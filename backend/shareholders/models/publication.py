import uuid

from django.db import models

from shared.constants import CURRENCY_CHOICES
from shared.models import BaseModel
from shared.storage import private_storage
from shareholders.constants import DISTRIBUTION_CURRENCIES
from shareholders.querysets.publication import PublicationQuerySet


class PublicationKind(models.TextChoices):
    HOLDING_STATEMENT = "holding_statement", "Annual holding statement"
    MEETING_NOTICE = "meeting_notice", "Meeting notice"
    RESOLUTION = "resolution", "Resolution"
    DISTRIBUTION = "distribution", "Dividend"


class ResolutionKind(models.TextChoices):
    ORDINARY = "ordinary", "Ordinary resolution"
    SPECIAL = "special", "Special resolution"


class VoteBasis(models.TextChoices):
    PER_SHARE = "per_share", "One vote per share"


DOCUMENT_KINDS = (
    PublicationKind.HOLDING_STATEMENT,
    PublicationKind.MEETING_NOTICE,
    PublicationKind.RESOLUTION,
    PublicationKind.DISTRIBUTION,
)


def publication_file_path(instance, filename):
    return f"companies/{instance.company_id}/publications/{instance.pk}/{uuid.uuid4()}.bin"


class Publication(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="publications")
    company_name = models.CharField(max_length=255, editable=False)
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="publications")
    token_name = models.CharField(max_length=100, editable=False)
    token_symbol = models.CharField(max_length=10, editable=False)
    kind = models.CharField(max_length=32, choices=PublicationKind.choices, editable=False)
    title = models.CharField(max_length=255, editable=False)
    record_date = models.DateField(editable=False)
    instruction = models.CharField(max_length=255, editable=False)
    authority_document = models.UUIDField(editable=False)
    authority_fingerprint = models.CharField(max_length=64, editable=False)
    file = models.FileField(upload_to=publication_file_path, storage=private_storage, max_length=255, editable=False)
    mime_type = models.CharField(max_length=100, blank=True, editable=False)
    digest = models.CharField(max_length=64, blank=True, editable=False)
    register_sequence = models.PositiveBigIntegerField(editable=False)
    register_head_hash = models.CharField(max_length=64, editable=False)
    member_rows = models.PositiveIntegerField(editable=False)
    audience_digest = models.CharField(max_length=64, editable=False)
    prepared_by_id = models.PositiveBigIntegerField(editable=False)
    question = models.TextField(blank=True, editable=False)
    resolution_kind = models.CharField(max_length=16, choices=ResolutionKind.choices, blank=True, editable=False)
    vote_basis = models.CharField(max_length=16, choices=VoteBasis.choices, blank=True, editable=False)
    opens_at = models.DateTimeField("voting opens", null=True, blank=True, editable=False)
    closes_at = models.DateTimeField("voting closes", null=True, blank=True, editable=False)
    rate_per_share = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True, editable=False)
    currency = models.CharField(max_length=16, choices=CURRENCY_CHOICES, blank=True, editable=False)
    declared_on = models.DateField("dividend declared on", null=True, blank=True, editable=False)
    payment_date = models.DateField(null=True, blank=True, editable=False)
    declared_total = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True, editable=False)
    undistributed = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True, editable=False)

    objects = PublicationQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(kind__in=DOCUMENT_KINDS)
                | (
                    models.Q(digest__regex="^[0-9a-f]{64}$")
                    & ~models.Q(title__regex=r"^\s*$")
                    & ~models.Q(mime_type__regex=r"^\s*$")
                ),
                name="publication_document_carries_its_bytes",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    audience_digest__regex="^[0-9a-f]{64}$",
                    authority_fingerprint__regex="^[0-9a-f]{64}$",
                    register_head_hash__regex="^[0-9a-f]{64}$",
                    register_sequence__gte=1,
                )
                & ~models.Q(instruction__regex=r"^\s*$"),
                name="publication_records_its_authority_and_snapshot",
            ),
            models.CheckConstraint(
                condition=~models.Q(company_name__regex=r"^\s*$")
                & ~models.Q(token_name__regex=r"^\s*$")
                & ~models.Q(token_symbol__regex=r"^\s*$"),
                name="publication_names_the_company_and_the_class",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        kind=PublicationKind.RESOLUTION,
                        resolution_kind__in=ResolutionKind.values,
                        vote_basis__in=VoteBasis.values,
                        opens_at__isnull=False,
                        closes_at__isnull=False,
                        closes_at__gt=models.F("opens_at"),
                    )
                    & ~models.Q(question__regex=r"^\s*$")
                )
                | (
                    ~models.Q(kind=PublicationKind.RESOLUTION)
                    & models.Q(
                        question="",
                        resolution_kind="",
                        vote_basis="",
                        opens_at__isnull=True,
                        closes_at__isnull=True,
                    )
                ),
                name="publication_resolution_states_its_question_and_window",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    kind=PublicationKind.DISTRIBUTION,
                    rate_per_share__isnull=False,
                    rate_per_share__gt=0,
                    currency__in=DISTRIBUTION_CURRENCIES,
                    declared_on__isnull=False,
                    payment_date__isnull=False,
                    payment_date__gte=models.F("record_date"),
                    declared_total__isnull=False,
                    declared_total__gt=0,
                    undistributed__isnull=False,
                    undistributed__gte=0,
                )
                | models.Q(
                    ~models.Q(kind=PublicationKind.DISTRIBUTION),
                    rate_per_share__isnull=True,
                    currency="",
                    declared_on__isnull=True,
                    payment_date__isnull=True,
                    declared_total__isnull=True,
                    undistributed__isnull=True,
                ),
                name="publication_distribution_states_its_rate_dates_and_total",
            ),
        ]
