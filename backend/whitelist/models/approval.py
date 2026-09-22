from django.db import models
from django.utils import timezone

from shared.models import BaseModel
from whitelist.models.choices import WhitelistStatus
from whitelist.querysets.approval import WhitelistApprovalQuerySet

EXPIRED = "Expired"


class WhitelistApproval(BaseModel):

    objects = WhitelistApprovalQuerySet.as_manager()

    entry = models.ForeignKey("whitelist.WhitelistEntry", on_delete=models.CASCADE, related_name="approvals")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="+")
    registry_address = models.CharField(max_length=42)
    status = models.CharField(max_length=20, choices=WhitelistStatus.choices, default=WhitelistStatus.PENDING)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Blank means the approval never expires.")
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Whitelist Approval"
        verbose_name_plural = "Whitelist Approvals"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status"])]
        constraints = [
            models.UniqueConstraint(fields=["entry", "company"], name="one_whitelist_approval_per_company"),
            models.CheckConstraint(
                condition=models.Q(registry_address__regex=r"^0x[0-9a-f]{40}$"),
                name="whitelist_approval_registry",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=WhitelistStatus.values), name="whitelist_approval_status"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.entry_id} for {self.company_id} ({self.status})"

    def is_listed(self, moment=None) -> bool:
        return self.status == WhitelistStatus.ACTIVE and (
            self.expires_at is None or self.expires_at > (moment or timezone.now())
        )

    def status_display(self, moment=None) -> str:
        if self.status == WhitelistStatus.ACTIVE and not self.is_listed(moment):
            return EXPIRED
        return self.get_status_display()
