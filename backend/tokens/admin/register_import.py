from django import forms
from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from shared.utils.admin_actions import admin_action_path
from shared.utils.admin_files import admin_file_path
from tokens.admin.register_opening import OpeningReviewForm
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterImport
from tokens.services.register_imports import decide_import, prepare_import_review


class ImportReviewForm(OpeningReviewForm):
    reviewed = forms.BooleanField(
        required=False,
        label="I verified the named authority, the current register document and the ASIC extract figures below.",
    )
    asic_issued_total = forms.IntegerField(min_value=0, required=False, label="ASIC extract: shares issued in class")
    asic_member_count = forms.IntegerField(min_value=0, required=False, label="ASIC extract: members holding the class")

    def clean(self):
        values = super().clean()
        if values.get("decision") == "apply" and (
            values.get("asic_issued_total") is None or values.get("asic_member_count") is None
        ):
            raise forms.ValidationError("Enter the ASIC extract's issued total and member count before applying.")
        return values


@admin.register(RegisterImport)
class RegisterImportAdmin(admin.ModelAdmin):
    list_display = ["uuid", "company", "token", "as_at", "status", "created_at"]
    list_filter = ["status"]
    readonly_fields = [field.name for field in RegisterImport._meta.fields if field.name != "file"] + [
        "evidence_link",
        "review_link",
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
            admin_action_path(self, "<uuid:uuid>/review/", "tokens_registerimport_review", self.review),
            admin_file_path(self, "<uuid:uuid>/evidence/", "tokens_registerimport_evidence", self.resolve_evidence),
        ] + super().get_urls()

    def resolve_evidence(self, request, uuid):
        proposal = get_object_or_404(self.get_queryset(request), pk=uuid)
        return proposal, proposal.file, proposal.evidence_snapshot["mime_type"]

    @admin.display(description="Retained register document")
    def evidence_link(self, obj):
        return format_html(
            '<a href="{}">Open retained document</a>', reverse("admin:tokens_registerimport_evidence", args=[obj.pk])
        )

    @admin.display(description="Review")
    def review_link(self, obj):
        if obj.status != "submitted":
            return "Decision recorded"
        return format_html(
            '<a href="{}">Review import</a>', reverse("admin:tokens_registerimport_review", args=[obj.pk])
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def review(self, request, proposal):
        form = ImportReviewForm(request.POST if request.method == "POST" else None)
        comparison = []
        refusal = ""
        try:
            if request.method == "GET":
                proposal, comparison, form.initial["confirmation"] = prepare_import_review(
                    proposal_id=proposal.pk, reviewer=request.user
                )
            elif form.is_valid():
                proposal = decide_import(
                    proposal_id=proposal.pk,
                    reviewer=request.user,
                    confirmation=form.cleaned_data["confirmation"],
                    decision=form.cleaned_data["decision"],
                    rejection_reason=form.cleaned_data["rejection_reason"],
                    asic_issued_total=form.cleaned_data["asic_issued_total"],
                    asic_member_count=form.cleaned_data["asic_member_count"],
                )
                self.log_change(request, proposal, f"Register import {proposal.status}.")
                self.message_user(request, f"Register import {proposal.status}.", messages.SUCCESS)
                return redirect("admin:tokens_registerimport_change", proposal.pk)
        except RegisterChangeConflict:
            refusal = "This import conflicts with an existing decision."
        except ValidationError as error:
            refusal = " ".join(str(item) for item in error.detail)
        return render(
            request,
            "admin/tokens/register_import_review.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": proposal,
                "title": "Review register import",
                "form": form,
                "comparison": comparison,
                "refusal": refusal,
                "evidence_link": self.evidence_link(proposal),
            },
        )
