from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet
from tokens.models import RegisterReconciliation
from tokens.serializers.register_reconciliation import (
    RegisterAcknowledgeSerializer,
    RegisterReconciliationSerializer,
)
from tokens.services.register_reconciliation import acknowledge_discrepancy

FILTERS = {"company": "token__company_id", "token": "token_id"}


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
        ]
    )
)
class RegisterReconciliationViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterReconciliation.objects.none()
    serializer_class = RegisterReconciliationSerializer
    scoped_model = RegisterReconciliation
    operator_actions = frozenset({"list", "retrieve", "acknowledge"})
    operator_actions_because = (
        "Reconciliation reads require this request's company owner or a current appointment holding "
        "administration or a register capability, and the queryset binds every reconciliation to those "
        "companies through its share class. Acknowledgement runs the bounded company register command, which "
        "checks the caller's current appointment under the company lock. Every response reads the operator-only "
        "acknowledgements and the acknowledging appointee's name."
    )
    ordering = ["-created_at", "-uuid"]
    ordering_fields = ["created_at"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.register_readable_by(self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset.with_acknowledgements()

    def _respond(self, reconciliation_id, status):
        current = self.get_queryset().with_acknowledgements().get(pk=reconciliation_id)
        return Response(RegisterReconciliationSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterAcknowledgeSerializer,
        responses={201: RegisterReconciliationSerializer, 200: RegisterReconciliationSerializer},
    )
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, uuid=None):
        serializer = RegisterAcknowledgeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        acknowledgement, created = acknowledge_discrepancy(
            actor=request.user, reconciliation_id=uuid, **serializer.validated_data
        )
        return self._respond(acknowledgement.reconciliation_id, 201 if created else 200)
