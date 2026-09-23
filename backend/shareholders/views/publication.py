from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action

from shared.views import AuthenticatedListViewSet, stream_stored_file
from shareholders.models import Publication
from shareholders.serializers import PublicationSerializer
from shareholders.services.publications import read_publication


class PublicationViewSet(AuthenticatedListViewSet):
    serializer_class = PublicationSerializer
    scoped_model = Publication
    lookup_field = "uuid"
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "head", "options"]

    def narrow(self, queryset):
        return queryset.with_the_holding_of(self.request.user.pk)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        publication, _ = read_publication(request.user, uuid)
        return stream_stored_file(publication.file, publication.mime_type, as_attachment=True)
