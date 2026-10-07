from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet
from tokens.models import RegisterDeployment
from tokens.serializers.register_deployment import (
    RegisterDeploymentCreateSerializer,
    RegisterDeploymentDecideSerializer,
    RegisterDeploymentDecisionPreviewSerializer,
    RegisterDeploymentDecisionRequestSerializer,
    RegisterDeploymentSerializer,
)
from tokens.services.register_deployments import (
    DEPLOYMENTS,
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
)
from tokens.views.register_proposal import with_decisions

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
class RegisterDeploymentViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterDeployment.objects.none()
    serializer_class = RegisterDeploymentSerializer
    scoped_model = RegisterDeployment
    operator_actions = frozenset({"list", "retrieve", "create", "decision_preview", "decide"})
    operator_actions_because = (
        "Private immutable deployment sources and decisions are served only through exact-company register reads. "
        "Bounded preparation and decisions require personal company appointments and retain the original "
        "approved deployment; the technical worker independently checks its source before fresh signing."
    )
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, DEPLOYMENTS.approved_function)

    def _respond(self, proposal, status=200):
        current = with_decisions(self.get_queryset(), DEPLOYMENTS.approved_function).get(pk=proposal.pk)
        return Response(RegisterDeploymentSerializer(current).data, status=status)

    @extend_schema(request=RegisterDeploymentCreateSerializer, responses={201: RegisterDeploymentSerializer})
    def create(self, request, *args, **kwargs):
        serializer = RegisterDeploymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(prepare_deployment(actor=request.user, **serializer.validated_data), status=201)

    @extend_schema(
        request=RegisterDeploymentDecisionRequestSerializer, responses=RegisterDeploymentDecisionPreviewSerializer
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterDeploymentDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, prepared = preview_deployment_decision(actor=request.user, deployment_id=uuid, **serializer.validated_data)
        return Response(RegisterDeploymentDecisionPreviewSerializer(prepared).data)

    @extend_schema(request=RegisterDeploymentDecideSerializer, responses=RegisterDeploymentSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterDeploymentDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_deployment(actor=request.user, deployment_id=uuid, **serializer.validated_data))
