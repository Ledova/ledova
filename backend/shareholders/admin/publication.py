from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.db.models import Q
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
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRecipient,
    ResolutionKind,
)
from shareholders.services.distributions import record_payment, withdraw_payment
from shareholders.services.publications import (
    deliver_publication,
    publish_to_members,
)
from shareholders.services.resolutions import enter_ballot
from tokens.models import ShareRegister, ShareToken

RESOLUTION_FIELDS = ("question", "resolution_kind", "vote_basis", "opens_at", "closes_at", "tally", "ballot_entry")
DISTRIBUTION_FIELDS = (
    "rate_per_share",
    "currency",
    "declared_on",
    "payment_date",
    "declared_total",
    "undistributed",
    "payment_entry",
)
FIELDS_OF = {PublicationKind.RESOLUTION: RESOLUTION_FIELDS, PublicationKind.DISTRIBUTION: DISTRIBUTION_FIELDS}
WINDOW_WIDGET = forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M")
DATE_WIDGET = forms.DateInput(attrs={"type": "date"})


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
    question = forms.CharField(
        required=False,
        label="Question put to members (a resolution only)",
        widget=forms.Textarea(attrs={"rows": 3, "cols": 60}),
    )
    resolution_kind = forms.ChoiceField(
        required=False,
        choices=[("", "Not a resolution"), *ResolutionKind.choices],
        label="Ordinary or special resolution",
    )
    opens_at = forms.DateTimeField(required=False, label="Voting opens (UTC)", widget=WINDOW_WIDGET)
    closes_at = forms.DateTimeField(required=False, label="Voting closes (UTC)", widget=WINDOW_WIDGET)
    rate_per_share = forms.DecimalField(
        required=False, max_digits=18, decimal_places=6, label="Rate per share in AUD (a distribution only)"
    )
    declared_on = forms.DateField(required=False, label="Date the dividend was declared", widget=DATE_WIDGET)
    payment_date = forms.DateField(required=False, label="Date the company will pay it", widget=DATE_WIDGET)
    declared_total = forms.DecimalField(
        required=False,
        max_digits=18,
        decimal_places=2,
        label="Total the company declared, in AUD",
        help_text="A check on the rate: the shares on the roll times the rate, rounded down to the cent.",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["token"].queryset = _share_classes()
        self.fields["authority_document"].queryset = _authorities()


def _sentences(detail):
    if isinstance(detail, dict):
        detail = list(detail.values())
    if isinstance(detail, list):
        return [sentence for item in detail for sentence in _sentences(item)]
    return [str(detail)]


def _roll_row(row):
    return f"{row.name or 'Unnamed member'} ({row.get_holder_type_display()}, {row.shares} shares)"


def _entitled_row(row):
    holder = row.name or "Unnamed member"
    return f"{holder} ({row.get_holder_type_display()}, {row.shares} shares, entitled to {row.entitlement})"


class BallotForm(forms.Form):
    recipient = forms.ModelChoiceField(queryset=PublicationRecipient.objects.none(), label="Member on the roll")
    choice = forms.ChoiceField(choices=BallotChoice.choices, label="Their vote")
    authority = forms.CharField(
        max_length=255,
        label="What you relied on",
        help_text="For example the reference of the member's signed proxy form or written instruction.",
    )

    def __init__(self, publication, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["recipient"].queryset = PublicationRecipient.objects.filter(
            publication=publication, ballots__isnull=True
        ).order_by("-shares", "member_id")
        self.fields["recipient"].label_from_instance = _roll_row


class PaymentForm(forms.Form):
    recipient = forms.ModelChoiceField(queryset=PublicationRecipient.objects.none(), label="Member on the roll")
    paid_on = forms.DateField(label="Date the company recorded it as paid", widget=DATE_WIDGET)
    reference = forms.CharField(max_length=64, label="The company's payment reference")
    evidence = forms.FileField(label="The company's remittance evidence")
    authority = forms.CharField(
        max_length=255,
        label="What you relied on",
        help_text="For example the reference of the company's written payment advice.",
    )

    def __init__(self, publication, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["recipient"].queryset = (
            PublicationRecipient.objects.filter(publication=publication, entitlement__gt=0)
            .with_latest_payment_record()
            .filter(Q(latest_payment_record__isnull=True) | Q(latest_payment_record=PublicationEventKind.PAYMENT_VOID))
        )
        self.fields["recipient"].label_from_instance = _entitled_row


class WithdrawalForm(forms.Form):
    recipient = forms.ModelChoiceField(queryset=PublicationRecipient.objects.none(), label="Member on the roll")
    reason = forms.CharField(
        max_length=255,
        label="Why the record is withdrawn",
        help_text="For example the reference of the company's written correction.",
    )

    def __init__(self, publication, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["recipient"].queryset = (
            PublicationRecipient.objects.filter(publication=publication)
            .with_latest_payment_record()
            .filter(latest_payment_record=PublicationEventKind.PAYMENT)
        )
        self.fields["recipient"].label_from_instance = _entitled_row


class PublicationRecipientInline(admin.TabularInline):
    model = PublicationRecipient
    extra = 0
    can_delete = False
    fields = ["member_id", "user_id", "name", "holder_type", "identity_source", "shares"]
    readonly_fields = fields

    def get_fields(self, request, obj=None):
        if obj is not None and obj.kind == PublicationKind.DISTRIBUTION:
            return [*self.fields, "entitlement"]
        return self.fields

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class PublicationEventInline(admin.TabularInline):
    model = PublicationEvent
    fk_name = "publication"
    extra = 0
    can_delete = False
    ordering = ["sequence"]
    fields = [
        "sequence",
        "kind",
        "member",
        "choice",
        "shares",
        "staff_entered",
        "actor_id",
        "authority",
        "created_at",
        "previous_hash",
        "entry_hash",
    ]
    readonly_fields = fields

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("recipient")

    @admin.display(description="Member")
    def member(self, obj):
        return "-" if obj.recipient is None else _roll_row(obj.recipient)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class PaymentRecordInline(PublicationEventInline):
    fields = [
        "sequence",
        "kind",
        "member",
        "paid_on",
        "reference",
        "evidence_digest",
        "evidence_link",
        "actor_id",
        "authority",
        "created_at",
        "previous_hash",
        "entry_hash",
    ]
    readonly_fields = fields
    verbose_name = "payment record"
    verbose_name_plural = "payment records"

    @admin.display(description="Remittance evidence")
    def evidence_link(self, obj):
        if obj.kind != PublicationEventKind.PAYMENT:
            return "-"
        return format_html(
            '<a href="{}">Open the remittance evidence</a>',
            reverse("admin:shareholders_publication_evidence", args=[obj.pk]),
        )


@admin.register(Publication)
class PublicationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "company", "token", "kind", "title", "record_date", "member_rows"]
    list_select_related = ["company", "token"]
    list_filter = ["kind", "record_date"]
    search_fields = ["title", "instruction", "company__name", "token__symbol"]
    readonly_fields = [field.name for field in Publication._meta.fields if field.name != "file"] + [
        "file_link",
        "tally",
        "ballot_entry",
        "payment_entry",
    ]
    exclude = ["file"]
    inlines = [PublicationRecipientInline]
    actions = None

    def get_readonly_fields(self, request, obj=None):
        shown = FIELDS_OF.get(None if obj is None else obj.kind, ())
        hidden = {name for fields in FIELDS_OF.values() for name in fields} - set(shown)
        return [name for name in self.readonly_fields if name not in hidden]

    def get_inlines(self, request, obj):
        if obj is not None and obj.kind == PublicationKind.RESOLUTION:
            return [PublicationEventInline, PublicationRecipientInline]
        if obj is not None and obj.kind == PublicationKind.DISTRIBUTION:
            return [PaymentRecordInline, PublicationRecipientInline]
        return self.inlines

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
            admin_page_path(self, "<uuid:uuid>/ballot/", "shareholders_publication_ballot", self.enter_a_ballot),
            admin_page_path(self, "<uuid:uuid>/payment/", "shareholders_publication_payment", self.record_a_payment),
            admin_page_path(
                self, "<uuid:uuid>/payment/withdraw/", "shareholders_publication_withdrawal", self.withdraw_a_payment
            ),
            admin_file_path(self, "<uuid:uuid>/file/", "shareholders_publication_file", self.resolve_file),
            admin_file_path(
                self, "payment/<uuid:uuid>/evidence/", "shareholders_publication_evidence", self.resolve_evidence
            ),
        ] + super().get_urls()

    def resolve_file(self, request, uuid):
        publication = get_object_or_404(self.get_queryset(request), pk=uuid)
        deliver_publication(request.user, publication, None, READ_AS_STAFF)
        return publication, publication.file, publication.mime_type, f"{publication.kind}-{publication.pk}"

    def resolve_evidence(self, request, uuid):
        if not request.user.has_perm("shareholders.view_publicationevent"):
            raise PermissionDenied
        record = get_object_or_404(
            PublicationEvent.objects.select_related("publication", "recipient").filter(
                kind=PublicationEventKind.PAYMENT, publication__in=self.get_queryset(request)
            ),
            pk=uuid,
        )
        deliver_publication(request.user, record.publication, record.recipient, READ_AS_STAFF, record)
        return record.publication, record.evidence, record.evidence_mime_type, f"payment-evidence-{record.pk}"

    @admin.display(description="Published document")
    def file_link(self, obj):
        if obj.pk is None or not obj.file:
            return "-"
        return format_html(
            '<a href="{}">Open the published document</a>',
            reverse("admin:shareholders_publication_file", args=[obj.pk]),
        )

    @admin.display(description="Tally")
    def tally(self, obj):
        close = PublicationEvent.objects.filter(publication=obj, kind=PublicationEventKind.CLOSE).first()
        if close is None:
            return "Not closed yet: the tally is written when the voting window has passed."
        counted = close.payload
        return format_html(
            "<strong>{}</strong>. For: {} shares from {} members. Against: {} shares from {} members. "
            "Abstained: {} shares from {} members. Eligible: {} shares held by {} members.",
            "Carried" if counted["carried"] else "Not carried",
            counted["for"]["shares"],
            counted["for"]["members"],
            counted["against"]["shares"],
            counted["against"]["members"],
            counted["abstain"]["shares"],
            counted["abstain"]["members"],
            counted["eligible"]["shares"],
            counted["eligible"]["members"],
        )

    @admin.display(description="Staff-entered ballot")
    def ballot_entry(self, obj):
        return format_html(
            '<a href="{}">Enter a ballot</a>',
            reverse("admin:shareholders_publication_ballot", args=[obj.pk]),
        )

    @admin.display(description="Payment records")
    def payment_entry(self, obj):
        return format_html(
            '<a href="{}">Record a payment</a> · <a href="{}">Withdraw a payment record</a>',
            reverse("admin:shareholders_publication_payment", args=[obj.pk]),
            reverse("admin:shareholders_publication_withdrawal", args=[obj.pk]),
        )

    def _payment_page(self, request, template, title, publication, form, refusal):
        return render(
            request,
            f"admin/shareholders/{template}.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": title,
                "publication": publication,
                "form": form,
                "refusal": refusal,
            },
        )

    @method_decorator(require_http_methods(["GET", "POST"]))
    def record_a_payment(self, request, uuid):
        publication = get_object_or_404(self.get_queryset(request).filter(kind=PublicationKind.DISTRIBUTION), pk=uuid)
        posted = request.method == "POST"
        form = PaymentForm(publication, request.POST if posted else None, files=request.FILES if posted else None)
        refusal = ""
        if form.is_valid():
            try:
                record = record_payment(request.user, publication, **form.cleaned_data)
            except ValidationError as error:
                refusal = " ".join(_sentences(error.detail))
            else:
                self.log_addition(request, record, f"Recorded a payment for roll row {record.recipient_id}.")
                self.message_user(request, f"Recorded the payment at sequence {record.sequence}.", messages.SUCCESS)
                return redirect("admin:shareholders_publication_change", publication.pk)
        return self._payment_page(request, "record_payment", "Record a payment", publication, form, refusal)

    @method_decorator(require_http_methods(["GET", "POST"]))
    def withdraw_a_payment(self, request, uuid):
        publication = get_object_or_404(self.get_queryset(request).filter(kind=PublicationKind.DISTRIBUTION), pk=uuid)
        form = WithdrawalForm(publication, request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                record = withdraw_payment(request.user, publication, **form.cleaned_data)
            except ValidationError as error:
                refusal = " ".join(_sentences(error.detail))
            else:
                self.log_addition(request, record, f"Withdrew the payment record for roll row {record.recipient_id}.")
                self.message_user(
                    request, f"Withdrew the payment record at sequence {record.sequence}.", messages.SUCCESS
                )
                return redirect("admin:shareholders_publication_change", publication.pk)
        return self._payment_page(request, "withdraw_payment", "Withdraw a payment record", publication, form, refusal)

    @method_decorator(require_http_methods(["GET", "POST"]))
    def enter_a_ballot(self, request, uuid):
        publication = get_object_or_404(self.get_queryset(request).filter(kind=PublicationKind.RESOLUTION), pk=uuid)
        form = BallotForm(publication, request.POST if request.method == "POST" else None)
        refusal = ""
        if form.is_valid():
            try:
                ballot = enter_ballot(request.user, publication, **form.cleaned_data)
            except ValidationError as error:
                refusal = " ".join(_sentences(error.detail))
            else:
                self.log_addition(
                    request, ballot, f"Entered a {ballot.choice} ballot for roll row {ballot.recipient_id}."
                )
                self.message_user(request, f"Recorded the ballot at sequence {ballot.sequence}.", messages.SUCCESS)
                return redirect("admin:shareholders_publication_change", publication.pk)
        return render(
            request,
            "admin/shareholders/enter_ballot.html",
            {
                **self.admin_site.each_context(request),
                "opts": self.model._meta,
                "title": "Enter a ballot",
                "publication": publication,
                "form": form,
                "refusal": refusal,
            },
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
                refusal = " ".join(_sentences(error.detail))
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
