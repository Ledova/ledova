from contextlib import contextmanager

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import CompanyAppointment, CompanyCapability
from tokens.exceptions import RegisterChangeConflict
from tokens.models import ClassRightsRevision, ShareToken
from tokens.services.register_authority import register_appointment, register_command


@contextmanager
def class_rights_read(*, actor, token):
    with register_command(actor, token.company_id, "class_rights_read") as (company, current_actor, profile, operator):
        token = get_object_or_404(
            ShareToken.objects.register_readable_by(current_actor).select_for_update(), pk=token.pk, company=company
        )
        administration = (
            CompanyAppointment.objects.current_for(
                current_actor, company.pk, at=timezone.now(), identity_required=operator.issuer_kyc_required
            )
            .filter(capabilities__contains=[CompanyCapability.ADMIN])
            .order_by("uuid")
            .first()
        )
        yield ClassRightsRevision.objects.filter(token=token), administration


def record_class_rights(*, actor, token, appointment, idempotency_key, previous_revision, summary, document_reference):
    with register_command(actor, token.company_id, "class_rights_record") as (
        company,
        current_actor,
        profile,
        operator,
    ):
        token = get_object_or_404(ShareToken.objects.select_for_update(), pk=token.pk, company=company)
        source = register_appointment(company, current_actor, profile, operator, appointment, CompanyCapability.ADMIN)
        prior = ClassRightsRevision.objects.filter(recorded_by=current_actor, idempotency_key=idempotency_key).first()
        if prior is not None:
            if (prior.token_id, prior.appointment_id, prior.revision - 1, prior.summary, prior.document_reference) != (
                token.pk,
                source.pk,
                previous_revision,
                summary,
                document_reference,
            ):
                raise RegisterChangeConflict("This request already records different class-rights details.")
            return prior, False
        latest = ClassRightsRevision.objects.filter(token=token).first()
        if previous_revision != (latest.revision if latest else 0):
            raise RegisterChangeConflict("The class-rights details changed. Reload them before saving again.")
        if not isinstance(summary, str) or not isinstance(document_reference, str):
            raise ValidationError("Class-rights details must be text.")
        revision = ClassRightsRevision.objects.create(
            token=token,
            revision=previous_revision + 1,
            summary=summary,
            document_reference=document_reference,
            recorded_by=current_actor,
            recorded_by_name=profile.full_name or "",
            appointment=source,
            idempotency_key=idempotency_key,
        )
        revision.refresh_from_db()
        return revision, True
