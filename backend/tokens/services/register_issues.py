import json
from contextlib import contextmanager
from datetime import date
from datetime import timezone as utc_zone
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import IntegrityError, OperationalError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.models import OutgoingOperation, OutgoingStatus
from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, use_operator
from tokens.exceptions import IssuanceSigningHold, RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterInstruction,
    RegisterInstructionDecision,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterPosition,
    RequestStatus,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
)
from tokens.services.register import member_identities
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
from users.models import UserProfile
from wallets.models import Wallet
from whitelist.exceptions import WhitelistSigningHold
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistApproval,
    WhitelistChange,
)
from whitelist.services.changes import lock_target
from whitelist.services.company_wallet_instructions import _lock_context
from whitelist.services.wallet_nominations import nomination_requirements


def _busy(exception):
    return getattr(exception.__cause__, "sqlstate", None) == "55P03"


def _company_of(actor, token):
    with use_operator(), _requester_principal(actor.pk):
        company = (
            ShareToken.objects.register_readable_by(actor).filter(pk=token).values_list("company_id", flat=True).first()
        )
    if company is None:
        raise NotFound("Share class not found.")
    return company


def _approval(proposal):
    return _scalar("SELECT tokens_register_issue_approval(%s, clock_timestamp())", [proposal.pk])


def _allocations(token, request_id):
    register = ShareRegister.objects.filter(token=token, sequence__gt=0).first()
    issued = int(register.issued_supply) if register else 0
    reserved = ShareIssuanceRequest.objects.unminted(token).exclude(pk=request_id).share_total()
    pending = (
        ShareIssuanceExecution.objects.unentered_after_opening(token)
        .exclude(request_id=request_id)
        .values_list("request_id", flat=True)
    )
    reserved += ShareIssuanceRequest.objects.filter(pk__in=pending).share_total()
    return register, issued, reserved, int(token.total_supply) - issued - reserved


def _identity(token, member, address):
    if not RegisterMemberWallet.objects.filter(
        company_id=token.company_id, member_id=member, address__iexact=address
    ).exists():
        raise ValidationError({"unmet_requirements": ["member_link_required"]})
    identity = member_identities(token, [member])[member]
    if (
        not identity.name
        or not identity.residential_address
        or identity.holder_type in ("unidentified", "ambiguous", "treasury")
    ):
        raise ValidationError({"unmet_requirements": ["member_identity_unavailable"]})
    return {
        "uuid": str(member),
        "name": identity.name,
        "residential_address": identity.residential_address,
        "identity_source": identity.source,
        "address": address.lower(),
    }


def _wallet_requirements(proposal):
    nomination = (
        CompanyWalletNomination.objects.select_related("request", "decision").filter(pk=proposal.nomination_id).first()
    )
    if nomination is None or nomination.company_id != proposal.company_id:
        return ["wallet_source_changed"]
    unmet = nomination_requirements(nomination)
    if nomination.snapshot != proposal.snapshot["private"]:
        unmet.append("wallet_source_changed")
    approval = WhitelistChange.objects.filter(pk=proposal.wallet_approval_id).first()
    target = proposal.snapshot["wallet"]
    if approval is None or (
        approval.company_id != proposal.company_id
        or approval.action != "add"
        or approval.status not in ("confirmed", "unchanged")
        or approval.address != target["address"]
        or approval.registry_address != target["registry_address"]
        or approval.chain_id != target["chain_id"]
        or approval.expires_at is None
        or not CompanyWalletInstruction.objects.filter(
            pk=approval.source_instruction_id,
            company_id=proposal.company_id,
            nomination_id=nomination.pk,
            change_id=approval.pk,
            status="applied",
            action="add",
        ).exists()
    ):
        unmet.append("wallet_approval_required")
    elif approval.expires_at.isoformat() != target["expires_at"] or approval.expires_at <= timezone.now():
        unmet.append("wallet_approval_lapsed")
    elif not WhitelistApproval.objects.filter(
        company_id=proposal.company_id,
        entry__wallet_id=nomination.wallet_id,
        registry_address=target["registry_address"],
        status="active",
        expires_at=approval.expires_at,
    ).exists():
        unmet.append("wallet_approval_lapsed")
    return unmet


