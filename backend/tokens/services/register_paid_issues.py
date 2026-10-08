import json
from contextlib import contextmanager
from uuid import UUID, uuid4

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import IntegrityError, OperationalError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.models import OutgoingOperation, OutgoingStatus
from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority_requests import _requester_principal
from offerings.models import Offering, Subscription, SubscriptionStatus
from offerings.services.subscription import cap_headroom, chain_snapshot
from shared.db import atomic, use_operator
from tokens.exceptions import (
    IssuanceExecutionConflict,
    IssuanceSigningHold,
    RegisterChangeConflict,
)
from tokens.models import (
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterInstruction,
    RegisterInstructionDecision,
    RequestStatus,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
)
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.register_authority import register_appointment
from tokens.services.register_decisions import DecisionFamily, _scalar, decide, preview
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_inclusions import opened_by_import
from tokens.services.register_instructions import _named
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.exceptions import WhitelistSigningHold
from whitelist.services.company_wallet_instructions import _lock_context


def _scalar_text(value):
    return None if value is None else str(value)


def source_snapshot(subscription):
    identity = identity_at_allotment(subscription.wallet.address, chain=subscription.offering.token.chain)
    return {
        "subscription": str(subscription.pk),
        "offering": str(subscription.offering_id),
        "company": str(subscription.company_id),
        "token": str(subscription.offering.token_id),
        "recipient_address": subscription.wallet.address.lower(),
        "recipient_name": identity.name,
        "shares": str(subscription.allotment_quantity),
        "requested_shares": str(subscription.quantity),
        "currency": subscription.currency,
        "price_per_share": str(subscription.price_per_share),
        "amount_due": str(subscription.amount_due),
        "amount_received": _scalar_text(subscription.amount_received),
        "money_held": str(subscription.money_held),
        "payment_received_on": (
            subscription.payment_received_on.isoformat() if subscription.payment_received_on else None
        ),
        "payment_reference_seen": subscription.payment_reference_seen or "",
        "payment_tx_hash": subscription.payment_tx_hash,
        "payment_confirmed_at": (
            subscription.payment_confirmed_at.isoformat() if subscription.payment_confirmed_at else None
        ),
        "refund_amount": _scalar_text(subscription.refund_amount),
        "refunded_at": subscription.refunded_at.isoformat() if subscription.refunded_at else None,
    }


def _subscription(reference):
    return (
        Subscription.objects.select_related("offering__token__company", "wallet", "user_account__user_profile")
        .filter(pk=reference)
        .first()
    )


def ready_subscriptions(*, actor, company, token):
    try:
        company, token = UUID(str(company)), UUID(str(token))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Choose the exact company and share class.") from None
    with use_operator(), _requester_principal(actor.pk):
        if (
            not CompanyAppointment.objects.current_for(actor, company, at=timezone.now(), identity_required=False)
            .holding_any([CompanyCapability.ADMIN, CompanyCapability.PREPARE])
            .exists()
        ):
            raise NotFound("Company paid issue sources not found.")
        current = ShareToken.objects.register_readable_by(actor).filter(pk=token, company_id=company).first()
        if current is None:
            raise NotFound("Share class not found.")
        if opened_by_import(token):
            return []
        return [
            source_snapshot(row)
            for row in Subscription.objects.awaiting_allotment()
            .filter(company_id=company, offering__token_id=token)
            .with_relations()
            .order_by("created_at", "uuid")
            if row.allotment_quantity > 0
            and row.refunded_at is None
            and row.wallet.user_account_id == row.user_account_id
        ]


def _approval(proposal):
    return _scalar("SELECT tokens_register_paid_issue_approval(%s, clock_timestamp())", [proposal.pk])


def _supply(proposal):
    with use_operator():
        subscription = _subscription(proposal.paid_subscription_id)
        if subscription is None:
            raise RegisterChangeConflict()
        return chain_snapshot(subscription.offering)


