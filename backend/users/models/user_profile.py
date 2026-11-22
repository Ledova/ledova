from django.conf import settings
from django.db import models

from shared.models import BaseModel


class UserProfile(BaseModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    full_name = models.CharField(max_length=100, blank=True, null=True)
    residential_address = models.TextField(blank=True, null=True)

    terms_and_conditions = models.BooleanField(default=False)
    is_signup_completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"UserProfile {self.user.email}"
