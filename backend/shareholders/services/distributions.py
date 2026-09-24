import hashlib
import logging
from decimal import MAX_PREC, ROUND_DOWN, Decimal, localcontext

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from shared.db import APP_ALIAS, atomic, current_alias
from shared.uploads import read_bounded, validate_upload
from shareholders.constants import (
    CENT,
    DISTRIBUTION_CURRENCIES,
    MONEY_CEILING,
    RATE_CEILING,
    RATE_STEP,
)
from shareholders.models import (
    PAYMENT_RECORDS,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
)
from tokens.constants import STATUTORY_CALENDAR

logger = logging.getLogger(__name__)

ONLY_A_DISTRIBUTION_PAYS = (
    "Only a distribution carries a rate per share, a declaration date, a payment date and a declared total."
)
NO_RATE = (
    "State the rate per share the company declared: more than zero, below 1,000,000,000,000, "
    "and to at most six decimal places."
)
NO_DECLARATION_DATE = "Record the date the company declared the dividend."
DECLARED_IN_THE_FUTURE = "The declaration date cannot be in the future."
NO_PAYMENT_DATE = "Record the date the company will pay the dividend."
PAYMENT_BEFORE_THE_RECORD_DATE = "The payment date cannot be before the record date."
NO_DECLARED_TOTAL = "Record the total the company declared, as a check on the rate."
TOTAL_DIFFERS = (
    "The declared total must be the {shares} shares on the roll times the rate of {rate}, rounded down to the cent: "
    "{expected}. The instruction gives {declared}. Check the rate and the total with the company."
)
NOTHING_PAYABLE = "At this rate the members on the roll are entitled to less than a cent between them."
TOTAL_TOO_LARGE = "A declared total of 10,000,000,000,000,000 or more cannot be recorded."
NOT_A_DISTRIBUTION = "Only a distribution records payments."
NOT_ON_THE_ROLL = "That member is not on this distribution's roll."
NOTHING_TO_RECORD = "This member's entitlement is less than a cent, so there is no payment to record."
NO_REFERENCE = "Record the company's reference for this payment."
NO_PAYMENT_AUTHORITY = "Record what you relied on, such as the reference of the company's payment advice."
RECORDED_IN_THE_FUTURE = "A payment cannot be recorded as made on a date that has not arrived."
RECORDED_BEFORE_DECLARATION = "A payment cannot be recorded as made before the dividend was declared."
ALREADY_RECORDED = (
    "A payment is already recorded for this member. Withdraw that record first if it was wrong, "
    "then record the correct one."
)
PAYMENT_REFUSED = "This payment could not be recorded."
NO_WITHDRAWAL_REASON = "Record why this payment record is being withdrawn."
NOTHING_TO_WITHDRAW = "This member has no payment record to withdraw."
ONLY_STAFF = "Only an active staff member records a payment or withdraws one."


def _operator():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Recording a distribution's payments requires the operator connection.")


def entitlement(shares, rate_per_share) -> Decimal:
    with localcontext(prec=MAX_PREC):
        return (Decimal(shares) * rate_per_share).quantize(CENT, rounding=ROUND_DOWN)


def _rate(rate_per_share):
    if rate_per_share is None or not Decimal(0) < rate_per_share < RATE_CEILING:
        raise ValidationError(NO_RATE)
    with localcontext(prec=MAX_PREC):
        if rate_per_share.quantize(RATE_STEP, rounding=ROUND_DOWN) != rate_per_share:
            raise ValidationError(NO_RATE)
    return rate_per_share


def distribution_terms(kind, record_date, rate_per_share, declared_on, payment_date, declared_total) -> dict:
    if kind != PublicationKind.DISTRIBUTION:
        if any(value is not None for value in (rate_per_share, declared_on, payment_date, declared_total)):
            raise ValidationError(ONLY_A_DISTRIBUTION_PAYS)
        return {}
    rate = _rate(rate_per_share)
    if declared_on is None:
        raise ValidationError(NO_DECLARATION_DATE)
    if declared_on > timezone.localdate(timezone=STATUTORY_CALENDAR):
        raise ValidationError(DECLARED_IN_THE_FUTURE)
    if payment_date is None:
        raise ValidationError(NO_PAYMENT_DATE)
    if payment_date < record_date:
        raise ValidationError(PAYMENT_BEFORE_THE_RECORD_DATE)
    if declared_total is None:
        raise ValidationError(NO_DECLARED_TOTAL)
    return {
        "rate_per_share": rate,
        "currency": DISTRIBUTION_CURRENCIES[0],
        "declared_on": declared_on,
        "payment_date": payment_date,
        "declared_total": declared_total,
    }


