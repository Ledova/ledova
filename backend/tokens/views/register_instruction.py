from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import RegisterInstruction
from tokens.serializers.register_instruction import (
    RegisterInstructionCreateSerializer,
    RegisterInstructionSerializer,
)
from tokens.services.register_instructions import submit_instruction


class RegisterInstructionViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterInstruction.objects.none()
    serializer_class = RegisterInstructionSerializer
    scoped_model = RegisterInstruction
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.filter(company__owner=self.request.user)

    @extend_schema(request=RegisterInstructionCreateSerializer, responses={201: RegisterInstructionSerializer})
    def create(self, request):
        serializer = RegisterInstructionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_instruction(actor=request.user, **serializer.validated_data)
        return Response(RegisterInstructionSerializer(proposal).data, status=201)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)
