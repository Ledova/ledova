from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from companies.querysets.appointment import CompanyAppointmentQuerySet
from shared.models import BaseModel


class CompanyAppointment(BaseModel):
    objects = CompanyAppointmentQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="appointments")
    appointee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="company_appointments", editable=False
    )
    appointee_profile = models.ForeignKey(
        "users.UserProfile", on_delete=models.PROTECT, related_name="+", editable=False
    )
    request = models.OneToOneField(
        "companies.CompanyAuthorityRequest", on_delete=models.PROTECT, related_name="appointment"
    )
    registry_check = models.ForeignKey("companies.CompanyRegistryCheck", on_delete=models.PROTECT, related_name="+")
    capabilities = models.JSONField(editable=False)
    delegatable_capabilities = models.JSONField(editable=False)
    expires_at = models.DateTimeField(null=True, editable=False)
    declaration_version = models.CharField(max_length=10, editable=False)
    declaration_text = models.TextField(editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["company"],
                condition=Q(request__isnull=False),
                name="companies_one_initial_appointment_per_company",
            )
        ]

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
