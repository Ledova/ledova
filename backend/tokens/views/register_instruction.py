from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from tokens.models import RegisterInstruction
from tokens.serializers.register_instruction import (
    RegisterInstructionCreateSerializer,
    RegisterInstructionSerializer,
)
from tokens.services.register_instructions import submit_instruction
from tokens.views.register_proposal import RegisterProposalViewSet


class RegisterInstructionViewSet(RegisterProposalViewSet):
    queryset = RegisterInstruction.objects.none()
    serializer_class = RegisterInstructionSerializer
    scoped_model = RegisterInstruction
    operator_actions_because = (
        "Retained instruction reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies."
    )

    def narrow(self, queryset):
        return super().narrow(queryset.legacy_instructions())

    @extend_schema(request=RegisterInstructionCreateSerializer, responses={201: RegisterInstructionSerializer})
    def create(self, request):
        serializer = RegisterInstructionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_instruction(actor=request.user, **serializer.validated_data)
        return Response(RegisterInstructionSerializer(proposal).data, status=201)