def _available(proposal):
    subscription = _subscription(proposal.paid_subscription_id)
    token = subscription.offering.token
    captured = getattr(proposal, "_paid_supply", None) or proposal.snapshot["chain_supply"]
    register = ShareRegister.objects.filter(token=token, sequence__gt=0).first()
    issued = max(int(captured[1]), int(register.issued_supply) if register else 0)
    reserved = ShareIssuanceRequest.objects.unminted(token).exclude(pk=proposal.request_id).share_total()
    pending = (
        ShareIssuanceExecution.objects.filter(token_id=token.pk, status="executed")
        .exclude(request_id=proposal.request_id)
        .filter(
            request_id__in=ShareIssuanceRequest.objects.filter(
                executed_at__gte=proposal.snapshot["observed_at"]
            ).values("pk")
        )
    )
    if register is not None:
        from tokens.models import RegisterEntry

        pending = pending.exclude(
            issuance_id__in=RegisterEntry.objects.filter(register=register, kind="issue").values("operation_id")
        )
    reserved += ShareIssuanceRequest.objects.filter(pk__in=pending.values("request_id")).share_total()
    room = cap_headroom(subscription.offering)
    if subscription.issuance_request_id == proposal.request_id and proposal.request_id:
        room += subscription.allotment_quantity
    return issued, reserved, int(token.total_supply) - issued - reserved, room


def _state(proposal):
    from tokens.services.issuance_execution import _intent

    subscription = _subscription(proposal.paid_subscription_id)
    if subscription is None:
        return ["subscription_source_changed"]
    token = subscription.offering.token
    unmet = []
    if subscription.status != SubscriptionStatus.PAID:
        unmet.append("subscription_not_paid")
    if subscription.issuance_request_id not in (None, proposal.request_id):
        unmet.append("subscription_already_admitted")
    if subscription.refunded_at is not None:
        unmet.append("subscription_refunded")
    if (
        subscription.amount_received is None
        or subscription.money_held < subscription.price_per_share * subscription.allotment_quantity
    ):
        unmet.append("subscription_not_paid")
    if subscription.wallet.chain != "base":
        unmet.append("subscription_source_changed")
    if subscription.allotment_quantity < 1:
        unmet.append("nothing_to_allot")
    if (
        source_snapshot(subscription) != proposal.snapshot["source"]
        or subscription.wallet.user_account_id != subscription.user_account_id
        or str(subscription.wallet_id) != proposal.snapshot["private"]["wallet"]
        or str(subscription.user_account_id) != proposal.snapshot["private"]["account"]
    ):
        unmet.append("subscription_source_changed")
    if (
        token.company_id != proposal.company_id
        or subscription.company_id != proposal.company_id
        or token.company.status != "active"
    ):
        unmet.append("class_identity_changed")
    if token.status != "deployed" or token.chain != "base" or token.decimals != 0 or not token.contract_address:
        unmet.append("class_not_deployed")
    if {
        "uuid": str(token.pk),
        "name": token.name,
        "symbol": token.symbol,
        "chain": token.chain,
        "contract_address": (token.contract_address or "").lower(),
        "authorised_shares": str(token.total_supply),
    } != proposal.snapshot["token"]:
        unmet.append("class_identity_changed")
    if {
        "uuid": str(token.company_id),
        "name": token.company.name,
        "acn": token.company.acn,
        "status": token.company.status,
    } != proposal.snapshot["company"]:
        unmet.append("class_identity_changed")
    if opened_by_import(token.pk):
        unmet.append("imported_register")
    if _named(proposal.approving_director) == _named(proposal.snapshot["source"]["recipient_name"]):
        unmet.append("approving_director_conflict")
    candidate = ShareIssuanceRequest(
        company_id=proposal.company_id,
        token=token,
        recipient_address=proposal.snapshot["source"]["recipient_address"],
        amount=int(proposal.snapshot["source"]["shares"]),
    )
    try:
        if _intent(candidate, token) != proposal.intent:
            unmet.append("class_identity_changed")
    except (IssuanceExecutionConflict, ValidationError, ValueError, TypeError, AttributeError):
        unmet.append("class_identity_changed")
    _, _, available, offering_room = _available(proposal)
    if subscription.allotment_quantity > min(available, offering_room):
        unmet.append("insufficient_headroom")
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
    except (ValidationError, TypeError, KeyError):
        unmet.append("evidence_unavailable")
    return sorted(set(unmet))


