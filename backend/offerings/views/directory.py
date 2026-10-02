from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from offerings.serializers import (
    DirectoryDocumentSerializer,
    DirectoryTokenListSerializer,
)
from offerings.services import published_document, published_documents
from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import ShareToken
from users.services.eligibility import eligible_investor_companies


class DirectoryTokenViewSet(AuthenticatedReadOnlyViewSet):
    unscoped_by_the_base_because = (
        "the directory is scoped by investor eligibility, not by ownership: in_directory() against the "
        "companies eligible_investor_companies returns for this principal. Catalogued as "
        "ShareToken.in_directory in shared/db/policies.py."
    )

    serializer_class = DirectoryTokenListSerializer
    ordering = ["name"]
    ordering_fields = ["name", "symbol", "created_at"]

    def get_queryset(self):
        return (
            ShareToken.objects.with_company()
            .in_directory()
            .filter(company__in=eligible_investor_companies(self.request.user))
            .with_issued_shares()
            .with_open_offering()
        )

    @extend_schema(responses=DirectoryDocumentSerializer(many=True), filters=False)
    @action(detail=True, methods=["get"], pagination_class=None)
    def documents(self, request, uuid=None):
        token = self.get_object()
        context = {**self.get_serializer_context(), "token": token}
        return Response(DirectoryDocumentSerializer(published_documents(token), many=True, context=context).data)

    @extend_schema(
        parameters=[OpenApiParameter("document_uuid", OpenApiTypes.UUID, OpenApiParameter.PATH)],
        responses={(200, "*/*"): OpenApiTypes.BINARY},
    )
    @action(detail=True, methods=["get"], url_path=r"documents/(?P<document_uuid>[^/.]+)/file")
    def document_file(self, request, uuid=None, document_uuid=None):
        document = published_document(self.get_object(), document_uuid)
        return stream_stored_file(document.file, document.mime_type)
