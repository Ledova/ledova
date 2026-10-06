from django.contrib import admin
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.html import format_html

from documents.services.access import may_review_documents
from shared.utils.admin_files import admin_file_path
from tokens.admin._helpers import status_badge
from users.models import InvestorClassification, InvestorClassificationStatus

STATUS_COLORS = {
    InvestorClassificationStatus.SUBMITTED: "#17a2b8",
    InvestorClassificationStatus.VERIFIED: "#28a745",
    InvestorClassificationStatus.REJECTED: "#dc3545",
    InvestorClassificationStatus.REVOKED: "#343a40",
}


@admin.register(InvestorClassification)
class InvestorClassificationAdmin(admin.ModelAdmin):
    list_display = [
        "uuid",
        "account_email",
        "category",
        "status_badge",
        "liveness",
        "expires_at",
        "created_at",
    ]
    list_filter = ["status", "category", "created_at"]
    search_fields = [
        "user_account__account_number",
        "user_account__user_profile__user__email",
        "certifier_name",
        "certifier_membership_number",
    ]
    list_select_related = ["user_account", "company"]
    ordering = ["-created_at"]
    readonly_fields = [
        "uuid",
        "status",
        "declaration_text",
        "evidence_link",
        "evidence_file_size",
        "evidence_mime_type",
        "supporting_evidence",
        "submitted_at",
        "reviewed_by",
        "reviewed_at",
        "review_notes",
        "rejection_reason",
        "expires_at",
        "liveness",
        "created_at",
        "updated_at",
    ]

    fieldsets = [
        ("Claim", {"fields": ["uuid", "user_account", "company", "category", "declared_basis"]}),
        ("Historical source status", {"fields": ["status", "liveness", "expires_at"]}),
        (
            "Declaration",
            {"fields": ["declaration_accepted", "declaration_text"], "classes": ["collapse"]},
        ),
        (
            "Evidence",
            {"fields": ["evidence_link", "evidence_file_size", "evidence_mime_type"]},
        ),
        (
            "Accountant's Certificate",
            {
                "fields": [
                    "certificate_issued_at",
                    "certifier_name",
                    "certifier_body",
                    "certifier_membership_number",
                ],
                "classes": ["collapse"],
            },
        ),
        (
            "Review",
            {
                "fields": ["submitted_at", "reviewed_by", "reviewed_at", "review_notes", "rejection_reason"],
                "classes": ["collapse"],
            },
        ),
        ("Timestamps", {"fields": ["created_at", "updated_at"], "classes": ["collapse"]}),
    ]

    status_badge = status_badge(STATUS_COLORS)

    @admin.display(description="Account")
    def account_email(self, obj):
        profile = obj.user_account.user_profile
        return profile.user.email if profile else obj.user_account.account_number

    @admin.display(description="Live")
    def liveness(self, obj):
        if obj.is_live:
            return "Live"
        if obj.is_expired:
            return "Expired"
        return "-"

    @admin.display(description="Evidence")
    def evidence_link(self, obj):
        if obj.pk is None or not obj.evidence_retained:
            return "-"
        url = reverse("admin:users_investorclassification_evidence", args=[obj.uuid])
        return format_html('<a href="{}" target="_blank">Open evidence</a>', url)

    def get_urls(self):
        custom_urls = [
            admin_file_path(
                self,
                "<uuid:uuid>/evidence/",
                "users_investorclassification_evidence",
                self._resolve_evidence,
            ),
        ]
        return custom_urls + super().get_urls()

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if not may_review_documents(request.user):
            return fieldsets
        return [*fieldsets, ("Supporting payslips", {"fields": ["supporting_evidence"]})]

    @admin.display(description="Private supporting evidence")
    def supporting_evidence(self, obj):
        return format_html(
            '<a href="{}?classification__exact={}">Read supporting payslips and extraction history</a>',
            reverse("admin:documents_document_changelist"),
            obj.pk,
        )

    def _resolve_evidence(self, request, uuid):
        classification = get_object_or_404(InvestorClassification, uuid=uuid)
        if not classification.evidence_retained:
            raise Http404("No evidence")
        return classification, classification.evidence_file, classification.evidence_mime_type

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
