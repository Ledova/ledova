import json
from contextlib import contextmanager
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import IntegrityError, OperationalError
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.models import OutgoingOperation, OutgoingStatus
from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation, lock_company_actor
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import atomic, use_operator
from tokens.exceptions import (
    InvalidTokenStateException,
    PauseChangeConflict,
    PauseSigningHold,
    RegisterChangeConflict,
)
from tokens.models import (
    PauseChange,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterPauseChange,
    RegisterPauseChangeDecision,
    ShareToken,
)
from tokens.services import pause_changes
from tokens.services.register_authority import register_appointment
from tokens.services.register_decisions import DecisionFamily, _scalar, decide, preview
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from users.models import UserProfile


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
    return _scalar("SELECT tokens_register_pause_approval(%s, clock_timestamp())", [proposal.pk])


def _snapshot(token, intent):
    return {
        "company": {
            "uuid": str(token.company_id),
            "name": token.company.name,
            "acn": token.company.acn,
            "status": token.company.status,
        },
        "token": {
            "uuid": str(token.pk),
            "name": token.name,
            "symbol": token.symbol,
            "chain": token.chain,
            "contract_address": (token.contract_address or "").lower(),
            "authorised_shares": str(token.total_supply),
            "decimals": token.decimals,
        },
        "transaction": intent,
    }


def _state(proposal):
    token = ShareToken.objects.select_related("company").get(pk=proposal.token_id)
    unmet = []
    if token.company.status != "active":
        unmet.append("company_not_active")
    if token.chain != "base" or token.status not in ("deployed", "paused") or not token.contract_address:
        unmet.append("class_not_deployed")
    if proposal.snapshot != _snapshot(token, proposal.intent):
        unmet.append("class_identity_changed")
    try:
        if pause_changes.transaction_intent(token, proposal.paused) != proposal.intent:
            unmet.append("pause_configuration_changed")
    except (PauseChangeConflict, InvalidTokenStateException, ValidationError):
        unmet.append("pause_configuration_changed")
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


def _lock_actors(company, actors):
    list(
        get_user_model()
        .objects.select_for_update(no_key=True, nowait=True, of=("self",))
        .filter(pk__in=actors)
        .order_by("pk")
    )
    list(
        UserProfile.objects.select_for_update(no_key=True, nowait=True, of=("self",))
        .filter(user_id__in=actors)
        .order_by("uuid")
    )
    operator = Operator.objects.select_for_update().get(pk=1)
    list(
        CompanyAppointment.objects.select_for_update().filter(company=company, appointee_id__in=actors).order_by("uuid")
    )
    return operator


@contextmanager
def _command(actor, initial, operation, recorded=False):
    with company_operation(actor, initial.company_id, operation), atomic(durable=True):
        pause_changes.lock_target(initial.intent["chain_id"], initial.intent["to"])
        company = Company.objects.select_for_update().get(pk=initial.company_id)
        approval = RegisterPauseChangeDecision.objects.filter(pk=_approval(initial)).first()
        actors = {actor.pk}
        if not recorded and not operation.endswith("_reject") and approval is not None:
            actors.add(approval.decided_by_id)
        operator = _lock_actors(company, actors)
        current_actor = get_user_model().objects.get(pk=actor.pk)
        yield company, current_actor, UserProfile.objects.filter(user=current_actor).first(), operator


def prepare_pause_change(
    *, actor, operation_id, appointment, token, paused, reason, authority_reference, authority_evidence
):
    try:
        operation_id, appointment, token, authority_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, token, authority_evidence)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Pause references must be valid UUIDs.") from None
    if type(paused) is not bool:
        raise ValidationError("The requested pause state must be a boolean.")
    if (
        not isinstance(reason, str)
        or not reason.strip()
        or len(reason) > 1000
        or not isinstance(authority_reference, str)
        or not authority_reference.strip()
        or len(authority_reference) > 255
    ):
        raise ValidationError("Retain the company's reason and authority reference within their limits.")
    reason, authority_reference = reason.strip(), authority_reference.strip()
    company_id = _company_of(actor, token)
    proposal = None
    try:
        with company_operation(actor, company_id, "register_pause_prepare"), atomic(durable=True):
            existing = RegisterPauseChange.objects.filter(pk=operation_id).first()
            if existing is not None:
                if (
                    existing.company_id,
                    existing.token_id,
                    existing.submitted_by_id,
                    existing.preparing_appointment_id,
                    existing.authority_evidence_id,
                    existing.paused,
                    existing.reason,
                    existing.authority_reference,
                ) != (
                    company_id,
                    token,
                    actor.pk,
                    appointment,
                    authority_evidence,
                    paused,
                    reason,
                    authority_reference,
                ) or not RegisterPauseChange.objects.register_readable_by(
                    actor
                ).filter(
                    pk=existing.pk
                ).exists():
                    raise RegisterChangeConflict()
                return existing
            captured = ShareToken.objects.get(pk=token, company_id=company_id)
            intent = pause_changes.transaction_intent(captured, paused)
            pause_changes.lock_target(intent["chain_id"], intent["to"])
            company, current_actor, profile, operator = lock_company_actor(actor, company_id)
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            current = ShareToken.objects.select_for_update(nowait=True, of=("self",)).get(pk=token, company=company)
            current.company = company
            if (
                PauseChange.objects.filter(pk=operation_id).exists()
                or pause_changes.transaction_intent(current, paused) != intent
            ):
                raise RegisterChangeConflict()
            evidence = RegisterEvidence.objects.get(pk=authority_evidence)
            raw = own_evidence_bytes(
                evidence,
                RegisterEvidenceKind.AUTHORITY,
                company,
                current_actor,
                "Retain the company's original authority evidence.",
            )
            proposal = RegisterPauseChange(
                pk=operation_id,
                company=company,
                token=current,
                paused=paused,
                reason=reason,
                authority_reference=authority_reference,
                authority_evidence=evidence,
                evidence_fingerprint=evidence.sha256,
                evidence_snapshot=evidence_snapshot(evidence),
                preparing_appointment=source,
                submitted_by=current_actor,
                intent=intent,
                intent_digest=_scalar(
                    "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(intent)]
                ),
                snapshot=_snapshot(current, intent),
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
    ShareToken.objects.select_for_update(nowait=True, of=("self",)).get(pk=proposal.token_id)
    return RegisterPauseChange.objects.select_for_update().get(pk=proposal.pk)


def _details(proposal):
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "approval_decision": proposal.approval_decision_id or _approval(proposal),
        "paused": proposal.paused,
        "reason": proposal.reason,
        "authority_reference": proposal.authority_reference,
    }


