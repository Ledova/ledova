import logging

from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse

from shared.utils.admin_actions import admin_action_path
from shared.utils.admin_display import action_buttons, format_units
from tokens.models import NAVUpdate, NAVUpdateStatus, YieldToken
from tokens.services import mint_service, nav

from ._helpers import MintForm, active_badge, hex_column, mint_result_message

logger = logging.getLogger(__name__)


class NAVUpdateForm(forms.Form):
    submission = forms.CharField(widget=forms.HiddenInput)
    nav_per_token = forms.DecimalField(
        max_digits=20,
        decimal_places=6,
        min_value=0.000001,
        label="NAV per Token (USD)",
        help_text="New NAV per token in USD (e.g., 1.005000 for $1.005)",
        widget=forms.NumberInput(attrs={"step": "0.000001", "style": "width: 200px;"}),
    )

    total_reserve_value = forms.DecimalField(
        max_digits=20,
        decimal_places=6,
        min_value=0,
        label="Synthetic Reference Value (USD)",
        help_text="Synthetic scenario value used by this experimental token model",
        widget=forms.NumberInput(attrs={"step": "0.01", "style": "width: 200px;"}),
    )

    custodian_report_ref = forms.CharField(
        max_length=200,
        required=False,
        label="Scenario Reference",
        help_text="Optional reference for the synthetic scenario (for example, a test case ID)",
    )

    update_on_chain = forms.BooleanField(
        initial=False,
        required=False,
        label="Execute on local/testnet chain",
        help_text="Also call updateNAV() on the configured local chain or supported public testnet",
    )

    notes = forms.CharField(
        widget=forms.Textarea(attrs={"rows": 3}),
        required=False,
        label="Notes (Optional)",
    )


