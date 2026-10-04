from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from companies.models import CompanyAppointment, CompanyTeamInvitation
from companies.serializers.team import (
    CompanyAppointmentRevokeSerializer,
    CompanyTeamAppointmentSerializer,
    CompanyTeamInvitationAcceptSerializer,
    CompanyTeamInvitationCreateSerializer,
    CompanyTeamInvitationIssuedSerializer,
    CompanyTeamInvitationSerializer,
    CompanyTeamQuerySerializer,
    OwnCompanyAppointmentSerializer,
)
from companies.services.authority_requests import _require_requester
from companies.services.team import (
    accept_team_invitation,
    company_team,
    issue_team_invitation,
    revoke_company_appointment,
)
from shared.views import AuthenticatedGenericViewSet


class CompanyTeamInvitationViewSet(mixins.ListModelMixin, AuthenticatedGenericViewSet):
    queryset = CompanyTeamInvitation.objects.none()
    serializer_class = CompanyTeamInvitationSerializer
    scoped_model = CompanyTeamInvitation
    http_method_names = ["get", "post", "head", "options"]
    operator_actions = frozenset({"list"})
    operator_actions_because = (
        "The inviter-private list loads acceptance timestamps through appointee-private appointments; "
        "its queryset always binds the authenticated inviter and returns no appointee identity or evidence."
    )

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_requester(request.user)

    def narrow(self, queryset):
        return queryset.filter(inviter=self.request.user).select_related("appointment")

    def get_serializer_class(self):
        if self.action == "create":
            return CompanyTeamInvitationCreateSerializer
        if self.action == "accept":
            return CompanyTeamInvitationAcceptSerializer
        return self.serializer_class

    @extend_schema(responses={201: CompanyTeamInvitationIssuedSerializer, 200: CompanyTeamInvitationIssuedSerializer})
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invitation, code, created = issue_team_invitation(
            requester=request.user,
            company_id=data["company"],
            inviter_appointment_id=data["inviter_appointment"],
            **{key: value for key, value in data.items() if key not in ("company", "inviter_appointment")}
        )
        response = CompanyTeamInvitationSerializer(invitation, context=self.get_serializer_context()).data
        response = Response(
            {**response, "code": code}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=CompanyTeamInvitationAcceptSerializer, responses={200: OwnCompanyAppointmentSerializer})
    @action(detail=False, methods=["post"])
    def accept(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appointment = accept_team_invitation(requester=request.user, **serializer.validated_data)
        return Response(OwnCompanyAppointmentSerializer(appointment, context=self.get_serializer_context()).data)


class CompanyAppointmentViewSet(mixins.ListModelMixin, AuthenticatedGenericViewSet):
    queryset = CompanyAppointment.objects.none()
    serializer_class = OwnCompanyAppointmentSerializer
    scoped_model = CompanyAppointment
    lookup_field = "uuid"
    http_method_names = ["get", "post", "head", "options"]
    operator_actions = frozenset({"list", "team", "revoke"})
    operator_actions_because = (
        "Own appointment lists bind the appointee before loading company names. Team reads and revocation "
        "services require current administration of the exact company or the target's own appointee."
    )

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require_requester(request.user)

    def narrow(self, queryset):
        return (
            queryset.filter(appointee=self.request.user)
            .select_related("appointee", "company", "revocation")
            .order_by("-created_at", "-uuid")
        )

    def get_serializer_class(self):
        if self.action == "revoke":
            return CompanyAppointmentRevokeSerializer
        if self.action == "team":
            return CompanyTeamAppointmentSerializer
        return self.serializer_class

    @extend_schema(
        filters=False,
        parameters=[CompanyTeamQuerySerializer],
        responses={200: CompanyTeamAppointmentSerializer(many=True)},
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def team(self, request):
        query = CompanyTeamQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        appointments = company_team(requester=request.user, company_id=query.validated_data["company"])
        return Response(self.get_serializer(appointments, many=True).data)

    @extend_schema(request=CompanyAppointmentRevokeSerializer, responses={200: OwnCompanyAppointmentSerializer})
    @action(detail=True, methods=["post"])
    def revoke(self, request, uuid=None):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appointment = revoke_company_appointment(requester=request.user, appointment_id=uuid)
        return Response(OwnCompanyAppointmentSerializer(appointment, context=self.get_serializer_context()).data)
