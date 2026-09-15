import logging
from decimal import Decimal

from django import forms
from django.contrib import admin, messages
from django.db.models import Exists, OuterRef
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.template.response import TemplateResponse
from django.urls import reverse

from assets.models import Asset, AssetChainDeployment, AssetType
from assets.services import sync as asset_sync
from operators.models import Operator
from operators.settlement import deployment_for, live_deployments
from shared.utils.admin_actions import admin_action_path
from shared.utils.admin_display import action_buttons, format_units
from tokens.constants import MINT_CHAIN

logger = logging.getLogger(__name__)


def mintable_deployment(asset):
    if not asset.is_active or asset.asset_type != AssetType.STABLECOIN.value:
        return None
    deployment = deployment_for(asset)
    return deployment if deployment and deployment.chain == MINT_CHAIN else None


class AssetChainDeploymentInline(admin.TabularInline):
    model = AssetChainDeployment
    extra = 0
    fields = ("chain", "contract_address", "decimals", "is_active")
    readonly_fields = ("uuid", "created_at")


class PriceUpdateForm(forms.Form):
    price = forms.DecimalField(
        max_digits=40, decimal_places=18, required=False, help_text="New price for selected assets"
    )
    currency = forms.CharField(
        max_length=16, initial="USD", required=False, help_text="Price currency (e.g., USD, EUR)"
    )
    create_snapshot = forms.BooleanField(initial=True, required=False, help_text="Create historical price snapshot")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = (
        "symbol",
        "name",
        "asset_type",
        "display_chains",
        "current_price",
        "price_currency",
        "is_active",
        "is_verified",
        "mint_action",
    )
    search_fields = ("symbol", "name", "chain_deployments__contract_address")
    list_filter = (
        "asset_type",
        "is_active",
        "is_verified",
    )
    list_per_page = 100
    readonly_fields = ("uuid", "current_price", "price_currency", "price_source", "created_at", "updated_at")
    inlines = [AssetChainDeploymentInline]
    actions = ["update_prices", "mark_as_active", "mark_as_inactive", "mark_as_verified"]

    def get_urls(self):
        mint = admin_action_path(self, "<uuid:uuid>/mint/", "assets_asset_mint", self.mint_view)
        return [mint] + super().get_urls()

    def get_queryset(self, request):
        mint_deployments = live_deployments(Operator.get().receiving_wallet_chain).filter(
            asset=OuterRef("pk"), chain=MINT_CHAIN
        )
        return super().get_queryset(request).annotate(has_mint_deployment=Exists(mint_deployments))

    @admin.display(description="Actions")
    def mint_action(self, obj):
        mintable = obj.has_mint_deployment and obj.is_active
        if not mintable or obj.asset_type != AssetType.STABLECOIN.value:
            return "-"
        return action_buttons([("+ Mint", reverse("admin:assets_asset_mint", args=[obj.uuid]), "#28a745")])

    def mint_view(self, request, asset):
        from tokens.admin._helpers import MintForm, mint_result_message
        from tokens.services import mint_service

        change_url = reverse("admin:assets_asset_change", args=[asset.pk])

        deployment = mintable_deployment(asset)
        if deployment is None:
            reason = (
                f"minting is available only on {MINT_CHAIN.title()}"
                if Operator.get().receiving_wallet_chain != MINT_CHAIN
                else f"{asset.symbol} has no active settlement deployment"
            )
            messages.error(request, f"Cannot mint: {reason}")
            return HttpResponseRedirect(change_url)

        try:
            info = mint_service.mint_info("AUDY", deployment.contract_address)
            current_supply = format_units(info["supply"], deployment.decimals)
            is_minter = info["is_minter"]
        except Exception as exc:
            logger.error(f"Failed to get {asset.symbol} contract info: {exc}")
            current_supply, is_minter = "Error", False

        form = MintForm(request.POST or None, decimals=deployment.decimals, symbol=asset.symbol)
        if request.method == "POST" and form.is_valid():
            mint_request = None
            try:
                values = dict(form.cleaned_data)
                submission_id = values.pop("submission_id")
                mint_request = mint_service.create_request(
                    submission_id, request.user, settlement_asset=asset, **values
                )
                tx_hash, _ = mint_service.execute(mint_request, request.user, permission="assets.change_asset")
                mint_result_message(request, mint_request, tx_hash)
            except Exception as exc:
                messages.error(request, f"Minting failed: {exc}")
            destination = (
                reverse("admin:tokens_mintrequest_change", args=[mint_request.pk]) if mint_request else change_url
            )
            return HttpResponseRedirect(destination)

        context = {
            **self.admin_site.each_context(request),
            "title": f"Mint {asset.symbol}",
            "subtitle": None,
            "token": asset,
            "contract_address": deployment.contract_address,
            "form": form,
            "opts": self.opts,
            "current_supply": current_supply,
            "is_minter": is_minter,
        }
        return render(request, "admin/tokens/mint_form.html", context)

    @admin.display(description="Chains")
    def display_chains(self, obj):
        chains = obj.chain_deployments.values_list("chain", flat=True)
        return ", ".join(chains) if chains else "—"

    @admin.action(description="Update prices for selected assets")
    def update_prices(self, request, queryset):
        if "apply" in request.POST:
            form = PriceUpdateForm(request.POST)
            if form.is_valid():
                price = form.cleaned_data.get("price")
                currency = form.cleaned_data.get("currency") or "USD"
                create_snapshot = form.cleaned_data.get("create_snapshot", True)

                if not price:
                    self.message_user(request, "Price is required", level=messages.ERROR)
                    return None

                success_count = 0
                error_count = 0

                for asset in queryset:
                    try:
                        asset_sync.update_price(
                            asset=asset,
                            price=Decimal(str(price)),
                            source="manual",
                            currency=currency,
                            create_snapshot=create_snapshot,
                        )
                        success_count += 1
                    except Exception:
                        error_count += 1

                if error_count > 0:
                    self.message_user(
                        request,
                        f"Updated {success_count} prices, {error_count} failed",
                        level=messages.WARNING,
                    )
                else:
                    self.message_user(request, f"Successfully updated prices for {success_count} assets")
                return None

        form = PriceUpdateForm()
        return TemplateResponse(
            request,
            "admin/assets/asset/update_prices.html",
            context={
                "form": form,
                "assets": queryset,
                "opts": self.model._meta,
                "action_checkbox_name": admin.helpers.ACTION_CHECKBOX_NAME,
            },
        )

    @admin.action(description="Mark selected assets as active")
    def mark_as_active(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f"{updated} assets marked as active.")

    @admin.action(description="Mark selected assets as inactive")
    def mark_as_inactive(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(request, f"{updated} assets marked as inactive.")

    @admin.action(description="Mark selected assets as verified (allowlist a quarantined token)")
    def mark_as_verified(self, request, queryset):
        updated = queryset.update(is_verified=True)
        self.message_user(request, f"{updated} assets marked as verified.")
