from django import forms
from django.contrib import admin
from django.http import HttpResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from shared.utils.admin_actions import admin_action_path, admin_page_path
from tokens.exceptions import RegisterNotInitialized
from tokens.models import RegisterExportKind, RegisterOutput
from tokens.services.register import (
    outputs_due,
    prepare_notice_figures,
)

PREPARE_PAGES = {
    RegisterExportKind.NOTICE_FIGURES: "admin:tokens_registeroutput_notice_figures",
}


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
    list_display = ["symbol", "name", "company", "notice_figures_link"]
    list_select_related = ["company"]
    search_fields = ["symbol", "name", "company__name"]
    fields = ["name", "symbol", "company", "notice_figures_link"]
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
            admin_page_path(self, "due/", "tokens_registeroutput_due", self.due),
            admin_action_path(
                self, "<uuid:uuid>/notice-figures/", "tokens_registeroutput_notice_figures", self.notice_figures
            ),
        ] + super().get_urls()

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

    @method_decorator(require_http_methods(["GET"]))
    def due(self, request):
        return render(
            request,
            "admin/tokens/register_outputs_due.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": "Register outputs due",
                "due": [
                    {
                        **item,
                        "url": (
                            reverse(PREPARE_PAGES[item["output"]], args=[item["token"].pk])
                            if item["output"] in PREPARE_PAGES
                            else ""
                        ),
                    }
                    for item in outputs_due()
                ],
            },
        )

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