def _state(proposal):
    from tokens.services.issuance_execution import _intent

    token = ShareToken.objects.select_related("company").get(pk=proposal.token_id)
    unmet = _wallet_requirements(proposal)
    if token.company.status != "active":
        unmet.append("company_not_active")
    if proposal.snapshot["company"] != {
        "uuid": str(token.company_id),
        "name": token.company.name,
        "acn": token.company.acn,
        "status": token.company.status,
    }:
        unmet.append("class_identity_changed")
    if token.status != "deployed" or token.chain != "base" or token.decimals != 0 or not token.contract_address:
        unmet.append("class_not_deployed")
    captured = proposal.snapshot["token"]
    if (
        str(token.pk),
        token.name,
        token.symbol,
        token.chain,
        (token.contract_address or "").lower(),
        str(token.total_supply),
    ) != (
        captured["uuid"],
        captured["name"],
        captured["symbol"],
        captured["chain"],
        captured["contract_address"],
        captured["authorised_shares"],
    ) or token.company_id != proposal.company_id:
        unmet.append("class_identity_changed")
    if opened_by_import(token.pk):
        unmet.append("imported_register")
    register, issued, reserved, available = _allocations(token, proposal.request_id)
    if (
        register is None
        or not RegisterOpening.objects.filter(
            pk=proposal.snapshot["register"]["opening"],
            token_id=token.pk,
            status="applied",
            applied_entry__register=register,
        ).exists()
    ):
        unmet.append("chain_register_required")
    try:
        if _identity(token, proposal.member_id, proposal.snapshot["member"]["address"]) != proposal.snapshot["member"]:
            unmet.append("member_identity_changed")
    except ValidationError as exception:
        unmet.extend(exception.detail.get("unmet_requirements", ["member_identity_unavailable"]))
    if _named(proposal.approving_director) == _named(proposal.snapshot["member"]["name"]):
        unmet.append("approving_director_conflict")
    request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
    if int(request.amount) > available:
        unmet.append("insufficient_headroom")
    if proposal.items != [
        {"request": str(request.pk), "recipient": proposal.snapshot["member"]["address"], "amount": str(request.amount)}
    ]:
        unmet.append("class_identity_changed")
    try:
        if _intent(request, token) != proposal.intent:
            unmet.append("class_identity_changed")
    except (ValidationError, ValueError, TypeError, AttributeError):
        unmet.append("class_identity_changed")
    for file, snapshot, fingerprint in (
        (proposal.file, proposal.evidence_snapshot, proposal.evidence_fingerprint),
        (proposal.terms_file, proposal.terms_snapshot, proposal.terms_fingerprint),
        *(
            (
                [(proposal.acceptance_file, proposal.acceptance_snapshot, proposal.acceptance_fingerprint)]
                if proposal.acceptance_required
                else []
            )
        ),
    ):
        try:
            matching_bytes(file, snapshot["file_size"], fingerprint)
        except (ValidationError, TypeError, KeyError):
            unmet.append("evidence_unavailable")
    return sorted(set(unmet))


@contextmanager
def _command(actor, initial, operation, recorded=False):
    snapshot = initial.snapshot
    with company_operation(actor, initial.company_id, operation), atomic(durable=True):
        if not recorded and operation != "register_issue_reject":
            target = snapshot["wallet"]
            lock_target(target["chain_id"], target["registry_address"], target["address"])
        company = Company.objects.select_for_update().get(pk=initial.company_id)
        actor_ids = {actor.pk}
        appointments = list(CompanyAppointment.objects.filter(appointee_id=actor.pk, company_id=company.pk))
        if not recorded and operation != "register_issue_reject":
            approval = RegisterInstructionDecision.objects.filter(pk=_approval(initial)).first() if initial.pk else None
            if approval is not None:
                actor_ids.add(approval.decided_by_id)
                appointments += list(CompanyAppointment.objects.filter(pk=approval.appointment_id))
        associations = snapshot["private"] if not recorded and operation != "register_issue_reject" else None
        operator, _ = _lock_context(company, actor_ids, associations, appointments)
        current_actor = get_user_model().objects.get(pk=actor.pk)
        yield company, current_actor, UserProfile.objects.filter(user=current_actor).first(), operator
        if not recorded and operation == "register_issue_reject":
            rejected = RegisterInstruction.objects.get(pk=initial.pk)
            request = ShareIssuanceRequest.objects.get(pk=rejected.request_id)
            request.status = RequestStatus.REJECTED
            request.reviewed_by = rejected.reviewed_by
            request.reviewed_at = rejected.reviewed_at
            request.rejection_reason = rejected.rejection_reason
            request.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])


