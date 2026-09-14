from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from web3 import Web3

from shared.constants import BLOCKCHAIN_BASE
from shared.utils.admin_actions import admin_action_path
from users.services.eligibility import account_eligibility
from wallets.models import Wallet
from whitelist.admin_actions import confirm_changes
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistEntry,
)
from whitelist.services.identity import entry_identity


def entry_eligibility(wallet):
    if wallet is None:
        return None
    return account_eligibility(wallet.user_account)


def eligibility_warning(wallet):
    outcome = entry_eligibility(wallet)
    if outcome is None or outcome.is_eligible:
        return ""
    return (
        "This wallet's account is not an eligible wholesale investor "
        f"({', '.join(outcome.reasons)}). Whitelisting the address does not make it one."
    )


class WhitelistEntryAddForm(forms.ModelForm):

    eligibility_warning = ""

    wallet_address = forms.CharField(
        max_length=100,
        widget=forms.TextInput(attrs={"style": "width: 500px; font-family: monospace;"}),
    )

    class Meta:
        model = WhitelistEntry
        fields = ["wallet_address", "label", "notes"]

    def clean_wallet_address(self):
        address = self.cleaned_data.get("wallet_address", "").strip()

        if not address:
            raise forms.ValidationError("Wallet address is required.")
        if not Web3.is_address(address):
            raise forms.ValidationError("Enter a valid EVM address.")
        address = Web3.to_checksum_address(address)

        if WhitelistEntry.objects.filter_by_address(address).exists():
            raise forms.ValidationError(f"Address '{address}' already has a whitelist entry.")

        wallets = list(Wallet.objects.filter_by_address(address, chain=BLOCKCHAIN_BASE).order_by("uuid")[:2])
        if len(wallets) > 1:
            raise forms.ValidationError(
                "This address is registered to multiple accounts on Base. Resolve the ownership ambiguity first."
            )
        self._wallet = wallets[0] if wallets else None
        return address

    def clean(self):
        cleaned = super().clean()
        if "wallet_address" in cleaned and self._wallet is None and not cleaned.get("label"):
            self.add_error(
                "wallet_address",
                f"Wallet '{cleaned['wallet_address']}' not found. Give the entry a label to whitelist it as a "
                "treasury or custodian address.",
            )
        self.eligibility_warning = eligibility_warning(getattr(self, "_wallet", None))
        return cleaned

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.wallet = self._wallet
        instance.address = "" if self._wallet else self.cleaned_data["wallet_address"]
        if commit:
            instance.save()
        return instance


