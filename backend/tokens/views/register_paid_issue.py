from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterInstruction
from tokens.serializers.register_paid_issue import (
    RegisterPaidIssueCreateSerializer,
    RegisterPaidIssueDecideSerializer,
    RegisterPaidIssueDecisionPreviewSerializer,
    RegisterPaidIssueDecisionRequestSerializer,
    RegisterPaidIssueSerializer,
    RegisterPaidIssueSourceSerializer,
)
from tokens.services.register_paid_issues import (
    PAID_ISSUES,
    decide_paid_issue,
    prepare_paid_issue,
    preview_paid_issue_decision,
    ready_subscriptions,
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
class RegisterPaidIssueViewSet(RegisterProposalViewSet):
    queryset = RegisterInstruction.objects.none()
    serializer_class = RegisterPaidIssueSerializer
    scoped_model = RegisterInstruction
    operator_actions = RegisterProposalViewSet.operator_actions | {
        "create",
        "decision_preview",
        "decide",
        "ready_subscriptions",
    }
    operator_actions_because = (
        "This bounded company issue projection reads only exact-company register proposals and their retained "
        "evidence. Preparation and decisions require personal appointments and exact genuine paid Subscription "
        "sources; application admits the original paid issuance journal and the worker checks it before signing."
    )

    def narrow(self, queryset):
        return super().narrow(queryset).company_paid_issues()

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, PAID_ISSUES.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), PAID_ISSUES.approved_function).get(pk=proposal.pk)
        return Response(RegisterPaidIssueSerializer(current).data, status=status)

    @extend_schema(request=RegisterPaidIssueCreateSerializer, responses={201: RegisterPaidIssueSerializer})
    def create(self, request):
        serializer = RegisterPaidIssueCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_paid_issue(actor=request.user, **serializer.validated_data), 201)

    @extend_schema(
        request=RegisterPaidIssueDecisionRequestSerializer, responses=RegisterPaidIssueDecisionPreviewSerializer
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterPaidIssueDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, prepared = preview_paid_issue_decision(actor=request.user, paid_issue_id=uuid, **serializer.validated_data)
        return Response(RegisterPaidIssueDecisionPreviewSerializer(prepared).data)

    @extend_schema(request=RegisterPaidIssueDecideSerializer, responses=RegisterPaidIssueSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterPaidIssueDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_paid_issue(actor=request.user, paid_issue_id=uuid, **serializer.validated_data))

    @extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID, required=True),
            OpenApiParameter("token", OpenApiTypes.UUID, required=True),
        ],
        responses=RegisterPaidIssueSourceSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="ready-subscriptions", pagination_class=None, filter_backends=[])
    def ready_subscriptions(self, request):
        rows = ready_subscriptions(
            actor=request.user, company=request.query_params.get("company"), token=request.query_params.get("token")
        )
        return Response(RegisterPaidIssueSourceSerializer(rows, many=True).data)
