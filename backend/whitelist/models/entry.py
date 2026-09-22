from django.db import models

from shared.models import BaseModel
from whitelist.querysets.entry import WhitelistEntryQuerySet


class WhitelistEntry(BaseModel):

    objects = WhitelistEntryQuerySet.as_manager()

    wallet = models.OneToOneField(
        "wallets.Wallet",
        on_delete=models.CASCADE,
        related_name="whitelist_entry",
        null=True,
        blank=True,
    )
    address = models.CharField(max_length=42, blank=True, help_text="Set only when the entry has no wallet.")
    label = models.CharField(max_length=100, blank=True, help_text="Treasury or custodian name for a non-user address.")

    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "Whitelist Entry"
        verbose_name_plural = "Whitelist Entries"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(wallet__isnull=False) | ~models.Q(address=""),
                name="whitelist_entry_wallet_or_address",
            ),
            models.UniqueConstraint(
                fields=["address"],
                condition=models.Q(wallet__isnull=True),
                name="whitelist_entry_unique_treasury_address",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.wallet_address[:10]}..."

    @property
    def wallet_address(self) -> str:
        return self.wallet.address if self.wallet_id else self.address
