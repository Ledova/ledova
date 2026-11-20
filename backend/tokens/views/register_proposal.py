from django.db.models import BooleanField, DateTimeField, F, Func
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.services.pending_deletion import delete_proposal


def with_decisions(queryset, approved_function):
    return (
        queryset.select_related("preparing_appointment__appointee_profile")
        .prefetch_related("decisions__appointment__appointee_profile")
        .annotate(
            approval_current=Func(
                F("uuid"),
                Func(function="clock_timestamp", output_field=DateTimeField()),
                function=approved_function,
                output_field=BooleanField(),
            )
        )
    )


class RegisterProposalViewSet(AuthenticatedReadOnlyViewSet):
    abstract = True
    operator_actions = frozenset({"list", "retrieve", "file"})
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]
    deletable_methods = ["get", "post", "delete", "head", "options"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user)

    def destroy(self, request, uuid=None):
        delete_proposal(actor=request.user, proposal=self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        if not proposal.file:
            raise NotFound("This record keeps no uploaded document copy.")
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)
