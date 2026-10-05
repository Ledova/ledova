from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from tokens.models import RegisterParticularsChange
from tokens.serializers.register_particulars import (
    RegisterParticularsChangeCreateSerializer,
    RegisterParticularsChangeDecideSerializer,
    RegisterParticularsChangeDecisionPreviewSerializer,
    RegisterParticularsChangeDecisionRequestSerializer,
    RegisterParticularsChangeSerializer,
)
from tokens.services.register_particulars import (
    PARTICULARS,
    decide_particulars_change,
    prepare_particulars_change,
    preview_particulars_decision,
)
from tokens.views.register_proposal import RegisterProposalViewSet, with_decisions

FILTERS = {"company": "company_id", "member": "member_id", "status": "status"}


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
    operator_actions = RegisterProposalViewSet.operator_actions | {"create", "decision_preview", "decide"}
    operator_actions_because = (
        "Retained particulars change reads require this request's company owner or a current appointment holding "
        "administration or a register capability. The queryset binds every change and file to those companies. "
        "Preparation, previews and decisions run the bounded company register command, which checks the caller's "
        "current appointment under the company lock, and their responses read the operator-only decisions."
    )

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in FILTERS.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return with_decisions(queryset, PARTICULARS.approved_function)

    def _respond(self, change, status=200):
        current = with_decisions(self.get_queryset(), PARTICULARS.approved_function).get(pk=change.pk)
        return Response(RegisterParticularsChangeSerializer(current).data, status=status)

    @extend_schema(
        request=RegisterParticularsChangeCreateSerializer,
        responses={201: RegisterParticularsChangeSerializer, 200: RegisterParticularsChangeSerializer},
    )
    def create(self, request):
        serializer = RegisterParticularsChangeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change, created = prepare_particulars_change(actor=request.user, **serializer.validated_data)
        return self._respond(change, 201 if created else 200)

    @extend_schema(
        request=RegisterParticularsChangeDecisionRequestSerializer,
        responses=RegisterParticularsChangeDecisionPreviewSerializer,
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, uuid=None):
        serializer = RegisterParticularsChangeDecisionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, preview = preview_particulars_decision(actor=request.user, change_id=uuid, **serializer.validated_data)
        return Response(RegisterParticularsChangeDecisionPreviewSerializer(preview).data)

    @extend_schema(request=RegisterParticularsChangeDecideSerializer, responses=RegisterParticularsChangeSerializer)
    @action(detail=True, methods=["post"])
    def decide(self, request, uuid=None):
        serializer = RegisterParticularsChangeDecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._respond(decide_particulars_change(actor=request.user, change_id=uuid, **serializer.validated_data))
