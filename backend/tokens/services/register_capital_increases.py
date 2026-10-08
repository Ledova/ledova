import json
from contextlib import contextmanager
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
from integrations.base_chain import get_base_chain_client
from operators.models import Operator
from shared.db import atomic, use_operator
from tokens.exceptions import (
    CapitalIncreaseConflict,
    CapitalIncreaseSigningHold,
    RegisterChangeConflict,
)
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RegisterCapitalIncrease,
    RegisterCapitalIncreaseDecision,
    RegisterEvidence,
    RegisterEvidenceKind,
    RequestStatus,
    ShareToken,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, _scalar, decide, preview
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from users.models import UserProfile

INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")


def _busy(exception):
    return getattr(exception.__cause__, "sqlstate", None) == "55P03"


def _company_of(actor, token):
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            ShareToken.objects.register_readable_by(actor).filter(pk=token).values_list("company_id", flat=True).first()
        )
    if company_id is None:
        raise NotFound("Share class not found.")
    return company_id


def _approval(proposal):
    return _scalar("SELECT tokens_register_capital_approval(%s, clock_timestamp())", [proposal.pk])


def _terms(request, prior):
    return {
        "prior_authorized_total": str(prior),
        "additional_shares": str(request.additional_shares),
        "new_authorized_total": str(request.new_authorized_total),
        "purpose": request.purpose,
        "board_resolution_reference": request.board_resolution_reference,
        "shareholder_approval_reference": request.shareholder_approval_reference,
    }


def _state(proposal):
    from tokens.services.capital_execution import _intent

    token = ShareToken.objects.select_related("company").get(pk=proposal.token_id)
    request = CapitalIncreaseRequest.objects.get(pk=proposal.request_id)
    unmet = []
    if token.company.status != "active":
        unmet.append("company_not_active")
    if (
        token.status not in ("deployed", "paused")
        or token.chain != "base"
        or token.decimals != 0
        or not token.contract_address
    ):
        unmet.append("class_not_deployed")
    if proposal.snapshot["company"] != {
        "uuid": str(token.company_id),
        "name": token.company.name,
        "acn": token.company.acn,
        "status": token.company.status,
    } or proposal.snapshot["token"] != {
        "uuid": str(token.pk),
        "name": token.name,
        "symbol": token.symbol,
        "chain": token.chain,
        "contract_address": (token.contract_address or "").lower(),
        "authorised_shares": str(token.total_supply),
        "decimals": token.decimals,
    }:
        unmet.append("class_identity_changed")
    if proposal.snapshot["capital"] != _terms(request, int(token.total_supply)):
        unmet.append("capital_terms_changed")
    if request.token_id != token.pk or request.company_id != proposal.company_id:
        unmet.append("capital_terms_changed")
    try:
        if _intent(request, token) != proposal.intent:
            unmet.append("capital_configuration_changed")
    except CapitalIncreaseConflict:
        unmet.append("capital_configuration_changed")
    evidence = RegisterEvidence.objects.filter(pk=proposal.authority_evidence_id).first()
    if (
        evidence is None
        or evidence_snapshot(evidence) != proposal.evidence_snapshot
        or evidence.sha256 != proposal.evidence_fingerprint
    ):
        unmet.append("evidence_changed")
    try:
        own_evidence_bytes(
            evidence,
            RegisterEvidenceKind.AUTHORITY,
            token.company,
            proposal.submitted_by,
            "Retain the company's original authority evidence.",
        )
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
    except (ValidationError, TypeError, KeyError):
        unmet.append("evidence_unavailable")
    return sorted(set(unmet))


def _chain_requirements(intent):
    try:
        client = get_base_chain_client()
        if client.assert_expected_chain() != intent["chain_id"]:
            return ["capital_configuration_changed"]
        observed = client.load_contract("ShareToken", intent["to"]).functions.authorizedShares().call()
        if type(observed) is not int or observed < 0:
            return ["authorised_cap_unavailable"]
        return [] if str(observed) == intent["prior_authorized_total"] else ["authorised_cap_changed"]
    except Exception:
        return ["authorised_cap_unavailable"]


