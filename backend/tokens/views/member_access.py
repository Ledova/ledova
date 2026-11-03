from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet
from tokens.models import MemberAssociation, MemberInvitation
from tokens.serializers import member_access as schema
from tokens.services import member_access as service

FILTERS = [
    OpenApiParameter("company", OpenApiTypes.UUID),
    OpenApiParameter("member", OpenApiTypes.UUID),
]


class MemberAccessViewSet(AuthenticatedReadOnlyViewSet):
    abstract = True
    operator_actions = frozenset(
        {
            "list",
            "retrieve",
            "create",
            "accept",
            "send_email",
            "preview",
            "revoke",
            "entries",
        }
    )
    http_method_names = ["get", "post", "head", "options"]

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for field in ("company", "member"):
            value = self.request.query_params.get(field)
            if value and field in {item.name for item in queryset.model._meta.fields}:
                queryset = queryset.filter(**{field: value})
        return queryset

    def body(self, serializer_class):
        serializer = serializer_class(data=self.request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


@extend_schema_view(list=extend_schema(parameters=FILTERS))
class MemberInvitationViewSet(MemberAccessViewSet):
    scoped_model = MemberInvitation
    queryset = MemberInvitation.objects.none()
    serializer_class = schema.MemberInvitationSerializer
    operator_actions_because = (
        "Member invitations are private company administration. Current personal ADMIN appointments scope every "
        "company read, issue and email send; preview requires the verified intended recipient. Accepting the "
        "hidden credential checks its intended email and actual signed-in account under the company lock and "
        "database guards, and grants no company appointment."
    )

    def narrow(self, queryset):
        return service.company_administered(queryset.select_related("association"), self.request.user)

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

    @extend_schema(
        request=schema.MemberInvitationCreateSerializer,
        responses={201: schema.MemberInvitationEmailSerializer, 200: schema.MemberInvitationEmailSerializer},
    )
    @action(detail=False, methods=["post"], url_path="send-email")
    def send_email(self, request):
        invitation, created = service.send_invitation_email(
            actor=request.user, **self.body(schema.MemberInvitationCreateSerializer)
        )
        invitation.email_delivery = "accepted"
        return Response(schema.MemberInvitationEmailSerializer(invitation).data, status=201 if created else 200)

    @extend_schema(
        request=schema.MemberInvitationPreviewRequestSerializer, responses=schema.MemberInvitationPreviewSerializer
    )
    @action(detail=False, methods=["post"])
    def preview(self, request):
        invitation = service.preview_invitation(
            actor=request.user, **self.body(schema.MemberInvitationPreviewRequestSerializer)
        )
        response = Response(schema.MemberInvitationPreviewSerializer(invitation).data)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=schema.MemberInvitationAcceptSerializer, responses=schema.MemberAssociationSerializer)
    @action(detail=False, methods=["post"])
    def accept(self, request):
        association = service.accept_invitation(
            actor=request.user, **self.body(schema.MemberInvitationAcceptSerializer)
        )
        return Response(schema.MemberAssociationSerializer(association).data)


@extend_schema_view(list=extend_schema(parameters=FILTERS))
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
        return service.company_administered(queryset, self.request.user)

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
        "and member. The operator projects that member's own retained balances, deltas, awards and vesting. "
        "An explicit company choice adds aggregate ownership and the member's own class quantities within "
        "one revalidated snapshot, without counterparties, private authority files or appointment rights."
    )

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    def narrow(self, queryset):
        return service.own_associations(queryset.select_related("company"), self.request.user)

    @extend_schema(responses=schema.MemberRecordSerializer(many=True))
    def list(self, request):
        rows = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(rows)
        items = rows if page is None else page
        data = schema.MemberRecordSerializer(
            [service.own_record(item, actor=request.user) for item in items], many=True
        ).data
        return self.get_paginated_response(data) if page is not None else Response(data)

    @extend_schema(responses=schema.MemberRecordSerializer)
    def retrieve(self, request, uuid=None):
        return Response(schema.MemberRecordSerializer(service.own_record(self.get_object(), actor=request.user)).data)

    @extend_schema(
        parameters=[OpenApiParameter("token", OpenApiTypes.UUID, required=True)],
        responses=schema.MemberRecordEntriesSerializer,
    )
    @action(detail=True, methods=["get"])
    def entries(self, request, uuid=None):
        from rest_framework import serializers

        token = serializers.UUIDField().run_validation(request.query_params.get("token"))
        return Response(schema.MemberRecordEntriesSerializer(service.own_entries(self.get_object(), token)).data)
