from drf_spectacular.utils import extend_schema
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from shared.views import AuthenticatedGenericViewSet
from shared.views.uploads import UploadProtectedView
from tokens.models import RegisterEvidence
from tokens.serializers.register_import import (
    RegisterEvidenceSerializer,
    RegisterEvidenceUploadSerializer,
)
from tokens.services.register_evidence import upload_register_evidence


class RegisterEvidenceViewSet(UploadProtectedView, AuthenticatedGenericViewSet):
    queryset = RegisterEvidence.objects.none()
    serializer_class = RegisterEvidenceSerializer
    scoped_model = RegisterEvidence
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["post", "options"]

    def narrow(self, queryset):
        return queryset.none()

    @extend_schema(
        request={"multipart/form-data": RegisterEvidenceUploadSerializer},
        responses={201: RegisterEvidenceSerializer, 200: RegisterEvidenceSerializer},
    )
    def create(self, request):
        serializer = RegisterEvidenceUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        evidence, created = upload_register_evidence(actor=request.user, **serializer.validated_data)
        return Response(RegisterEvidenceSerializer(evidence).data, status=201 if created else 200)
