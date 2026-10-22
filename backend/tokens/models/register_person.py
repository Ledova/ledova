from django.conf import settings
from django.db import models

from shared.models import BaseModel


class RegisterPersonRegistration(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="person_registrations")
    member = models.OneToOneField("tokens.RegisterMember", on_delete=models.PROTECT, related_name="registration")
    name = models.CharField(max_length=255)
    residential_address = models.TextField()
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