def _before_command(actor, proposal, kind, appointment):
    if kind == "reject":
        return []
    try:
        proposal._paid_supply = _supply(proposal)
        amount = int(proposal.snapshot["source"]["shares"])
        reserved = proposal._paid_supply[2]
        if (
            proposal.request_id
            and ShareIssuanceRequest.objects.filter(
                pk=proposal.request_id, status__in=["approved", "executing"]
            ).exists()
        ):
            reserved -= amount
        return (
            ["insufficient_headroom"] if amount > proposal._paid_supply[0] - proposal._paid_supply[1] - reserved else []
        )
    except Exception:
        return ["provider_unavailable"]


def _lock(proposal):
    ShareToken.objects.select_for_update(nowait=True, of=("self",)).get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    Offering.objects.select_for_update().get(pk=proposal.snapshot["source"]["offering"])
    Subscription.objects.select_for_update().get(pk=proposal.paid_subscription_id)
    current = RegisterInstruction.objects.select_for_update().get(pk=proposal.pk)
    if current.request_id:
        ShareIssuanceRequest.objects.select_for_update().get(pk=current.request_id)
    if hasattr(proposal, "_paid_supply"):
        current._paid_supply = proposal._paid_supply
    return current


@contextmanager
def _command(actor, initial, operation, recorded=False):
    with company_operation(actor, initial.company_id, operation), atomic(durable=True):
        company = Company.objects.select_for_update().get(pk=initial.company_id)
        decisions = (
            list(RegisterInstructionDecision.objects.filter(pk=_approval(initial)))
            if initial.pk and not initial._state.adding and not recorded and not operation.endswith("reject")
            else []
        )
        appointments = list(CompanyAppointment.objects.filter(company=company, appointee_id=actor.pk)) + list(
            CompanyAppointment.objects.filter(pk__in=[row.appointment_id for row in decisions])
        )
        if not recorded and not operation.endswith("reject"):
            Wallet.objects.select_for_update(nowait=True, no_key=True, of=("self",)).get(
                pk=initial.snapshot["private"]["wallet"]
            )
            UserAccount.objects.select_for_update(nowait=True, no_key=True, of=("self",)).get(
                pk=initial.snapshot["private"]["account"]
            )
        operator, _ = _lock_context(company, {actor.pk, *[row.decided_by_id for row in decisions]}, None, appointments)
        current_actor = get_user_model().objects.get(pk=actor.pk)
        yield company, current_actor, UserProfile.objects.filter(user=current_actor).first(), operator


