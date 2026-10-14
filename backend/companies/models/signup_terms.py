from django.conf import settings
from django.db import models

from shared.models import BaseModel


class CompanySignupTermsAcceptance(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    accepted_profile = models.ForeignKey("users.UserProfile", on_delete=models.PROTECT, related_name="+")
    declaration_version = models.CharField(max_length=10, editable=False)
    declaration_text = models.TextField(editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["appointment", "declaration_version"], name="company_signup_terms_appointment_version"
            ),
        ]
