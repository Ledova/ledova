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
from tokens.models import RegisterInstruction
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
)


class InstructionReviewForm(OpeningReviewForm):
    reviewed = forms.BooleanField(
        required=False,
        label=(
            "I verified the named director's authority for exactly the issues or transfers below, and that the "
            "director is not an issue's recipient or a party to a transfer."
        ),
    )


@admin.register(RegisterInstruction)
class RegisterInstructionAdmin(admin.ModelAdmin):
    list_display = ["uuid", "company", "token", "kind", "status", "created_at"]
    list_filter = ["kind", "status"]
    readonly_fields = [field.name for field in RegisterInstruction._meta.fields if field.name != "file"] + [
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
            admin_action_path(self, "<uuid:uuid>/review/", "tokens_registerinstruction_review", self.review),
            admin_file_path(
                self, "<uuid:uuid>/evidence/", "tokens_registerinstruction_evidence", self.resolve_evidence
            ),
        ] + super().get_urls()

    def resolve_evidence(self, request, uuid):
        proposal = get_object_or_404(self.get_queryset(request), pk=uuid)
        return proposal, proposal.file, proposal.evidence_snapshot["mime_type"]

    @admin.display(description="Retained authority evidence")
    def evidence_link(self, obj):
        return format_html(
            '<a href="{}">Open retained document</a>',
            reverse("admin:tokens_registerinstruction_evidence", args=[obj.pk]),
        )

    @admin.display(description="Review")
    def review_link(self, obj):
        if obj.status != "submitted":
            return "Decision recorded"
        return format_html(
            '<a href="{}">Review instruction</a>', reverse("admin:tokens_registerinstruction_review", args=[obj.pk])
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def review(self, request, proposal):
        form = InstructionReviewForm(request.POST if request.method == "POST" else None)
        rows = []
        refusal = ""
        try:
            if request.method == "GET":
                proposal, rows, form.initial["confirmation"] = prepare_instruction_review(
                    proposal_id=proposal.pk, reviewer=request.user
                )
            elif form.is_valid():
                proposal = decide_instruction(
                    proposal_id=proposal.pk,
                    reviewer=request.user,
                    confirmation=form.cleaned_data["confirmation"],
                    decision=form.cleaned_data["decision"],
                    rejection_reason=form.cleaned_data["rejection_reason"],
                )
                self.log_change(request, proposal, f"Register instruction {proposal.status}.")
                self.message_user(request, f"Register instruction {proposal.status}.", messages.SUCCESS)
                return redirect("admin:tokens_registerinstruction_change", proposal.pk)
        except RegisterChangeConflict:
            refusal = "This instruction conflicts with an existing decision."
        except ValidationError as error:
            refusal = " ".join(str(item) for item in error.detail)
        return render(
            request,
            "admin/tokens/register_instruction_review.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": proposal,
                "title": "Review register instruction",
                "form": form,
                "rows": rows,
                "refusal": refusal,
                "evidence_link": self.evidence_link(proposal),
            },
        )
