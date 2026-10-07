from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet
from tokens.views.register_proposal import with_decisions
from whitelist.company_serializers import (
    CompanyWalletInstructionCreateSerializer,
    CompanyWalletInstructionDecideSerializer,
    CompanyWalletInstructionDecisionPreviewSerializer,
    CompanyWalletInstructionDecisionRequestSerializer,
    CompanyWalletInstructionSerializer,
    CompanyWalletNominationSerializer,
    CompanyWalletTargetSerializer,
    WalletNominationCreateSerializer,
    WalletNominationPreviewResultSerializer,
    WalletNominationPreviewSerializer,
    WalletNominationSerializer,
)
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistChange,
)
from whitelist.services.company_wallet_instructions import (
    WALLET_INSTRUCTIONS,
    decide_wallet_instruction,
    prepare_wallet_instruction,
    preview_wallet_instruction_decision,
)
from whitelist.services.wallet_nominations import (
    nominate_wallet,
    preview_wallet_nomination,
)


@extend_schema_view(
    list=extend_schema(
        parameters=[OpenApiParameter("request", OpenApiTypes.UUID), OpenApiParameter("company", OpenApiTypes.UUID)]
    )
)
class WalletNominationViewSet(AuthenticatedReadOnlyViewSet):
    queryset = CompanyWalletNomination.objects.none()
    serializer_class = WalletNominationSerializer
    scoped_model = CompanyWalletNomination
    operator_actions = frozenset({"list", "retrieve", "preview", "create"})
    operator_actions_because = (
        "Private proof associations are consumed only by the actual participant's own eligibility request; "
        "the response shares only the selected wallet facts."
    )
    http_method_names = ["get", "post", "head", "options"]
    ordering = ["-submitted_at", "-uuid"]

    def narrow(self, queryset):
        return queryset.owned_by(self.request.user).select_related("company", "request__user_account", "decision")

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name in ("request", "company"):
            if value := self.request.query_params.get(name):
                queryset = queryset.filter(**{f"{name}_id": value})
        return queryset

    @extend_schema(request=WalletNominationPreviewSerializer, responses=WalletNominationPreviewResultSerializer)
    @action(detail=False, methods=["post"])
    def preview(self, request):
        serializer = WalletNominationPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = preview_wallet_nomination(actor=request.user, **serializer.validated_data)
        return Response(WalletNominationPreviewResultSerializer(result).data)

    @extend_schema(
        request=WalletNominationCreateSerializer,
        responses={201: WalletNominationSerializer, 200: WalletNominationSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = WalletNominationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result, created = nominate_wallet(actor=request.user, **serializer.validated_data)
        return Response(WalletNominationSerializer(result).data, status=201 if created else 200)


class CompanyWalletNominationViewSet(AuthenticatedReadOnlyViewSet):
    queryset = CompanyWalletNomination.objects.none()
    serializer_class = CompanyWalletNominationSerializer
    scoped_model = CompanyWalletNomination
    operator_actions = frozenset({"list", "retrieve"})
    operator_actions_because = (
        "Current personal company register readers receive only explicitly nominated address "
        "and eligibility/proof completion facts; no account-wide wallet directory or proof bytes are read."
    )
    http_method_names = ["get", "head", "options"]
    ordering = ["-submitted_at", "-uuid"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user).select_related(
            "company", "request__user_account", "decision"
        )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name in ("company", "request"):
            if value := self.request.query_params.get(name):
                queryset = queryset.filter(**{f"{name}_id": value})
        return queryset

    @extend_schema(
        parameters=[OpenApiParameter("company", OpenApiTypes.UUID), OpenApiParameter("request", OpenApiTypes.UUID)]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("action", str, enum=["add", "remove"]),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class CompanyWalletInstructionViewSet(AuthenticatedReadOnlyViewSet):
    queryset = CompanyWalletInstruction.objects.none()
    serializer_class = CompanyWalletInstructionSerializer
    scoped_model = CompanyWalletInstruction
    operator_actions = frozenset({"list", "retrieve", "create", "decision_preview", "decide"})
    operator_actions_because = (
        "Company wallet instructions retain private exact sources and outgoing associations; "
        "preparation and decisions require personal company capabilities "
        "and every fresh signature checks the original current source."
    )
    http_method_names = ["get", "post", "head", "options"]
    ordering = ["-created_at", "-uuid"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name in ("company", "action", "status"):
            if value := self.request.query_params.get(name):
                queryset = queryset.filter(**{f"{name}_id" if name == "company" else name: value})
        return with_decisions(queryset, WALLET_INSTRUCTIONS.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), WALLET_INSTRUCTIONS.approved_function).get(pk=proposal.pk)
        return Response(CompanyWalletInstructionSerializer(current).data, status=status)

    @extend_schema(
        request=CompanyWalletInstructionCreateSerializer, responses={201: CompanyWalletInstructionSerializer}
    )
    def create(self, request, *args, **kwargs):
        serializer = CompanyWalletInstructionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_wallet_instruction(actor=request.user, **serializer.validated_data), status=201)

    @extend_schema(
        request=CompanyWalletInstructionDecisionRequestSerializer,
        responses=CompanyWalletInstructionDecisionPreviewSerializer,
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = CompanyWalletInstructionDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, result = preview_wallet_instruction_decision(
            actor=request.user, instruction_id=uuid, **serializer.validated_data
        )
        return Response(CompanyWalletInstructionDecisionPreviewSerializer(result).data)

    @extend_schema(request=CompanyWalletInstructionDecideSerializer, responses=CompanyWalletInstructionSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = CompanyWalletInstructionDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(
            decide_wallet_instruction(actor=request.user, instruction_id=uuid, **serializer.validated_data)
        )


class CompanyWalletTargetViewSet(AuthenticatedReadOnlyViewSet):
    queryset = WhitelistChange.objects.none()
    serializer_class = CompanyWalletTargetSerializer
    scoped_model = WhitelistChange
    operator_actions = frozenset({"list", "retrieve"})
    operator_actions_because = (
        "Only retained confirmed or observed ADD targets for a current exact-company register reader are exposed; "
        "wallet deletion does not erase the immutable removal target."
    )
    http_method_names = ["get", "head", "options"]
    ordering = ["-created_at", "-uuid"]

    def narrow(self, queryset):
        return queryset.company_targets(self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        if value := self.request.query_params.get("company"):
            queryset = queryset.filter(company_id=value)
        return queryset

    @extend_schema(parameters=[OpenApiParameter("company", OpenApiTypes.UUID)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)
