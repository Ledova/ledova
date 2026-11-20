from django.db import models

from shared.models import BaseModel


class DeletionScope(models.TextChoices):
    COMPANY = "company", "Company"
    SHARE_CLASS = "share_class", "Share class"
    PROPOSAL = "proposal", "Pending proposal"
    INVITATION = "invitation", "Pending invitation"
    DOCUMENT = "document", "Shareholder document"
    PERSON = "person", "Person"


class CompanyDisposal(BaseModel):
    company_id = models.UUIDField()
    scope = models.CharField(max_length=20, choices=DeletionScope.choices, default=DeletionScope.COMPANY)
    actor_id = models.BigIntegerField()
    appointment_id = models.UUIDField(null=True)
    manifest = models.JSONField()
    transaction_id = models.BigIntegerField(null=True)
    database_disposed_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(scope__in=DeletionScope.values),
                name="company_disposal_scope_known",
            ),
        ]
