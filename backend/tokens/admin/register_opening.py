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
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterOpening
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
)


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
            admin_action_path(self, "<uuid:uuid>/review/", "tokens_registeropening_review", self.review),
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

    @admin.display(description="Review")
    def review_link(self, obj):
        if obj.status != "submitted":
            return "Decision recorded"
        return format_html(
            '<a href="{}">Review opening</a>', reverse("admin:tokens_registeropening_review", args=[obj.pk])
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def review(self, request, proposal):
        form = OpeningReviewForm(request.POST if request.method == "POST" else None)
        refusal = ""
        try:
            if request.method == "GET":
                proposal, form.initial["confirmation"] = prepare_opening_review(
                    proposal_id=proposal.pk, reviewer=request.user
                )
            elif form.is_valid():
                proposal = decide_opening(
                    proposal_id=proposal.pk,
                    reviewer=request.user,
                    confirmation=form.cleaned_data["confirmation"],
                    decision=form.cleaned_data["decision"],
                    rejection_reason=form.cleaned_data["rejection_reason"],
                )
                self.log_change(request, proposal, f"Register opening {proposal.status}.")
                self.message_user(request, f"Register opening {proposal.status}.", messages.SUCCESS)
                return redirect("admin:tokens_registeropening_change", proposal.pk)
        except RegisterChangeConflict:
            refusal = "This opening conflicts with the current register or an existing decision."
        except ValidationError as error:
            refusal = " ".join(str(item) for item in error.detail)
        return render(
            request,
            "admin/tokens/register_opening_review.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": proposal,
                "title": "Review register opening",
                "form": form,
                "refusal": refusal,
                "evidence_link": self.evidence_link(proposal),
                "mapping_rows": self.mapping_rows(proposal),
            },
        )

    def mapping_rows(self, proposal):
        if proposal.boundary is None:
            return []
        shares = {row["address"].lower(): row["shares"] for row in proposal.boundary["holdings"]}
        return [
            {"address": link["address"], "shares": shares.get(link["address"].lower(), "0"), "member": link["member"]}
            for link in proposal.mapping
        ]