def prepare_paid_issue(
    *,
    actor,
    operation_id,
    appointment,
    subscription,
    approving_director,
    authority_reference,
    reason,
    authority_evidence
):
    from tokens.services.issuance_execution import _intent

    try:
        operation_id, appointment, subscription, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, subscription, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Paid issue references must be UUIDs.") from None
    values = {"approving_director": approving_director, "authority_reference": authority_reference, "reason": reason}
    for name, limit in (("approving_director", 255), ("authority_reference", 255), ("reason", 1000)):
        if not isinstance(values[name], str) or not values[name].strip() or len(values[name]) > limit:
            raise ValidationError({name: "Provide a bounded nonblank value."})
        values[name] = values[name].strip()
    with use_operator(), _requester_principal(actor.pk):
        prior = (
            RegisterInstruction.objects.company_paid_issues()
            .register_readable_by(actor)
            .filter(pk=operation_id)
            .first()
        )
        expected = {
            "paid_subscription_id": subscription,
            "preparing_appointment_id": appointment,
            "submitted_by_id": actor.pk,
            "authority_evidence_id": authority_evidence,
            **values,
        }
        if prior is not None:
            if any(getattr(prior, name) != value for name, value in expected.items()):
                raise RegisterChangeConflict()
            return prior
        selected = _subscription(subscription)
        if (
            selected is None
            or not ShareToken.objects.register_readable_by(actor).filter(pk=selected.offering.token_id).exists()
        ):
            raise NotFound("Paid subscription not found.")
        observed = timezone.now().isoformat()
        supply = chain_snapshot(selected.offering)
        initial = RegisterInstruction(
            company_id=selected.company_id,
            paid_subscription_id=subscription,
            snapshot={"private": {"wallet": str(selected.wallet_id), "account": str(selected.user_account_id)}},
        )
    proposal = None
    try:
        with _command(actor, initial, "register_paid_issue_prepare") as (company, current_actor, profile, operator):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            current = ShareToken.objects.select_for_update(nowait=True, of=("self",)).get(
                pk=selected.offering.token_id, company=company
            )
            Offering.objects.select_for_update().get(pk=selected.offering_id)
            Subscription.objects.select_for_update().get(pk=subscription)
            selected = _subscription(subscription)
            replay = RegisterInstruction.objects.filter(pk=operation_id).first()
            if replay is not None:
                if any(getattr(replay, name) != value for name, value in expected.items()):
                    raise RegisterChangeConflict()
                return replay
            request_id, dispatch_id = uuid4(), uuid4()
            candidate = ShareIssuanceRequest(
                uuid=request_id,
                dispatch_id=dispatch_id,
                company=company,
                token=current,
                recipient_address=selected.wallet.address,
                amount=selected.allotment_quantity,
            )
            intent = _intent(candidate, current)
            register = ShareRegister.objects.filter(token=current).first()
            snapshot = {
                "company": {
                    "uuid": str(company.pk),
                    "name": company.name,
                    "acn": company.acn,
                    "status": company.status,
                },
                "token": {
                    "uuid": str(current.pk),
                    "name": current.name,
                    "symbol": current.symbol,
                    "chain": current.chain,
                    "contract_address": current.contract_address.lower(),
                    "authorised_shares": str(current.total_supply),
                },
                "source": source_snapshot(selected),
                "register": {
                    "present": register is not None,
                    "uuid": str(register.pk) if register else None,
                    "sequence": register.sequence if register else None,
                    "head_hash": register.head_hash if register else None,
                    "issued_supply": str(register.issued_supply) if register else None,
                },
                "transaction": {name: intent[name] for name in ("chain_id", "sender", "to", "value", "data")},
                "private": {
                    "wallet": str(selected.wallet_id),
                    "account": str(selected.user_account_id),
                    "request": str(request_id),
                    "dispatch": str(dispatch_id),
                },
                "chain_supply": list(supply),
                "observed_at": observed,
            }
            proposal = RegisterInstruction(
                uuid=operation_id,
                company=company,
                token=current,
                kind="issue",
                paid_subscription=selected,
                items=[
                    {
                        "subscription": str(subscription),
                        "recipient": selected.wallet.address.lower(),
                        "amount": str(selected.allotment_quantity),
                    }
                ],
                preparing_appointment=source,
                submitted_by=current_actor,
                snapshot=snapshot,
                intent=intent,
                intent_digest=_scalar(
                    "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(intent)]
                ),
                **values
            )
            evidence = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(
                evidence,
                RegisterEvidenceKind.AUTHORITY,
                company,
                current_actor,
                "Retain this preparer's exact company authority evidence.",
            )
            proposal.authority_evidence = evidence
            proposal.evidence_fingerprint, proposal.evidence_snapshot = evidence.sha256, evidence_snapshot(evidence)
            proposal.file.save("evidence.bin", ContentFile(raw), save=False)
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            proposal.save(force_insert=True)
            return proposal
    except IntegrityError:
        if proposal is not None:
            discard(proposal.file)
        raise RegisterChangeConflict() from None
    except (OperationalError, WhitelistSigningHold) as exception:
        if proposal is not None:
            discard(proposal.file)
        if isinstance(exception, WhitelistSigningHold) or getattr(exception.__cause__, "sqlstate", None) == "55P03":
            unmet = (
                exception.unmet_requirements if isinstance(exception, WhitelistSigningHold) else ["source_lock_busy"]
            )
            raise ValidationError({"unmet_requirements": unmet}) from None
        raise
    except BaseException:
        if proposal is not None:
            discard(proposal.file)
        raise


