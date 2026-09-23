from django.db import models

from shared.models import BaseModel
from tokens.models.choices import IDENTITY_SOURCE_CHOICES
from whitelist.models import HolderType

from .publication import Publication


class PublicationRecipient(BaseModel):
    publication = models.ForeignKey(Publication, on_delete=models.PROTECT, related_name="recipients")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="publication_recipients")
    member_id = models.UUIDField(editable=False)
    user_id = models.PositiveBigIntegerField(null=True, editable=False)
    name = models.CharField(max_length=255, blank=True, editable=False)
    holder_type = models.CharField(max_length=16, choices=HolderType.choices, editable=False)
    identity_source = models.CharField(max_length=24, choices=IDENTITY_SOURCE_CHOICES, editable=False)
    shares = models.DecimalField(max_digits=78, decimal_places=0, editable=False)

    class Meta:
        ordering = ["-shares", "member_id"]
        constraints = [
            models.UniqueConstraint(fields=["publication", "member_id"], name="publication_member_once"),
            models.CheckConstraint(condition=models.Q(shares__gt=0), name="publication_recipient_holds_shares"),
            models.CheckConstraint(
                condition=models.Q(holder_type=HolderType.MEMBER) | models.Q(user_id__isnull=True),
                name="publication_recipient_names_a_member",
            ),
        ]
        indexes = [models.Index(fields=["user_id"], name="publication_recipient_user")]
