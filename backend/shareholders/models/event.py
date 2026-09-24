import uuid

from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage

from .publication import Publication
from .recipient import PublicationRecipient


class PublicationEventKind(models.TextChoices):
    BALLOT = "ballot", "Ballot"
    CLOSE = "close", "Close"
    PAYMENT = "payment", "Payment recorded"
    PAYMENT_VOID = "payment_void", "Payment record withdrawn"


PAYMENT_RECORDS = (PublicationEventKind.PAYMENT, PublicationEventKind.PAYMENT_VOID)


class BallotChoice(models.TextChoices):
    FOR = "for", "For"
    AGAINST = "against", "Against"
    ABSTAIN = "abstain", "Abstain"


def payment_evidence_path(instance, filename):
    return (
        f"companies/{instance.company_id}/publications/{instance.publication_id}/payments/{instance.pk}/"
        f"{uuid.uuid4()}.bin"
    )


class PublicationEvent(BaseModel):
    publication = models.ForeignKey(Publication, on_delete=models.PROTECT, related_name="events")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="publication_events")
    sequence = models.PositiveBigIntegerField(default=0, editable=False)
    kind = models.CharField(max_length=16, choices=PublicationEventKind.choices)
    recipient = models.ForeignKey(
        PublicationRecipient, on_delete=models.PROTECT, null=True, blank=True, related_name="ballots"
    )
    choice = models.CharField(max_length=8, choices=BallotChoice.choices, blank=True)
    shares = models.DecimalField(max_digits=78, decimal_places=0, null=True, editable=False)
    actor_id = models.PositiveBigIntegerField(null=True, blank=True)
    staff_entered = models.BooleanField(default=False)
    authority = models.CharField(max_length=255, blank=True)
    payload = models.JSONField(null=True, editable=False)
    paid_on = models.DateField("recorded as paid on", null=True, blank=True)
    reference = models.CharField("the company's payment reference", max_length=64, blank=True)
    evidence = models.FileField(upload_to=payment_evidence_path, storage=private_storage, max_length=255, blank=True)
    evidence_digest = models.CharField(max_length=64, blank=True)
    previous_hash = models.CharField(max_length=64, blank=True, editable=False)
    entry_hash = models.CharField(max_length=64, blank=True, editable=False)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["publication", "sequence"], name="publication_event_sequence"),
            models.UniqueConstraint(
                fields=["publication", "recipient"],
                condition=models.Q(kind=PublicationEventKind.BALLOT),
                name="publication_ballot_once",
            ),
            models.UniqueConstraint(
                fields=["publication"],
                condition=models.Q(kind=PublicationEventKind.CLOSE),
                name="publication_closes_once",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    kind=PublicationEventKind.BALLOT,
                    recipient__isnull=False,
                    choice__in=BallotChoice.values,
                    shares__isnull=False,
                    actor_id__isnull=False,
                    payload__isnull=True,
                    paid_on__isnull=True,
                    reference="",
                    evidence="",
                    evidence_digest="",
                )
                | models.Q(
                    kind=PublicationEventKind.CLOSE,
                    recipient__isnull=True,
                    choice="",
                    shares__isnull=True,
                    actor_id__isnull=True,
                    staff_entered=False,
                    payload__isnull=False,
                    paid_on__isnull=True,
                    reference="",
                    evidence="",
                    evidence_digest="",
                )
                | models.Q(
                    ~models.Q(reference__regex=r"^\s*$"),
                    ~models.Q(evidence=""),
                    kind=PublicationEventKind.PAYMENT,
                    recipient__isnull=False,
                    choice="",
                    shares__isnull=True,
                    actor_id__isnull=False,
                    staff_entered=True,
                    payload__isnull=True,
                    paid_on__isnull=False,
                    evidence_digest__regex="^[0-9a-f]{64}$",
                )
                | models.Q(
                    kind=PublicationEventKind.PAYMENT_VOID,
                    recipient__isnull=False,
                    choice="",
                    shares__isnull=True,
                    actor_id__isnull=False,
                    staff_entered=True,
                    payload__isnull=True,
                    paid_on__isnull=True,
                    reference="",
                    evidence="",
                    evidence_digest="",
                ),
                name="publication_event_has_the_shape_of_its_kind",
            ),
            models.CheckConstraint(
                condition=(models.Q(staff_entered=True) & ~models.Q(authority__regex=r"^\s*$"))
                | models.Q(staff_entered=False, authority=""),
                name="publication_event_staff_entry_names_its_authority",
            ),
        ]