def prepare_issue(
    *,
    actor,
    operation_id,
    appointment,
    token,
    member,
    nomination,
    wallet_approval,
    shares,
    approving_director,
    authority_reference,
    reason,
    terms_on,
    terms,
    acceptance_required,
    authority_evidence,
    terms_evidence,
    acceptance_evidence=None,
):
    from tokens.services.issuance_execution import _intent

    try:
        operation_id, appointment, token, member, nomination, wallet_approval, authority_evidence, terms_evidence = (
            UUID(str(value))
            for value in (
                operation_id,
                appointment,
                token,
                member,
                nomination,
                wallet_approval,
                authority_evidence,
                terms_evidence,
            )
        )
        acceptance_evidence = UUID(str(acceptance_evidence)) if acceptance_evidence is not None else None
        quantity = int(shares)
        if type(shares) is bool or str(shares) != str(quantity) or not 1 <= quantity <= 2147483647:
            raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Grant references and whole shares must be valid.") from None
    if acceptance_required is not True and acceptance_required is not False:
        raise ValidationError("State whether the company terms require acceptance.")
    if acceptance_required != (acceptance_evidence is not None):
        raise ValidationError("Retain acceptance evidence exactly when the company terms require it.")
    if type(terms_on) is not date:
        raise ValidationError("Retain the company-supplied terms date.")
    if terms_on > timezone.now().astimezone(utc_zone.utc).date():
        raise ValidationError("The supplied terms date cannot be in the future.")
    values = {
        "approving_director": approving_director,
        "authority_reference": authority_reference,
        "reason": reason,
        "terms": terms,
    }
    for name, limit in (("approving_director", 255), ("authority_reference", 255), ("reason", 1000), ("terms", 1000)):
        if not isinstance(values[name], str) or not values[name].strip() or len(values[name]) > limit:
            raise ValidationError("Retain the company's director, authority reference, reason and grant terms.")
        values[name] = values[name].strip()
    company_id = _company_of(actor, token)
    with use_operator(), _requester_principal(actor.pk):
        prior = RegisterInstruction.objects.filter(pk=operation_id, company_id=company_id).first()
        nominated = CompanyWalletNomination.objects.filter(pk=nomination, company_id=company_id).first()
        approval = WhitelistChange.objects.filter(pk=wallet_approval, company_id=company_id).first()
    expected = {
        "token_id": token,
        "member_id": member,
        "nomination_id": nomination,
        "wallet_approval_id": wallet_approval,
        "terms_on": terms_on,
        "acceptance_required": acceptance_required,
        "authority_evidence_id": authority_evidence,
        "terms_evidence_id": terms_evidence,
        "acceptance_evidence_id": acceptance_evidence,
        "preparing_appointment_id": appointment,
        "submitted_by_id": actor.pk,
        **values,
    }
    if prior is not None:
        with use_operator(), _requester_principal(actor.pk):
            if (
                not RegisterInstruction.objects.register_readable_by(actor).filter(pk=prior.pk).exists()
                or any(getattr(prior, name) != value for name, value in expected.items())
                or prior.request.amount != quantity
            ):
                raise RegisterChangeConflict()
            return prior
    if nominated is None or approval is None:
        raise ValidationError({"unmet_requirements": ["wallet_approval_required"]})
    initial = RegisterInstruction(
        company_id=company_id,
        snapshot={
            "private": nominated.snapshot,
            "wallet": {
                "chain_id": approval.chain_id,
                "registry_address": approval.registry_address,
                "address": approval.address,
            },
        },
    )
    proposal = None
    try:
        with _command(actor, initial, "register_issue_prepare") as (company, current_actor, profile, operator):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            current = ShareToken.objects.select_for_update(of=("self",)).get(pk=token, company=company)
            list(ShareRegister.objects.select_for_update().filter(token=current).values_list("uuid", flat=True))
            replay = RegisterInstruction.objects.filter(pk=operation_id).first()
            if replay is not None:
                if (
                    any(getattr(replay, name) != value for name, value in expected.items())
                    or replay.request.amount != quantity
                ):
                    raise RegisterChangeConflict()
                return replay
            register = ShareRegister.objects.filter(token=current, sequence__gt=0).first()
            opening = RegisterOpening.objects.filter(
                token=current, status="applied", applied_entry__register=register
            ).first()
            if register is None or opening is None:
                raise ValidationError({"unmet_requirements": ["chain_register_required"]})
            identified = _identity(current, member, nominated.snapshot["address"])
            request = ShareIssuanceRequest.objects.create(
                token=current,
                company=company,
                recipient_address=identified["address"],
                recipient_name=identified["name"],
                amount=quantity,
                reason=values["reason"],
                submitted_by=current_actor,
                submitted_at=timezone.now(),
                status=RequestStatus.UNDER_REVIEW,
            )
            intent = _intent(request, current)
            position = RegisterPosition.objects.filter(register=register, member_id=member).first()
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
                "member": identified,
                "wallet": {
                    "nomination": str(nomination),
                    "approval": str(wallet_approval),
                    "address": approval.address,
                    "registry_address": approval.registry_address,
                    "chain_id": approval.chain_id,
                    "expires_at": approval.expires_at.isoformat() if approval.expires_at else "",
                    "proof_completed_at": nominated.snapshot["proof_completed_at"],
                    "eligibility_expires_at": nominated.snapshot["eligibility_expires_at"],
                },
                "register": {
                    "uuid": str(register.pk),
                    "opening": str(opening.pk),
                    "sequence": register.sequence,
                    "head_hash": register.head_hash,
                    "issued_supply": str(register.issued_supply),
                    "current_shares": str(position.shares) if position else "0",
                },
                "transaction": {name: intent[name] for name in ("chain_id", "sender", "to", "value", "data")},
                "private": nominated.snapshot,
            }
            proposal = RegisterInstruction(
                uuid=operation_id,
                company=company,
                token=current,
                kind="issue",
                request=request,
                items=[{"request": str(request.pk), "recipient": identified["address"], "amount": str(quantity)}],
                member_id=member,
                nomination_id=nomination,
                wallet_approval_id=wallet_approval,
                preparing_appointment=source,
                terms_on=terms_on,
                acceptance_required=acceptance_required,
                submitted_by=current_actor,
                snapshot=snapshot,
                intent=intent,
                intent_digest=_scalar(
                    "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(intent)]
                ),
                **values,
            )
            for prefix, reference, kind in (
                ("authority", authority_evidence, RegisterEvidenceKind.AUTHORITY),
                ("terms", terms_evidence, RegisterEvidenceKind.SUPPORTING),
                *(
                    (
                        [("acceptance", acceptance_evidence, RegisterEvidenceKind.SUPPORTING)]
                        if acceptance_required
                        else []
                    )
                ),
            ):
                evidence = RegisterEvidence.objects.select_for_update().filter(pk=reference).first()
                raw = own_evidence_bytes(
                    evidence, kind, company, current_actor, "Retain the evidence uploaded by this company preparer."
                )
                setattr(proposal, f"{prefix}_evidence", evidence)
                setattr(
                    proposal,
                    "evidence_snapshot" if prefix == "authority" else f"{prefix}_snapshot",
                    evidence_snapshot(evidence),
                )
                setattr(
                    proposal,
                    "evidence_fingerprint" if prefix == "authority" else f"{prefix}_fingerprint",
                    evidence.sha256,
                )
                getattr(proposal, "file" if prefix == "authority" else f"{prefix}_file").save(
                    "evidence.bin", ContentFile(raw), save=False
                )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            proposal.save(force_insert=True)
            return proposal
    except IntegrityError:
        if proposal is not None:
            discard(proposal.file, proposal.terms_file, proposal.acceptance_file)
        raise RegisterChangeConflict() from None
    except (OperationalError, WhitelistSigningHold) as exception:
        if isinstance(exception, WhitelistSigningHold) or _busy(exception):
            if proposal is not None:
                discard(proposal.file, proposal.terms_file, proposal.acceptance_file)
            unmet = (
                exception.unmet_requirements if isinstance(exception, WhitelistSigningHold) else ["source_lock_busy"]
            )
            raise ValidationError({"unmet_requirements": unmet}) from None
        raise
    except BaseException:
        if proposal is not None:
            discard(proposal.file, proposal.terms_file, proposal.acceptance_file)
        raise
    finally:
        if proposal is not None and proposal._state.adding:
            discard(proposal.file, proposal.terms_file, proposal.acceptance_file)


