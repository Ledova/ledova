import hashlib
import json

from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.constants import DOCUMENT_REVIEW_MAX_AGE
from companies.models import Company, CompanyDocument
from shared.db import APP_ALIAS, atomic, current_alias


def _reviewer(user):
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Document verification requires the operator connection.")
    reviewer = get_user_model().objects.get(pk=user.pk)
    if not reviewer.is_active or not reviewer.is_staff or not reviewer.has_perm("companies.change_companydocument"):
        raise PermissionDenied("Document verification requires an authorised staff reviewer.")
    return reviewer


def _fingerprint(document):
    today = timezone.localdate()
    if (
        not document.file
        or document.rejection_reason
        or (document.valid_from and document.valid_from > today)
        or (document.valid_until and document.valid_until < today)
    ):
        raise ValidationError("Review requires an available uploaded file with current validity and no rejection.")
    digest = hashlib.sha256()
    size = 0
    try:
        with document.file.open("rb") as source:
            for chunk in source.chunks():
                digest.update(chunk)
                size += len(chunk)
    except (OSError, ValueError):
        raise ValidationError("The private document file is unavailable. Restore it before review.") from None
    if size != document.file_size or not size:
        raise ValidationError("The private file does not match the recorded size. Submit a new document.")
    content = {
        "document": str(document.pk),
        "company": str(document.company_id),
        "company_identity": {
            "name": document.company.name,
            "acn": document.company.acn,
            "abn": document.company.abn,
            "company_type": document.company.company_type,
            "owner": document.company.owner_id,
        },
        "document_type": document.document_type,
        "name": document.name,
        "file": document.file.name,
        "file_size": size,
        "mime_type": document.mime_type,
        "external_url": document.external_url,
        "valid_from": document.valid_from.isoformat() if document.valid_from else None,
        "valid_until": document.valid_until.isoformat() if document.valid_until else None,
        "sha256": digest.hexdigest(),
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def prepare_document_review(*, document_id, reviewer):
    reviewer = _reviewer(reviewer)
    document = CompanyDocument.objects.select_related("company").get(pk=document_id)
    confirmation = signing.dumps(
        {"document": str(document.pk), "reviewer": reviewer.pk, "fingerprint": _fingerprint(document)},
        salt="companies.document-review",
    )
    return document, confirmation


def verify_document(*, document_id, reviewer, confirmation):
    reviewer = _reviewer(reviewer)
    try:
        preview = signing.loads(confirmation, salt="companies.document-review", max_age=DOCUMENT_REVIEW_MAX_AGE)
    except signing.BadSignature:
        raise ValidationError("The review confirmation is invalid or expired. Open a fresh review.") from None
    if preview["document"] != str(document_id) or preview["reviewer"] != reviewer.pk:
        raise ValidationError("The review confirmation belongs to another document or reviewer.")
    with atomic():
        company_id = CompanyDocument.objects.values_list("company_id", flat=True).get(pk=document_id)
        company = Company.objects.select_for_update(no_key=True).get(pk=company_id)
        document = CompanyDocument.objects.select_for_update().get(pk=document_id)
        if document.company_id != company.pk:
            raise ValidationError("The document changed after review began. Review the current file again.")
        document.company = company
        fingerprint = _fingerprint(document)
        if fingerprint != preview["fingerprint"]:
            raise ValidationError("The document changed after review began. Review the current file again.")
        document.is_verified = True
        document.verified_fingerprint = fingerprint
        document.verified_by = reviewer
        document.verified_at = timezone.now()
        document.save(update_fields=["is_verified", "verified_fingerprint", "verified_by", "verified_at", "updated_at"])
        return document
