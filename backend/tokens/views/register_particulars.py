from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.response import Response

from tokens.models import RegisterParticularsChange
from tokens.serializers.register_particulars import (
    RegisterParticularsChangeCreateSerializer,
    RegisterParticularsChangeSerializer,
)
from tokens.services.register_particulars import edit_particulars
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {"company": "company_id", "member": "member_id", "status": "status"}
APPROVED = "tokens_register_particulars_approved"


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("member", OpenApiTypes.UUID),
            OpenApiParameter("status", str, enum=["submitted", "applied", "rejected"]),
        ]
    )
)
class RegisterParticularsChangeViewSet(RegisterProposalViewSet):
    queryset = RegisterParticularsChange.objects.none()
    serializer_class = RegisterParticularsChangeSerializer
    scoped_model = RegisterParticularsChange
    operator_actions = RegisterProposalViewSet.operator_actions | {"create"}
    operator_actions_because = (
        "Retained particulars change reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every change and file to those companies. "
        "An edit runs the bounded company register command, which checks the caller's current appointment under the "
        "company lock, and its response reads the operator-only decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, APPROVED)

    @extend_schema(
        request=RegisterParticularsChangeCreateSerializer,
        responses={201: RegisterParticularsChangeSerializer, 200: RegisterParticularsChangeSerializer},
    )
    def create(self, request):
        serializer = RegisterParticularsChangeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change, created = edit_particulars(actor=request.user, **serializer.validated_data)
        current = with_decisions(self.get_queryset(), APPROVED).get(pk=change.pk)
        return Response(RegisterParticularsChangeSerializer(current).data, status=201 if created else 200)