def _lock(proposal):
    ShareToken.objects.select_for_update(of=("self",)).get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    ShareIssuanceRequest.objects.select_for_update().get(pk=proposal.request_id)
    return RegisterInstruction.objects.select_for_update().get(pk=proposal.pk)


def _details(proposal):
    token = ShareToken.objects.get(pk=proposal.token_id)
    register, issued, reserved, available = _allocations(token, proposal.request_id)
    shares = int(proposal.request.amount)
    held = RegisterPosition.objects.filter(register=register, member_id=proposal.member_id).first()
    current = int(held.shares) if held else 0
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "approval_decision": proposal.approval_decision_id or _approval(proposal),
        "shares": str(shares),
        "terms_on": proposal.terms_on,
        "terms": proposal.terms,
        "acceptance_required": proposal.acceptance_required,
        "approving_director": proposal.approving_director,
        "authority_reference": proposal.authority_reference,
        "reason": proposal.reason,
        "register_sequence": register.sequence if register else 0,
        "issued_supply": str(issued),
        "reserved_shares": str(reserved),
        "authorised_supply": str(token.total_supply),
        "available_shares": str(available),
        "after_issued_supply": str(issued + shares),
        "current_shares": str(current),
        "after_shares": str(current + shares),
    }


def _apply(proposal, actor, decision):
    from tokens.services.issuance_execution import admit_company

    proposal.approval_decision_id = _approval(proposal)
    if proposal.approval_decision_id is None:
        raise RegisterChangeConflict()
    request = ShareIssuanceRequest.objects.get(pk=proposal.request_id)
    request.status = RequestStatus.APPROVED
    request.reviewed_by = actor
    request.reviewed_at = decision.decided_at
    request.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "approval_decision", "reviewed_by", "reviewed_at", "updated_at"])
    admit_company(request, proposal, actor)


