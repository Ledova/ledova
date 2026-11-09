from django.conf import settings
from django.db import models

from shared.models import BaseModel


class TermsAcceptance(BaseModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    version = models.CharField(max_length=10, editable=False)
    statement = models.TextField(editable=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "version"], name="authentication_user_terms_version")]
