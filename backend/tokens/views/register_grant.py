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
from tokens.models import RegisterGrant
from tokens.serializers.register_grant import (
    RegisterGrantCreateSerializer,
    RegisterGrantDecideSerializer,
    RegisterGrantDecisionPreviewSerializer,
    RegisterGrantDecisionRequestSerializer,
    RegisterGrantSerializer,
)
from tokens.services.register_grants import (
    GRANTS,
    decide_grant,
    prepare_grant,
    preview_grant_decision,
)
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {"company": "company_id", "token": "token_id", "member": "member", "status": "status"}


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
            OpenApiParameter("member", OpenApiTypes.UUID),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class RegisterGrantViewSet(RegisterProposalViewSet):
    queryset = RegisterGrant.objects.none()
    serializer_class = RegisterGrantSerializer
    scoped_model = RegisterGrant
    operator_actions = RegisterProposalViewSet.operator_actions | {
        "create",
        "terms_file",
        "acceptance_file",
        "decision_preview",
        "decide",
    }
    operator_actions_because = (
        "Retained non-paid grants and private files are read only through this request's exact-company register "
        "queryset. Bounded preparation and decisions check current company appointments under the company lock; "
        "the operator connection performs the exact approved ledger effect and reads append-only decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, GRANTS.approved_function)

    def _respond(self, grant, status=200):
        current = with_decisions(self.get_queryset(), GRANTS.approved_function).get(pk=grant.pk)
        return Response(RegisterGrantSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterGrantCreateSerializer, responses={201: RegisterGrantSerializer, 200: RegisterGrantSerializer}
    )
    def create(self, request):
        serializer = RegisterGrantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grant, created = prepare_grant(actor=request.user, **serializer.validated_data)
        return self._respond(grant, 201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="terms-file")
    def terms_file(self, request, uuid=None):
        grant = self.get_object()
        return stream_stored_file(grant.terms_file, grant.terms_snapshot["mime_type"], as_attachment=True)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="acceptance-file")
    def acceptance_file(self, request, uuid=None):
        grant = self.get_object()
        if not grant.acceptance_required:
            raise NotFound("This grant's terms require no acceptance document.")
        return stream_stored_file(grant.acceptance_file, grant.acceptance_snapshot["mime_type"], as_attachment=True)

    @extend_schema(request=RegisterGrantDecisionRequestSerializer, responses=RegisterGrantDecisionPreviewSerializer)
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterGrantDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, preview = preview_grant_decision(actor=request.user, grant_id=uuid, **serializer.validated_data)
        return Response(RegisterGrantDecisionPreviewSerializer(preview).data)

    @extend_schema(request=RegisterGrantDecideSerializer, responses=RegisterGrantSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterGrantDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_grant(actor=request.user, grant_id=uuid, **serializer.validated_data))
