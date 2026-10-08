import csv
from uuid import UUID

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from companies.models import Company
from shared.views import AuthenticatedGenericViewSet
from tokens.filters import ShareTokenFilter
from tokens.models import ShareIssuance, ShareToken
from tokens.serializers import (
    FormerMemberSerializer,
    ShareIssuanceListSerializer,
    ShareRegisterEntrySerializer,
    ShareRegisterHolderSerializer,
    ShareRegisterWaitingEffectSerializer,
    ShareTokenCreateSerializer,
    ShareTokenDetailSerializer,
    ShareTokenListSerializer,
)
from tokens.serializers.pause_change import (
    PauseSubmissionRequestSerializer,
    PauseSubmissionResponseSerializer,
)
from tokens.serializers.register_opening import RegisterOpeningHoldersSerializer
from tokens.serializers.register_transfer import RegisterMembersSerializer
from tokens.services import pause_changes
from tokens.services.former_holders import fold_is_stale, former_members_of
from tokens.services.register import (
    REGISTER_HEADERS,
    api_holders,
    export_rows,
    stored_entries,
    stored_register,
    stored_waiting_list,
)
from tokens.services.register_openings import opening_holders
from tokens.services.register_transfers import register_members


class ShareTokenViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, AuthenticatedGenericViewSet
):
    lookup_field = "uuid"
    filterset_class = ShareTokenFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "name", "symbol", "status", "token_type"]

    scoped_model = ShareToken
    operator_actions = frozenset(
        {
            "create",
            "list",
            "retrieve",
            "pause",
            "unpause",
            "pause_submission",
            "issuances",
            "holders",
            "register",
            "register_entries",
            "register_export",
            "register_opening_holders",
            "register_waiting",
            "register_members",
        }
    )
    operator_actions_because = (
        "Share-class creation and owned reads keep their exact current-owner condition while basic company "
        "administration remains separately scoped; its company selector and locked insertion "
        "remain bound to that owner. "
        "a members' register has to carry each holder's name and residential address, and those "
        "belong to the issuer's investors rather than to the issuer, so no policy admits them to the "
        "principal reading it. Without the operator connection the register does not fail - it prints "
        "'unidentified' and blank addresses, which is a legally wrong document produced confidently. "
        "The list of effects waiting to be entered classifies completions as recording does, and a "
        "settlement is visible only to its parties, so it reads what no policy admits to the issuer and "
        "the classification refuses any other connection. "
        "The reader stays IsAuthenticated: an issuer is entitled to this and is not an administrator. "
        "Register entries name each changed member as the register does, from the same identity sources. "
        "Register reads (the class list, holders, entries, export and waiting effects) also admit a current "
        "company appointment holding administration or a register capability, alongside the owner. "
        "The opening holders read reads the chain for a class whose register is not opened, so it admits only a "
        "current appointment holding administration or prepare, and names linked members from the same sources."
    )

    register_reads = frozenset(
        {"register", "holders", "register_entries", "register_export", "register_waiting", "register_members"}
    )

    def get_serializer_class(self):
        if self.action == "create":
            return ShareTokenCreateSerializer
        if self.action in {"list", "register"}:
            return ShareTokenListSerializer
        return ShareTokenDetailSerializer

    def narrow(self, queryset):
        if self.action == "register_opening_holders":
            queryset = queryset.register_preparable_by(self.request.user)
        elif self.action in self.register_reads or self.action == "retrieve":
            queryset = queryset.register_readable_by(self.request.user)
        else:
            queryset = queryset.issued_by(self.request.user)
        return queryset.with_company()

    def filter_queryset(self, queryset):
        if self.action in {"list", "register"}:
            return super().filter_queryset(queryset)
        return queryset

    @extend_schema(responses=ShareTokenDetailSerializer)
    def create(self, request, *args, **kwargs):
        if not Company.objects.owned_by(request.user).exists():
            raise PermissionDenied("You must be associated with a company to create tokens.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.save()
        return Response(
            ShareTokenDetailSerializer(token, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

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
                "token": ShareTokenDetailSerializer(token, context=self.get_serializer_context()).data,
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

    @extend_schema(responses=ShareTokenListSerializer(many=True))
    @action(detail=False, methods=["get"])
    def register(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

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
                "initialized": serializers.BooleanField(),
                "holders": ShareRegisterHolderSerializer(many=True),
                "total_holders": serializers.IntegerField(),
                "issued_supply": serializers.CharField(allow_null=True),
                "waiting_effects": serializers.IntegerField(allow_null=True),
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
        register = stored_register(token)
        rows = register["rows"] if register else []
        return Response(
            {
                "token": {
                    "uuid": str(token.uuid),
                    "name": token.name,
                    "symbol": token.symbol,
                    "status": token.status,
                    "total_supply": token.total_supply,
                },
                "initialized": register is not None,
                "holders": api_holders(rows),
                "total_holders": len(rows),
                "issued_supply": None if register is None else str(register["issued_supply"]),
                "waiting_effects": None if register is None else register["waiting_effects"],
                "former_members": FormerMemberSerializer(
                    register["former_members"] if register else former_members_of(token), many=True
                ).data,
                "former_members_as_at": (
                    register["recorded_at"] if register and not register["on_chain"] else token.former_holders_folded_at
                ),
                "former_members_block": None if register and not register["on_chain"] else token.former_holders_block,
                "former_members_stale": False if register and not register["on_chain"] else fold_is_stale(token),
            }
        )

    @extend_schema(
        responses=inline_serializer(
            name="ShareRegisterWaiting",
            fields={"effects": ShareRegisterWaitingEffectSerializer(many=True, allow_null=True)},
        )
    )
    @action(detail=True, methods=["get"], url_path="register/waiting")
    def register_waiting(self, request, uuid=None):
        return Response({"effects": stored_waiting_list(self.get_object())})

    @extend_schema(responses=RegisterMembersSerializer)
    @action(detail=True, methods=["get"], url_path="register/members")
    def register_members(self, request, uuid=None):
        return Response(RegisterMembersSerializer(register_members(self.get_object())).data)

    @extend_schema(
        responses=ShareRegisterEntrySerializer(many=True),
        filters=False,
        parameters=[OpenApiParameter("entry", OpenApiTypes.UUID, many=True)],
    )
    @action(detail=True, methods=["get"], url_path="register/entries")
    def register_entries(self, request, uuid=None):
        try:
            wanted = [UUID(value) for value in request.query_params.getlist("entry")]
        except ValueError:
            raise ValidationError({"entry": "Name each entry by its UUID."}) from None
        rows = stored_entries(self.get_object(), self.paginate_queryset, wanted)
        return self.get_paginated_response(ShareRegisterEntrySerializer(rows, many=True).data)

    @extend_schema(responses=RegisterOpeningHoldersSerializer)
    @action(detail=True, methods=["get"], url_path="register/opening-holders")
    def register_opening_holders(self, request, uuid=None):
        return Response(RegisterOpeningHoldersSerializer(opening_holders(self.get_object())).data)

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=True, methods=["get"], url_path="register/export", http_method_names=["get", "options"])
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
