from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect

from tokens.exceptions import IssuanceExecutionConflict
from tokens.models import (
    RequestStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.services import issuance_execution, share_token_service

from ._helpers import short_hex
from .review_workflow import ReviewWorkflowAdmin


class IssuanceExecutionForm(forms.Form):
    confirmation = forms.CharField(widget=forms.HiddenInput)


@admin.register(ShareIssuanceRequest)
class ShareIssuanceRequestAdmin(ReviewWorkflowAdmin):
    label = "Issuance"
    deletable_status = RequestStatus.SUBMITTED
    approved_by_instruction = True

    def recorded_execution_error(self, obj) -> str:
        execution = (
            ShareIssuanceExecution.objects.select_related("operation", "transaction").filter(request_id=obj.pk).first()
        )
        if execution and execution.status == "executing" and execution.transaction_id:
            category = execution.operation.last_error or "Receipt verification pending"
            return f"Original transaction {execution.transaction.tx_hash} remains unresolved ({category})."
        return (
            ShareIssuance.objects.filter(idempotency_key=share_token_service.issuance_key(obj))
            .exclude(error_message="")
            .order_by("-created_at")
            .values_list("error_message", flat=True)
            .first()
            or ""
        )

    list_display = [
        "token_symbol",
        "recipient_display",
        "amount",
        "issuance_type",
        "status_badge",
        "dilution_display",
        "submitted_by",
        "submitted_at",
        "created_at",
    ]
    list_filter = ["status", "issuance_type", "token__company"]
    search_fields = [
        "token__symbol",
        "token__name",
        "reason",
        "recipient_address",
        "recipient_name",
        "submitted_by__email",
    ]
    detail_fieldset = (
        "Issuance Details",
        {"fields": ["recipient_address", "recipient_name", "amount", "issuance_type", "reason", "dilution_percentage"]},
    )

    @admin.display(description="Recipient")
    def recipient_display(self, obj):
        address = short_hex(obj.recipient_address)
        return f"{obj.recipient_name} ({address})" if obj.recipient_name else address

    def describe(self, obj):
        return f"{obj.amount} shares to {short_hex(obj.recipient_address)}"

    def detail_rows(self, obj):
        recipient = f"{obj.recipient_name} - {obj.recipient_address}" if obj.recipient_name else obj.recipient_address
        return [
            ("Recipient", recipient),
            ("Amount", f"{obj.amount} shares"),
            ("Issuance Type", obj.get_issuance_type_display()),
            ("Reason", obj.reason),
        ]

    def execution_steps(self, obj):
        return [
            "whitelist().isWhitelisted(recipient) in the company registry and authorizedShares() - totalSupply() "
            ">= amount - Checked before sending",
            f"mint({obj.recipient_address}, {obj.amount}) - Mint shares to recipient",
        ]

    def execute_view(self, request, obj):
        if not obj.can_be_executed and obj.status != RequestStatus.EXECUTING:
            return self._refuse(request, obj, "execute")
        try:
            if request.method == "POST":
                form = IssuanceExecutionForm(request.POST)
                if not form.is_valid():
                    raise IssuanceExecutionConflict("Reload the issuance execution confirmation.")
                issuance_execution.admit(obj, request.user, confirmed=form.cleaned_data["confirmation"])
                obj.refresh_from_db()
                messages.info(request, f"Issuance status: {obj.get_status_display()}.")
                return HttpResponseRedirect(self._change_url(obj))
            form = IssuanceExecutionForm(initial={"confirmation": issuance_execution.confirmation(obj, request.user)})
        except IssuanceExecutionConflict as exc:
            messages.error(request, str(exc.detail))
            return HttpResponseRedirect(self._change_url(obj))
        return self._render(request, obj, "execute", form)