def _before_command(actor, proposal, kind, appointment):
    return [] if kind == "reject" else _chain_requirements(proposal.intent)


def _lock_actors(company, actor_ids):
    list(get_user_model().objects.select_for_update(nowait=True, of=("self",)).filter(pk__in=actor_ids).order_by("pk"))
    list(
        UserProfile.objects.select_for_update(nowait=True, of=("self",)).filter(user_id__in=actor_ids).order_by("uuid")
    )
    operator = Operator.objects.select_for_update().get(pk=1)
    list(
        CompanyAppointment.objects.select_for_update()
        .filter(company=company, appointee_id__in=actor_ids)
        .order_by("uuid")
    )
    return operator


@contextmanager
def _command(actor, initial, operation, recorded=False):
    with company_operation(actor, initial.company_id, operation), atomic(durable=True):
        company = Company.objects.select_for_update().get(pk=initial.company_id)
        approval = RegisterCapitalIncreaseDecision.objects.filter(pk=_approval(initial)).first()
        actors = {actor.pk}
        if not recorded and not operation.endswith("_reject") and approval is not None:
            actors.add(approval.decided_by_id)
        operator = _lock_actors(company, actors)
        current_actor = get_user_model().objects.get(pk=actor.pk)
        yield company, current_actor, UserProfile.objects.filter(user=current_actor).first(), operator
        if not recorded and operation == "register_capital_reject":
            rejected = RegisterCapitalIncrease.objects.get(pk=initial.pk)
            request = CapitalIncreaseRequest.objects.get(pk=rejected.request_id)
            request.status = RequestStatus.REJECTED
            request.reviewed_by = rejected.reviewed_by
            request.reviewed_at = rejected.reviewed_at
            request.rejection_reason = rejected.rejection_reason
            request.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])


