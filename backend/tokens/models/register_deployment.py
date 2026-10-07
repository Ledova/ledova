from django.conf import settings
from django.db import models

from shared.models import BaseModel
from tokens.models.register_correction import RegisterCorrectionStatus
from tokens.models.register_decision import RegisterDecision
from tokens.querysets import RegisterProposalQuerySet


class RegisterDeployment(BaseModel):
    objects = RegisterProposalQuerySet.as_manager()
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_deployments")
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_deployments")
    snapshot = models.JSONField()
    intent = models.JSONField()
    intent_digest = models.CharField(max_length=64)
    preparing_appointment = models.ForeignKey(
        "companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+"
    )
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=16, choices=RegisterCorrectionStatus.choices, default="submitted")
    approval_decision = models.ForeignKey(
        "tokens.RegisterDeploymentDecision", on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    deployment_id = models.UUIDField(unique=True, null=True, editable=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    reviewed_at = models.DateTimeField(null=True, editable=False)
    rejection_reason = models.CharField(max_length=1000, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]


class RegisterDeploymentDecision(RegisterDecision):
    register_deployment = models.ForeignKey(RegisterDeployment, on_delete=models.PROTECT, related_name="decisions")

    class Meta(RegisterDecision.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["decided_by", "idempotency_key"], name="one_register_deployment_decision_per_key"
            ),
            models.UniqueConstraint(
                fields=["register_deployment"],
                condition=models.Q(kind__in=["apply", "reject"]),
                name="one_register_deployment_outcome",
            ),
        ]
