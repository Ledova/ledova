from django import forms
from django.contrib import admin, messages
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_http_methods
from rest_framework.exceptions import ValidationError

from companies.models import CompanyDocument
from shared.utils.admin_actions import admin_page_path
from shared.utils.admin_files import admin_file_path
from shareholders.constants import READ_AS_STAFF
from shareholders.models import Publication, PublicationKind, PublicationRecipient
from shareholders.services.publications import (
    publish_to_members,
    record_publication_read,
)
from tokens.models import ShareRegister, ShareToken


def _authorities():
    return (
        CompanyDocument.objects.filter(is_verified=True, verified_by__isnull=False)
        .exclude(verified_fingerprint="")
        .select_related("company")
        .order_by("company__name", "name")
    )


def _share_classes():
    return ShareToken.objects.filter(
        pk__in=ShareRegister.objects.filter(sequence__gt=0).values("token_id")
    ).select_related("company")


class PublishForm(forms.Form):
    token = forms.ModelChoiceField(queryset=_share_classes(), label="Share class")
    kind = forms.ChoiceField(choices=PublicationKind.choices, label="What is being published")
    title = forms.CharField(max_length=255, label="Title members will see")
    record_date = forms.DateField(label="Record date", widget=forms.DateInput(attrs={"type": "date"}))
    instruction = forms.CharField(max_length=255, label="Reference of the company's written instruction")
    authority_document = forms.ModelChoiceField(
        queryset=_authorities(), label="Verified company document carrying that authority"
    )
    file = forms.FileField(label="The document itself")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["token"].queryset = _share_classes()
        self.fields["authority_document"].queryset = _authorities()


class PublicationRecipientInline(admin.TabularInline):
    model = PublicationRecipient
    extra = 0
    can_delete = False
    fields = ["member_id", "user_id", "name", "holder_type", "identity_source", "shares"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Publication)
class PublicationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "company", "token", "kind", "title", "record_date", "member_rows"]
    list_select_related = ["company", "token"]
    list_filter = ["kind", "record_date"]
    search_fields = ["title", "instruction", "company__name", "token__symbol"]
    readonly_fields = [field.name for field in Publication._meta.fields if field.name != "file"] + ["file_link"]
    exclude = ["file"]
    inlines = [PublicationRecipientInline]
    actions = None

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return obj is None and super().has_change_permission(request, obj)

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
            admin_page_path(self, "publish/", "shareholders_publication_publish", self.publish),
            admin_file_path(self, "<uuid:uuid>/file/", "shareholders_publication_file", self.resolve_file),
        ] + super().get_urls()

    def resolve_file(self, request, uuid):
        publication = get_object_or_404(self.get_queryset(request), pk=uuid)
        record_publication_read(request.user, publication, None, READ_AS_STAFF)
        return publication, publication.file, publication.mime_type, f"{publication.kind}-{publication.pk}"

    @admin.display(description="Published document")
    def file_link(self, obj):
        if obj.pk is None or not obj.file:
            return "-"
        return format_html(
            '<a href="{}">Open the published document</a>',
            reverse("admin:shareholders_publication_file", args=[obj.pk]),
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def publish(self, request):
        form = PublishForm(request.POST if request.method == "POST" else None, files=request.FILES or None)
        refusal = ""
        if form.is_valid():
            fields = dict(form.cleaned_data)
            token = fields.pop("token")
            fields["authority_document"] = fields["authority_document"].pk
            fields["upload"] = fields.pop("file")
            try:
                publication = publish_to_members(token, request.user, **fields)
            except ValidationError as error:
                refusal = " ".join(str(item) for item in error.detail)
            else:
                self.log_addition(request, publication, f"Published {publication.kind} to members.")
                self.message_user(
                    request, f"Published to {publication.member_rows} members of {token.symbol}.", messages.SUCCESS
                )
                return redirect("admin:shareholders_publication_change", publication.pk)
        return render(
            request,
            "admin/shareholders/publish.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": "Publish to members",
                "form": form,
                "refusal": refusal,
            },
        )
