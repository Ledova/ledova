from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from tokens.models import RegisterCorrection
from tokens.serializers.register_correction import (
    RegisterCorrectionCreateSerializer,
    RegisterCorrectionSerializer,
)
from tokens.services.register_corrections import submit_correction
from tokens.views.register_proposal import RegisterProposalViewSet


class RegisterCorrectionViewSet(RegisterProposalViewSet):
    queryset = RegisterCorrection.objects.none()
    serializer_class = RegisterCorrectionSerializer
    scoped_model = RegisterCorrection
    operator_actions_because = (
        "Retained correction reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies."
    )

    @extend_schema(request=RegisterCorrectionCreateSerializer, responses={201: RegisterCorrectionSerializer})
    def create(self, request):
        serializer = RegisterCorrectionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_correction(actor=request.user, **serializer.validated_data)
        return Response(RegisterCorrectionSerializer(proposal).data, status=201)
