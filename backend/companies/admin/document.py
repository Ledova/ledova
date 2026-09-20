from django import forms
from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from companies.models import CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from shared.utils.admin_actions import admin_action_path
from shared.utils.admin_files import admin_file_path


class DocumentReviewForm(forms.Form):
    confirmation = forms.CharField(widget=forms.HiddenInput)
    reviewed = forms.BooleanField(label="I reviewed this file and its company, type and validity details.")


@admin.register(CompanyDocument)
class CompanyDocumentAdmin(admin.ModelAdmin):

    list_display = [
        "name",
        "company",
        "document_type",
        "is_verified",
        "created_at",
    ]
    list_filter = ["document_type", "is_verified", "created_at"]
    search_fields = ["name", "company__name"]
    readonly_fields = [
        "uuid",
        "file_link",
        "created_at",
        "is_verified",
        "verified_at",
        "verified_by",
        "verified_fingerprint",
        "verification_link",
    ]

    fieldsets = [
        ("Document", {"fields": ["company", "document_type", "name"]}),
        ("File", {"fields": ["file_link", "external_url", "file_size", "mime_type"]}),
        ("Validity", {"fields": ["valid_from", "valid_until"], "classes": ["collapse"]}),
        (
            "Verification",
            {"fields": ["is_verified", "verified_at", "verified_by", "verified_fingerprint", "verification_link"]},
        ),
        ("Notes", {"fields": ["notes", "rejection_reason"], "classes": ["collapse"]}),
        ("Timestamps", {"fields": ["uuid", "created_at"], "classes": ["collapse"]}),
    ]

    @admin.display(description="File")
    def file_link(self, obj):
        if obj.pk is None or not obj.file:
            return "-"
        url = reverse("admin:companies_companydocument_file", args=[obj.uuid])
        return format_html('<a href="{}" target="_blank">Open document</a>', url)

    def get_urls(self):
        custom_urls = [
            admin_file_path(self, "<uuid:uuid>/file/", "companies_companydocument_file", self._resolve_file),
            admin_action_path(self, "<uuid:uuid>/verify/", "companies_companydocument_verify", self.review_document),
        ]
        return custom_urls + super().get_urls()

    def _resolve_file(self, request, uuid):
        document = get_object_or_404(CompanyDocument, uuid=uuid)
        return document, document.file, document.mime_type

    @admin.display(description="Review")
    def verification_link(self, obj):
        if obj.pk is None:
            return "Save the document before reviewing it."
        return format_html(
            '<a href="{}">Review and verify document</a>',
            reverse("admin:companies_companydocument_verify", args=[obj.pk]),
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def review_document(self, request, document):
        form = DocumentReviewForm(request.POST if request.method == "POST" else None)
        try:
            if request.method == "GET":
                document, form.initial["confirmation"] = prepare_document_review(
                    document_id=document.pk, reviewer=request.user
                )
            elif form.is_valid():
                verify_document(
                    document_id=document.pk,
                    reviewer=request.user,
                    confirmation=form.cleaned_data["confirmation"],
                )
                self.log_change(request, document, "Verified the reviewed document content and details.")
                self.message_user(request, "Document verification recorded.", messages.SUCCESS)
                return redirect("admin:companies_companydocument_change", document.pk)
        except ValidationError as error:
            self.message_user(request, " ".join(str(item) for item in error.detail), messages.ERROR)
            return redirect("admin:companies_companydocument_change", document.pk)
        return render(
            request,
            "admin/companies/document_review.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": "Review company document",
                "original": document,
                "file_link": self.file_link(document),
                "form": form,
            },
        )
