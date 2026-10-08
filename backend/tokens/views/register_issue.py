from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from shared.views import stream_stored_file
from tokens.models import RegisterInstruction
from tokens.serializers.register_issue import (
    RegisterIssueCreateSerializer,
    RegisterIssueDecideSerializer,
    RegisterIssueDecisionPreviewSerializer,
    RegisterIssueDecisionRequestSerializer,
    RegisterIssueSerializer,
)
from tokens.services.register_issues import (
    ISSUES,
    decide_issue,
    prepare_issue,
    preview_issue_decision,
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
class RegisterIssueViewSet(RegisterProposalViewSet):
    queryset = RegisterInstruction.objects.none()
    serializer_class = RegisterIssueSerializer
    scoped_model = RegisterInstruction
    operator_actions = RegisterProposalViewSet.operator_actions | {
        "create",
        "decision_preview",
        "decide",
        "terms_file",
        "acceptance_file",
    }
    operator_actions_because = (
        "This bounded company issue projection reads only exact-company register proposals and their retained "
        "evidence. Preparation and decisions require personal appointments and immutable nomination/member "
        "sources; application admits an exact original issuance journal and the worker checks it before signing."
    )

    def narrow(self, queryset):
        return super().narrow(queryset).company_issues()

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, ISSUES.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), ISSUES.approved_function).get(pk=proposal.pk)
        return Response(RegisterIssueSerializer(current).data, status=status)

    @extend_schema(request=RegisterIssueCreateSerializer, responses={201: RegisterIssueSerializer})
    def create(self, request):
        serializer = RegisterIssueCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_issue(actor=request.user, **serializer.validated_data), 201)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="terms-file")
    def terms_file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.terms_file, proposal.terms_snapshot["mime_type"], as_attachment=True)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="acceptance-file")
    def acceptance_file(self, request, uuid=None):
        proposal = self.get_object()
        if not proposal.acceptance_required:
            raise NotFound("This grant required no acceptance evidence.")
        return stream_stored_file(
            proposal.acceptance_file, proposal.acceptance_snapshot["mime_type"], as_attachment=True
        )

    @extend_schema(request=RegisterIssueDecisionRequestSerializer, responses=RegisterIssueDecisionPreviewSerializer)
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterIssueDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, prepared = preview_issue_decision(actor=request.user, issue_id=uuid, **serializer.validated_data)
        return Response(RegisterIssueDecisionPreviewSerializer(prepared).data)

    @extend_schema(request=RegisterIssueDecideSerializer, responses=RegisterIssueSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterIssueDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_issue(actor=request.user, issue_id=uuid, **serializer.validated_data))
