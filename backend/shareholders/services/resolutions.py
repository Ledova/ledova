import logging

from django.db import IntegrityError
from django.db.models.expressions import RawSQL
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from shared.db import APP_ALIAS, atomic, current_alias, use_operator
from shareholders.constants import SPECIAL_RESOLUTION_MAJORITY
from shareholders.exceptions import NO_PUBLICATION, PublicationIntegrityError
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRecipient,
    ResolutionKind,
)

logger = logging.getLogger(__name__)

NOT_A_RESOLUTION = "Only a resolution takes ballots and is closed."
UNKNOWN_CHOICE = "Choose for, against or abstain."
NOT_OPEN_YET = "Voting on this resolution has not opened yet."
VOTING_CLOSED = "Voting on this resolution has closed."
ALREADY_CAST = "A ballot has already been recorded for this member, and a ballot cannot be changed."
NOT_ON_THE_ROLL = "That member is not on this resolution's roll."
NO_BALLOT_AUTHORITY = "Record what you relied on to enter this ballot, such as the reference of a proxy form."
ONLY_STAFF = "Only an active staff member enters a ballot on a member's behalf."
BALLOT_REFUSED = "This ballot could not be recorded."
STILL_OPEN = "A resolution cannot be closed before its voting window has passed."
CHAIN_BROKEN = "Publication {publication}'s event chain does not verify at sequence {sequence}."
BALLOT_OFF_THE_ROLL = "Publication {publication} records a ballot whose member or shares differ from its roll."
BALLOT_TWICE = "Publication {publication} records more than one ballot for one member."
EVENT_AFTER_CLOSE = "Publication {publication} records an event after its close."
EVENT_ELSEWHERE = "Publication {publication} records an event under another company."
TALLY_DIFFERS = "Publication {publication} records a tally that differs from its ballots."


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Recording or verifying a resolution's ballots requires the operator connection.")


def _is_closed(publication):
    return PublicationEvent.objects.filter(publication_id=publication.pk, kind=PublicationEventKind.CLOSE).exists()


def _why_no_ballot(publication, recipient):
    now = timezone.now()
    with use_operator():
        if now >= publication.closes_at or _is_closed(publication):
            return VOTING_CLOSED
        if now < publication.opens_at:
            return NOT_OPEN_YET
        if PublicationEvent.objects.filter(recipient_id=recipient.pk, kind=PublicationEventKind.BALLOT).exists():
            return ALREADY_CAST
    return BALLOT_REFUSED


def _record_ballot(publication, recipient, choice, *, actor_id, authority=""):
    if choice not in BallotChoice.values:
        raise ValidationError(UNKNOWN_CHOICE)
    try:
        with use_operator(), atomic():
            ballot = PublicationEvent.objects.create(
                publication_id=publication.pk,
                company_id=publication.company_id,
                kind=PublicationEventKind.BALLOT,
                recipient_id=recipient.pk,
                choice=choice,
                actor_id=actor_id,
                staff_entered=bool(authority),
                authority=authority,
            )
            ballot.refresh_from_db()
    except IntegrityError:
        raise ValidationError(_why_no_ballot(publication, recipient)) from None
    return ballot


def cast_ballot(user, publication_id, choice):
    publication = Publication.objects.filter(pk=publication_id, kind=PublicationKind.RESOLUTION).first()
    recipient = (
        None
        if publication is None
        else PublicationRecipient.objects.filter(publication=publication, user_id=user.pk).first()
    )
    if recipient is None:
        raise NotFound(NO_PUBLICATION)
    return _record_ballot(publication, recipient, choice, actor_id=user.pk)


def enter_ballot(staff_user, publication, recipient, choice, authority):
    _operator()
    if not (staff_user.is_active and staff_user.is_staff):
        raise PermissionDenied(ONLY_STAFF)
    if publication.kind != PublicationKind.RESOLUTION:
        raise ValidationError(NOT_A_RESOLUTION)
    if recipient.publication_id != publication.pk:
        raise ValidationError(NOT_ON_THE_ROLL)
    if not authority.strip():
        raise ValidationError(NO_BALLOT_AUTHORITY)
    return _record_ballot(publication, recipient, choice, actor_id=staff_user.pk, authority=authority.strip())