def _apply(proposal, actor, decision):
    proposal.approval_decision_id = _approval(proposal)
    if proposal.approval_decision_id is None:
        raise RegisterChangeConflict()
    proposal.status, proposal.reviewed_by, proposal.reviewed_at = "applied", actor, decision.decided_at
    proposal.save(update_fields=["status", "approval_decision", "reviewed_by", "reviewed_at", "updated_at"])
    pause_changes.admit_company(proposal, actor)


PAUSE_CHANGES = DecisionFamily(
    model=RegisterPauseChange,
    decision_model=RegisterPauseChangeDecision,
    field="pause_change",
    operation="register_pause",
    approved_function="tokens_register_pause_approved",
    digest_function="tokens_register_pause_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
    command=_command,
    noun="pause change",
)


def preview_pause_change_decision(*, actor, pause_change_id, appointment, kind, reason=""):
    return preview(
        PAUSE_CHANGES,
        _details,
        actor=actor,
        proposal_id=pause_change_id,
        appointment=appointment,
        kind=kind,
        reason=reason,
    )


def decide_pause_change(
    *, actor, pause_change_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    try:
        return decide(
            PAUSE_CHANGES,
            actor=actor,
            proposal_id=pause_change_id,
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
        [] if _scalar("SELECT tokens_register_pause_source_current(%s)", [proposal.pk]) else ["company_source_expired"]
    )


def permanent_source_loss(proposal):
    return bool(_scalar("SELECT tokens_register_pause_source_lapsed(%s)", [proposal.pk]))


def execution_requirements(proposal):
    if proposal.status != "applied":
        return []
    execution = PauseChange.objects.select_related("operation").filter(source_pause=proposal).first()
    if (
        execution
        and execution.operation
        and execution.operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED)
    ):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


def execution_receipt(proposal):
    execution = PauseChange.objects.select_related("operation__current_attempt").filter(source_pause=proposal).first()
    if execution is None:
        return None
    operation = execution.operation
    attempt = operation.current_attempt if operation else None
    return {
        "submission_id": execution.pk,
        "paused": execution.paused,
        "status": execution.status,
        "completed_at": execution.completed_at,
        "operation_id": operation.pk if operation else None,
        "claim_id": operation.claim_id if operation else None,
        "operation_status": operation.status if operation else None,
        "tx_hash": attempt.tx_hash if attempt and attempt.claim_id == operation.claim_id else None,
        "block_number": operation.block_number if operation else None,
        "block_hash": operation.block_hash if operation else None,
        "gas_used": operation.gas_used if operation else None,
        "observation": execution.observation,
    }


@contextmanager
def signing_source(change, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = RegisterPauseChange.objects.filter(pk=change.source_pause_id, status="applied").first()
    if source is None:
        raise PauseSigningHold(["legacy_source_unavailable"])
    try:
        pause_changes.lock_target(change.chain_id, change.contract_address)
        company = Company.objects.select_for_update().get(pk=source.company_id)
        decisions = list(
            RegisterPauseChangeDecision.objects.filter(pause_change=source, kind="apply")
            | RegisterPauseChangeDecision.objects.filter(pk=source.approval_decision_id)
        )
        _lock_actors(company, {row.decided_by_id for row in decisions})
        source = _lock(source)
        PauseChange.objects.select_for_update().get(pk=change.pk)

        def validate(operation):
            unmet = _state(source) + _authority_requirements(source)
            if (change.pk, change.company_id, change.token_id, change.intent, change.initiated_by_id) != (
                source.pk,
                source.company_id,
                source.token_id,
                source.intent,
                source.reviewed_by_id,
            ):
                unmet.append("class_identity_changed")
            if unmet:
                raise PauseSigningHold(sorted(set(unmet)))

        yield validate
    except OperationalError as exception:
        if _busy(exception):
            raise PauseSigningHold(["source_lock_busy"]) from None
        raise