def _details(proposal):
    issued, reserved, available, offering_room = _available(proposal)
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "approval_decision": proposal.approval_decision_id or _approval(proposal),
        "shares": proposal.snapshot["source"]["shares"],
        "approving_director": proposal.approving_director,
        "authority_reference": proposal.authority_reference,
        "reason": proposal.reason,
        "offering_headroom": str(offering_room),
        "issued_supply": str(issued),
        "reserved_shares": str(reserved),
        "authorised_supply": proposal.snapshot["token"]["authorised_shares"],
        "available_shares": str(min(available, offering_room)),
    }


def _apply(proposal, actor, decision):
    from tokens.services.issuance_execution import admit_company

    subscription = Subscription.objects.select_for_update().get(pk=proposal.paid_subscription_id)
    proposal.approval_decision_id = _approval(proposal)
    if proposal.approval_decision_id is None or subscription.issuance_request_id:
        raise RegisterChangeConflict()
    request = ShareIssuanceRequest.objects.create(
        uuid=UUID(proposal.snapshot["private"]["request"]),
        dispatch_id=UUID(proposal.snapshot["private"]["dispatch"]),
        company_id=proposal.company_id,
        token_id=proposal.token_id,
        recipient_address=proposal.intent["recipient"],
        recipient_name=proposal.snapshot["source"]["recipient_name"],
        amount=int(proposal.intent["amount"]),
        reason=proposal.reason,
        submitted_by=actor,
        submitted_at=decision.decided_at,
        status=RequestStatus.UNDER_REVIEW,
    )
    proposal.request = request
    proposal.status, proposal.reviewed_by, proposal.reviewed_at = "applied", actor, decision.decided_at
    proposal.save(update_fields=["request", "status", "approval_decision", "reviewed_by", "reviewed_at", "updated_at"])
    request.status, request.reviewed_by, request.reviewed_at = RequestStatus.APPROVED, actor, decision.decided_at
    request.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    subscription.issuance_request = request
    subscription.save(update_fields=["issuance_request", "updated_at"])
    admit_company(request, proposal, actor, subscription=subscription)


PAID_ISSUES = DecisionFamily(
    model=RegisterInstruction,
    decision_model=RegisterInstructionDecision,
    field="instruction",
    operation="register_paid_issue",
    approved_function="tokens_register_paid_issue_approved",
    digest_function="tokens_register_paid_issue_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
    before_command=_before_command,
    command=_command,
    noun="paid issue",
)


def _issue_of(actor, reference):
    with use_operator(), _requester_principal(actor.pk):
        if (
            not RegisterInstruction.objects.company_paid_issues()
            .register_readable_by(actor)
            .filter(pk=reference)
            .exists()
        ):
            raise NotFound("Paid register issue not found.")


