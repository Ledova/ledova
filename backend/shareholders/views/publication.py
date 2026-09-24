from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedListViewSet, stream_stored_file
from shareholders.filters import PublicationFilter
from shareholders.models import Publication
from shareholders.serializers import (
    BallotSerializer,
    PublicationSerializer,
    PublicationSummarySerializer,
)
from shareholders.services.publications import read_publication
from shareholders.services.resolutions import cast_ballot
from shareholders.services.summary import summarise_for


class PublicationViewSet(AuthenticatedListViewSet):
    serializer_class = PublicationSerializer
    scoped_model = Publication
    filterset_class = PublicationFilter
    lookup_field = "uuid"
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def get_throttles(self):
        self.throttle_scope = "ballot" if self.action == "ballot" else None
        return super().get_throttles()

    def narrow(self, queryset):
        return queryset.seen_by(self.request.user.pk)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        publication, _ = read_publication(request.user, uuid)
        return stream_stored_file(publication.file, publication.mime_type, as_attachment=True)

    @extend_schema(request=BallotSerializer, responses={200: PublicationSerializer})
    @action(detail=True, methods=["post"])
    def ballot(self, request, uuid=None):
        ballot = BallotSerializer(data=request.data)
        ballot.is_valid(raise_exception=True)
        cast_ballot(request.user, uuid, ballot.validated_data["choice"])
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(responses=PublicationSummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(PublicationSummarySerializer(summarise_for(request.user)).data)
