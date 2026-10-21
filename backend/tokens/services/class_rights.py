from contextlib import contextmanager
from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import CompanyAppointment, CompanyCapability
from tokens.class_rights_attributes import (
    validate_class_rights_attributes,
    validate_class_rights_effective_date,
)
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    ClassRightsRevision,
    RegisterEvidence,
    RegisterEvidenceKind,
    ShareToken,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_evidence import evidence_snapshot, matching_bytes


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


def _documents(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValidationError("Choose at most 100 class documents.")
    try:
        identifiers = [str(UUID(str(item))) for item in value]
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Each class document needs an uploaded file.") from None
    if len(set(identifiers)) != len(identifiers):
        raise ValidationError("Attach each file only once to the class rights.")
    return sorted(identifiers)


def _retained_documents(*, token, company, actor, identifiers):
    snapshots = []
    for identifier in identifiers:
        evidence = (
            RegisterEvidence.objects.select_for_update()
            .filter(pk=identifier, company=company, kind=RegisterEvidenceKind.CLASS_RIGHTS)
            .first()
        )
        retained = ClassRightsRevision.objects.filter(
            token=token, documents__contains=[{"evidence": identifier}]
        ).exists()
        if evidence is None or (evidence.uploaded_by_id != actor.pk and not retained):
            raise ValidationError(
                "Choose a class document you uploaded for this company or one retained for this class."
            )
        matching_bytes(evidence.file, evidence.file_size, evidence.sha256)
        snapshots.append(evidence_snapshot(evidence))
    return snapshots


def record_class_rights(
    *,
    actor,
    token,
    appointment,
    idempotency_key,
    previous_revision,
    summary,
    document_reference="",
    documents=None,
    attributes=None,
    effective_date=None
):
    identifiers = _documents([] if documents is None else documents)
    attributes = {} if attributes is None else attributes
    try:
        validate_class_rights_attributes(attributes)
        validate_class_rights_effective_date(effective_date)
    except DjangoValidationError as exc:
        raise ValidationError(exc.messages) from None
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
            if (
                prior.token_id,
                prior.appointment_id,
                prior.revision - 1,
                prior.summary,
                prior.document_reference,
                prior.attributes,
                prior.effective_date,
                [document["evidence"] for document in prior.documents],
            ) != (
                token.pk,
                source.pk,
                previous_revision,
                summary,
                document_reference,
                attributes,
                effective_date,
                identifiers,
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
            attributes=attributes,
            effective_date=effective_date,
            documents=_retained_documents(token=token, company=company, actor=current_actor, identifiers=identifiers),
            recorded_by=current_actor,
            recorded_by_name=profile.full_name or "",
            appointment=source,
            idempotency_key=idempotency_key,
        )
        revision.refresh_from_db()
        return revision, True


@contextmanager
def class_rights_file(*, actor, token, revision, evidence):
    with class_rights_read(actor=actor, token=token) as (revisions, administration):
        record = get_object_or_404(revisions, pk=revision, documents__contains=[{"evidence": str(evidence)}])
        snapshot = next(document for document in record.documents if document["evidence"] == str(evidence))
        retained = get_object_or_404(
            RegisterEvidence, pk=evidence, company_id=token.company_id, kind=RegisterEvidenceKind.CLASS_RIGHTS
        )
        if evidence_snapshot(retained) != snapshot:
            raise ValidationError("The class document no longer matches its retained record.")
        matching_bytes(retained.file, snapshot["file_size"], snapshot["sha256"])
        yield retained, snapshot
