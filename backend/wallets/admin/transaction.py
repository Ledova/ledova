from django.contrib import admin

from shared.utils.share_classes import share_class_label
from wallets.models import Transaction


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "tx_hash_short",
        "chain",
        "from_address_short",
        "to_address_short",
        "asset_label",
        "amount",
        "market_value_display",
        "market_value_aud_display",
        "transaction_fee",
        "status",
        "block_timestamp",
    )
    search_fields = (
        "tx_hash",
        "from_address",
        "to_address",
        "wallet__address",
        "asset__symbol",
    )
    list_filter = (
        "chain",
        "block_timestamp",
        "asset",
        "status",
    )
    readonly_fields = ("uuid", "market_value_aud", "created_at", "updated_at")
    list_select_related = ("asset", "wallet")

    def get_queryset(self, request):
        return super().get_queryset(request).with_share_class()

    @admin.display(description="TX Hash")
    def tx_hash_short(self, obj):
        return f"{obj.tx_hash[:16]}..." if obj.tx_hash else "-"

    @admin.display(description="From")
    def from_address_short(self, obj):
        return f"{obj.from_address[:10]}..." if obj.from_address else "-"

    @admin.display(description="To")
    def to_address_short(self, obj):
        return f"{obj.to_address[:10]}..." if obj.to_address else "-"

    @admin.display(description="Asset", ordering="asset__symbol")
    def asset_label(self, obj):
        return share_class_label(obj) or str(obj.asset)

    @admin.display(description="USD Value")
    def market_value_display(self, obj):
        if obj.market_value is not None:
            return f"${obj.market_value:,.2f}"
        return "-"

    @admin.display(description="AUD Value")
    def market_value_aud_display(self, obj):
        if obj.market_value_aud is not None:
            return f"A${obj.market_value_aud:,.2f}"
        return "-"
