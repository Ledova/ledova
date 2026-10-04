from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from shared.models import BaseModel


class RegistryCheckStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PASSED = "passed", "Passed"
    FAILED = "failed", "Failed"


class RegistryCheckPurpose(models.TextChoices):
    AUTHORITY = "authority", "Representative authority"
    REVIEW = "review", "Start review"
    RETRY = "retry", "Retry"
    ACTIVATION = "activation", "Activation"


class CompanyRegistryCheck(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.CASCADE, related_name="registry_checks")
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    purpose = models.CharField(max_length=16, choices=RegistryCheckPurpose.choices)
    started_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True)
    requested_name = models.CharField(max_length=255)
    requested_acn = models.CharField(max_length=11)
    requested_abn = models.CharField(max_length=14, blank=True)
    identity = models.JSONField()
    lifecycle_revision = models.PositiveBigIntegerField()
    status = models.CharField(max_length=16, choices=RegistryCheckStatus.choices, default=RegistryCheckStatus.PENDING)
    reason = models.CharField(max_length=40, blank=True)
    registry_abn = models.CharField(max_length=14, blank=True)
    registry_acn = models.CharField(max_length=11, blank=True)
    entity_name = models.CharField(max_length=255, blank=True)
    entity_type = models.CharField(max_length=16, blank=True)
    entity_status = models.CharField(max_length=32, blank=True)
    effective_from = models.DateField(null=True)
    retrieved_at = models.CharField(max_length=40, blank=True)
    register_updated_at = models.DateField(null=True)

    initiating_appointment = models.ForeignKey(
        "companies.CompanyAppointment",
        on_delete=models.PROTECT,
        related_name="activation_checks",
        null=True,
        editable=False,
    )
    idempotency_key = models.UUIDField(null=True, editable=False)
    person_identity = models.JSONField(null=True, editable=False)
    issuer_identity_required = models.BooleanField(null=True, editable=False)
    declaration_version = models.CharField(max_length=10, null=True, editable=False)
    declaration_text = models.TextField(null=True, editable=False)
    applied_at = models.DateTimeField(null=True, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["initiated_by", "idempotency_key"],
                condition=Q(idempotency_key__isnull=False),
                name="companies_activation_request_key",
            ),
            models.UniqueConstraint(
                fields=["company"],
                condition=Q(applied_at__isnull=False),
                name="companies_one_initial_activation_effect",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        initiating_appointment__isnull=True,
                        idempotency_key__isnull=True,
                        person_identity__isnull=True,
                        issuer_identity_required__isnull=True,
                        declaration_version__isnull=True,
                        declaration_text__isnull=True,
                        applied_at__isnull=True,
                    )
                    | Q(
                        purpose="activation",
                        initiating_appointment__isnull=False,
                        idempotency_key__isnull=False,
                        person_identity__isnull=False,
                        issuer_identity_required__isnull=False,
                        declaration_version__isnull=False,
                        declaration_text__isnull=False,
                    )
                ),
                name="companies_activation_exact_provenance",
            ),
        ]
        ordering = ["-started_at", "-uuid"]
