from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import (
    RegisterAward,
    RegisterAwardEnd,
    RegisterAwardVesting,
    RegisterAwardVestingReversal,
)
from tokens.serializers.register_award import (
    RegisterAwardCreateSerializer,
    RegisterAwardEndCreateSerializer,
    RegisterAwardEndSerializer,
    RegisterAwardSerializer,
    RegisterAwardVestingCreateSerializer,
    RegisterAwardVestingReversalCreateSerializer,
    RegisterAwardVestingReversalSerializer,
    RegisterAwardVestingSerializer,
)
from tokens.services.register_awards import (
    record_award,
    record_award_end,
    record_award_vesting,
    record_award_vesting_reversal,
)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
            OpenApiParameter("member", OpenApiTypes.UUID),
        ]
    )
)
class RegisterAwardViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterAward.objects.none()
    serializer_class = RegisterAwardSerializer
    scoped_model = RegisterAward
    operator_actions = frozenset({"list", "retrieve", "create", "file"})
    operator_actions_because = (
        "Private promised employee agreements are read only through current exact-company register appointments. "
        "The bounded durable producer checks current personal preparation authority and retains immutable evidence."
    )
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.readable_by(self.request.user).select_related("preparing_appointment__appointee_profile")

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in {"company": "company_id", "token": "token_id", "member": "member"}.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    @extend_schema(
        request=RegisterAwardCreateSerializer, responses={201: RegisterAwardSerializer, 200: RegisterAwardSerializer}
    )
    def create(self, request):
        serializer = RegisterAwardCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        award, created = record_award(actor=request.user, **serializer.validated_data)
        current = self.get_queryset().get(pk=award.pk)
        return Response(RegisterAwardSerializer(current).data, status=201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        award = self.get_object()
        response = stream_stored_file(award.file, award.agreement_snapshot["mime_type"], as_attachment=True)
        try:
            self.get_object()
        except BaseException:
            response.close()
            raise
        return response


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("award", OpenApiTypes.UUID),
        ]
    )
)
class RegisterAwardVestingViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterAwardVesting.objects.none()
    serializer_class = RegisterAwardVestingSerializer
    scoped_model = RegisterAwardVesting
    operator_actions = frozenset({"list", "retrieve", "create", "file"})
    operator_actions_because = (
        "Private company-confirmed vesting facts and files require current exact-company register appointments. "
        "The durable preparation producer serializes against the award and retains attributable evidence."
    )
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.readable_by(self.request.user).select_related("preparing_appointment__appointee_profile")

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name, field in {"company": "company_id", "award": "award_id"}.items():
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset

    @extend_schema(
        request=RegisterAwardVestingCreateSerializer,
        responses={201: RegisterAwardVestingSerializer, 200: RegisterAwardVestingSerializer},
    )
    def create(self, request):
        serializer = RegisterAwardVestingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vesting, created = record_award_vesting(actor=request.user, **serializer.validated_data)
        current = self.get_queryset().get(pk=vesting.pk)
        return Response(RegisterAwardVestingSerializer(current).data, status=201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        vesting = self.get_object()
        response = stream_stored_file(vesting.file, vesting.evidence_snapshot["mime_type"], as_attachment=True)
        try:
            self.get_object()
        except BaseException:
            response.close()
            raise
        return response


@extend_schema_view(
    list=extend_schema(
        parameters=[OpenApiParameter("company", OpenApiTypes.UUID), OpenApiParameter("award", OpenApiTypes.UUID)]
    )
)
class RegisterAwardEndViewSet(RegisterAwardVestingViewSet):
    queryset = RegisterAwardEnd.objects.none()
    serializer_class = RegisterAwardEndSerializer
    scoped_model = RegisterAwardEnd
    operator_actions_because = (
        "Append-only entitlement facts and private evidence require current exact-company register appointments. "
        "The bounded preparation producer locks the award and rechecks quantities, dates and commit-time authority."
    )

    @extend_schema(
        request=RegisterAwardEndCreateSerializer,
        responses={201: RegisterAwardEndSerializer, 200: RegisterAwardEndSerializer},
    )
    def create(self, request):
        serializer = RegisterAwardEndCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fact, created = record_award_end(actor=request.user, **serializer.validated_data)
        current = self.get_queryset().get(pk=fact.pk)
        return Response(RegisterAwardEndSerializer(current).data, status=201 if created else 200)


@extend_schema_view(
    list=extend_schema(
        parameters=[OpenApiParameter("company", OpenApiTypes.UUID), OpenApiParameter("award", OpenApiTypes.UUID)]
    )
)
class RegisterAwardVestingReversalViewSet(RegisterAwardVestingViewSet):
    queryset = RegisterAwardVestingReversal.objects.none()
    serializer_class = RegisterAwardVestingReversalSerializer
    scoped_model = RegisterAwardVestingReversal
    operator_actions_because = (
        "Append-only entitlement facts and private evidence require current exact-company register appointments. "
        "The bounded preparation producer locks the award and rechecks quantities, dates and commit-time authority."
    )

    @extend_schema(
        request=RegisterAwardVestingReversalCreateSerializer,
        responses={201: RegisterAwardVestingReversalSerializer, 200: RegisterAwardVestingReversalSerializer},
    )
    def create(self, request):
        serializer = RegisterAwardVestingReversalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fact, created = record_award_vesting_reversal(actor=request.user, **serializer.validated_data)
        current = self.get_queryset().get(pk=fact.pk)
        return Response(RegisterAwardVestingReversalSerializer(current).data, status=201 if created else 200)
