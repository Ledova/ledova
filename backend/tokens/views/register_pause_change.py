from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterPauseChange
from tokens.serializers.register_pause_change import (
    RegisterPauseChangeCreateSerializer,
    RegisterPauseChangeDecideSerializer,
    RegisterPauseChangeDecisionPreviewSerializer,
    RegisterPauseChangeDecisionRequestSerializer,
    RegisterPauseChangeSerializer,
)
from tokens.services.register_pause_changes import (
    PAUSE_CHANGES,
    decide_pause_change,
    prepare_pause_change,
    preview_pause_change_decision,
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
class RegisterPauseChangeViewSet(RegisterProposalViewSet):
    queryset = RegisterPauseChange.objects.none()
    serializer_class = RegisterPauseChangeSerializer
    scoped_model = RegisterPauseChange
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "decision_preview", "decide"}
    operator_actions_because = (
        "This bounded projection reads exact-company pause proposals and retained authority evidence. "
        "Personal appointments govern each decision; application admits the original pause journal atomically, "
        "and the worker rechecks the company source before signing."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, PAUSE_CHANGES.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), PAUSE_CHANGES.approved_function).get(pk=proposal.pk)
        return Response(RegisterPauseChangeSerializer(current).data, status=status)

    @extend_schema(request=RegisterPauseChangeCreateSerializer, responses={201: RegisterPauseChangeSerializer})
    def create(self, request):
        serializer = RegisterPauseChangeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_pause_change(actor=request.user, **serializer.validated_data), 201)

    @extend_schema(
        request=RegisterPauseChangeDecisionRequestSerializer,
        responses=RegisterPauseChangeDecisionPreviewSerializer,
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterPauseChangeDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, prepared = preview_pause_change_decision(
            actor=request.user, pause_change_id=uuid, **serializer.validated_data
        )
        return Response(RegisterPauseChangeDecisionPreviewSerializer(prepared).data)

    @extend_schema(request=RegisterPauseChangeDecideSerializer, responses=RegisterPauseChangeSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterPauseChangeDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_pause_change(actor=request.user, pause_change_id=uuid, **serializer.validated_data))