@admin.register(WhitelistEntry)
class WhitelistEntryAdmin(admin.ModelAdmin):
    list_display = [
        "short_address",
        "wallet_owner",
        "investor_eligibility",
        "label",
        "status",
        "is_whitelisted",
        "created_at",
    ]
    list_filter = [
        "status",
        "is_whitelisted",
    ]
    search_fields = [
        "wallet__address",
        "address",
        "label",
        "wallet__user_account__uuid",
    ]
    readonly_fields = [
        "uuid",
        "status",
        "is_whitelisted",
        "created_at",
        "updated_at",
        "add_tx_hash",
        "remove_tx_hash",
        "on_chain_timestamp",
        "last_synced_at",
        "status_actions",
    ]
    ordering = ["-created_at"]
    actions = ["add_to_blockchain", "remove_from_blockchain", "sync_with_blockchain"]

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            kwargs["form"] = WhitelistEntryAddForm
        return super().get_form(request, obj, **kwargs)

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return [
                ("Add Wallet to Whitelist", {"fields": ["wallet_address", "label"]}),
                ("Notes", {"fields": ["notes"], "classes": ["collapse"]}),
            ]
        return self._change_fieldsets

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj:
            readonly.extend(["wallet", "address"])
        return readonly

    _change_fieldsets = [
        ("Wallet Information", {"fields": ["uuid", "wallet", "address", "label"]}),
        ("Status & Actions", {"fields": ["status", "is_whitelisted", "status_actions"]}),
        (
            "Blockchain",
            {
                "fields": ["add_tx_hash", "remove_tx_hash", "on_chain_timestamp", "last_synced_at"],
                "classes": ["collapse"],
            },
        ),
        ("Notes", {"fields": ["notes"], "classes": ["collapse"]}),
        ("Timestamps", {"fields": ["created_at", "updated_at"], "classes": ["collapse"]}),
    ]

    def short_address(self, obj):
        address = obj.wallet_address
        return format_html(
            '<span title="{}">{}</span>',
            address,
            f"{address[:10]}...{address[-6:]}",
        )

    short_address.short_description = "Wallet Address"

    def get_queryset(self, request):
        return super().get_queryset(request).with_holder_identity()

    def wallet_owner(self, obj):
        identity = entry_identity(obj)
        if identity.name:
            return identity.name
        return mark_safe('<span style="color: #dc3545;">Unassigned</span>')

    wallet_owner.short_description = "Owner"
    wallet_owner.admin_order_field = "wallet__user_account__uuid"

    @admin.display(description="Investor Eligibility")
    def investor_eligibility(self, obj):
        outcome = entry_eligibility(obj.wallet if obj.wallet_id else None)
        if outcome is None:
            return "-"
        if outcome.is_eligible:
            return mark_safe('<span style="color: #28a745;">Eligible</span>')
        return format_html('<span style="color: #dc3545;">{}</span>', ", ".join(outcome.reasons))

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        warning = getattr(form, "eligibility_warning", "")
        if warning:
            messages.warning(request, warning)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            admin_action_path(
                self,
                "<uuid:uuid>/add-to-blockchain/",
                "whitelist_whitelistentry_add_to_blockchain",
                self.add_to_blockchain_view,
            ),
            admin_action_path(
                self,
                "<uuid:uuid>/remove-from-blockchain/",
                "whitelist_whitelistentry_remove_from_blockchain",
                self.remove_from_blockchain_view,
            ),
        ]
        return custom_urls + urls

    def status_actions(self, obj):
        if obj.pk is None:
            return "-"
        if obj.changes.unresolved().exists():
            return "A whitelist change is unresolved. Automatic recovery will continue."
        base_style = (
            "display: inline-block; padding: 6px 12px; margin: 2px; "
            "text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;"
        )

        action = "remove_from" if obj.is_whitelisted else "add_to"
        url = reverse(f"admin:whitelist_whitelistentry_{action}_blockchain", args=[obj.uuid])
        return format_html(
            '<a href="{}" style="{} background-color: {}; color: white;">{}</a>',
            url,
            base_style,
            "#dc3545" if obj.is_whitelisted else "#28a745",
            "Remove from Blockchain" if obj.is_whitelisted else "Add to Blockchain",
        )

    status_actions.short_description = "Quick Actions"

    def add_to_blockchain_view(self, request, entry):
        response = confirm_changes(
            self,
            request,
            self.get_queryset(request).filter(pk=entry.pk),
            [entry],
            WhitelistAction.ADD,
            WhitelistAuthority.WHITELIST_ADMIN,
        )
        return response or HttpResponseRedirect(reverse("admin:whitelist_whitelistentry_change", args=[entry.pk]))

    def remove_from_blockchain_view(self, request, entry):
        response = confirm_changes(
            self,
            request,
            self.get_queryset(request).filter(pk=entry.pk),
            [entry],
            WhitelistAction.REMOVE,
            WhitelistAuthority.WHITELIST_ADMIN,
        )
        return response or HttpResponseRedirect(reverse("admin:whitelist_whitelistentry_change", args=[entry.pk]))

    @admin.action(description="Add selected entries to blockchain whitelist", permissions=["change"])
    def add_to_blockchain(self, request, queryset):
        return confirm_changes(
            self, request, queryset, list(queryset), WhitelistAction.ADD, WhitelistAuthority.WHITELIST_ADMIN
        )

    @admin.action(description="Remove selected entries from blockchain whitelist", permissions=["change"])
    def remove_from_blockchain(self, request, queryset):
        return confirm_changes(
            self, request, queryset, list(queryset), WhitelistAction.REMOVE, WhitelistAuthority.WHITELIST_ADMIN
        )

    @admin.action(description="Sync selected entries with blockchain")
    def sync_with_blockchain(self, request, queryset):
        from whitelist.services import whitelist

        service = whitelist
        result = service.sync_entries(list(queryset))

        if result["synced"]:
            self.message_user(request, f"Synced {result['synced']} address(es) with blockchain.", messages.SUCCESS)
        for error in result["errors"]:
            self.message_user(request, error, messages.ERROR)
