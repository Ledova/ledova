from django.conf import settings
from django.db import models

from shared.models import BaseModel


class CompanyTeamInvitation(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="team_invitations")
    company_name = models.CharField(max_length=255, editable=False)
    inviter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    inviter_appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    capabilities = models.JSONField(editable=False)
    delegatable_capabilities = models.JSONField(editable=False)
    acceptance_deadline = models.DateTimeField(editable=False)
    appointment_expires_at = models.DateTimeField(null=True, editable=False)
    code_sha256 = models.CharField(max_length=64, unique=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(fields=["inviter", "idempotency_key"], name="companies_team_invitation_key"),
        ]
