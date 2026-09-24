import hashlib
import logging

from rest_framework.exceptions import ValidationError

from companies.models import CompanyDocument
from shared.uploads import UPLOAD_MIME_BY_EXTENSION
from tokens.constants import COMPANY_PACK_MAX_STORED_BYTES
from tokens.exceptions import RegisterIntegrityError

logger = logging.getLogger(__name__)

FOLDER = "documents"
EVIDENCE_FOLDER = "documents/evidence"
EXTENSIONS = {mime_type: extension for extension, mime_type in UPLOAD_MIME_BY_EXTENSION.items()}


def _path(folder, uuid, mime_type):
    return f"{folder}/{uuid}{EXTENSIONS.get(mime_type, '')}"


def evidence_path(record):
    return _path(EVIDENCE_FOLDER, record.pk, record.evidence_snapshot.get("mime_type"))


def held(company):
    listed, stored = [], {}
    for document in CompanyDocument.objects.filter(company=company).order_by("created_at", "uuid"):
        path = _path(FOLDER, document.pk, document.mime_type) if document.file else None
        listed.append(
            {
                "uuid": document.pk,
                "type": document.document_type,
                "name": document.name,
                "mime_type": document.mime_type,
                "valid_from": document.valid_from,
                "valid_until": document.valid_until,
                "verified": document.is_verified,
                "verified_at": document.verified_at,
                "uploaded_at": document.created_at,
                "external_url": document.external_url,
                "path": path,
            }
        )
        if path is not None:
            stored[path] = {
                "file": document.file,
                "size": document.file_size,
                "evidence": None,
                "of": f"company document {document.pk}",
            }
    return listed, stored


def evidence(records) -> dict:
    return {
        evidence_path(record): {
            "file": record.file,
            "size": None,
            "evidence": (record.evidence_snapshot.get("file_size"), record.evidence_snapshot.get("sha256")),
            "of": f"the evidence of {record._meta.verbose_name} {record.pk}",
        }
        for record in records
    }


def _missing(stored):
    logger.error("A file for a company pack is missing from private storage: %s", stored["file"].name)
    return ValidationError(
        f"The stored file of {stored['of']} is missing, so no pack was produced. Restore it to private storage, "
        "then produce the pack again."
    )


def _size(stored):
    if stored["size"] is not None:
        return stored["size"]
    try:
        return stored["file"].size
    except (OSError, ValueError):
        raise _missing(stored) from None


def within_ceiling(company, stored):
    total = sum(_size(item) for item in stored.values())
    if total > COMPANY_PACK_MAX_STORED_BYTES:
        logger.warning("A company pack for company %s was refused: %s bytes of stored files", company.pk, total)
        raise ValidationError(
            f"The files this pack would carry come to {total:,} bytes, over the ceiling of "
            f"{COMPANY_PACK_MAX_STORED_BYTES:,} bytes for a pack produced while you wait, so no pack was produced. "
            "Ask engineering to build background production, which is built the first time a pack exceeds the "
            "ceiling."
        )


def carry(stored, target):
    try:
        source = stored["file"].open("rb")
    except (OSError, ValueError):
        raise _missing(stored) from None
    digest, size = hashlib.sha256(), 0
    with source:
        for chunk in source.chunks():
            digest.update(chunk)
            size += len(chunk)
            target.write(chunk)
    if stored["evidence"] is not None and stored["evidence"] != (size, digest.hexdigest()):
        logger.error("The retained evidence copy %s no longer matches its recorded digest", stored["file"].name)
        raise RegisterIntegrityError(
            f"The copy Ledova kept of {stored['of']} no longer matches the SHA-256 recorded when it was submitted, "
            "so no pack was produced. Restore the copy that was submitted before producing a pack."
        )
    return size, digest.hexdigest()