def prepare_capital_increase(
    *,
    actor,
    operation_id,
    appointment,
    token,
    additional_shares,
    new_authorized_total,
    purpose,
    board_resolution_reference,
    authority_evidence,
    shareholder_approval_reference=""
):
    from tokens.services.capital_execution import _intent
    from tokens.services.dilution import dilution_for

    try:
        operation_id, appointment, token, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, token, authority_evidence)
        )
        for quantity in (additional_shares, new_authorized_total):
            if type(quantity) is not int or not 1 <= quantity <= 2147483647:
                raise ValueError
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Capital references and positive whole-share quantities must be valid.") from None
    values = {
        "purpose": purpose,
        "board_resolution_reference": board_resolution_reference,
        "shareholder_approval_reference": shareholder_approval_reference,
    }
    if (
        not isinstance(purpose, str)
        or not purpose.strip()
        or not isinstance(board_resolution_reference, str)
        or not board_resolution_reference.strip()
        or len(board_resolution_reference) > 255
        or not isinstance(shareholder_approval_reference, str)
        or len(shareholder_approval_reference) > 255
    ):
        raise ValidationError(
            "Retain the company's purpose and board reference, with its optional shareholder reference."
        )
    values = {key: value.strip() for key, value in values.items()}
    company_id = _company_of(actor, token)
    with use_operator(), _requester_principal(actor.pk):
        prior = RegisterCapitalIncrease.objects.filter(pk=operation_id).first()
        captured = ShareToken.objects.get(pk=token, company_id=company_id)
        temporary = CapitalIncreaseRequest(
            token=captured, additional_shares=additional_shares, new_authorized_total=new_authorized_total, **values
        )
        intent = _intent(temporary, captured) if prior is None else None
    if intent is not None:
        unmet = _chain_requirements(intent)
        if unmet:
            raise ValidationError({"unmet_requirements": unmet})
    proposal = None
    try:
        with register_command(actor, company_id, "register_capital_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            existing = RegisterCapitalIncrease.objects.select_related("request").filter(pk=operation_id).first()
            if existing is not None:
                expected = (
                    company.pk,
                    token,
                    current_actor.pk,
                    appointment,
                    authority_evidence,
                    additional_shares,
                    new_authorized_total,
                    *values.values(),
                )
                actual = (
                    existing.company_id,
                    existing.token_id,
                    existing.submitted_by_id,
                    existing.preparing_appointment_id,
                    existing.authority_evidence_id,
                    existing.request.additional_shares,
                    existing.request.new_authorized_total,
                    existing.request.purpose,
                    existing.request.board_resolution_reference,
                    existing.request.shareholder_approval_reference,
                )
                if (
                    actual != expected
                    or not RegisterCapitalIncrease.objects.register_readable_by(current_actor)
                    .filter(pk=existing.pk)
                    .exists()
                ):
                    raise RegisterChangeConflict()
                return existing
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            current = ShareToken.objects.select_for_update(of=("self",)).get(pk=token, company=company)
            current.company = company
            if new_authorized_total != int(current.total_supply) + additional_shares:
                raise ValidationError(
                    "The target cap must equal the recorded prior cap plus the additional whole shares."
                )
            if CapitalIncreaseRequest.objects.filter(token=current).in_flight().exists():
                raise ValidationError({"unmet_requirements": ["capital_in_flight"]})
            request = CapitalIncreaseRequest(
                token=current,
                additional_shares=additional_shares,
                new_authorized_total=new_authorized_total,
                status=RequestStatus.UNDER_REVIEW,
                submitted_by=current_actor,
                submitted_at=timezone.now(),
                **values
            )
            if _intent(request, current) != intent:
                raise RegisterChangeConflict()
            request.dilution_percentage = dilution_for(request)
            request.save(force_insert=True)
            evidence = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(
                evidence,
                RegisterEvidenceKind.AUTHORITY,
                company,
                current_actor,
                "Retain authority evidence uploaded by this company preparer.",
            )
            proposal = RegisterCapitalIncrease(
                uuid=operation_id,
                company=company,
                token=current,
                request=request,
                authority_evidence=evidence,
                evidence_fingerprint=evidence.sha256,
                evidence_snapshot=evidence_snapshot(evidence),
                preparing_appointment=source,
                submitted_by=current_actor,
                intent=intent,
                intent_digest=_scalar(
                    "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(intent)]
                ),
                snapshot={
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
                        "decimals": current.decimals,
                    },
                    "capital": _terms(request, int(current.total_supply)),
                    "transaction": {name: intent[name] for name in INTENT_FIELDS},
                },
            )
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
    except OperationalError as exception:
        if proposal is not None:
            discard(proposal.file)
        if _busy(exception):
            raise ValidationError({"unmet_requirements": ["source_lock_busy"]}) from None
        raise
    except BaseException:
        if proposal is not None:
            discard(proposal.file)
        raise
    finally:
        if proposal is not None and proposal._state.adding:
            discard(proposal.file)


def _lock(proposal):
    ShareToken.objects.select_for_update(of=("self",)).get(pk=proposal.token_id)
    CapitalIncreaseRequest.objects.select_for_update().get(pk=proposal.request_id)
    return RegisterCapitalIncrease.objects.select_for_update().get(pk=proposal.pk)


def _details(proposal):
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "approval_decision": proposal.approval_decision_id or _approval(proposal),
        **{
            key: proposal.snapshot["capital"][key]
            for key in ("prior_authorized_total", "additional_shares", "new_authorized_total")
        },
    }


def _apply(proposal, actor, decision):
    from tokens.services.capital_execution import admit_company

    proposal.approval_decision_id = _approval(proposal)
    if proposal.approval_decision_id is None:
        raise RegisterChangeConflict()
    request = CapitalIncreaseRequest.objects.get(pk=proposal.request_id)
    request.status = RequestStatus.APPROVED
    request.reviewed_by = actor
    request.reviewed_at = decision.decided_at
    request.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "approval_decision", "reviewed_by", "reviewed_at", "updated_at"])
    admit_company(request, proposal, actor)


CAPITAL_INCREASES = DecisionFamily(
    model=RegisterCapitalIncrease,
    decision_model=RegisterCapitalIncreaseDecision,
    field="capital_increase",
    operation="register_capital",
    approved_function="tokens_register_capital_approved",
    digest_function="tokens_register_capital_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
    before_command=_before_command,
    command=_command,
    noun="capital increase",
)


