from django import forms
from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.http import FileResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from companies.models import CompanyPack
from shared.utils.admin_actions import admin_action_path
from tokens.exceptions import RegisterIntegrityError
from tokens.services.company_pack import produce_company_pack

DOCUMENT_PERMISSION = "companies.view_companydocument"


class CompanyPackForm(forms.Form):
    instruction = forms.CharField(
        max_length=255,
        label="Reference of the company's written instruction, or of the document that compels disclosure",
    )
    recipient = forms.CharField(max_length=255, label="Who the pack is for")


@admin.register(CompanyPack)
class CompanyPackAdmin(admin.ModelAdmin):
    list_display = ["name", "acn", "status", "pack_link"]
    search_fields = ["name", "acn"]
    fields = ["name", "acn", "status", "pack_link"]
    readonly_fields = fields
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
            admin_action_path(self, "<uuid:uuid>/produce/", "companies_companypack_produce", self.produce),
        ] + super().get_urls()

    @admin.display(description="Company pack")
    def pack_link(self, obj):
        return format_html(
            '<a href="{}">Produce a company pack</a>', reverse("admin:companies_companypack_produce", args=[obj.pk])
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def produce(self, request, company):
        if not request.user.has_perm(DOCUMENT_PERMISSION):
            raise PermissionDenied
        form = CompanyPackForm(request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                archive, filename = produce_company_pack(company, request.user, **form.cleaned_data)
            except ValidationError as error:
                refusal = " ".join(str(item) for item in error.detail)
            except RegisterIntegrityError as error:
                refusal = str(error)
            else:
                return FileResponse(archive, as_attachment=True, filename=filename, content_type="application/zip")
        return render(
            request,
            "admin/companies/company_pack.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": company,
                "title": f"Company pack: {company.name}",
                "form": form,
                "refusal": refusal,
            },
        )
