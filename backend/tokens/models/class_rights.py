from django.conf import settings
from django.db import models

from shared.models import BaseModel


class ClassRightsRevision(BaseModel):
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="rights_revisions")
    revision = models.PositiveIntegerField()
    summary = models.CharField(max_length=4000, blank=True)
    document_reference = models.CharField(max_length=255, blank=True)
    documents = models.JSONField(default=list, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    recorded_by_name = models.CharField(max_length=255, blank=True)
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()

    class Meta:
        ordering = ["-revision"]
        constraints = [
            models.CheckConstraint(condition=models.Q(revision__gt=0), name="class_rights_positive_revision"),
            models.UniqueConstraint(fields=["token", "revision"], name="one_class_rights_revision"),
            models.UniqueConstraint(fields=["recorded_by", "idempotency_key"], name="one_class_rights_request"),
        ]
