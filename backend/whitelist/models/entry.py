from django.db import models
from django.utils import timezone

from shared.models import BaseModel
from whitelist.models.choices import WhitelistStatus
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

    status = models.CharField(
        max_length=20,
        choices=WhitelistStatus.choices,
        default=WhitelistStatus.PENDING,
    )
    is_whitelisted = models.BooleanField(default=False)

    on_chain_timestamp = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    failure_reconciled_at = models.DateTimeField(null=True, blank=True, editable=False)
    add_tx_hash = models.CharField(max_length=66, null=True, blank=True)
    remove_tx_hash = models.CharField(max_length=66, null=True, blank=True)

    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = "Whitelist Entry"
        verbose_name_plural = "Whitelist Entries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["is_whitelisted"]),
        ]
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

    def record_the_chain_still_lists_it(self) -> bool:
        moment = timezone.now()
        changed = (
            type(self)
            .objects.filter(
                pk=self.pk,
                status=WhitelistStatus.FAILED,
                failure_reconciled_at__isnull=True,
                updated_at=self.updated_at,
            )
            .update(is_whitelisted=True, failure_reconciled_at=moment, updated_at=moment)
        )
        if changed:
            self.is_whitelisted = True
            self.failure_reconciled_at = moment
            self.updated_at = moment
        return bool(changed)
