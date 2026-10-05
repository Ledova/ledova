from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from shared.views import stream_stored_file
from tokens.models import RegisterImport
from tokens.serializers.register_import import (
    RegisterImportCreateSerializer,
    RegisterImportDecideSerializer,
    RegisterImportDecisionPreviewSerializer,
    RegisterImportDecisionRequestSerializer,
    RegisterImportSerializer,
)
from tokens.services.register_imports import (
    decide_import,
    prepare_import,
    preview_import_decision,
)
from tokens.views.register_proposal import RegisterProposalViewSet

FILTERS = {"company": "company_id", "token": "token_id", "status": "status"}


class RegisterImportViewSet(RegisterProposalViewSet):
    queryset = RegisterImport.objects.none()
    serializer_class = RegisterImportSerializer
    scoped_model = RegisterImport
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "asic_file", "decision_preview", "decide"}
    operator_actions_because = (
        "Retained import reads require this request's company owner or a current appointment holding "
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
        return queryset.select_related("preparing_appointment__appointee_profile").prefetch_related(
            "decisions__appointment__appointee_profile"
        )

    def _respond(self, proposal, status=200):
        current = self.filter_queryset(self.get_queryset()).get(pk=proposal.pk)
        return Response(RegisterImportSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterImportCreateSerializer,
        responses={201: RegisterImportSerializer, 200: RegisterImportSerializer},
    )
    def create(self, request):
        serializer = RegisterImportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal, created = prepare_import(actor=request.user, **serializer.validated_data)
        return self._respond(proposal, 201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="asic-file")
    def asic_file(self, request, uuid=None):
        proposal = self.get_object()
        if not proposal.asic_file:
            raise NotFound("This import keeps no ASIC extract copy.")
        return stream_stored_file(proposal.asic_file, proposal.asic_snapshot["mime_type"], as_attachment=True)

    @extend_schema(request=RegisterImportDecisionRequestSerializer, responses=RegisterImportDecisionPreviewSerializer)
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterImportDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, preview = preview_import_decision(actor=request.user, import_id=uuid, **serializer.validated_data)
        return Response(RegisterImportDecisionPreviewSerializer(preview).data)

    @extend_schema(request=RegisterImportDecideSerializer, responses=RegisterImportSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterImportDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_import(actor=request.user, import_id=uuid, **serializer.validated_data))
