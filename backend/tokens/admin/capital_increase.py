from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect

from tokens.exceptions import CapitalIncreaseConflict
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    RequestStatus,
)
from tokens.services import capital_execution

from .review_workflow import ReviewWorkflowAdmin


class CapitalExecutionForm(forms.Form):
    confirmation = forms.CharField(widget=forms.HiddenInput)


@admin.register(CapitalIncreaseRequest)
class CapitalIncreaseAdmin(ReviewWorkflowAdmin):
    label = "Capital increase"
    deletable_status = RequestStatus.DRAFT
    list_display = [
        "token_symbol",
        "additional_shares",
        "new_authorized_total",
        "status_badge",
        "dilution_display",
        "submitted_by",
        "submitted_at",
        "created_at",
    ]
    list_filter = ["status", "token__company"]
    search_fields = ["token__symbol", "token__name", "purpose", "submitted_by__email"]
    detail_fieldset = (
        "Capital Increase Details",
        {
            "fields": [
                "additional_shares",
                "new_authorized_total",
                "purpose",
                "board_resolution_reference",
                "shareholder_approval_reference",
                "dilution_percentage",
            ]
        },
    )

    def describe(self, obj):
        return f"+{obj.additional_shares} shares"

    def detail_rows(self, obj):
        return [
            ("Additional Shares", f"+{obj.additional_shares} shares"),
            ("New Authorized Total", f"{obj.new_authorized_total} shares"),
            ("Purpose", obj.purpose),
            ("Board Resolution", obj.board_resolution_reference),
            ("Shareholder Approval", obj.shareholder_approval_reference or "-"),
        ]

    def execution_steps(self, obj):
        return [f"setAuthorizedShares({obj.new_authorized_total}) - Raise the authorized share cap; nothing is minted"]

    def recorded_execution_error(self, obj):
        execution = (
            CapitalIncreaseExecution.objects.select_related("operation", "transaction")
            .filter(request_id=obj.pk)
            .first()
        )
        if execution and execution.attribution_evidence is not None:
            return "Capital increase requires operator attribution. Its original evidence is retained."
        if execution and execution.operation_id and execution.projected_at is None and execution.transaction_id:
            category = execution.operation.last_error or "Receipt verification pending"
            return f"Original transaction {execution.transaction.tx_hash} remains unresolved ({category})."
        return super().recorded_execution_error(obj)

    def execute_view(self, request, obj):
        if not obj.can_be_executed and obj.status != RequestStatus.EXECUTING:
            return self._refuse(request, obj, "execute")
        try:
            if request.method == "POST":
                form = CapitalExecutionForm(request.POST)
                if not form.is_valid():
                    raise CapitalIncreaseConflict("Reload the capital execution confirmation.")
                capital_execution.admit(obj, request.user, confirmed=form.cleaned_data["confirmation"])
                obj.refresh_from_db()
                messages.info(request, f"Capital increase status: {obj.get_status_display()}.")
                return HttpResponseRedirect(self._change_url(obj))
            form = CapitalExecutionForm(initial={"confirmation": capital_execution.confirmation(obj, request.user)})
        except CapitalIncreaseConflict as exc:
            messages.error(request, str(exc.detail))
            return HttpResponseRedirect(self._change_url(obj))
        return self._render(request, obj, "execute", form)
