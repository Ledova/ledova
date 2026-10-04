from django.conf import settings
from django.db import models

from shared.models import BaseModel


class CompanyLegacyOwnerSource(BaseModel):
    company = models.OneToOneField(
        "companies.Company", on_delete=models.PROTECT, related_name="legacy_owner_source", editable=False
    )
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", editable=False)
    owner_profile = models.ForeignKey("users.UserProfile", on_delete=models.PROTECT, related_name="+", editable=False)
    provenance = models.CharField(max_length=64, editable=False)
