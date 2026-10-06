from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterOpening, RegisterWalletLink
from tokens.serializers.register_opening import (
    RegisterOpeningCreateSerializer,
    RegisterOpeningDecideSerializer,
    RegisterOpeningDecisionPreviewSerializer,
    RegisterOpeningDecisionRequestSerializer,
    RegisterOpeningSerializer,
    RegisterWalletLinkCreateSerializer,
    RegisterWalletLinkSerializer,
)
from tokens.services.register_openings import (
    OPENINGS,
    decide_opening,
    prepare_opening,
    preview_opening_decision,
    submit_link,
)
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {"company": "company_id", "token": "token_id", "status": "status"}


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class RegisterOpeningViewSet(RegisterProposalViewSet):
    queryset = RegisterOpening.objects.none()
    serializer_class = RegisterOpeningSerializer
    scoped_model = RegisterOpening
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "decision_preview", "decide"}
    operator_actions_because = (
        "Retained opening reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every proposal and file to those companies. "
        "Preparation, previews and decisions run the bounded company register command, which checks the caller's "
        "current appointment under the company lock, and their responses read the operator-only decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, OPENINGS.approved_function).select_related("token")

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), OPENINGS.approved_function).get(pk=proposal.pk)
        return Response(RegisterOpeningSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterOpeningCreateSerializer,
        responses={201: RegisterOpeningSerializer, 200: RegisterOpeningSerializer},
    )
    def create(self, request):
        serializer = RegisterOpeningCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal, created = prepare_opening(actor=request.user, **serializer.validated_data)
        return self._respond(proposal, 201 if created else 200)

    @extend_schema(request=RegisterOpeningDecisionRequestSerializer, responses=RegisterOpeningDecisionPreviewSerializer)
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterOpeningDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, preview = preview_opening_decision(actor=request.user, opening_id=uuid, **serializer.validated_data)
        return Response(RegisterOpeningDecisionPreviewSerializer(preview).data)

    @extend_schema(request=RegisterOpeningDecideSerializer, responses=RegisterOpeningSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterOpeningDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_opening(actor=request.user, opening_id=uuid, **serializer.validated_data))


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
