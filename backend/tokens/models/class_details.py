from django.conf import settings
from django.db import models

from shared.models import BaseModel


class ClassDetailsRevision(BaseModel):
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="details_revisions")
    revision = models.PositiveIntegerField()
    before = models.JSONField()
    after = models.JSONField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    recorded_by_name = models.CharField(max_length=255, blank=True)
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-revision"]
        constraints = [
            models.CheckConstraint(condition=models.Q(revision__gt=0), name="class_details_positive_revision"),
            models.UniqueConstraint(fields=["token", "revision"], name="one_class_details_revision"),
        ]
