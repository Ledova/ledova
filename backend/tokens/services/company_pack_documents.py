import hashlib
import logging

from botocore.exceptions import BotoCoreError
from botocore.exceptions import ClientError as S3ClientError
from google.api_core.exceptions import GoogleAPIError
from rest_framework.exceptions import ValidationError

from companies.models import CompanyDocument
from shared.uploads import UPLOAD_MIME_BY_EXTENSION
from tokens.constants import COMPANY_PACK_MAX_STORED_BYTES
from tokens.exceptions import RegisterIntegrityError
from tokens.models import RegisterEvidence, RegisterImport, RegisterMemberDocument

logger = logging.getLogger(__name__)

FOLDER = "documents"
EVIDENCE_FOLDER = "documents/evidence"
EXTENSIONS = {mime_type: extension for extension, mime_type in UPLOAD_MIME_BY_EXTENSION.items()}


def _path(folder, uuid, mime_type):
    return f"{folder}/{uuid}{EXTENSIONS.get(mime_type, '')}"


def evidence_path(record):
    if not record.file:
        return None
    return _path(
        f"{EVIDENCE_FOLDER}/{record._meta.model_name}", record.pk, (record.evidence_snapshot or {}).get("mime_type")
    )


def asic_evidence_path(record):
    return _path(f"{EVIDENCE_FOLDER}/{record._meta.model_name}-asic", record.pk, record.asic_snapshot.get("mime_type"))


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
                "recorded": None,
                "of": f"company document {document.pk}",
            }
    return listed, stored


def member_documents(company):
    listed, openings, stored = [], [], {}
    for document in (
        RegisterMemberDocument.objects.filter(company=company).select_related("evidence").order_by("created_at", "uuid")
    ):
        evidence = document.evidence
        path = _path(f"{EVIDENCE_FOLDER}/shareholders", evidence.pk, evidence.mime_type)
        listed.append(
            {
                "uuid": document.pk,
                "company": document.company_id,
                "member": document.member_id,
                "token": document.token_id,
                "source_import": document.source_import_id,
                "evidence": evidence.pk,
                "category": document.category,
                "snapshot": document.snapshot,
                "appointment": document.appointment_id,
                "recorded_by": document.recorded_by_id,
                "created_at": document.created_at,
                "path": path,
            }
        )
        stored[path] = {
            "file": evidence.file,
            "size": document.snapshot["file_size"],
            "recorded": {"size": document.snapshot["file_size"], "sha256": document.snapshot["sha256"]},
            "of": f"shareholder evidence {evidence.pk}",
        }
    for opening in RegisterImport.objects.filter(company=company).order_by("created_at", "uuid"):
        for member in opening.members:
            for document in member.get("documents", []):
                evidence = RegisterEvidence.objects.get(pk=document["evidence"], company=company)
                snapshot = document["snapshot"]
                path = _path(f"{EVIDENCE_FOLDER}/shareholders", evidence.pk, snapshot["mime_type"])
                openings.append(
                    {
                        "company": company.pk,
                        "member": member["member"],
                        "token": opening.token_id,
                        "source_import": opening.pk,
                        "status": opening.status,
                        "evidence": evidence.pk,
                        "category": document["category"],
                        "snapshot": snapshot,
                        "path": path,
                    }
                )
                stored[path] = {
                    "file": evidence.file,
                    "size": snapshot["file_size"],
                    "recorded": {"size": snapshot["file_size"], "sha256": snapshot["sha256"]},
                    "of": f"shareholder evidence {evidence.pk}",
                }
    return {"links": listed, "openings": openings}, stored


def evidence(records) -> dict:
    copies = {
        evidence_path(record): {
            "file": record.file,
            "size": None,
            "recorded": {
                "size": record.evidence_snapshot.get("file_size"),
                "sha256": record.evidence_snapshot.get("sha256"),
            },
            "of": f"the evidence of {record._meta.verbose_name} {record.pk}",
        }
        for record in records
        if record.file
    }
    for record in records:
        if getattr(record, "asic_file", None):
            copies[asic_evidence_path(record)] = {
                "file": record.asic_file,
                "size": None,
                "recorded": {
                    "size": record.asic_snapshot.get("file_size"),
                    "sha256": record.asic_snapshot.get("sha256"),
                },
                "of": f"the ASIC extract of {record._meta.verbose_name} {record.pk}",
            }
    return copies


UNREADABLE = (OSError, ValueError, GoogleAPIError, S3ClientError, BotoCoreError)


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
    except UNREADABLE:
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
    digest, size = hashlib.sha256(), 0
    try:
        with stored["file"].open("rb") as source:
            for chunk in source.chunks():
                digest.update(chunk)
                size += len(chunk)
                target.write(chunk)
    except UNREADABLE:
        raise _missing(stored) from None
    carried = {"size": size, "sha256": digest.hexdigest()}
    recorded = stored["recorded"]
    if recorded is not None and {key: carried[key] for key in recorded} != recorded:
        logger.error("The stored file %s no longer matches its recorded digest", stored["file"].name)
        raise RegisterIntegrityError(
            f"The copy Ledova kept of {stored['of']} no longer matches the SHA-256 recorded when it was submitted, "
            "so no pack was produced. Restore the copy that was submitted before producing a pack."
        )
    return size, carried["sha256"]


RETAINED_SOURCES = {
    "evidence_snapshot": "file",
    "agreement_snapshot": "file",
    "terms_snapshot": "terms_file",
    "acceptance_snapshot": "acceptance_file",
    "asic_snapshot": "asic_file",
}


def retained_evidence_path(record, snapshot_field):
    snapshot = getattr(record, snapshot_field) or {}
    if not snapshot:
        return None
    suffix = (
        ""
        if snapshot_field in {"evidence_snapshot", "agreement_snapshot"}
        else "-" + snapshot_field.removesuffix("_snapshot")
    )
    return _path(f"{EVIDENCE_FOLDER}/{record._meta.model_name}{suffix}", record.pk, snapshot.get("mime_type"))


def retained_sources(records):
    copies = {}
    for record in records:
        fields = ["agreement_snapshot"] if record._meta.model_name == "registeraward" else ["evidence_snapshot"]
        if record._meta.model_name in {"registergrant", "registerinstruction"}:
            fields += ["terms_snapshot", "acceptance_snapshot"]
        if record._meta.model_name == "registertransfer":
            fields += ["instrument_snapshot"]
        for field in fields:
            snapshot = getattr(record, field) or {}
            if not snapshot:
                continue
            file_field = "instrument_file" if field == "instrument_snapshot" else RETAINED_SOURCES[field]
            path = retained_evidence_path(record, field)
            copies[path] = {
                "file": getattr(record, file_field),
                "size": None,
                "recorded": {"size": snapshot.get("file_size"), "sha256": snapshot.get("sha256")},
                "of": f"the retained {field.removesuffix('_snapshot')} of {record._meta.verbose_name} {record.pk}",
            }
    return copies
