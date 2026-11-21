from django.conf import settings
from django.db import models

from shared.models import BaseModel, Country


class UserProfile(BaseModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    full_name = models.CharField(max_length=100, blank=True, null=True)
    phone_country_code = models.CharField(max_length=5, blank=True, null=True)
    phone_number = models.CharField(max_length=15, blank=True, null=True)
    date_of_birth = models.DateField(null=True, blank=True)
    residential_address = models.TextField(blank=True, null=True)

    citizenship_country = models.ForeignKey(
        Country, null=True, blank=True, on_delete=models.SET_NULL, related_name="citizens"
    )
    residence_country = models.ForeignKey(
        Country, null=True, blank=True, on_delete=models.SET_NULL, related_name="residents"
    )

    terms_and_conditions = models.BooleanField(default=False)
    is_signup_completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"UserProfile {self.user.email}"
