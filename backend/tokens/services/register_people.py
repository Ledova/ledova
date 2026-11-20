from collections import deque
from uuid import UUID

from django.apps import apps
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import CompanyCapability, DeletionScope
from companies.services.company_deletion import (
    current_appointment,
    discard,
    follow_ups,
    remove,
    reverse_relations,
    stored_files,
)
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    MemberAssociation,
    MemberAssociationRevocation,
    MemberInvitation,
    RegisterAllotment,
    RegisterAward,
    RegisterGrant,
    RegisterImport,
    RegisterInstruction,
    RegisterMember,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterPersonRegistration,
    RegisterPosition,
    RegisterTransfer,
    RegisterWalletLink,
)
from tokens.services.pending_deletion import RECORD_GONE
from tokens.services.register_authority import (
    current_register_reader,
    register_appointment,
    register_command,
)
from tokens.services.register_transfers import register_people

PERSON_IN_USE = "Only a person with no shares and no register records naming them can be deleted."
NO_PERSON_PREPARER = "A current company administrator or preparer is required to delete this person."
NO_PERSON_ADMINISTRATOR = "A current company administrator is required to delete a person with record access."
PERSON_PARTS = (
    "RegisterMemberParticulars",
    "RegisterPersonRegistration",
    "RegisterParticularsChange",
    "RegisterParticularsChangeDecision",
)


def used_people(company_id):
    used = set(RegisterPosition.objects.filter(register__company_id=company_id).values_list("member_id", flat=True))
    used |= set(
        RegisterMemberCessation.objects.filter(member__company_id=company_id).values_list("member_id", flat=True)
    )
    used |= set(RegisterMemberWallet.objects.filter(company_id=company_id).values_list("member_id", flat=True))
    used |= set(RegisterInstruction.objects.filter(member__company_id=company_id).values_list("member_id", flat=True))
    for model in (RegisterAward, RegisterGrant, RegisterAllotment):
        used |= set(model.objects.filter(company_id=company_id).values_list("member", flat=True))
    for pair in RegisterTransfer.objects.filter(company_id=company_id).values_list("from_member", "to_member"):
        used |= set(pair)
    for members in RegisterImport.objects.filter(company_id=company_id).values_list("members", flat=True):
        used |= {UUID(str(row["member"])) for row in members if isinstance(row, dict) and row.get("member")}
    for model in (RegisterOpening, RegisterWalletLink):
        for mapping in model.objects.filter(company_id=company_id).values_list("mapping", flat=True):
            used |= {
                UUID(str(link["member"])) for link in mapping or [] if isinstance(link, dict) and link.get("member")
            }
    return used


def company_people(*, actor, company_id):
    with register_command(actor, company_id, "register_people_read") as (company, actor, profile, operator):
        current_register_reader(company, actor, profile, operator)
        used = used_people(company.pk)
        if current_appointment(actor, company.pk, operator, [CompanyCapability.ADMIN])[0] is None:
            used |= set(MemberInvitation.objects.filter(company=company).values_list("member", flat=True))
            used |= set(MemberAssociation.objects.filter(company=company).values_list("member", flat=True))
        members = register_people(company.pk, actor)["members"]
        for row in members:
            row["deletable"] = row["member"] not in used
        return {"company": company.pk, "members": members}


def person_rows(member):
    allowed = {apps.get_model("tokens", name) for name in PERSON_PARTS}
    rows = {RegisterMember: list(RegisterMember._base_manager.filter(pk=member.pk).values())}
    queue = deque([RegisterMember])
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
            if related.many_to_many or related.related_model not in allowed:
                raise ValidationError(PERSON_IN_USE)
            rows.setdefault(related.related_model, []).extend(extra)
            queue.append(related.related_model)
    return rows


def delete_person(*, actor, company_id, member_id):
    with register_command(actor, company_id, "register_person_delete") as (company, current, _profile, operator):
        appointment, expires_at = current_appointment(
            current, company.pk, operator, [CompanyCapability.ADMIN, CompanyCapability.PREPARE]
        )
        if appointment is None:
            raise NotFound(NO_PERSON_PREPARER)
        member = RegisterMember.objects.select_for_update().filter(pk=member_id, company=company).first()
        if member is None:
            raise NotFound(RECORD_GONE)
        invitations = list(
            MemberInvitation.objects.select_for_update()
            .filter(company=company, member=member.pk)
            .order_by("pk")
            .values()
        )
        associations = list(
            MemberAssociation.objects.select_for_update()
            .filter(company=company, member=member.pk)
            .order_by("pk")
            .values()
        )
        if invitations or associations:
            appointment, expires_at = current_appointment(current, company.pk, operator, [CompanyCapability.ADMIN])
            if appointment is None:
                raise PermissionDenied(NO_PERSON_ADMINISTRATOR)
        if member.pk in used_people(company.pk):
            raise ValidationError(PERSON_IN_USE)
        rows = person_rows(member)
        linked = [row["uuid"] for row in associations]
        rows[MemberInvitation] = invitations
        rows[MemberAssociation] = associations
        rows[MemberAssociationRevocation] = list(
            MemberAssociationRevocation.objects.select_for_update().filter(association_id__in=linked).values()
        )
        records = [str(identifier) for identifier in linked]
        files = stored_files(rows)
        remove(
            company_id=company.pk,
            actor_id=current.pk,
            appointment_id=appointment,
            scope=DeletionScope.PERSON,
            rows=follow_ups(rows, lambda data: Q(**{f"{data}__record__in": records})),
            expires_at=expires_at,
        )
    discard(files)


def add_person(*, actor, operation_id, company, appointment, member, name, residential_address):
    with register_command(actor, company, "register_person_add") as (company, actor, profile, operator):
        source = register_appointment(company, actor, profile, operator, appointment, CompanyCapability.PREPARE)
        expected = {
            "company_id": company.pk,
            "member_id": member,
            "name": name.strip(),
            "residential_address": residential_address.strip(),
            "preparing_appointment_id": source.pk,
            "submitted_by_id": actor.pk,
        }
        prior = RegisterPersonRegistration.objects.filter(pk=operation_id).first()
        if prior is not None:
            if any(getattr(prior, key) != value for key, value in expected.items()):
                raise RegisterChangeConflict()
            return prior, False
        if RegisterMember.objects.filter(pk=member).exists():
            raise RegisterChangeConflict()
        try:
            registration = RegisterPersonRegistration.objects.create(uuid=operation_id, **expected)
            RegisterMember.objects.create(uuid=member, company=company)
            RegisterMemberParticulars.objects.create(
                member_id=member,
                name=registration.name,
                residential_address=registration.residential_address,
                as_at=timezone.now().date(),
                source_registration=registration,
            )
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return registration, True
