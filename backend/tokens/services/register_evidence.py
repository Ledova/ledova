import hashlib

from django.core.files.base import ContentFile
from django.db import IntegrityError
from rest_framework.exceptions import ValidationError

from companies.models import CompanyCapability
from companies.services.document_review import private_document_bytes
from shared.uploads import read_bounded, validate_upload
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterEvidence, RegisterEvidenceKind
from tokens.services.register_authority import register_appointment, register_command


def evidence_snapshot(evidence):
    return {
        "provided_by": "company",
        "evidence": str(evidence.pk),
        "company": str(evidence.company_id),
        "document_type": evidence.kind,
        "name": evidence.original_filename,
        "file_size": evidence.file_size,
        "mime_type": evidence.mime_type,
        "sha256": evidence.sha256,
    }


def matching_bytes(stored, size, digest):
    try:
        raw = private_document_bytes(stored)
    except ValidationError:
        raw = b""
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise ValidationError("A retained evidence file no longer matches its record. Upload it and prepare again.")
    return raw


def own_evidence_bytes(evidence, kind, company, actor, refusal):
    if (
        evidence is None
        or evidence.kind != kind
        or evidence.company_id != company.pk
        or evidence.uploaded_by_id != actor.pk
    ):
        raise ValidationError(refusal)
    return matching_bytes(evidence.file, evidence.file_size, evidence.sha256)


def discard(*files):
    for stored in files:
        if stored and stored._committed:
            stored.storage.delete(stored.name)


def _retained(prior, company, kind, appointment, size, mime_type, digest):
    if (prior.company_id, prior.kind, prior.appointment_id, prior.file_size, prior.mime_type, prior.sha256) != (
        company.pk,
        kind,
        appointment.pk,
        size,
        mime_type,
        digest,
    ):
        raise RegisterChangeConflict()
    return prior


def retain_register_evidence(*, actor, company_id, appointment, kind, idempotency_key, name, raw, mime_type):
    if kind not in RegisterEvidenceKind.values:
        raise ValidationError(
            "Choose a share register, an ASIC extract, an authority document or a supporting document."
        )
    digest = hashlib.sha256(raw).hexdigest()
    evidence = None
    try:
        with register_command(actor, company_id, "register_evidence") as (company, current_actor, profile, operator):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            prior = RegisterEvidence.objects.filter(uploaded_by=current_actor, idempotency_key=idempotency_key).first()
            if prior is not None:
                return _retained(prior, company, kind, source, len(raw), mime_type, digest), False
            evidence = RegisterEvidence(
                company=company,
                kind=kind,
                uploaded_by=current_actor,
                appointment=source,
                idempotency_key=idempotency_key,
                original_filename=(name or "evidence")[:255],
                file_size=len(raw),
                mime_type=mime_type,
                sha256=digest,
            )
            evidence.file.save("evidence.bin", ContentFile(raw), save=False)
            try:
                evidence.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return evidence, True
    except BaseException:
        if evidence is not None:
            discard(evidence.file)
        raise


def upload_register_evidence(*, actor, company_id, appointment, kind, idempotency_key, file):
    _, mime_type = validate_upload(file)
    file.seek(0)
    return retain_register_evidence(
        actor=actor,
        company_id=company_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        name=file.name,
        raw=read_bounded(file),
        mime_type=mime_type,
    )
