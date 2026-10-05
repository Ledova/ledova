from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from tokens.models import RegisterImport
from tokens.serializers.register_import import (
    RegisterImportCreateSerializer,
    RegisterImportSerializer,
)
from tokens.services.register_imports import submit_import
from tokens.views.register_proposal import RegisterProposalViewSet


class RegisterImportViewSet(RegisterProposalViewSet):
    queryset = RegisterImport.objects.none()
    serializer_class = RegisterImportSerializer
    scoped_model = RegisterImport
    operator_actions_because = (
        "Retained import reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies."
    )

    @extend_schema(request=RegisterImportCreateSerializer, responses={201: RegisterImportSerializer})
    def create(self, request):
        serializer = RegisterImportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_import(actor=request.user, **serializer.validated_data)
        return Response(RegisterImportSerializer(proposal).data, status=201)
