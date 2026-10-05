from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterCorrection
from tokens.serializers.register_correction import (
    RegisterCorrectionCreateSerializer,
    RegisterCorrectionDecideSerializer,
    RegisterCorrectionDecisionPreviewSerializer,
    RegisterCorrectionDecisionRequestSerializer,
    RegisterCorrectionSerializer,
)
from tokens.services.register_corrections import (
    CORRECTIONS,
    decide_correction,
    prepare_correction,
    preview_correction_decision,
)
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {"company": "company_id", "register": "register_id", "status": "status"}


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("register", OpenApiTypes.UUID),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class RegisterCorrectionViewSet(RegisterProposalViewSet):
    queryset = RegisterCorrection.objects.none()
    serializer_class = RegisterCorrectionSerializer
    scoped_model = RegisterCorrection
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "decision_preview", "decide"}
    operator_actions_because = (
        "Retained correction reads require this request's company owner or a current appointment holding "
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
        return with_decisions(queryset, CORRECTIONS.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), CORRECTIONS.approved_function).get(pk=proposal.pk)
        return Response(RegisterCorrectionSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterCorrectionCreateSerializer,
        responses={201: RegisterCorrectionSerializer, 200: RegisterCorrectionSerializer},
    )
    def create(self, request):
        serializer = RegisterCorrectionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal, created = prepare_correction(actor=request.user, **serializer.validated_data)
        return self._respond(proposal, 201 if created else 200)

    @extend_schema(
        request=RegisterCorrectionDecisionRequestSerializer, responses=RegisterCorrectionDecisionPreviewSerializer
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterCorrectionDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, preview = preview_correction_decision(actor=request.user, correction_id=uuid, **serializer.validated_data)
        return Response(RegisterCorrectionDecisionPreviewSerializer(preview).data)

    @extend_schema(request=RegisterCorrectionDecideSerializer, responses=RegisterCorrectionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterCorrectionDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_correction(actor=request.user, correction_id=uuid, **serializer.validated_data))
