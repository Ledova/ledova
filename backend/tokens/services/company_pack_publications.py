import hashlib
import logging
from datetime import timezone as utc_zone

from django.db.models import Count, Q
from django.db.models.expressions import RawSQL

from shareholders.constants import READ_AS_COMPANY, READ_AS_MEMBER, READ_AS_STAFF
from shareholders.exceptions import PublicationIntegrityError
from shareholders.models import (
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRead,
    PublicationRecipient,
)
from shareholders.services.publications import verify_roll
from tokens.exceptions import RegisterIntegrityError
from tokens.services.company_pack_documents import EXTENSIONS

logger = logging.getLogger(__name__)

FOLDER = "publications"
EMPTY_HEAD = "0" * 64
PREIMAGE = RawSQL("shareholders_publication_event_preimage(shareholders_publicationevent)", [])
DOCUMENT_READ = Q(event_uuid__isnull=True)
NO_READS = {
    "document": {READ_AS_MEMBER: 0, READ_AS_COMPANY: 0, READ_AS_STAFF: 0},
    "members_who_opened": 0,
    "remittance_evidence": 0,
}
VERIFY = "Run `python manage.py publications verify --publication {publication}` before producing a pack."


def _stamp(moment):
    return moment.astimezone(utc_zone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _whole(value):
    return None if value is None else str(int(value))


def _reads(publications) -> dict:
    counted = (
        PublicationRead.objects.filter(publication_uuid__in=[publication.pk for publication in publications])
        .values("publication_uuid")
        .annotate(
            **{kind: Count("pk", filter=DOCUMENT_READ & Q(kind=kind)) for kind in NO_READS["document"]},
            members_who_opened=Count("recipient_uuid", filter=DOCUMENT_READ & Q(kind=READ_AS_MEMBER), distinct=True),
            remittance_evidence=Count("pk", filter=~DOCUMENT_READ),
        )
        .order_by()
    )
    return {
        row["publication_uuid"]: {
            "document": {kind: row[kind] for kind in NO_READS["document"]},
            "members_who_opened": row["members_who_opened"],
            "remittance_evidence": row["remittance_evidence"],
        }
        for row in counted
    }


def _roll(publication) -> list:
    try:
        verify_roll(publication)
    except PublicationIntegrityError:
        logger.error("The roll of publication %s no longer matches its recorded digest", publication.pk)
        raise RegisterIntegrityError(
            f"The roll of publication {publication.pk} no longer matches the rows and digest it recorded, so no "
            f"pack was produced. {VERIFY.format(publication=publication.pk)}"
        ) from None
    return [
        {
            "uuid": row.pk,
            "member": row.member_id,
            "name": row.name,
            "holder_type": row.holder_type,
            "identity_source": row.identity_source,
            "shares": _whole(row.shares),
            "entitlement": row.entitlement,
        }
        for row in PublicationRecipient.objects.filter(publication=publication).order_by("-shares", "member_id")
    ]


def _chain(publication) -> list:
    events = list(
        PublicationEvent.objects.filter(publication=publication).annotate(preimage=PREIMAGE).order_by("sequence")
    )
    for event in events:
        if hashlib.sha256(event.preimage.encode()).hexdigest() != event.entry_hash:
            logger.error("Event %s of publication %s does not match its hash", event.pk, publication.pk)
            raise RegisterIntegrityError(
                f"Event {event.sequence} of publication {publication.pk} does not match its hash, so no pack was "
                f"produced. {VERIFY.format(publication=publication.pk)}"
            )
    return events


def _evidence_path(event):
    return f"{FOLDER}/{event.publication_id}/payments/{event.pk}{EXTENSIONS.get(event.evidence_mime_type, '')}"


def _event(event) -> dict:
    linked = {
        "sequence": event.sequence,
        "kind": event.kind,
        "previous_hash": event.previous_hash,
        "entry_hash": event.entry_hash,
    }
    if event.kind == PublicationEventKind.BALLOT:
        return {**linked, "withheld": True}
    return {
        **linked,
        "withheld": False,
        "uuid": event.pk,
        "recipient": event.recipient_id,
        "staff_entered": event.staff_entered,
        "authority": event.authority,
        "payload": event.payload,
        "paid_on": event.paid_on,
        "reference": event.reference,
        "evidence": (
            {"path": _evidence_path(event), "sha256": event.evidence_digest, "mime_type": event.evidence_mime_type}
            if event.evidence
            else None
        ),
        "created_at": _stamp(event.created_at),
        "preimage": event.preimage,
    }


def _terms(publication) -> dict:
    return {
        "resolution": (
            {
                "question": publication.question,
                "resolution_kind": publication.resolution_kind,
                "vote_basis": publication.vote_basis,
                "opens_at": publication.opens_at,
                "closes_at": publication.closes_at,
            }
            if publication.kind == PublicationKind.RESOLUTION
            else None
        ),
        "distribution": (
            {
                "rate_per_share": publication.rate_per_share,
                "currency": publication.currency,
                "declared_on": publication.declared_on,
                "payment_date": publication.payment_date,
                "declared_total": publication.declared_total,
                "undistributed": publication.undistributed,
            }
            if publication.kind == PublicationKind.DISTRIBUTION
            else None
        ),
    }


def _publication(publication, document, reads) -> dict:
    return {
        "uuid": publication.pk,
        "kind": publication.kind,
        "title": publication.title,
        "company_name": publication.company_name,
        "class": publication.token_id,
        "class_name": publication.token_name,
        "class_symbol": publication.token_symbol,
        "record_date": publication.record_date,
        "published_at": publication.created_at,
        "instruction": publication.instruction,
        "authority_document": publication.authority_document,
        "register": {"sequence": publication.register_sequence, "head_hash": publication.register_head_hash},
        "member_rows": publication.member_rows,
        "audience_digest": publication.audience_digest,
        "document": {"path": document, "mime_type": publication.mime_type, "sha256": publication.digest},
        **_terms(publication),
        "reads": reads,
    }


def section(company) -> dict:
    publications = list(Publication.objects.filter(company=company).order_by("created_at", "uuid"))
    reads = _reads(publications)
    files, stored, listed = {}, {}, []
    for publication in publications:
        folder = f"{FOLDER}/{publication.pk}"
        document = f"{folder}/document{EXTENSIONS.get(publication.mime_type, '')}"
        events = _chain(publication)
        read = reads.get(publication.pk, NO_READS)
        files[f"{folder}/publication.json"] = _publication(publication, document, read)
        files[f"{folder}/roll.json"] = _roll(publication)
        files[f"{folder}/events.json"] = [_event(event) for event in events]
        stored[document] = {
            "file": publication.file,
            "size": None,
            "recorded": {"sha256": publication.digest},
            "of": f"the document of publication {publication.pk}",
        }
        for event in events:
            if event.evidence:
                stored[_evidence_path(event)] = {
                    "file": event.evidence,
                    "size": None,
                    "recorded": {"sha256": event.evidence_digest},
                    "of": f"the remittance evidence of payment record {event.pk}",
                }
        listed.append(
            {
                "publication": publication,
                "events": len(events),
                "head_hash": events[-1].entry_hash if events else EMPTY_HEAD,
                "reads": read,
            }
        )
    return {"files": files, "stored": stored, "listed": listed}


def heads(listed) -> list:
    return [
        {
            "publication": row["publication"].pk,
            "kind": row["publication"].kind,
            "events": row["events"],
            "head_hash": row["head_hash"],
        }
        for row in listed
    ]
