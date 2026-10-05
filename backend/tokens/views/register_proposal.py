from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file


class RegisterProposalViewSet(AuthenticatedReadOnlyViewSet):
    abstract = True
    operator_actions = frozenset({"list", "retrieve", "file"})
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)
