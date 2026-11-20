from collections import deque

from django.apps import apps
from django.db.models import Q
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability, DeletionScope
from companies.services.company_deletion import (
    NOT_SUPPORTED,
    current_appointment,
    discard,
    follow_ups,
    remove,
    reverse_relations,
    stored_files,
)
from tokens.models import MemberAssociation, MemberInvitation
from tokens.services.register_authority import register_command

PROPOSAL_DECISIONS = {
    "RegisterAllotment": "RegisterAllotmentDecision",
    "RegisterTransfer": "RegisterTransferDecision",
    "RegisterGrant": "RegisterGrantDecision",
    "RegisterImport": "RegisterImportDecision",
    "RegisterCorrection": "RegisterCorrectionDecision",
    "RegisterParticularsChange": "RegisterParticularsChangeDecision",
}
ALLOTMENT_PARTS = ("agreement", "contribution")
NOT_PENDING = "Only a proposal awaiting a decision can be deleted."
NO_PREPARER = "A current company administrator or preparer is required to delete this proposal."
ACCEPTED = "This invitation was accepted. Revoke the access instead."
NO_ADMINISTRATOR = "A current company administrator is required to delete this invitation."
RECORD_GONE = "This record no longer exists. Refresh first."


def _unnotified(data):
    return Q(pk__in=[])


def proposal_rows(proposal):
    model = type(proposal)
    decision = apps.get_model("tokens", PROPOSAL_DECISIONS[model.__name__])
    rows = {model: list(model._base_manager.filter(pk=proposal.pk).select_for_update().values())}
    if model.__name__ == "RegisterAllotment":
        for field in ALLOTMENT_PARTS:
            identifier = rows[model][0][f"{field}_id"]
            target = model._meta.get_field(field).related_model
            if identifier:
                rows[target] = list(target._base_manager.filter(pk=identifier).select_for_update().values())
    queue = deque(rows)
    while queue:
        owner = queue.popleft()
        selected = [row["uuid"] for row in rows[owner]]
        for related in reverse_relations(owner):
            found = list(
                related.related_model._base_manager.filter(**{f"{related.field.attname}__in": selected})
                .order_by("pk")
                .select_for_update()
                .values()
            )
            known = {row["uuid"] for row in rows.get(related.related_model, [])}
            extra = [row for row in found if row["uuid"] not in known]
            if not extra:
                continue
            if related.many_to_many or related.related_model is not decision:
                raise ValidationError(NOT_SUPPORTED)
            rows.setdefault(decision, []).extend(extra)
            queue.append(decision)
    return follow_ups(rows, _unnotified)


def delete_proposal(*, actor, proposal):
    model = type(proposal)
    if model.__name__ not in PROPOSAL_DECISIONS:
        raise ValidationError(NOT_SUPPORTED)
    with register_command(actor, proposal.company_id, "register_proposal_delete") as (
        company,
        current,
        _profile,
        operator,
    ):
        proposal = model.objects.select_for_update().filter(pk=proposal.pk, company_id=company.pk).first()
        if proposal is None:
            raise NotFound(RECORD_GONE)
        appointment, expires_at = current_appointment(
            current, company.pk, operator, [CompanyCapability.ADMIN, CompanyCapability.PREPARE]
        )
        if appointment is None:
            raise NotFound(NO_PREPARER)
        if proposal.status != "submitted":
            raise ValidationError(NOT_PENDING)
        rows = proposal_rows(proposal)
        files = stored_files(rows)
        remove(
            company_id=company.pk,
            actor_id=current.pk,
            appointment_id=appointment,
            scope=DeletionScope.PROPOSAL,
            rows=rows,
            expires_at=expires_at,
        )
    discard(files)


def delete_member_invitation(*, actor, invitation):
    with register_command(actor, invitation.company_id, "invitation_delete") as (company, current, _profile, operator):
        invitation = (
            MemberInvitation.objects.select_for_update().filter(pk=invitation.pk, company_id=company.pk).first()
        )
        appointment, expires_at = current_appointment(current, company.pk, operator, [CompanyCapability.ADMIN])
        if invitation is None:
            raise NotFound(RECORD_GONE)
        if appointment is None:
            raise NotFound(NO_ADMINISTRATOR)
        if MemberAssociation.objects.filter(invitation_id=invitation.pk).exists():
            raise ValidationError(ACCEPTED)
        rows = {MemberInvitation: list(MemberInvitation.objects.filter(pk=invitation.pk).values())}
        remove(
            company_id=company.pk,
            actor_id=current.pk,
            appointment_id=appointment,
            scope=DeletionScope.INVITATION,
            rows=follow_ups(rows, _unnotified),
            expires_at=expires_at,
        )
