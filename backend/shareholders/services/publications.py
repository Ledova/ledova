import hashlib
import logging

from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import Company, CompanyDocument
from shared.db import APP_ALIAS, atomic, current_alias, on_commit, use_operator
from shared.uploads import read_bounded, validate_upload
from shareholders.constants import (
    PUBLICATION_NOTICE,
    READ_AS_COMPANY,
    READ_AS_MEMBER,
    READ_AS_STAFF,
)
from shareholders.exceptions import (
    NO_PUBLICATION,
    PublicationIntegrityError,
    PublicationNotDelivered,
    PublicationUnopened,
)
from shareholders.models import (
    Publication,
    PublicationEvent,
    PublicationKind,
    PublicationRead,
    PublicationRecipient,
    ResolutionKind,
    VoteBasis,
)
from shareholders.services.distributions import distribution_terms, entitle
from shareholders.services.roll import frozen_rows, roll_digest
from tokens.constants import STATUTORY_CALENDAR
from tokens.models import ShareRegister
from tokens.services.former_holders import retention_cutoff

logger = logging.getLogger(__name__)

UNKNOWN_KIND = "Choose a publication kind the platform knows."
FUTURE_RECORD_DATE = "The record date cannot be in the future."
NO_INSTRUCTION = "Record the reference of the company's written instruction."
NO_TITLE = "Give the publication a title members will recognise."
NO_AUTHORITY = (
    "The company's authority for this publication must be a verified company document with a recorded fingerprint."
)
REGISTER_NOT_OPENED = "This share class's stored register has not been opened, so it has no members to publish to."
NO_MEMBERS = "The stored register lists no member holding shares on that record date."
ONLY_A_RESOLUTION_VOTES = "Only a resolution carries a question and a voting window."
NO_QUESTION = "State the question the members are asked to resolve."
UNKNOWN_RESOLUTION_KIND = "Choose whether this is an ordinary or a special resolution."
NO_WINDOW = "Give the resolution the moment voting opens and the moment it closes."
WINDOW_BACKWARDS = "Voting must close after it opens."
CLOSES_IN_THE_PAST = "Voting must close in the future."

ANNOUNCEMENTS = {
    PublicationKind.HOLDING_STATEMENT: (
        "Your holding statement is ready",
        "{company} has published a holding statement for your {token}.",
    ),
    PublicationKind.MEETING_NOTICE: (
        "A meeting notice for your shares",
        "{company} has published a meeting notice to the members of its {token}.",
    ),
    PublicationKind.RESOLUTION: (
        "A resolution has been put to members",
        "{company} has put a resolution to the members of its {token}.",
    ),
    PublicationKind.DISTRIBUTION: (
        "A dividend has been declared",
        "{company} has declared a dividend on your {token}.",
    ),
}


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Publishing to members requires the operator connection.")


def _authority(token, authority_document):
    document = (
        CompanyDocument.objects.filter(
            uuid=authority_document,
            company_id=token.company_id,
            is_verified=True,
            verified_by__isnull=False,
        )
        .exclude(verified_fingerprint="")
        .first()
    )
    if document is None:
        raise ValidationError(NO_AUTHORITY)
    return document.verified_fingerprint


def _bytes(upload):
    _, mime_type = validate_upload(upload, field="file")
    upload.seek(0)
    raw = read_bounded(upload)
    upload.seek(0)
    return raw, mime_type


def _resolution(kind, question, resolution_kind, opens_at, closes_at) -> dict:
    if kind != PublicationKind.RESOLUTION:
        if question.strip() or resolution_kind or opens_at is not None or closes_at is not None:
            raise ValidationError(ONLY_A_RESOLUTION_VOTES)
        return {}
    if not question.strip():
        raise ValidationError(NO_QUESTION)
    if resolution_kind not in ResolutionKind.values:
        raise ValidationError(UNKNOWN_RESOLUTION_KIND)
    if opens_at is None or closes_at is None:
        raise ValidationError(NO_WINDOW)
    if closes_at <= opens_at:
        raise ValidationError(WINDOW_BACKWARDS)
    if closes_at <= timezone.now():
        raise ValidationError(CLOSES_IN_THE_PAST)
    return {
        "question": question.strip(),
        "resolution_kind": resolution_kind,
        "vote_basis": VoteBasis.PER_SHARE,
        "opens_at": opens_at,
        "closes_at": closes_at,
    }


