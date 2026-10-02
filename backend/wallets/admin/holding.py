from django.contrib import admin

from shared.utils.share_classes import share_class_label
from wallets.models import Holding


@admin.register(Holding)
class HoldingAdmin(admin.ModelAdmin):
    list_display = (
        "uuid",
        "wallet_address_short",
        "asset_label",
        "quantity",
        "market_value_display",
        "last_synced_at",
    )
    list_filter = (
        "asset__asset_type",
        "asset__is_verified",
        "last_synced_at",
        "created_at",
    )
    search_fields = (
        "uuid",
        "wallet__address",
        "asset__symbol",
        "asset__name",
    )
    readonly_fields = (
        "uuid",
        "quantity",
        "market_value",
        "last_synced_at",
        "created_at",
        "updated_at",
    )
    ordering = ("-quantity",)
    list_select_related = ("wallet", "asset")

    def get_queryset(self, request):
        return super().get_queryset(request).with_share_class()

    @admin.display(description="Wallet", ordering="wallet__address")
    def wallet_address_short(self, obj):
        return f"{obj.wallet.address[:10]}..."

    @admin.display(description="Asset", ordering="asset__symbol")
    def asset_label(self, obj):
        return share_class_label(obj) or obj.asset.symbol

    @admin.display(description="Market Value (USD)")
    def market_value_display(self, obj):
        value = obj.market_value
        if value:
            return f"${value:,.2f}"
        return "-"

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