def entitle(terms, rows) -> dict:
    if not terms:
        return {}
    rate = terms["rate_per_share"]
    shares = sum(int(row["shares"]) for row in rows)
    expected = entitlement(shares, rate)
    if expected >= MONEY_CEILING:
        raise ValidationError(TOTAL_TOO_LARGE)
    if expected == 0:
        raise ValidationError(NOTHING_PAYABLE)
    if terms["declared_total"] != expected:
        raise ValidationError(
            TOTAL_DIFFERS.format(shares=shares, rate=rate, expected=expected, declared=terms["declared_total"])
        )
    for row in rows:
        row["entitlement"] = entitlement(row["shares"], rate)
    return {"undistributed": expected - sum(row["entitlement"] for row in rows)}


def _staff_on_the_roll(staff_user, publication, recipient):
    _operator()
    if not (staff_user.is_active and staff_user.is_staff):
        raise PermissionDenied(ONLY_STAFF)
    if publication.kind != PublicationKind.DISTRIBUTION:
        raise ValidationError(NOT_A_DISTRIBUTION)
    if recipient.publication_id != publication.pk:
        raise ValidationError(NOT_ON_THE_ROLL)


def _evidence(upload):
    _, mime_type = validate_upload(upload, field="evidence")
    upload.seek(0)
    raw = read_bounded(upload)
    upload.seek(0)
    return raw, mime_type


def _latest_record(recipient):
    return (
        PublicationEvent.objects.filter(recipient_id=recipient.pk, kind__in=PAYMENT_RECORDS)
        .order_by("-sequence")
        .values_list("kind", flat=True)
        .first()
    )


def _recorded(publication, recipient, **columns):
    with atomic():
        record = PublicationEvent.objects.create(
            publication_id=publication.pk,
            company_id=publication.company_id,
            recipient_id=recipient.pk,
            staff_entered=True,
            **columns,
        )
        record.refresh_from_db()
    return record


def record_payment(staff_user, publication, recipient, *, paid_on, reference, evidence, authority):
    _staff_on_the_roll(staff_user, publication, recipient)
    if not recipient.entitlement:
        raise ValidationError(NOTHING_TO_RECORD)
    if not reference.strip():
        raise ValidationError(NO_REFERENCE)
    if not authority.strip():
        raise ValidationError(NO_PAYMENT_AUTHORITY)
    if paid_on > timezone.localdate(timezone=STATUTORY_CALENDAR):
        raise ValidationError(RECORDED_IN_THE_FUTURE)
    if paid_on < publication.declared_on:
        raise ValidationError(RECORDED_BEFORE_DECLARATION)
    if _latest_record(recipient) == PublicationEventKind.PAYMENT:
        raise ValidationError(ALREADY_RECORDED)
    raw, mime_type = _evidence(evidence)
    try:
        record = _recorded(
            publication,
            recipient,
            kind=PublicationEventKind.PAYMENT,
            actor_id=staff_user.pk,
            authority=authority.strip(),
            paid_on=paid_on,
            reference=reference.strip(),
            evidence=ContentFile(raw, name="evidence.bin"),
            evidence_digest=hashlib.sha256(raw).hexdigest(),
            evidence_mime_type=mime_type,
        )
    except IntegrityError:
        raise ValidationError(
            ALREADY_RECORDED if _latest_record(recipient) == PublicationEventKind.PAYMENT else PAYMENT_REFUSED
        ) from None
    logger.info(f"Recorded payment {record.pk} for roll row {recipient.pk} of distribution {publication.pk}")
    return record


def withdraw_payment(staff_user, publication, recipient, reason):
    _staff_on_the_roll(staff_user, publication, recipient)
    if not reason.strip():
        raise ValidationError(NO_WITHDRAWAL_REASON)
    try:
        record = _recorded(
            publication,
            recipient,
            kind=PublicationEventKind.PAYMENT_VOID,
            actor_id=staff_user.pk,
            authority=reason.strip(),
        )
    except IntegrityError:
        raise ValidationError(NOTHING_TO_WITHDRAW) from None
    logger.info(f"Withdrew the payment record for roll row {recipient.pk} of distribution {publication.pk}")
    return record
