from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet
from tokens.models import (
    MemberAssociation,
    MemberCertificateRequest,
    MemberInvitation,
    MemberParticularsRequest,
)
from tokens.serializers import member_access as schema
from tokens.serializers.register_particulars import RegisterParticularsChangeSerializer
from tokens.services import member_access as service
from tokens.services.register_particulars import PARTICULARS
from tokens.views.register_proposal import with_decisions

FILTERS = [
    OpenApiParameter("company", OpenApiTypes.UUID),
    OpenApiParameter("member", OpenApiTypes.UUID),
    OpenApiParameter("association", OpenApiTypes.UUID),
]


class MemberAccessViewSet(AuthenticatedReadOnlyViewSet):
    abstract = True
    operator_actions = frozenset({"list", "retrieve", "create", "accept", "revoke", "entries", "prepare", "withdraw"})
    http_method_names = ["get", "post", "head", "options"]

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for field in ("company", "member", "association"):
            value = self.request.query_params.get(field)
            if value and field in {item.name for item in queryset.model._meta.fields}:
                queryset = queryset.filter(**{field: value})
        return queryset

    def body(self, serializer_class):
        serializer = serializer_class(data=self.request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


@extend_schema_view(list=extend_schema(parameters=FILTERS[:2]))
class MemberInvitationViewSet(MemberAccessViewSet):
    scoped_model = MemberInvitation
    queryset = MemberInvitation.objects.none()
    serializer_class = schema.MemberInvitationSerializer
    operator_actions_because = (
        "Member invitations are private company administration. Current personal ADMIN appointments scope every "
        "company read and issue; accepting a code verifies its intended email and the actual signed-in account "
        "under the company lock and database guards, and grants no company appointment."
    )

    def narrow(self, queryset):
        return service.company_readable(queryset.select_related("association"), self.request.user, admin=True)

    @extend_schema(
        request=schema.MemberInvitationCreateSerializer,
        responses={201: schema.MemberInvitationIssuedSerializer, 200: schema.MemberInvitationIssuedSerializer},
    )
    def create(self, request):
        invitation, code, created = service.issue_invitation(
            actor=request.user, **self.body(schema.MemberInvitationCreateSerializer)
        )
        invitation.code = code
        return Response(schema.MemberInvitationIssuedSerializer(invitation).data, status=201 if created else 200)

    @extend_schema(request=schema.MemberInvitationAcceptSerializer, responses=schema.MemberAssociationSerializer)
    @action(detail=False, methods=["post"])
    def accept(self, request):
        association = service.accept_invitation(
            actor=request.user, **self.body(schema.MemberInvitationAcceptSerializer)
        )
        return Response(schema.MemberAssociationSerializer(association).data)


@extend_schema_view(list=extend_schema(parameters=FILTERS[:2]))
class MemberAssociationViewSet(MemberAccessViewSet):
    scoped_model = MemberAssociation
    queryset = MemberAssociation.objects.none()
    serializer_class = schema.MemberAssociationSerializer
    operator_actions_because = (
        "Current personal ADMIN appointments read and revoke explicit company/member associations. The bounded "
        "command checks exact current administration, locks the company and retains immutable attribution; "
        "participant reads use the separate own-record projection."
    )

    def narrow(self, queryset):
        return service.company_readable(queryset, self.request.user, admin=True)

    @extend_schema(request=schema.MemberAssociationRevokeSerializer, responses=schema.MemberAssociationSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, uuid=None):
        self.get_object()
        association = service.revoke_association(
            actor=request.user, association_id=uuid, **self.body(schema.MemberAssociationRevokeSerializer)
        )
        return Response(schema.MemberAssociationSerializer(association).data)


class MemberRecordViewSet(MemberAccessViewSet):
    scoped_model = MemberAssociation
    queryset = MemberAssociation.objects.none()
    serializer_class = schema.MemberRecordSerializer
    operator_actions_because = (
        "A current explicit member association binds this signed-in user and actual owned account to one company "
        "and member. The operator projects only that member's own retained balances, deltas, awards and vesting; "
        "it exposes no counterparties, company totals, private authority files or appointment rights."
    )

    def narrow(self, queryset):
        return service.own_associations(queryset.select_related("company"), self.request.user)

    @extend_schema(responses=schema.MemberRecordSerializer(many=True))
    def list(self, request):
        rows = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(rows)
        items = rows if page is None else page
        data = schema.MemberRecordSerializer([service.own_record(item) for item in items], many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @extend_schema(responses=schema.MemberRecordSerializer)
    def retrieve(self, request, uuid=None):
        return Response(schema.MemberRecordSerializer(service.own_record(self.get_object())).data)

    @extend_schema(
        parameters=[OpenApiParameter("token", OpenApiTypes.UUID, required=True)],
        responses=schema.MemberRecordEntriesSerializer,
    )
    @action(detail=True, methods=["get"])
    def entries(self, request, uuid=None):
        from rest_framework import serializers

        token = serializers.UUIDField().run_validation(request.query_params.get("token"))
        return Response(schema.MemberRecordEntriesSerializer(service.own_entries(self.get_object(), token)).data)


@extend_schema_view(list=extend_schema(parameters=FILTERS))
class MemberParticularsRequestViewSet(MemberAccessViewSet):
    scoped_model = MemberParticularsRequest
    queryset = MemberParticularsRequest.objects.none()
    serializer_class = schema.MemberParticularsRequestSerializer
    operator_actions_because = (
        "Members submit immutable proposed particulars through their own current association; they cannot edit "
        "the register. Current exact-company personal register readers see the company queue. Preparation hands "
        "the attributable source into the existing evidence-backed company decision and application command."
    )

    def narrow(self, queryset):
        return service.request_readable(queryset.select_related("change"), self.request.user)

    @extend_schema(
        request=schema.MemberParticularsRequestCreateSerializer,
        responses={201: schema.MemberParticularsRequestSerializer, 200: schema.MemberParticularsRequestSerializer},
    )
    def create(self, request):
        source, created = service.request_particulars(
            actor=request.user, **self.body(schema.MemberParticularsRequestCreateSerializer)
        )
        return Response(schema.MemberParticularsRequestSerializer(source).data, status=201 if created else 200)

    @extend_schema(
        request=schema.MemberParticularsRequestPrepareSerializer,
        responses={201: RegisterParticularsChangeSerializer, 200: RegisterParticularsChangeSerializer},
    )
    @action(detail=True, methods=["post"])
    def prepare(self, request, uuid=None):
        change, created = service.prepare_requested_particulars(
            actor=request.user, request_id=uuid, **self.body(schema.MemberParticularsRequestPrepareSerializer)
        )
        current = with_decisions(
            service.requested_particulars_change(request.user, change.pk), PARTICULARS.approved_function
        ).get()
        return Response(RegisterParticularsChangeSerializer(current).data, status=201 if created else 200)


@extend_schema_view(list=extend_schema(parameters=FILTERS))
class MemberCertificateRequestViewSet(MemberAccessViewSet):
    scoped_model = MemberCertificateRequest
    queryset = MemberCertificateRequest.objects.none()
    serializer_class = schema.MemberCertificateRequestSerializer
    operator_actions_because = (
        "Own associated members request only genuine receiving ISSUE or TRANSFER effects; current personal "
        "company register appointments read that exact queue. Immutable requests and own withdrawals retain "
        "attribution and report their recorded state without promising an unavailable certificate output."
    )

    def narrow(self, queryset):
        return service.request_readable(queryset.select_related("withdrawal"), self.request.user)

    @extend_schema(
        request=schema.MemberCertificateRequestCreateSerializer,
        responses={201: schema.MemberCertificateRequestSerializer, 200: schema.MemberCertificateRequestSerializer},
    )
    def create(self, request):
        source, created = service.request_certificate(
            actor=request.user, **self.body(schema.MemberCertificateRequestCreateSerializer)
        )
        return Response(schema.MemberCertificateRequestSerializer(source).data, status=201 if created else 200)

    @extend_schema(
        request=schema.MemberCertificateWithdrawSerializer, responses=schema.MemberCertificateRequestSerializer
    )
    @action(detail=True, methods=["post"])
    def withdraw(self, request, uuid=None):
        source = service.withdraw_certificate(
            actor=request.user, request_id=uuid, **self.body(schema.MemberCertificateWithdrawSerializer)
        )
        return Response(schema.MemberCertificateRequestSerializer(source).data)
