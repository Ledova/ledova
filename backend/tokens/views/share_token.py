import csv

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from companies.models import Company
from shared.views import AuthenticatedModelViewSet
from tokens.filters import ShareTokenFilter
from tokens.models import ShareIssuance, ShareToken
from tokens.serializers import (
    FormerMemberSerializer,
    ShareIssuanceCreateSerializer,
    ShareIssuanceListSerializer,
    ShareIssuanceRequestSerializer,
    ShareRegisterHolderSerializer,
    ShareTokenCreateSerializer,
    ShareTokenDetailSerializer,
    ShareTokenListSerializer,
)
from tokens.serializers.pause_change import (
    PauseSubmissionRequestSerializer,
    PauseSubmissionResponseSerializer,
)
from tokens.services import deployment, pause_changes, share_token_service
from tokens.services.former_holders import fold_is_stale, former_members_of
from tokens.services.register import (
    REGISTER_HEADERS,
    api_holders,
    export_rows,
    token_register,
)
from tokens.services.share_token_service import delete_share_token


class ShareTokenViewSet(AuthenticatedModelViewSet):
    filterset_class = ShareTokenFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "name", "symbol", "status", "token_type"]

    scoped_model = ShareToken
    operator_actions = frozenset({"holders", "register_export"})
    operator_actions_because = (
        "a members' register has to carry each holder's name and residential address, and those "
        "belong to the issuer's investors rather than to the issuer, so no policy admits them to the "
        "principal reading it. Without the operator connection the register does not fail - it prints "
        "'unidentified' and blank addresses, which is a legally wrong document produced confidently. "
        "The reader stays IsAuthenticated: an issuer is entitled to this and is not an administrator."
    )

    def get_serializer_class(self):
        if self.action == "create":
            return ShareTokenCreateSerializer
        if self.action == "list":
            return ShareTokenListSerializer
        return ShareTokenDetailSerializer

    def narrow(self, queryset):
        queryset = queryset.issued_by(self.request.user)
        return queryset.with_company()

    def perform_destroy(self, instance):
        delete_share_token(instance)

    def filter_queryset(self, queryset):
        if self.action == "list":
            return super().filter_queryset(queryset)
        return queryset

    @extend_schema(responses=ShareTokenDetailSerializer)
    def create(self, request, *args, **kwargs):
        if not Company.objects.owned_by(request.user).exists():
            raise PermissionDenied("You must be associated with a company to create tokens.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.save()
        return Response(ShareTokenDetailSerializer(token).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        responses=inline_serializer(
            name="TokenDeploymentStarted",
            fields={"message": serializers.CharField(), "token": ShareTokenDetailSerializer()},
        )
    )
    @action(detail=True, methods=["post"])
    def deploy(self, request, uuid=None):
        token = self.get_object()
        deployment.start_deployment(token, principal_id=request.user.pk)
        return Response({"message": "Token deployment initiated.", "token": ShareTokenDetailSerializer(token).data})

    @extend_schema(
        request=PauseSubmissionRequestSerializer,
        responses={200: PauseSubmissionResponseSerializer, 202: PauseSubmissionResponseSerializer},
    )
    @action(detail=True, methods=["post"])
    def pause(self, request, uuid=None):
        return self._submit_pause(request, True)

    @extend_schema(
        request=PauseSubmissionRequestSerializer,
        responses={200: PauseSubmissionResponseSerializer, 202: PauseSubmissionResponseSerializer},
    )
    @action(detail=True, methods=["post"])
    def unpause(self, request, uuid=None):
        return self._submit_pause(request, False)

    def _submit_pause(self, request, paused):
        token = self.get_object()
        serializer = PauseSubmissionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change = pause_changes.submit(token, request.user, serializer.validated_data["submission_id"], paused)
        return self._pause_response(token, change)

    def _pause_response(self, token, change):
        token.refresh_from_db()
        return Response(
            {
                "message": pause_changes.message(change),
                "token": ShareTokenDetailSerializer(token).data,
                "submission": pause_changes.outcome(change),
            },
            status=status.HTTP_200_OK if change.completed_at else status.HTTP_202_ACCEPTED,
        )

    @extend_schema(
        parameters=[OpenApiParameter("submission_id", OpenApiTypes.UUID, OpenApiParameter.PATH)],
        responses={200: PauseSubmissionResponseSerializer, 202: PauseSubmissionResponseSerializer},
    )
    @action(detail=True, methods=["get"], url_path="pause-submissions/(?P<submission_id>[^/.]+)")
    def pause_submission(self, request, uuid=None, submission_id=None):
        token = self.get_object()
        change = pause_changes.retrieve(token, request.user, submission_id)
        return self._pause_response(token, change)

    @extend_schema(
        request=ShareIssuanceCreateSerializer,
        responses={
            201: inline_serializer(
                name="ShareIssuanceRequested",
                fields={
                    "message": serializers.CharField(),
                    "token": ShareTokenDetailSerializer(),
                    "issuance_request": ShareIssuanceRequestSerializer(),
                },
            )
        },
    )
    @action(detail=True, methods=["post"])
    def issue(self, request, uuid=None):
        token = self.get_object()
        serializer = ShareIssuanceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issuance_request = share_token_service.create_issuance_request(
            token=token, user=request.user, **serializer.validated_data
        )
        return Response(
            {
                "message": "Share issuance request submitted for approval.",
                "token": ShareTokenDetailSerializer(token).data,
                "issuance_request": ShareIssuanceRequestSerializer(issuance_request).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        responses=ShareIssuanceListSerializer(many=True),
        filters=False,
        parameters=[OpenApiParameter("status", OpenApiTypes.STR, OpenApiParameter.QUERY)],
    )
    @action(detail=True, methods=["get"])
    def issuances(self, request, uuid=None):
        token = self.get_object()
        issuances = (
            ShareIssuance.objects.filter(token__in=ShareToken.objects.issued_by(request.user))
            .with_token()
            .with_initiated_by()
            .with_subscription()
            .filter_by_token(token)
        )
        if request.query_params.get("status"):
            issuances = issuances.filter(status=request.query_params["status"])
        page = self.paginate_queryset(issuances.order_by("-completed_at"))
        return self.get_paginated_response(ShareIssuanceListSerializer(page, many=True).data)

    @extend_schema(
        responses=inline_serializer(
            name="ShareRegister",
            fields={
                "token": inline_serializer(
                    name="ShareRegisterToken",
                    fields={
                        "uuid": serializers.UUIDField(),
                        "name": serializers.CharField(),
                        "symbol": serializers.CharField(),
                        "status": serializers.CharField(),
                        "total_supply": serializers.CharField(),
                    },
                ),
                "holders": ShareRegisterHolderSerializer(many=True),
                "total_holders": serializers.IntegerField(),
                "issued_supply": serializers.CharField(),
                "listed_total": serializers.CharField(),
                "discrepancy": serializers.CharField(),
                "former_members": FormerMemberSerializer(many=True),
                "former_members_as_at": serializers.DateTimeField(allow_null=True),
                "former_members_block": serializers.IntegerField(allow_null=True),
                "former_members_stale": serializers.BooleanField(),
            },
        )
    )
    @action(detail=True, methods=["get"])
    def holders(self, request, uuid=None):
        token = self.get_object()
        rows, discrepancy = token_register(token)
        listed = sum(int(row["balance"]) for row in rows)
        return Response(
            {
                "token": {
                    "uuid": str(token.uuid),
                    "name": token.name,
                    "symbol": token.symbol,
                    "status": token.status,
                    "total_supply": token.total_supply,
                },
                "holders": api_holders(rows),
                "total_holders": len(rows),
                "issued_supply": str(listed + discrepancy),
                "listed_total": str(listed),
                "discrepancy": str(discrepancy),
                "former_members": FormerMemberSerializer(former_members_of(token), many=True).data,
                "former_members_as_at": token.former_holders_folded_at,
                "former_members_block": token.former_holders_block,
                "former_members_stale": fold_is_stale(token),
            }
        )

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=True, methods=["get"], url_path="register/export")
    def register_export(self, request, uuid=None):
        token = self.get_object()
        rows = export_rows(token, request.user)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="register-{token.symbol}.csv"'
        writer = csv.writer(response)
        writer.writerow(REGISTER_HEADERS)
        for row in rows:
            writer.writerow(row)
        return response
