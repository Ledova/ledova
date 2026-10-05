from django.contrib import admin
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods

from shared.utils.admin_files import admin_file_path
from tokens.models import RegisterImport


@admin.register(RegisterImport)
class RegisterImportAdmin(admin.ModelAdmin):
    list_display = ["uuid", "company", "token", "as_at", "status", "created_at"]
    list_filter = ["status"]
    readonly_fields = [
        field.name for field in RegisterImport._meta.fields if field.name not in ("file", "asic_file")
    ] + [
        "evidence_link",
        "asic_link",
    ]
    exclude = ["file", "asic_file"]
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
            admin_file_path(self, "<uuid:uuid>/evidence/", "tokens_registerimport_evidence", self.resolve_evidence),
            admin_file_path(self, "<uuid:uuid>/asic/", "tokens_registerimport_asic", self.resolve_asic),
        ] + super().get_urls()

    def resolve_evidence(self, request, uuid):
        proposal = get_object_or_404(self.get_queryset(request), pk=uuid)
        return proposal, proposal.file, proposal.evidence_snapshot["mime_type"]

    def resolve_asic(self, request, uuid):
        proposal = get_object_or_404(self.get_queryset(request).exclude(asic_file=""), pk=uuid)
        return proposal, proposal.asic_file, proposal.asic_snapshot["mime_type"]

    @admin.display(description="Retained register document")
    def evidence_link(self, obj):
        return format_html(
            '<a href="{}">Open retained document</a>', reverse("admin:tokens_registerimport_evidence", args=[obj.pk])
        )

    @admin.display(description="Retained ASIC extract")
    def asic_link(self, obj):
        if not obj.asic_file:
            return "Staff-verified company document"
        return format_html(
            '<a href="{}">Open retained extract</a>', reverse("admin:tokens_registerimport_asic", args=[obj.pk])
        )
