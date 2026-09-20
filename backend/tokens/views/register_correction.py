from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import RegisterCorrection
from tokens.serializers.register_correction import (
    RegisterCorrectionCreateSerializer,
    RegisterCorrectionSerializer,
)
from tokens.services.register_corrections import submit_correction


class RegisterCorrectionViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterCorrection.objects.none()
    serializer_class = RegisterCorrectionSerializer
    scoped_model = RegisterCorrection
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.filter(company__owner=self.request.user)

    @extend_schema(request=RegisterCorrectionCreateSerializer, responses={201: RegisterCorrectionSerializer})
    def create(self, request):
        serializer = RegisterCorrectionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_correction(actor=request.user, **serializer.validated_data)
        return Response(RegisterCorrectionSerializer(proposal).data, status=201)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)
