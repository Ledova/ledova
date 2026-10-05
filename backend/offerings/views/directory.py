from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from offerings.serializers import (
    DirectoryDocumentSerializer,
    DirectoryTokenListSerializer,
)
from offerings.services import published_document, published_documents
from offerings.services.directory import directory_tokens
from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file


class DirectoryTokenViewSet(AuthenticatedReadOnlyViewSet):
    unscoped_by_the_base_because = (
        "the directory is scoped by investor eligibility, not by ownership: in_directory() against the "
        "exact company primary decisions or exact product offering decisions for this principal. Catalogued as "
        "ShareToken.in_directory in shared/db/policies.py."
    )

    serializer_class = DirectoryTokenListSerializer
    ordering = ["name"]
    ordering_fields = ["name", "symbol", "created_at"]

    def get_queryset(self):
        return directory_tokens(self.request.user)

    @extend_schema(responses=DirectoryDocumentSerializer(many=True), filters=False)
    @action(detail=True, methods=["get"], pagination_class=None)
    def documents(self, request, uuid=None):
        token = self.get_object()
        context = {**self.get_serializer_context(), "token": token}
        return Response(
            DirectoryDocumentSerializer(published_documents(token, user=request.user), many=True, context=context).data
        )

    @extend_schema(
        parameters=[OpenApiParameter("document_uuid", OpenApiTypes.UUID, OpenApiParameter.PATH)],
        responses={(200, "*/*"): OpenApiTypes.BINARY},
    )
    @action(detail=True, methods=["get"], url_path=r"documents/(?P<document_uuid>[^/.]+)/file")
    def document_file(self, request, uuid=None, document_uuid=None):
        document = published_document(self.get_object(), document_uuid, user=request.user)
        return stream_stored_file(document.file, document.mime_type)