def close_resolution(publication):
    _operator()
    if publication.kind != PublicationKind.RESOLUTION:
        raise ValidationError(NOT_A_RESOLUTION)
    try:
        with atomic():
            close = PublicationEvent.objects.create(
                publication_id=publication.pk,
                company_id=publication.company_id,
                kind=PublicationEventKind.CLOSE,
            )
            close.refresh_from_db()
            return close
    except IntegrityError:
        close = PublicationEvent.objects.filter(publication_id=publication.pk, kind=PublicationEventKind.CLOSE).first()
        if close is None:
            raise ValidationError(STILL_OPEN) from None
        return close


def close_due_resolutions(now=None) -> int:
    now = now or timezone.now()
    closed = failed = 0
    with use_operator():
        due = list(
            Publication.objects.filter(kind=PublicationKind.RESOLUTION, closes_at__lte=now)
            .exclude(events__kind=PublicationEventKind.CLOSE)
            .order_by("closes_at", "pk")
        )
        for publication in due:
            try:
                close_resolution(publication)
            except Exception as error:
                failed += 1
                logger.error("Resolution %s could not be closed: %s", publication.pk, type(error).__name__)
                continue
            closed += 1
    logger.info(f"Closed {closed} resolutions whose voting window had passed")
    if failed:
        raise RuntimeError(f"{failed} resolutions past their voting window could not be closed.")
    return closed


def tally(publication, recipients, ballots) -> dict:
    counted = {choice: {"shares": 0, "members": 0} for choice in BallotChoice.values}
    for ballot in ballots:
        counted[ballot.choice]["shares"] += int(ballot.shares)
        counted[ballot.choice]["members"] += 1
    shares_for = counted[BallotChoice.FOR]["shares"]
    shares_against = counted[BallotChoice.AGAINST]["shares"]
    cast = shares_for + shares_against
    majority = SPECIAL_RESOLUTION_MAJORITY
    if publication.resolution_kind == ResolutionKind.SPECIAL:
        carried = cast > 0 and shares_for * majority.denominator >= cast * majority.numerator
    else:
        carried = shares_for > shares_against
    recipients = list(recipients)
    return {
        "basis": publication.vote_basis,
        "resolution_kind": publication.resolution_kind,
        **{
            choice: {"shares": str(totals["shares"]), "members": totals["members"]}
            for choice, totals in counted.items()
        },
        "eligible": {"shares": str(sum(int(row.shares) for row in recipients)), "members": len(recipients)},
        "carried": carried,
    }


def verify_publication(publication_id) -> dict:
    _operator()
    with atomic():
        publication = Publication.objects.select_for_update().get(pk=publication_id)
        roll = {row.pk: row for row in PublicationRecipient.objects.filter(publication=publication)}
        events = (
            PublicationEvent.objects.filter(publication=publication)
            .order_by("sequence")
            .annotate(calculated_hash=RawSQL("shareholders_publication_event_hash(shareholders_publicationevent)", []))
        )
        previous_hash = "0" * 64
        sequence = 0
        ballots = {}
        close = None
        for event in events.iterator(chunk_size=100):
            sequence += 1
            if (
                event.sequence != sequence
                or event.previous_hash != previous_hash
                or event.entry_hash != event.calculated_hash
            ):
                raise PublicationIntegrityError(CHAIN_BROKEN.format(publication=publication.pk, sequence=sequence))
            previous_hash = event.entry_hash
            if event.company_id != publication.company_id:
                raise PublicationIntegrityError(EVENT_ELSEWHERE.format(publication=publication.pk))
            if close is not None:
                raise PublicationIntegrityError(EVENT_AFTER_CLOSE.format(publication=publication.pk))
            if event.kind == PublicationEventKind.CLOSE:
                close = event
                continue
            member = roll.get(event.recipient_id)
            if member is None or event.shares != member.shares:
                raise PublicationIntegrityError(BALLOT_OFF_THE_ROLL.format(publication=publication.pk))
            if event.recipient_id in ballots:
                raise PublicationIntegrityError(BALLOT_TWICE.format(publication=publication.pk))
            ballots[event.recipient_id] = event
        if close is not None and close.payload != tally(publication, roll.values(), ballots.values()):
            raise PublicationIntegrityError(TALLY_DIFFERS.format(publication=publication.pk))
    return {
        "events": sequence,
        "head_hash": previous_hash,
        "ballots": len(ballots),
        "tally": None if close is None else close.payload,
    }
