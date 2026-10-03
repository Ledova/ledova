from django.conf import settings
from django.db import models
from django.utils import timezone

from companies.querysets.appointment import CompanyAppointmentQuerySet
from shared.models import BaseModel


class CompanyAppointment(BaseModel):
    objects = CompanyAppointmentQuerySet.as_manager()
    company = models.OneToOneField("companies.Company", on_delete=models.PROTECT, related_name="initial_appointment")
    request = models.OneToOneField(
        "companies.CompanyAuthorityRequest", on_delete=models.PROTECT, related_name="appointment"
    )
    registry_check = models.ForeignKey("companies.CompanyRegistryCheck", on_delete=models.PROTECT, related_name="+")
    capabilities = models.JSONField(editable=False)
    delegatable_capabilities = models.JSONField(editable=False)
    expires_at = models.DateTimeField(null=True, editable=False)
    declaration_version = models.CharField(max_length=10, editable=False)
    declaration_text = models.TextField(editable=False)

    @property
    def status(self):
        if getattr(self, "revocation", None):
            return "revoked"
        if self.expires_at and self.expires_at <= timezone.now():
            return "expired"
        return "active"


class CompanyAppointmentRevocation(BaseModel):
    appointment = models.OneToOneField(CompanyAppointment, on_delete=models.PROTECT, related_name="revocation")
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