ISSUES = DecisionFamily(
    model=RegisterInstruction,
    decision_model=RegisterInstructionDecision,
    field="instruction",
    operation="register_issue",
    approved_function="tokens_register_issue_approved",
    digest_function="tokens_register_issue_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
    command=_command,
    noun="issue",
)


def _issue_of(actor, issue_id):
    with use_operator(), _requester_principal(actor.pk):
        if not RegisterInstruction.objects.company_issues().register_readable_by(actor).filter(pk=issue_id).exists():
            raise NotFound("Register issue not found.")


def preview_issue_decision(*, actor, issue_id, appointment, kind, reason=""):
    _issue_of(actor, issue_id)
    return preview(
        ISSUES, _details, actor=actor, proposal_id=issue_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_issue(*, actor, issue_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    _issue_of(actor, issue_id)
    try:
        return decide(
            ISSUES,
            actor=actor,
            proposal_id=issue_id,
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
        if isinstance(exception, WhitelistSigningHold) or _busy(exception):
            unmet = (
                exception.unmet_requirements if isinstance(exception, WhitelistSigningHold) else ["source_lock_busy"]
            )
            raise ValidationError({"unmet_requirements": unmet}) from None
        raise


def _authority_requirements(proposal):
    decisions = [
        RegisterInstructionDecision.objects.filter(
            pk=proposal.approval_decision_id, instruction=proposal, kind="approve"
        ).first(),
        RegisterInstructionDecision.objects.filter(instruction=proposal, kind="apply").first(),
    ]
    if any(row is None for row in decisions):
        return ["company_source_expired"]
    for row, capability in zip(decisions, ("approve", "apply"), strict=True):
        if not _scalar(
            "SELECT tokens_register_appointment_current(%s, %s, %s, %s, clock_timestamp())",
            [row.appointment_id, proposal.company_id, row.decided_by_id, capability],
        ):
            return ["company_source_expired"]
    return []


def permanent_source_loss(proposal, unmet):
    if any(
        code in unmet
        for code in (
            "company_source_expired",
            "eligibility_source_lapsed",
            "wallet_proof_required",
            "wallet_approval_lapsed",
        )
    ):
        return True
    return (
        "wallet_source_changed" in unmet
        and not Wallet.objects.filter(pk=proposal.snapshot["private"]["wallet"]).exists()
    )


def execution_requirements(proposal):
    if proposal.status != "applied":
        return []
    execution = ShareIssuanceExecution.objects.select_related("operation").filter(source_instruction=proposal).first()
    if (
        execution
        and execution.operation
        and execution.operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED)
    ):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


def execution_receipt(proposal):
    execution = (
        ShareIssuanceExecution.objects.select_related("operation__current_attempt", "transaction")
        .filter(
            source_instruction=proposal,
            request_id=proposal.request_id,
            company_id=proposal.company_id,
            token_id=proposal.token_id,
        )
        .first()
    )
    if execution is None:
        return None
    operation = execution.operation
    attempt = operation.current_attempt if operation else None
    matched = attempt is not None and attempt.claim_id == operation.claim_id and attempt.operation_id == operation.pk
    entry = (
        RegisterEntry.objects.filter(
            operation_id=execution.issuance_id, register__token_id=proposal.token_id, kind="issue"
        ).first()
        if execution.issuance_id
        else None
    )
    finalized = execution.finalized_receipt or {}
    return {
        "execution": execution.pk,
        "status": execution.status,
        "request": execution.request_id,
        "dispatch_id": execution.pk,
        "issuance": execution.issuance_id,
        "operation_id": operation.pk if operation else None,
        "claim_id": operation.claim_id if operation else None,
        "operation_status": operation.status if operation else None,
        "transaction": execution.transaction_id,
        "tx_hash": attempt.tx_hash if matched else None,
        "block_number": finalized.get("block_number"),
        "block_hash": finalized.get("block_hash"),
        "completed_at": proposal.request.executed_at if execution.status == "executed" else None,
        "register_entry": entry.pk if entry else None,
        "effective_on": entry.effective_on if entry else None,
    }


@contextmanager
def signing_source(execution, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = RegisterInstruction.objects.filter(
        pk=execution.source_instruction_id, status="applied", request_id=execution.request_id
    ).first()
    if source is None:
        raise IssuanceSigningHold(["legacy_source_unavailable"])
    try:
        target = source.snapshot["wallet"]
        lock_target(target["chain_id"], target["registry_address"], target["address"])
        company = Company.objects.select_for_update().get(pk=source.company_id)
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if operation.claim_id == claim.claim_id and operation.status in (
            OutgoingStatus.SIGNED,
            OutgoingStatus.CONFIRMED,
        ):
            yield None
            return
        decisions = list(
            RegisterInstructionDecision.objects.filter(instruction=source, kind="apply")
            | RegisterInstructionDecision.objects.filter(pk=source.approval_decision_id)
        )
        appointments = list(CompanyAppointment.objects.filter(pk__in=[row.appointment_id for row in decisions]))
        _lock_context(company, {row.decided_by_id for row in decisions}, source.snapshot["private"], appointments)
        source = _lock(source)
        ShareIssuanceExecution.objects.select_for_update().get(pk=execution.pk)

        def validate(operation):
            unmet = _state(source) + _authority_requirements(source)
            if (
                execution.company_id != source.company_id
                or execution.token_id != source.token_id
                or execution.intent != source.intent
            ):
                unmet.append("class_identity_changed")
            if unmet:
                raise IssuanceSigningHold(sorted(set(unmet)))

        yield validate
    except (OperationalError, WhitelistSigningHold) as exception:
        if isinstance(exception, WhitelistSigningHold):
            raise IssuanceSigningHold(exception.unmet_requirements) from None
        if _busy(exception):
            raise IssuanceSigningHold(["source_lock_busy"]) from None
        raise
