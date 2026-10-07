from django import forms
from django.contrib import admin
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods

from shared.utils.admin_files import admin_file_path
from tokens.models import RegisterOpening, RegisterWalletLink


class OpeningReviewForm(forms.Form):
    confirmation = forms.CharField(widget=forms.HiddenInput, required=False)
    decision = forms.ChoiceField(choices=[("apply", "Approve and apply"), ("reject", "Reject")])
    reviewed = forms.BooleanField(
        required=False,
        label="I verified the named authority, the captured boundary and the exact member mapping it approves.",
    )
    rejection_reason = forms.CharField(max_length=1000, required=False, widget=forms.Textarea)

    def clean(self):
        values = super().clean()
        if values.get("decision") == "apply" and (not values.get("reviewed") or not values.get("confirmation")):
            raise forms.ValidationError("Application requires a fresh review and explicit authority confirmation.")
        if values.get("decision") == "reject" and not values.get("rejection_reason"):
            raise forms.ValidationError("Give a reason for rejection.")
        return values


@admin.register(RegisterOpening)
class RegisterOpeningAdmin(admin.ModelAdmin):
    list_display = ["uuid", "company", "token", "authority", "status", "created_at"]
    list_filter = ["authority", "status"]
    readonly_fields = [field.name for field in RegisterOpening._meta.fields if field.name != "file"] + [
        "evidence_link",
    ]
    exclude = ["file"]
    actions = None

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @method_decorator(require_http_methods(["GET"]))
    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        return super().changeform_view(
            request,
            object_id,
            form_url,
            {
                **(extra_context or {}),
                "show_save": False,
                "show_save_and_continue": False,
                "show_save_and_add_another": False,
            },
        )

    def get_urls(self):
        return [
            admin_file_path(self, "<uuid:uuid>/evidence/", "tokens_registeropening_evidence", self.resolve_evidence),
        ] + super().get_urls()

    def resolve_evidence(self, request, uuid):
        proposal = get_object_or_404(self.get_queryset(request), pk=uuid)
        return proposal, proposal.file, proposal.evidence_snapshot["mime_type"]

    @admin.display(description="Retained authority evidence")
    def evidence_link(self, obj):
        return format_html(
            '<a href="{}">Open retained document</a>',
            reverse("admin:tokens_registeropening_evidence", args=[obj.pk]),
        )


@admin.register(RegisterWalletLink)
class RegisterWalletLinkAdmin(admin.ModelAdmin):
    list_display = ["uuid", "company", "authority", "status", "created_at"]
    list_filter = ["authority", "status"]
    readonly_fields = [field.name for field in RegisterWalletLink._meta.fields if field.name != "file"] + [
        "evidence_link",
    ]
    exclude = ["file"]
    actions = None

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @method_decorator(require_http_methods(["GET"]))
    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        return super().changeform_view(
            request,
            object_id,
            form_url,
            {
                **(extra_context or {}),
                "show_save": False,
                "show_save_and_continue": False,
                "show_save_and_add_another": False,
            },
        )

    def get_urls(self):
        return [
            admin_file_path(self, "<uuid:uuid>/evidence/", "tokens_registerwalletlink_evidence", self.resolve_evidence),
        ] + super().get_urls()

    def resolve_evidence(self, request, uuid):
        link = get_object_or_404(self.get_queryset(request), pk=uuid)
        return link, link.file, link.evidence_snapshot["mime_type"]

    @admin.display(description="Retained authority evidence")
    def evidence_link(self, obj):
        return format_html(
            '<a href="{}">Open retained document</a>',
            reverse("admin:tokens_registerwalletlink_evidence", args=[obj.pk]),
        )
