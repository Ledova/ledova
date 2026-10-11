import uuid

from django.conf import settings
from django.db import models

from shared.models import BaseModel
from shared.storage import private_storage


def member_certificate_path(instance, filename):
    return f"companies/{instance.request.company_id}/member-certificates/{instance.pk}/{uuid.uuid4()}.bin"


class MemberCertificateFulfilment(BaseModel):
    request = models.OneToOneField(
        "tokens.MemberCertificateRequest", on_delete=models.PROTECT, related_name="fulfilment"
    )
    export = models.OneToOneField("tokens.RegisterExport", on_delete=models.PROTECT, related_name="member_fulfilment")
    produced_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    instruction = models.CharField(max_length=255)
    source_snapshot = models.JSONField()
    source_digest = models.CharField(max_length=64)
    digest = models.CharField(max_length=64)
    file_size = models.PositiveBigIntegerField()
    file = models.FileField(upload_to=member_certificate_path, storage=private_storage, max_length=255)

    class Meta:
        ordering = ["-created_at", "-uuid"]
