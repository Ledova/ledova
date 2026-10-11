from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import stream_stored_file
from tokens.models import RegisterAllotment
from tokens.serializers.register_allotment import (
    RegisterAllotmentCreateSerializer,
    RegisterAllotmentDecideSerializer,
    RegisterAllotmentDecisionPreviewSerializer,
    RegisterAllotmentDecisionRequestSerializer,
    RegisterAllotmentSerializer,
)
from tokens.services.register_allotments import (
    ALLOTMENTS,
    decide_allotment,
    prepare_allotment,
    preview_allotment_decision,
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
class RegisterAllotmentViewSet(RegisterProposalViewSet):
    queryset = RegisterAllotment.objects.none()
    serializer_class = RegisterAllotmentSerializer
    scoped_model = RegisterAllotment
    operator_actions = RegisterProposalViewSet.operator_actions | {
        "create",
        "agreement_file",
        "receipt_file",
        "decision_preview",
        "decide",
    }
    operator_actions_because = (
        "Private external agreements, company receipt attestations and allotted capital are read only through "
        "current personal appointments for this exact company. Preparation and exact decisions lock the company; "
        "the operator records the sole approved ISSUE and retains append-only sources and decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset.select_related("agreement", "contribution"), ALLOTMENTS.approved_function)

    def _respond(self, allotment, status=200):
        current = with_decisions(self.get_queryset(), ALLOTMENTS.approved_function).get(pk=allotment.pk)
        return Response(RegisterAllotmentSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterAllotmentCreateSerializer,
        responses={201: RegisterAllotmentSerializer, 200: RegisterAllotmentSerializer},
    )
    def create(self, request):
        serializer = RegisterAllotmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        allotment, created = prepare_allotment(actor=request.user, **serializer.validated_data)
        return self._respond(allotment, 201 if created else 200)

    def _private_file(self, allotment, source):
        response = stream_stored_file(source.file, source.evidence_snapshot["mime_type"], as_attachment=True)
        try:
            self.get_object()
        except BaseException:
            response.close()
            raise
        return response

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        allotment = self.get_object()
        return self._private_file(allotment, allotment)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="agreement-file")
    def agreement_file(self, request, uuid=None):
        allotment = self.get_object()
        return self._private_file(allotment, allotment.agreement)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="receipt-file")
    def receipt_file(self, request, uuid=None):
        allotment = self.get_object()
        return self._private_file(allotment, allotment.contribution)

    @extend_schema(
        request=RegisterAllotmentDecisionRequestSerializer, responses=RegisterAllotmentDecisionPreviewSerializer
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterAllotmentDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, result = preview_allotment_decision(actor=request.user, allotment_id=uuid, **serializer.validated_data)
        return Response(RegisterAllotmentDecisionPreviewSerializer(result).data)

    @extend_schema(request=RegisterAllotmentDecideSerializer, responses=RegisterAllotmentSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterAllotmentDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_allotment(actor=request.user, allotment_id=uuid, **serializer.validated_data))
