from django.contrib import admin
from django.core.exceptions import ObjectDoesNotExist
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

from shared.utils.admin_display import admin_link
from shared.utils.token_amounts import format_units
from tokens.models import (
    OrderActionPurpose,
    OrderSubmission,
    SwapOrder,
    TransferOrder,
)

from ._helpers import hex_column

NOT_RELAYED = "Not relayed"
NONE_RECORDED = "None recorded"


class MarketRecordAdmin(admin.ModelAdmin):
    actions = None
    date_hierarchy = "created_at"
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


def _email(account):
    return account.user_profile.user.email


def _lines(items):
    return format_html_join(mark_safe("<br>"), "{}", ((item,) for item in items)) or NONE_RECORDED


@admin.display(description="Account", ordering="owner_account__user_profile__user__email")
def _owner(_admin, obj):
    return _email(obj.owner_account)


def _action(action):
    terms = (
        f" to {action.new_quantity} at {action.new_price_per_share}"
        if action.purpose == OrderActionPurpose.MODIFY
        else ""
    )
    refusal = f": {action.refusal_detail}" if action.refusal_detail else ""
    return f"{action.get_purpose_display()}{terms}, {action.get_status_display().lower()}{refusal}"


OWNER_SEARCH = [
    "wallet_address",
    "owner_account__account_number",
    "owner_account__user_profile__user__email",
    "owner_account__user_profile__full_name",
    "token__symbol",
    "token__name",
    "token__company__name",
]


@admin.register(TransferOrder)
class TransferOrderAdmin(MarketRecordAdmin):
    list_display = [
        "created_at",
        "token",
        "order_type",
        "account",
        "wallet_short",
        "quantity",
        "filled_quantity",
        "price_per_share",
        "payment",
        "status",
    ]
    list_filter = ["status", "order_type", ("token", admin.RelatedOnlyFieldListFilter)]
    search_fields = [*OWNER_SEARCH, "tx_hash"]
    list_select_related = ["token", "payment_asset", "owner_account__user_profile__user"]
    fieldsets = [
        ("Order", {"fields": ["uuid", "token", "order_type", "status", "payment_asset", "created_at"]}),
        ("Owner", {"fields": ["owner_account", "wallet", "wallet_address", "admission"]}),
        ("Terms", {"fields": ["quantity", "min_quantity", "filled_quantity", "price_per_share"]}),
        (
            "Changes",
            {"fields": ["original_quantity", "original_price", "modification_count", "last_modified_at", "changes"]},
        ),
        (
            "Matching and settlement",
            {
                "fields": [
                    "matched_order",
                    "settlements",
                    "completed_at",
                    "tx_hash",
                    "exchange_order_id",
                    "error_message",
                ]
            },
        ),
        ("Timestamps", {"fields": ["updated_at"], "classes": ["collapse"]}),
    ]

    account = _owner
    wallet_short = hex_column("wallet_address", "Wallet")

    @admin.display(description="Payment", ordering="payment_asset__symbol")
    def payment(self, obj):
        return obj.payment_asset.symbol if obj.payment_asset else "-"

    @admin.display(description="Signed admission")
    def admission(self, obj):
        try:
            submission = obj.submission
        except ObjectDoesNotExist:
            return NONE_RECORDED
        return admin_link(submission, f"{submission.get_status_display()}: {submission.submission_id}")

    @admin.display(description="Cancel and modify actions")
    def changes(self, obj):
        return _lines(_action(action) for action in obj.actions.order_by("created_at"))

    @admin.display(description="Settlements")
    def settlements(self, obj):
        swaps = sorted([*obj.swap_as_sell.all(), *obj.swap_as_buy.all()], key=lambda swap: swap.created_at)
        return _lines(
            admin_link(swap, f"{swap.share_amount} shares, {swap.get_status_display().lower()}") for swap in swaps
        )


