from django.conf import settings
from django.db import models

from shared.models import BaseModel
from whitelist.querysets.change import WhitelistChangeQuerySet


class WhitelistAction(models.TextChoices):
    ADD = "add", "Add"
    REMOVE = "remove", "Remove"


class WhitelistAuthority(models.TextChoices):
    OPERATOR_API = "operator_api", "Operator API"
    WHITELIST_ADMIN = "whitelist_admin", "Whitelist administration"
    SUBSCRIPTION_ADMIN = "subscription_admin", "Subscription administration"
    CLASSIFICATION_REFRESH = "refresh", "Eligibility invalidation"
    COMPANY = "company", "Company instruction"


class WhitelistInvalidationCause(models.TextChoices):
    SOURCE_WITHDRAWAL = "source_withdrawal", "Source withdrawn by its holder"
    REQUEST_WITHDRAWAL = "request_withdrawal", "Company request withdrawn by its holder"
    COMPANY_REVOCATION = "company_revocation", "Company decision revoked"
    EXPIRY = "expiry", "Eligibility expired automatically"
    EVIDENCE_PURGE = "evidence_purge", "Evidence purged automatically"
    STANDING_LOSS = "standing_loss", "Account standing lost"
    IDENTITY_LOSS = "identity_loss", "Configured identity lost"
    WALLET_REMOVAL = "wallet_removal", "Wallet removed or verification lost"


class WhitelistEligibilityInvalidation(BaseModel):
    user_account = models.ForeignKey("users.UserAccount", on_delete=models.PROTECT, related_name="+")
    cause = models.CharField(max_length=32, choices=WhitelistInvalidationCause.choices, editable=False)
    chain_id = models.PositiveBigIntegerField(editable=False)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    wallet_id = models.UUIDField(null=True, editable=False)
    address = models.CharField(max_length=42, blank=True, editable=False)
    facts = models.JSONField(editable=False)
    cause_fields = models.JSONField(default=list, editable=False)
    invalidated_at = models.DateTimeField(editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cause__in=["standing_loss", "identity_loss", "wallet_removal"]),
                name="whitelist_invalidation_retained_cause",
            ),
            models.CheckConstraint(condition=models.Q(chain_id__gt=0), name="whitelist_invalidation_chain"),
            models.CheckConstraint(
                condition=models.Q(cause="wallet_removal", wallet_id__isnull=False, address__regex=r"^0x[0-9a-f]{40}$")
                | ~models.Q(cause="wallet_removal") & models.Q(wallet_id__isnull=True, address=""),
                name="whitelist_invalidation_wallet_scope",
            ),
        ]


class WhitelistChangeStatus(models.TextChoices):
    PENDING = "pending", "Checking the admitted change"
    EXECUTING = "executing", "Outcome unresolved"
    CONFIRMED = "confirmed", "Confirmed"
    UNCHANGED = "unchanged", "No change required"
    FAILED = "failed", "Failed"


class WhitelistChange(BaseModel):
    source_instruction = models.ForeignKey(
        "whitelist.CompanyWalletInstruction", on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    action = models.CharField(max_length=6, choices=WhitelistAction.choices, editable=False)
    address = models.CharField(max_length=42, editable=False)
    chain_id = models.PositiveBigIntegerField(editable=False)
    registry_address = models.CharField(max_length=42, editable=False)
    company_id = models.UUIDField(editable=False)
    expires_at = models.DateTimeField(null=True, editable=False)
    intent = models.JSONField(editable=False)
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", null=True)
    authority = models.CharField(max_length=20, choices=WhitelistAuthority.choices, editable=False)
    eligibility_decision = models.ForeignKey(
        "users.CompanyEligibilityDecision", on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    eligibility_invalidation = models.ForeignKey(
        WhitelistEligibilityInvalidation, on_delete=models.PROTECT, related_name="+", null=True, editable=False
    )
    invalidation_cause = models.CharField(
        max_length=32, choices=WhitelistInvalidationCause.choices, blank=True, editable=False
    )
    invalidated_at = models.DateTimeField(null=True, editable=False)
    requested_wallet_id = models.UUIDField(null=True, editable=False)
    entry_id = models.UUIDField(null=True, editable=False)
    operation = models.OneToOneField(
        "blockchain.OutgoingOperation", on_delete=models.PROTECT, null=True, related_name="whitelist_change"
    )
    transaction = models.OneToOneField(
        "blockchain.BlockchainTransaction", on_delete=models.PROTECT, null=True, related_name="whitelist_change"
    )
    status = models.CharField(
        max_length=10, choices=WhitelistChangeStatus.choices, default=WhitelistChangeStatus.PENDING
    )
    failure_code = models.CharField(max_length=64, blank=True, editable=False)
    completed_at = models.DateTimeField(null=True, editable=False)

    objects = WhitelistChangeQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["chain_id", "registry_address", "address"],
                condition=models.Q(status__in=[WhitelistChangeStatus.PENDING, WhitelistChangeStatus.EXECUTING]),
                name="one_unresolved_whitelist_change",
            ),
            models.CheckConstraint(condition=models.Q(chain_id__gt=0), name="whitelist_change_chain"),
            models.CheckConstraint(
                condition=models.Q(address__regex=r"^0x[0-9a-f]{40}$")
                & models.Q(registry_address__regex=r"^0x[0-9a-f]{40}$"),
                name="whitelist_change_addresses",
            ),
            models.CheckConstraint(
                condition=models.Q(action__in=WhitelistAction.values), name="whitelist_change_action"
            ),
            models.CheckConstraint(
                condition=models.Q(action=WhitelistAction.ADD) | models.Q(expires_at__isnull=True),
                name="whitelist_change_removal_has_no_expiry",
            ),
            models.CheckConstraint(
                condition=models.Q(authority__in=WhitelistAuthority.values), name="whitelist_change_authority"
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=WhitelistChangeStatus.values), name="whitelist_change_status"
            ),
        ]

    def __str__(self):
        return f"{self.action}:{self.uuid} ({self.status})"