def preview_capital_increase_decision(*, actor, capital_increase_id, appointment, kind, reason=""):
    return preview(
        CAPITAL_INCREASES,
        _details,
        actor=actor,
        proposal_id=capital_increase_id,
        appointment=appointment,
        kind=kind,
        reason=reason,
    )


def decide_capital_increase(
    *, actor, capital_increase_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    try:
        return decide(
            CAPITAL_INCREASES,
            actor=actor,
            proposal_id=capital_increase_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
    except OperationalError as exception:
        if _busy(exception):
            raise ValidationError({"unmet_requirements": ["source_lock_busy"]}) from None
        raise


def _authority_requirements(proposal):
    return (
        []
        if _scalar("SELECT tokens_register_capital_source_current(%s)", [proposal.pk])
        else ["company_source_expired"]
    )


def permanent_source_loss(proposal):
    return bool(
        _scalar(
            "SELECT EXISTS (SELECT 1 FROM tokens_registercapitalincreasedecision decision "
            "JOIN companies_companyappointment appointment ON appointment.uuid=decision.appointment_id "
            "LEFT JOIN companies_companyappointmentrevocation revocation ON revocation.appointment_id=appointment.uuid "
            "WHERE decision.capital_increase_id=%s AND "
            "(decision.uuid=%s OR decision.kind='apply') AND "
            "(revocation.uuid IS NOT NULL OR appointment.expires_at<=clock_timestamp()))",
            [proposal.pk, proposal.approval_decision_id],
        )
    )


def execution_requirements(proposal):
    if proposal.status != "applied":
        return []
    execution = CapitalIncreaseExecution.objects.select_related("operation").filter(source_increase=proposal).first()
    if (
        execution
        and execution.operation
        and execution.operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED)
    ):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


def execution_receipt(proposal):
    execution = (
        CapitalIncreaseExecution.objects.select_related("operation__current_attempt", "transaction")
        .filter(
            source_increase=proposal,
            request_id=proposal.request_id,
            token_id=proposal.token_id,
            company_id=proposal.company_id,
        )
        .first()
    )
    if execution is None:
        return None
    operation, record = execution.operation, execution.transaction
    attempt = operation.current_attempt if operation else None
    matched = (
        attempt is not None
        and attempt.claim_id == operation.claim_id
        and record is not None
        and record.tx_hash == attempt.tx_hash
    )
    return {
        "execution": execution.pk,
        "request": execution.request_id,
        "dispatch_id": execution.pk,
        "status": proposal.request.status,
        "operation_id": operation.pk if operation else None,
        "claim_id": operation.claim_id if operation else None,
        "operation_status": operation.status if operation else None,
        "transaction": execution.transaction_id,
        "tx_hash": record.tx_hash if matched else None,
        "block_number": record.block_number if record else None,
        "block_hash": record.block_hash if record else None,
        "gas_used": record.gas_used if record else None,
        "projected_at": execution.projected_at,
        "attribution_required": execution.attribution_evidence is not None,
    }


@contextmanager
def signing_source(execution, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = RegisterCapitalIncrease.objects.filter(
        pk=execution.source_increase_id, request_id=execution.request_id, status="applied"
    ).first()
    if source is None:
        raise CapitalIncreaseSigningHold(["legacy_source_unavailable"])
    try:
        company = Company.objects.select_for_update().get(pk=source.company_id)
        decisions = list(
            RegisterCapitalIncreaseDecision.objects.filter(capital_increase=source, kind="apply")
            | RegisterCapitalIncreaseDecision.objects.filter(pk=source.approval_decision_id)
        )
        _lock_actors(company, {row.decided_by_id for row in decisions})
        source = _lock(source)
        CapitalIncreaseExecution.objects.select_for_update().get(pk=execution.pk)

        def validate(operation):
            unmet = _state(source) + _authority_requirements(source)
            if (execution.company_id, execution.token_id, execution.intent) != (
                source.company_id,
                source.token_id,
                source.intent,
            ):
                unmet.append("class_identity_changed")
            if unmet:
                raise CapitalIncreaseSigningHold(sorted(set(unmet)))

        yield validate
    except OperationalError as exception:
        if _busy(exception):
            raise CapitalIncreaseSigningHold(["source_lock_busy"]) from None
        raise
