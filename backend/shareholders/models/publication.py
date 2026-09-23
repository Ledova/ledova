import uuid

from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage


class PublicationKind(models.TextChoices):
    HOLDING_STATEMENT = "holding_statement", "Annual holding statement"
    MEETING_NOTICE = "meeting_notice", "Meeting notice"


DOCUMENT_KINDS = (PublicationKind.HOLDING_STATEMENT, PublicationKind.MEETING_NOTICE)


def publication_file_path(instance, filename):
    return f"companies/{instance.company_id}/publications/{instance.pk}/{uuid.uuid4()}.bin"


class Publication(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="publications")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="publications")
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
        ]
