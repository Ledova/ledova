from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterCapitalIncrease
from tokens.serializers.register_capital_increase import (
    RegisterCapitalIncreaseCreateSerializer,
    RegisterCapitalIncreaseDecideSerializer,
    RegisterCapitalIncreaseDecisionPreviewSerializer,
    RegisterCapitalIncreaseDecisionRequestSerializer,
    RegisterCapitalIncreaseSerializer,
)
from tokens.services.register_capital_increases import (
    CAPITAL_INCREASES,
    decide_capital_increase,
    prepare_capital_increase,
    preview_capital_increase_decision,
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
class RegisterCapitalIncreaseViewSet(RegisterProposalViewSet):
    queryset = RegisterCapitalIncrease.objects.none()
    serializer_class = RegisterCapitalIncreaseSerializer
    scoped_model = RegisterCapitalIncrease
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "decision_preview", "decide"}
    operator_actions_because = (
        "This bounded projection reads exact-company capital proposals and retained authority evidence. "
        "Personal appointments govern each decision; application admits the original capital journal atomically, "
        "and the worker rechecks the company source before signing."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, CAPITAL_INCREASES.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), CAPITAL_INCREASES.approved_function).get(pk=proposal.pk)
        return Response(RegisterCapitalIncreaseSerializer(current).data, status=status)

    @extend_schema(request=RegisterCapitalIncreaseCreateSerializer, responses={201: RegisterCapitalIncreaseSerializer})
    def create(self, request):
        serializer = RegisterCapitalIncreaseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_capital_increase(actor=request.user, **serializer.validated_data), 201)

    @extend_schema(
        request=RegisterCapitalIncreaseDecisionRequestSerializer,
        responses=RegisterCapitalIncreaseDecisionPreviewSerializer,
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterCapitalIncreaseDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, prepared = preview_capital_increase_decision(
            actor=request.user, capital_increase_id=uuid, **serializer.validated_data
        )
        return Response(RegisterCapitalIncreaseDecisionPreviewSerializer(prepared).data)

    @extend_schema(request=RegisterCapitalIncreaseDecideSerializer, responses=RegisterCapitalIncreaseSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterCapitalIncreaseDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(
            decide_capital_increase(actor=request.user, capital_increase_id=uuid, **serializer.validated_data)
        )