@admin.register(SwapOrder)
class SwapOrderAdmin(MarketRecordAdmin):
    list_display = [
        "created_at",
        "share_token",
        "share_amount",
        "payment",
        "seller",
        "buyer",
        "status",
        "expires_at",
        "completed_at",
    ]
    list_filter = ["status", ("share_token", admin.RelatedOnlyFieldListFilter)]
    search_fields = [
        "order_hash",
        "settlement_digest",
        "tx_hash",
        "transaction__tx_hash",
        "seller_address",
        "buyer_address",
        "share_token__symbol",
        "share_token__name",
        "share_token__company__name",
    ]
    list_select_related = ["share_token", "payment_asset"]
    fieldsets = [
        (
            "Match",
            {
                "fields": [
                    "uuid",
                    "status",
                    "share_token",
                    "share_amount",
                    "payment",
                    "payment_asset",
                    "payment_amount",
                    "nonce",
                    "created_at",
                    "expires_at",
                    "expiry_release_eligible",
                ]
            },
        ),
        ("Seller", {"fields": ["sell_order", "seller_account", "seller_wallet", "seller_address", "seller_signed"]}),
        ("Buyer", {"fields": ["buy_order", "buyer_account", "buyer_wallet", "buyer_address", "buyer_signed"]}),
        ("Settlement", {"fields": ["relay", "completed_at", "error_message", "approvals"]}),
        (
            "Signed terms",
            {
                "fields": [
                    "settlement_protocol_version",
                    "settlement_digest",
                    "order_hash",
                    "settlement_context",
                    "finalized_receipt",
                ],
                "classes": ["collapse"],
            },
        ),
        ("Timestamps", {"fields": ["updated_at"], "classes": ["collapse"]}),
    ]

    seller = hex_column("seller_address", "Seller")
    buyer = hex_column("buyer_address", "Buyer")

    @admin.display(description="Payment")
    def payment(self, obj):
        asset = (obj.settlement_context or {}).get("payment_asset") or {}
        decimals = asset.get("deployment_decimals")
        if type(decimals) is not int:
            return f"{obj.payment_amount} base units"
        return f"{format_units(obj.payment_amount, decimals)} {asset.get('symbol', '')}".strip()

    @admin.display(description="Account")
    def seller_account(self, obj):
        return admin_link(obj.sell_order.owner_account, _email(obj.sell_order.owner_account))

    @admin.display(description="Account")
    def buyer_account(self, obj):
        return admin_link(obj.buy_order.owner_account, _email(obj.buy_order.owner_account))

    @admin.display(description="Signed", boolean=True)
    def seller_signed(self, obj):
        return obj.seller_has_signed

    @admin.display(description="Signed", boolean=True)
    def buyer_signed(self, obj):
        return obj.buyer_has_signed

    @admin.display(description="Relayed transaction")
    def relay(self, obj):
        relayed = obj.transaction
        if relayed is None:
            return format_html("<code>{}</code>", obj.tx_hash) if obj.tx_hash else NOT_RELAYED
        block = f" in block {relayed.block_number}" if relayed.block_number is not None else ""
        return format_html(
            "<code>{}</code><br>{}{}", relayed.tx_hash or "Not signed yet", relayed.get_status_display(), block
        )

    @admin.display(description="Participants' approvals")
    def approvals(self, obj):
        return _lines(
            format_html(
                "{}, {}: <code>{}</code>",
                submission.participant.capitalize(),
                submission.get_outcome_display().lower(),
                submission.tx_hash,
            )
            for submission in obj.approval_submissions.order_by("created_at")
        )


@admin.register(OrderSubmission)
class OrderSubmissionAdmin(MarketRecordAdmin):
    list_display = [
        "created_at",
        "token",
        "order_type",
        "account",
        "wallet_short",
        "quantity",
        "price_per_share",
        "status",
        "refusal_code",
    ]
    list_filter = ["status", "refusal_code", "order_type", ("token", admin.RelatedOnlyFieldListFilter)]
    search_fields = [*OWNER_SEARCH, "refusal_detail"]
    list_select_related = ["token", "owner_account__user_profile__user"]
    fieldsets = [
        ("Submission", {"fields": ["uuid", "submission_id", "status", "initiated_by", "created_at", "resolved_at"]}),
        (
            "Signed intent",
            {
                "fields": [
                    "owner_account",
                    "wallet",
                    "wallet_address",
                    "token",
                    "order_type",
                    "quantity",
                    "min_quantity",
                    "price_per_share",
                    "chain_id",
                    "verifying_contract",
                    "token_metadata",
                    "intent_version",
                ]
            },
        ),
        (
            "Outcome",
            {
                "fields": [
                    "order",
                    "initial_counter_order",
                    "initial_swap",
                    "refusal_code",
                    "refusal_detail",
                    "executed_challenge",
                ]
            },
        ),
        ("Timestamps", {"fields": ["updated_at"], "classes": ["collapse"]}),
    ]

    account = _owner
    wallet_short = hex_column("wallet_address", "Wallet")
