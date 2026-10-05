from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from tokens.models import RegisterOpening, RegisterWalletLink
from tokens.serializers.register_opening import (
    RegisterOpeningCreateSerializer,
    RegisterOpeningSerializer,
    RegisterWalletLinkCreateSerializer,
    RegisterWalletLinkSerializer,
)
from tokens.services.register_openings import submit_link, submit_opening
from tokens.views.register_proposal import RegisterProposalViewSet


class RegisterOpeningViewSet(RegisterProposalViewSet):
    queryset = RegisterOpening.objects.none()
    serializer_class = RegisterOpeningSerializer
    scoped_model = RegisterOpening
    operator_actions_because = (
        "Retained opening reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies."
    )

    @extend_schema(request=RegisterOpeningCreateSerializer, responses={201: RegisterOpeningSerializer})
    def create(self, request):
        serializer = RegisterOpeningCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_opening(actor=request.user, **serializer.validated_data)
        return Response(RegisterOpeningSerializer(proposal).data, status=201)


class RegisterWalletLinkViewSet(RegisterProposalViewSet):
    queryset = RegisterWalletLink.objects.none()
    serializer_class = RegisterWalletLinkSerializer
    scoped_model = RegisterWalletLink
    operator_actions_because = (
        "Retained wallet-link reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies."
    )

    @extend_schema(request=RegisterWalletLinkCreateSerializer, responses={201: RegisterWalletLinkSerializer})
    def create(self, request):
        serializer = RegisterWalletLinkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_link(actor=request.user, **serializer.validated_data)
        return Response(RegisterWalletLinkSerializer(proposal).data, status=201)