def publish_to_members(
    token,
    prepared_by,
    *,
    kind,
    title,
    record_date,
    instruction,
    authority_document,
    upload,
    question="",
    resolution_kind="",
    opens_at=None,
    closes_at=None,
    rate_per_share=None,
    declared_on=None,
    payment_date=None,
    declared_total=None,
):
    from shareholders.tasks.publications import tell_the_members

    _operator()
    if kind not in PublicationKind.values:
        raise ValidationError(UNKNOWN_KIND)
    if not title.strip():
        raise ValidationError(NO_TITLE)
    if not instruction.strip():
        raise ValidationError(NO_INSTRUCTION)
    if record_date > timezone.localdate(timezone=STATUTORY_CALENDAR):
        raise ValidationError(FUTURE_RECORD_DATE)
    resolution = _resolution(kind, question, resolution_kind, opens_at, closes_at)
    distribution = distribution_terms(kind, record_date, rate_per_share, declared_on, payment_date, declared_total)
    fingerprint = _authority(token, authority_document)
    raw, mime_type = _bytes(upload)

    with atomic():
        register = ShareRegister.objects.select_for_update().filter(token=token).first()
        if register is None or register.sequence == 0:
            raise ValidationError(REGISTER_NOT_OPENED)
        rows = frozen_rows(token, register, record_date)
        if not rows:
            raise ValidationError(NO_MEMBERS)
        remainder = entitle(distribution, rows)
        publication = Publication.objects.create(
            company_id=token.company_id,
            company_name=token.company.name,
            token=token,
            token_name=token.name,
            token_symbol=token.symbol,
            kind=kind,
            title=title.strip(),
            record_date=record_date,
            instruction=instruction.strip(),
            authority_document=authority_document,
            authority_fingerprint=fingerprint,
            file=ContentFile(raw, name=f"{kind}.bin"),
            mime_type=mime_type,
            digest=hashlib.sha256(raw).hexdigest(),
            register_sequence=register.sequence,
            register_head_hash=register.head_hash,
            member_rows=len(rows),
            audience_digest=roll_digest(rows),
            prepared_by_id=prepared_by.pk,
            **resolution,
            **distribution,
            **remainder,
        )
        PublicationRecipient.objects.bulk_create(
            PublicationRecipient(publication=publication, company_id=publication.company_id, **row) for row in rows
        )
        on_commit(lambda: tell_the_members.defer(publication_id=str(publication.pk)))
    return publication


def verify_roll(publication) -> dict:
    rows = [
        {
            "member_id": recipient.member_id,
            "user_id": recipient.user_id,
            "name": recipient.name,
            "holder_type": recipient.holder_type,
            "identity_source": recipient.identity_source,
            "shares": int(recipient.shares),
        }
        for recipient in PublicationRecipient.objects.filter(publication=publication)
    ]
    digest = roll_digest(rows)
    if len(rows) != publication.member_rows or digest != publication.audience_digest:
        raise PublicationIntegrityError(
            f"Publication {publication.pk} has a roll of {len(rows)} rows digesting to {digest}, "
            f"and it recorded {publication.member_rows} rows digesting to {publication.audience_digest}."
        )
    return {"member_rows": len(rows), "audience_digest": digest}


def record_publication_read(user, publication, recipient, kind) -> None:
    try:
        with use_operator():
            PublicationRead.objects.create(
                actor_id=user.pk,
                publication_uuid=publication.pk,
                recipient_uuid=None if recipient is None else recipient.pk,
                kind=kind,
            )
    except Exception as error:
        logger.error("A publication read could not be recorded: %s", type(error).__name__)
        raise PublicationNotDelivered() from None


def deliver_publication(user, publication, recipient, kind) -> None:
    try:
        publication.file.open("rb")
    except (ValueError, OSError) as error:
        logger.error("A publication's stored document could not be opened: %s", type(error).__name__)
        raise PublicationUnopened() from None
    try:
        record_publication_read(user, publication, recipient, kind)
    except BaseException:
        publication.file.close()
        raise


def _reader(user, publication, recipient):
    if recipient is not None:
        return READ_AS_MEMBER
    if Company.objects.filter(pk=publication.company_id, owner_id=user.pk).exists():
        return READ_AS_COMPANY
    if user.is_active and user.is_staff:
        return READ_AS_STAFF
    raise NotFound(NO_PUBLICATION)


def read_publication(user, publication_id):
    publication = Publication.objects.filter(pk=publication_id).first()
    if publication is None:
        raise NotFound(NO_PUBLICATION)
    recipient = PublicationRecipient.objects.filter(publication=publication, user_id=user.pk).first()
    deliver_publication(user, publication, recipient, _reader(user, publication, recipient))
    return publication, recipient


def notify_the_roll(publication_id) -> int:
    from users.tasks.notifications import send_push_notification

    with use_operator():
        publication = Publication.objects.filter(pk=publication_id).first()
        if publication is None:
            logger.error("A publication to announce no longer exists: %s", publication_id)
            return 0
        readers = list(
            PublicationRecipient.objects.filter(publication_id=publication.pk, user_id__isnull=False)
            .order_by("member_id")
            .values_list("user_id", flat=True)
        )
    title, body = ANNOUNCEMENTS[publication.kind]
    for user_id in readers:
        send_push_notification.defer(
            user_id=str(user_id),
            title=title,
            body=body.format(company=publication.company_name, token=publication.token_name),
            data={
                "type": PUBLICATION_NOTICE,
                "event": "published",
                "publication_id": str(publication.pk),
                "kind": publication.kind,
            },
            notification_type="general",
        )
    logger.info(f"Announced publication {publication.pk} to {len(readers)} members with an account")
    return len(readers)


def purge_publications(now=None) -> int:
    cutoff = retention_cutoff(now)
    expired = list(Publication.objects.filter(created_at__date__lt=cutoff).values_list("pk", flat=True))
    if not expired:
        return 0
    with atomic():
        PublicationRead.objects.filter(publication_uuid__in=expired).delete()
        PublicationEvent.objects.filter(publication_id__in=expired).delete()
        PublicationRecipient.objects.filter(publication_id__in=expired).delete()
        Publication.objects.filter(pk__in=expired).delete()
    logger.info(f"Removed {len(expired)} publications that passed the seven-year clock")
    return len(expired)