def preview_paid_issue_decision(*, actor, paid_issue_id, appointment, kind, reason=""):
    _issue_of(actor, paid_issue_id)
    return preview(
        PAID_ISSUES, _details, actor=actor, proposal_id=paid_issue_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_paid_issue(
    *, actor, paid_issue_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    _issue_of(actor, paid_issue_id)
    try:
        return decide(
            PAID_ISSUES,
            actor=actor,
            proposal_id=paid_issue_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
    except (OperationalError, WhitelistSigningHold) as exception:
        if isinstance(exception, WhitelistSigningHold) or getattr(exception.__cause__, "sqlstate", None) == "55P03":
            unmet = (
                exception.unmet_requirements if isinstance(exception, WhitelistSigningHold) else ["source_lock_busy"]
            )
            raise ValidationError({"unmet_requirements": unmet}) from None
        raise


def execution_requirements(proposal):
    from tokens.services.register_issues import _authority_requirements

    execution = ShareIssuanceExecution.objects.select_related("operation").filter(source_instruction=proposal).first()
    if proposal.status != "applied" or (
        execution
        and (
            execution.status == "executed"
            or execution.operation
            and execution.operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED)
        )
    ):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


def permanent_source_loss(proposal, unmet):
    if "company_source_expired" not in unmet:
        return False
    from blockchain.models import SignedAttempt
    from companies.models import CompanyAppointmentRevocation

    execution = ShareIssuanceExecution.objects.filter(source_instruction=proposal).first()
    if (
        execution
        and execution.operation_id
        and SignedAttempt.objects.filter(operation_id=execution.operation_id).exists()
    ):
        return False
    decisions = RegisterInstructionDecision.objects.filter(
        pk=proposal.approval_decision_id
    ) | RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply")
    return any(
        CompanyAppointmentRevocation.objects.filter(appointment_id=row.appointment_id).exists()
        or _scalar(
            "SELECT expires_at <= clock_timestamp() FROM companies_companyappointment WHERE uuid = %s",
            [row.appointment_id],
        )
        is True
        for row in decisions
    )


def lock_execution_source(execution):
    source = RegisterInstruction.objects.filter(
        pk=execution.source_instruction_id, paid_subscription_id=execution.subscription_id
    ).first()
    if source is None:
        return
    Company.objects.select_for_update().get(pk=execution.company_id)
    ShareToken.objects.select_for_update(nowait=True, of=("self",)).get(pk=execution.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=execution.token_id).values_list("uuid", flat=True))
    Offering.objects.select_for_update().get(pk=source.snapshot["source"]["offering"])
    Subscription.objects.select_for_update().get(pk=execution.subscription_id)
    ShareIssuanceRequest.objects.select_for_update().get(pk=execution.request_id)
    RegisterInstruction.objects.select_for_update().get(pk=source.pk)
    ShareIssuanceExecution.objects.select_for_update().get(pk=execution.pk)


@contextmanager
def signing_source(execution, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = RegisterInstruction.objects.filter(
        pk=execution.source_instruction_id,
        paid_subscription_id=execution.subscription_id,
        request_id=execution.request_id,
        status="applied",
    ).first()
    if source is None:
        raise IssuanceSigningHold(["legacy_source_unavailable"])
    try:
        company = Company.objects.select_for_update().get(pk=source.company_id)
        Wallet.objects.select_for_update(nowait=True, no_key=True, of=("self",)).get(
            pk=source.snapshot["private"]["wallet"]
        )
        UserAccount.objects.select_for_update(nowait=True, no_key=True, of=("self",)).get(
            pk=source.snapshot["private"]["account"]
        )
        decisions = list(
            RegisterInstructionDecision.objects.filter(pk=source.approval_decision_id)
            | RegisterInstructionDecision.objects.filter(instruction=source, kind="apply")
        )
        appointments = list(CompanyAppointment.objects.filter(pk__in=[row.appointment_id for row in decisions]))
        _lock_context(company, {row.decided_by_id for row in decisions}, None, appointments)
        lock_execution_source(execution)
        source = RegisterInstruction.objects.get(pk=source.pk)

        def validate(operation):
            unmet = execution_requirements(source)
            if execution.intent != source.intent or execution.executed_by_id != source.reviewed_by_id:
                unmet.append("class_identity_changed")
            if unmet:
                raise IssuanceSigningHold(sorted(set(unmet)))

        yield validate
    except OperationalError as exception:
        if getattr(exception.__cause__, "sqlstate", None) == "55P03":
            raise IssuanceSigningHold(["source_lock_busy"]) from None
        raise
    except WhitelistSigningHold as exception:
        raise IssuanceSigningHold(exception.unmet_requirements) from None
