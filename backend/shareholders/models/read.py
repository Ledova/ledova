from django.db import models

from shared.models import BaseModel
from shareholders.constants import PUBLICATION_READ_KINDS


class PublicationRead(BaseModel):
    actor_id = models.PositiveBigIntegerField()
    publication_uuid = models.UUIDField(db_index=True)
    recipient_uuid = models.UUIDField(null=True, blank=True)
    event_uuid = models.UUIDField(null=True, blank=True)
    kind = models.CharField(max_length=16, choices=PUBLICATION_READ_KINDS)

    class Meta:
        ordering = ["-created_at"]
