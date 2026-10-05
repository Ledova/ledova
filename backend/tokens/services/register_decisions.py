from dataclasses import dataclass
from typing import Callable

from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import current_alias, use_operator
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterDecisionKind
from tokens.services.register_authority import (
    holds,
    register_appointment,
    register_command,
)
from users.models import UserProfile

CAPABILITY = {
    RegisterDecisionKind.APPROVE: CompanyCapability.APPROVE,
    RegisterDecisionKind.APPLY: CompanyCapability.APPLY,
    RegisterDecisionKind.REJECT: CompanyCapability.APPROVE,
}


@dataclass(frozen=True)
class DecisionFamily:
    model: type
    decision_model: type
    field: str
    operation: str
    approved_function: str
    digest_function: str
    effect_requirements: Callable
    lock: Callable
    apply: Callable

    @property
    def subject(self):
        return self.operation.removeprefix("register_")


def _scalar(sql, params):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()[0]


def _digest(family, proposal, kind, actor, appointment, reason):
    return _scalar(
        f"SELECT {family.digest_function}(%s, %s, %s, %s, %s)",
        [proposal.pk, kind, actor.pk, appointment.pk, reason],
    )


def _approved(family, proposal):
    return _scalar(f"SELECT {family.approved_function}(%s, clock_timestamp())", [proposal.pk])


def _check_kind(kind, reason):
    if kind not in RegisterDecisionKind.values:
        raise ValidationError("Choose approval, application or rejection.")
    if not isinstance(reason, str) or len(reason) > 1000:
        raise ValidationError("A rejection reason may have at most 1000 characters.")


def _requirements(family, proposal, kind, appointment, reason):
    unmet = []
    if not holds(appointment, CAPABILITY[kind]):
        unmet.append("appointment_capability_required")
    if proposal.status != "submitted":
        unmet.append(f"{family.subject}_decided")
    if kind == RegisterDecisionKind.REJECT:
        if not reason.strip():
            unmet.append("reason_required")
        return sorted(set(unmet))
    if reason:
        unmet.append("reason_not_allowed")
    if proposal.preparing_appointment_id is None:
        unmet.append("company_provided_evidence_required")
        return sorted(set(unmet))
    approved = _approved(family, proposal)
    if kind == RegisterDecisionKind.APPROVE and approved:
        unmet.append("already_approved")
    if kind == RegisterDecisionKind.APPLY and not approved:
        approvals = proposal.decisions.filter(kind=RegisterDecisionKind.APPROVE).exists()
        unmet.append("approval_lapsed" if approvals else "approval_required")
    if proposal.status == "submitted" and "appointment_capability_required" not in unmet:
        unmet.extend(family.effect_requirements(proposal))
    return sorted(set(unmet))


def _readable(family, actor, proposal_id):
    with use_operator(), _requester_principal(actor.pk):
        proposal = family.model.objects.register_readable_by(actor).filter(pk=proposal_id).first()
    if proposal is None:
        raise NotFound(f"Register {family.subject} not found.")
    return proposal


def preview(family, details, *, actor, proposal_id, appointment, kind, reason):
    _check_kind(kind, reason)
    initial = _readable(family, actor, proposal_id)
    with company_operation(actor, initial.company_id, f"{family.operation}_preview"):
        proposal = family.model.objects.select_related("company").get(pk=initial.pk)
        current_actor = type(actor).objects.get(pk=actor.pk)
        profile = UserProfile.objects.filter(user=current_actor).first()
        source = register_appointment(proposal.company, current_actor, profile, Operator.get(), appointment)
        unmet = _requirements(family, proposal, kind, source, reason)
        return proposal, {
            "preview_digest": _digest(family, proposal, kind, current_actor, source, reason),
            "unmet_requirements": unmet,
            "can_decide": not unmet,
            **details(proposal),
        }


def _reject(proposal, actor, decision):
    proposal.status = "rejected"
    proposal.rejection_reason = decision.reason
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at", "updated_at"])


def decide(family, *, actor, proposal_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason):
    if confirmation is not True:
        raise ValidationError(f"Confirm the exact register {family.subject} decision.")
    _check_kind(kind, reason)
    initial = _readable(family, actor, proposal_id)
    with register_command(actor, initial.company_id, f"{family.operation}_{kind}") as (
        company,
        current_actor,
        profile,
        operator,
    ):
        source = register_appointment(company, current_actor, profile, operator, appointment)
        prior = family.decision_model.objects.filter(decided_by=current_actor, idempotency_key=idempotency_key).first()
        if prior is not None:
            decided = getattr(prior, f"{family.field}_id")
            if (decided, prior.kind, prior.appointment_id, prior.reason, prior.digest) != (
                initial.pk,
                kind,
                source.pk,
                reason,
                preview_digest,
            ):
                raise RegisterChangeConflict()
            return family.model.objects.get(pk=decided)
        proposal = family.lock(initial)
        if _digest(family, proposal, kind, current_actor, source, reason) != preview_digest:
            raise RegisterChangeConflict()
        unmet = _requirements(family, proposal, kind, source, reason)
        if unmet:
            raise ValidationError({"unmet_requirements": unmet})
        try:
            decision = family.decision_model.objects.create(
                **{family.field: proposal},
                kind=kind,
                decided_by=current_actor,
                appointment=source,
                idempotency_key=idempotency_key,
                digest=preview_digest,
                reason=reason,
                decided_at=timezone.now(),
            )
        except IntegrityError:
            raise RegisterChangeConflict() from None
        decision.refresh_from_db(fields=["decided_at"])
        if kind == RegisterDecisionKind.APPLY:
            family.apply(proposal, current_actor, decision)
        elif kind == RegisterDecisionKind.REJECT:
            _reject(proposal, current_actor, decision)
        return proposal
