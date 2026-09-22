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
from tokens.services.register import prepare_inspection_copy


class InspectionCopyForm(forms.Form):
    instruction = forms.CharField(max_length=255, label="Reference of the company's written instruction")
    requested_on = forms.DateField(label="Date the request was made", widget=forms.DateInput(attrs={"type": "date"}))
    recipient = forms.CharField(max_length=255, label="Who the copy is for")


@admin.register(RegisterOutput)
class RegisterOutputAdmin(admin.ModelAdmin):
    list_display = ["symbol", "name", "company", "inspection_copy_link"]
    list_select_related = ["company"]
    search_fields = ["symbol", "name", "company__name"]
    fields = ["name", "symbol", "company", "inspection_copy_link"]
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
        ] + super().get_urls()

    @admin.display(description="Inspection copy")
    def inspection_copy_link(self, obj):
        return format_html(
            '<a href="{}">Prepare an inspection copy</a>',
            reverse("admin:tokens_registeroutput_inspection_copy", args=[obj.pk]),
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
                refusal = " ".join(str(item) for item in error.detail)
            else:
                response = HttpResponse(content, content_type="text/csv")
                response["Content-Disposition"] = f'attachment; filename="register-{token.symbol}-inspection-copy.csv"'
                return response
        return render(
            request,
            "admin/tokens/register_inspection_copy.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "original": token,
                "title": f"Register outputs: {token.symbol}",
                "form": form,
                "refusal": refusal,
            },
        )
