from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import stream_stored_file
from tokens.models import RegisterTransfer
from tokens.serializers.register_transfer import (
    RegisterTransferCreateSerializer,
    RegisterTransferDecideSerializer,
    RegisterTransferDecisionPreviewSerializer,
    RegisterTransferDecisionRequestSerializer,
    RegisterTransferSerializer,
)
from tokens.services.register_transfers import (
    TRANSFERS,
    decide_transfer,
    prepare_transfer,
    preview_transfer_decision,
)
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {
    "company": "company_id",
    "token": "token_id",
    "from_member": "from_member",
    "to_member": "to_member",
    "status": "status",
}


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
            OpenApiParameter("from_member", OpenApiTypes.UUID),
            OpenApiParameter("to_member", OpenApiTypes.UUID),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class RegisterTransferViewSet(RegisterProposalViewSet):
    queryset = RegisterTransfer.objects.none()
    serializer_class = RegisterTransferSerializer
    scoped_model = RegisterTransfer
    operator_actions = RegisterProposalViewSet.operator_actions | {
        "create",
        "instrument_file",
        "decision_preview",
        "decide",
    }
    operator_actions_because = (
        "Retained direct transfers and private files are read only through the exact-company register queryset. "
        "Bounded preparation and decisions check current company appointments under the company lock; "
        "the operator connection performs the exact approved ledger effect and reads append-only decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset.select_related("register_entry"), TRANSFERS.approved_function)

    def _respond(self, transfer, status=200):
        current = (
            with_decisions(self.get_queryset(), TRANSFERS.approved_function)
            .select_related("register_entry")
            .get(pk=transfer.pk)
        )
        return Response(RegisterTransferSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterTransferCreateSerializer,
        responses={201: RegisterTransferSerializer, 200: RegisterTransferSerializer},
    )
    def create(self, request):
        serializer = RegisterTransferCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transfer, created = prepare_transfer(actor=request.user, **serializer.validated_data)
        return self._respond(transfer, 201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path="instrument-file")
    def instrument_file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(
            proposal.instrument_file, proposal.instrument_snapshot["mime_type"], as_attachment=True
        )

    @extend_schema(
        request=RegisterTransferDecisionRequestSerializer, responses=RegisterTransferDecisionPreviewSerializer
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterTransferDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, data = preview_transfer_decision(actor=request.user, transfer_id=uuid, **serializer.validated_data)
        return Response(RegisterTransferDecisionPreviewSerializer(data).data)

    @extend_schema(request=RegisterTransferDecideSerializer, responses=RegisterTransferSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterTransferDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_transfer(actor=request.user, transfer_id=uuid, **serializer.validated_data))