@admin.register(YieldToken)
class YieldTokenAdmin(admin.ModelAdmin):
    search_fields = ["name", "symbol", "contract_address"]
    ordering = ["symbol"]
    contract_address_short = hex_column("contract_address", "Contract", tail=8)
    is_active_badge = active_badge
    list_display = [
        "name",
        "symbol",
        "contract_address_short",
        "nav_display",
        "total_reserve_display",
        "last_nav_update",
        "is_active_badge",
        "actions_column",
    ]
    list_filter = ["is_active"]
    readonly_fields = [
        "uuid",
        "nav_per_token",
        "total_reserve_value",
        "last_nav_update",
        "created_at",
        "updated_at",
    ]

    fieldsets = [
        (None, {"fields": ["uuid", "name", "symbol", "contract_address", "decimals", "is_active"]}),
        ("NAV Information", {"fields": ["nav_per_token", "total_reserve_value", "last_nav_update"]}),
        ("Timestamps", {"fields": ["created_at", "updated_at"], "classes": ["collapse"]}),
    ]

    def save_model(self, request, obj, form, change):
        if change:
            obj.save(update_fields=[*form.changed_data, "updated_at"])
        else:
            super().save_model(request, obj, form, change)

    def get_urls(self):
        custom = [
            admin_action_path(self, "<uuid:uuid>/update-nav/", "tokens_yieldtoken_update_nav", self.update_nav_view),
            admin_action_path(self, "<uuid:uuid>/mint/", "tokens_yieldtoken_mint", self.mint_view),
        ]
        return custom + super().get_urls()

    def mint_url(self, obj):
        return reverse("admin:tokens_yieldtoken_mint", args=[obj.uuid])

    def mint_view(self, request, yield_token):
        change_url = reverse("admin:tokens_yieldtoken_change", args=[yield_token.pk])

        if not yield_token.is_active:
            messages.error(request, f"Cannot mint: {yield_token.symbol} is not active")
            return HttpResponseRedirect(change_url)
        if not yield_token.contract_address:
            messages.error(request, f"Cannot mint: {yield_token.symbol} has no contract address")
            return HttpResponseRedirect(change_url)

        try:
            info = mint_service.mint_info("AUSG", yield_token.contract_address)
            current_supply = format_units(info["supply"], yield_token.decimals)
            is_minter = info["is_minter"]
        except Exception as exc:
            logger.error(f"Failed to get {yield_token.symbol} contract info: {exc}")
            current_supply, is_minter = "Error", False

        form = MintForm(request.POST or None, decimals=yield_token.decimals, symbol=yield_token.symbol)
        if request.method == "POST" and form.is_valid():
            mint_request = None
            try:
                values = dict(form.cleaned_data)
                submission_id = values.pop("submission_id")
                mint_request = mint_service.create_request(
                    submission_id, request.user, yield_token=yield_token, **values
                )
                tx_hash, _ = mint_service.execute(mint_request, request.user, permission="tokens.change_yieldtoken")
                mint_result_message(request, mint_request, tx_hash)
            except Exception as exc:
                messages.error(request, f"Minting failed: {exc}")
            destination = (
                reverse("admin:tokens_mintrequest_change", args=[mint_request.pk]) if mint_request else change_url
            )
            return HttpResponseRedirect(destination)

        context = {
            **self.admin_site.each_context(request),
            "title": f"Mint {yield_token.symbol}",
            "subtitle": None,
            "token": yield_token,
            "contract_address": yield_token.contract_address,
            "form": form,
            "opts": self.opts,
            "current_supply": current_supply,
            "is_minter": is_minter,
        }
        return render(request, "admin/tokens/mint_form.html", context)

    @admin.display(description="NAV/Token")
    def nav_display(self, obj):
        return f"${obj.nav_per_token:,.6f}" if obj.nav_per_token else "-"

    @admin.display(description="Synthetic Reference Value")
    def total_reserve_display(self, obj):
        return f"${obj.total_reserve_value:,.2f}" if obj.total_reserve_value else "-"

    @admin.display(description="Actions")
    def actions_column(self, obj):
        if not obj.is_active or not obj.contract_address:
            return "-"
        nav_url = reverse("admin:tokens_yieldtoken_update_nav", args=[obj.uuid])
        return action_buttons([("Update NAV", nav_url, "#007bff"), ("+ Mint", self.mint_url(obj), "#28a745")])

    def update_nav_view(self, request, yield_token):
        nav_info = None
        if request.method == "POST":
            form = NAVUpdateForm(request.POST)
            if form.is_valid():
                try:
                    values = form.cleaned_data
                    submission_id = nav.submission_from_confirmation(values["submission"], yield_token, request.user)
                    update = nav.submit(
                        yield_token,
                        request.user,
                        submission_id,
                        values["nav_per_token"],
                        values["total_reserve_value"],
                        update_on_chain=values["update_on_chain"],
                        custodian_report_ref=values["custodian_report_ref"],
                        notes=values["notes"],
                    )
                except Exception:
                    logger.exception("NAV admission failed for yield token %s", yield_token.pk)
                    form.add_error(
                        None, "The NAV submission could not be accepted. Retry this form with its original values."
                    )
                else:
                    if update.completed_at and update.status in (NAVUpdateStatus.APPLIED, NAVUpdateStatus.CONFIRMED):
                        messages.success(request, "This NAV submission completed. Its recorded outcome is shown below.")
                    elif update.status == NAVUpdateStatus.FAILED:
                        messages.error(request, "This NAV submission was refused or failed. It cannot run again.")
                    else:
                        messages.warning(
                            request, "NAV update pending. Its original submission will be recovered automatically."
                        )
                    return HttpResponseRedirect(reverse("admin:tokens_navupdate_change", args=[update.pk]))
        else:
            form = NAVUpdateForm(
                initial={
                    "submission": nav.confirmation(yield_token, request.user),
                    "nav_per_token": yield_token.nav_per_token,
                    "total_reserve_value": yield_token.total_reserve_value,
                }
            )
            if yield_token.contract_address:
                try:
                    nav_info = nav.chain_info(yield_token)
                except Exception:
                    logger.warning("On-chain NAV read unavailable for yield token %s", yield_token.pk)
        context = {
            **self.admin_site.each_context(request),
            "title": f"Update NAV — {yield_token.symbol}",
            "subtitle": None,
            "yield_token": yield_token,
            "form": form,
            "opts": self.opts,
            "nav_info": nav_info,
            "is_nav_updater": nav_info and nav_info["is_nav_updater"],
            "recent_updates": NAVUpdate.objects.filter(yield_token=yield_token).select_related("updated_by")[:5],
        }
        return render(request, "admin/tokens/yieldtoken/update_nav_form.html", context)


@admin.register(NAVUpdate)
class NAVUpdateAdmin(admin.ModelAdmin):
    list_display = [
        "yield_token",
        "mode",
        "status",
        "completed_at",
        "nav_change_display",
        "total_reserve_value",
        "custodian_report_ref",
        "updated_by",
        "created_at",
    ]
    list_filter = ["yield_token", "mode", "status"]
    list_select_related = ["yield_token", "updated_by", "operation"]
    readonly_fields = [
        "uuid",
        "yield_token",
        "mode",
        "status",
        "completed_at",
        "old_nav_per_token",
        "new_nav_per_token",
        "total_reserve_value",
        "custodian_report_ref",
        "transaction",
        "operation",
        "original_transaction_hash",
        "intent",
        "event",
        "updated_by",
        "notes",
        "created_at",
        "updated_at",
    ]
    ordering = ["-created_at"]

    @admin.display(description="NAV Change")
    def nav_change_display(self, obj):
        return f"${obj.old_nav_per_token} → ${obj.new_nav_per_token}"

    @admin.display(description="Original transaction hash")
    def original_transaction_hash(self, obj):
        if obj.operation_id and obj.operation.current_attempt_id:
            return obj.operation.current_attempt.tx_hash
        return obj.transaction.tx_hash if obj.transaction_id else "-"

    def has_view_permission(self, request, obj=None):
        return super().has_view_permission(request, obj) or request.user.has_perm("tokens.change_yieldtoken")

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
