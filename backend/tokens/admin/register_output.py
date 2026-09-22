from django import forms
from django.contrib import admin
from django.http import HttpResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from shared.utils.admin_actions import admin_action_path
from tokens.exceptions import RegisterNotInitialized
from tokens.models import RegisterOutput
from tokens.services.register import (
    prepare_certificate,
    prepare_inspection_copy,
    prepare_notice_figures,
)


class InspectionCopyForm(forms.Form):
    instruction = forms.CharField(max_length=255, label="Reference of the company's written instruction")
    requested_on = forms.DateField(label="Date the request was made", widget=forms.DateInput(attrs={"type": "date"}))
    recipient = forms.CharField(max_length=255, label="Who the copy is for")


class CertificateForm(forms.Form):
    sequence = forms.IntegerField(min_value=1, label="Number of the register entry")
    instruction = forms.CharField(max_length=255, label="Reference of the company's written instruction")


class NoticeFiguresForm(forms.Form):
    period_from = forms.DateField(label="First day of the period", widget=forms.DateInput(attrs={"type": "date"}))
    instruction = forms.CharField(max_length=255, label="Reference of the company's written instruction")


def _refusal(error):
    return " ".join(str(item) for item in error.detail)


def _download(content, content_type, filename):
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@admin.register(RegisterOutput)
class RegisterOutputAdmin(admin.ModelAdmin):
    list_display = ["symbol", "name", "company", "inspection_copy_link", "certificate_link", "notice_figures_link"]
    list_select_related = ["company"]
    search_fields = ["symbol", "name", "company__name"]
    fields = ["name", "symbol", "company", "inspection_copy_link", "certificate_link", "notice_figures_link"]
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
            admin_action_path(
                self, "<uuid:uuid>/inspection-copy/", "tokens_registeroutput_inspection_copy", self.inspection_copy
            ),
            admin_action_path(self, "<uuid:uuid>/certificate/", "tokens_registeroutput_certificate", self.certificate),
            admin_action_path(
                self, "<uuid:uuid>/notice-figures/", "tokens_registeroutput_notice_figures", self.notice_figures
            ),
        ] + super().get_urls()

    @admin.display(description="Inspection copy")
    def inspection_copy_link(self, obj):
        return format_html(
            '<a href="{}">Prepare an inspection copy</a>',
            reverse("admin:tokens_registeroutput_inspection_copy", args=[obj.pk]),
        )

    @admin.display(description="Certificate")
    def certificate_link(self, obj):
        return format_html(
            '<a href="{}">Prepare a certificate</a>',
            reverse("admin:tokens_registeroutput_certificate", args=[obj.pk]),
        )

    @admin.display(description="Notice figures")
    def notice_figures_link(self, obj):
        return format_html(
            '<a href="{}">Prepare notice figures</a>',
            reverse("admin:tokens_registeroutput_notice_figures", args=[obj.pk]),
        )

    def _page(self, request, token, template, form, refusal):
        return render(
            request,
            template,
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": token,
                "title": f"Register outputs: {token.symbol}",
                "form": form,
                "refusal": refusal,
            },
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def inspection_copy(self, request, token):
        form = InspectionCopyForm(request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                content = prepare_inspection_copy(token, request.user, **form.cleaned_data)
            except RegisterNotInitialized:
                refusal = "This share class's register has not been opened, so there is no register to copy."
            except ValidationError as error:
                refusal = _refusal(error)
            else:
                return _download(content, "text/csv", f"register-{token.symbol}-inspection-copy.csv")
        return self._page(request, token, "admin/tokens/register_inspection_copy.html", form, refusal)

    @method_decorator(require_http_methods(["GET", "POST"]))
    def certificate(self, request, token):
        form = CertificateForm(request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                content = prepare_certificate(token, request.user, **form.cleaned_data)
            except ValidationError as error:
                refusal = _refusal(error)
            else:
                sequence = form.cleaned_data["sequence"]
                return _download(content, "application/pdf", f"certificate-{token.symbol}-{sequence}.pdf")
        return self._page(request, token, "admin/tokens/register_certificate.html", form, refusal)

    @method_decorator(require_http_methods(["GET", "POST"]))
    def notice_figures(self, request, token):
        form = NoticeFiguresForm(request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                content, sequence = prepare_notice_figures(token, request.user, **form.cleaned_data)
            except RegisterNotInitialized:
                refusal = "This share class's register has not been opened, so there are no figures to prepare."
            except ValidationError as error:
                refusal = _refusal(error)
            else:
                period_from = form.cleaned_data["period_from"].isoformat()
                return _download(content, "text/csv", f"notice-figures-{token.symbol}-{period_from}-to-{sequence}.csv")
        return self._page(request, token, "admin/tokens/register_notice_figures.html", form, refusal)
