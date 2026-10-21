import csv
from uuid import UUID

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    inline_serializer,
)
from rest_framework import mixins, serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

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
from tokens.serializers.class_rights import (
    ClassRightsPageSerializer,
    ClassRightsQuerySerializer,
    ClassRightsRevisionSerializer,
    ClassRightsWriteSerializer,
)
from tokens.serializers.register_certificate import (
    RegisterCertificatePreviewSerializer,
    RegisterCertificateRequestSerializer,
    RegisterCertificateSelectionSerializer,
)
from tokens.serializers.register_inspection_copy import (
    RegisterInspectionPreviewSerializer,
    RegisterInspectionRequestSerializer,
)
from tokens.serializers.register_opening import RegisterOpeningHoldersSerializer
from tokens.serializers.register_transfer import RegisterMembersSerializer
from tokens.services.class_rights import class_rights_read, record_class_rights
from tokens.services.former_holders import fold_is_stale, former_members_of
from tokens.services.register import (
    REGISTER_HEADERS,
    api_holders,
    export_rows,
    stored_entries,
    stored_register,
    stored_waiting_list,
)
from tokens.services.register_certificates import (
    prepare_company_certificate,
    preview_company_certificate,
)
from tokens.services.register_inspection_copies import (
    prepare_company_inspection_copy,
    preview_company_inspection_copy,
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
            "issuances",
            "holders",
            "register",
            "register_entries",
            "register_export",
            "register_inspection_copy",
            "register_certificate",
            "register_opening_holders",
            "register_waiting",
            "register_members",
            "class_rights",
        }
    )
    operator_actions_because = (
        "Share-class creation requires current personal company administration or prepare authority; its company "
        "selector and insertion recheck that authority inside the locked company operation. Owned reads remain "
        "separately scoped. "
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
        "current appointment holding administration or prepare, and names linked members from the same sources. "
        "Inspection copies and unsigned certificates separately require a current personal register appointment "
        "inside the locked company operation; ownership and platform staff permission grant no output authority. "
        "Private class-rights descriptions are read by exact-company register readers; their durable append-only "
        "producer requires current personal company administration and retains attributable revisions."
    )

    register_reads = frozenset(
        {
            "register",
            "holders",
            "register_entries",
            "register_export",
            "register_waiting",
            "register_members",
            "register_inspection_copy",
            "register_certificate",
            "class_rights",
        }
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
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.save()
        return Response(
            ShareTokenDetailSerializer(token, context=self.get_serializer_context()).data,
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
        page = self.paginate_queryset(issuances.order_by("-completed_at", "-uuid"))
        return self.get_paginated_response(ShareIssuanceListSerializer(page, many=True).data)

    @extend_schema(responses=ShareTokenListSerializer(many=True))
    @action(detail=False, methods=["get"])
    def register(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    @extend_schema(
        methods=["GET"],
        parameters=[
            OpenApiParameter("page", OpenApiTypes.INT),
            OpenApiParameter("page_size", OpenApiTypes.INT),
            OpenApiParameter("idempotency_key", OpenApiTypes.UUID),
        ],
        responses=ClassRightsPageSerializer,
    )
    @extend_schema(
        methods=["POST"],
        request=ClassRightsWriteSerializer,
        responses={
            200: ClassRightsRevisionSerializer,
            201: ClassRightsRevisionSerializer,
            409: OpenApiResponse(response=OpenApiTypes.OBJECT, description="The request or loaded revision conflicts."),
        },
    )
    @action(detail=True, methods=["get", "post"], url_path="class-rights")
    def class_rights(self, request, uuid=None):
        token = self.get_object()
        if request.method == "GET":
            query = ClassRightsQuerySerializer(data=request.query_params)
            query.is_valid(raise_exception=True)
            with class_rights_read(actor=request.user, token=token) as (revisions, administration):
                current = revisions.first()
                if key := query.validated_data.get("idempotency_key"):
                    revisions = revisions.filter(idempotency_key=key)
                page = self.paginate_queryset(revisions)
                response = self.get_paginated_response(ClassRightsRevisionSerializer(page, many=True).data)
                response.data.update(
                    current=ClassRightsRevisionSerializer(current).data if current else None,
                    administration_appointment=str(administration.pk) if administration else None,
                )
                return response
        serializer = ClassRightsWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revision, created = record_class_rights(actor=request.user, token=token, **serializer.validated_data)
        return Response(ClassRightsRevisionSerializer(revision).data, status=201 if created else 200)

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
        return Response(RegisterMembersSerializer(register_members(self.get_object(), request.user)).data)

    @extend_schema(
        responses=ShareRegisterEntrySerializer(many=True),
        filters=False,
        parameters=[
            OpenApiParameter("entry", OpenApiTypes.UUID, many=True),
            OpenApiParameter("member", OpenApiTypes.UUID),
        ],
    )
    @action(detail=True, methods=["get"], url_path="register/entries")
    def register_entries(self, request, uuid=None):
        try:
            wanted = [UUID(value) for value in request.query_params.getlist("entry")]
        except ValueError:
            raise ValidationError({"entry": "Name each entry by its UUID."}) from None
        try:
            member = UUID(request.query_params["member"]) if "member" in request.query_params else None
        except ValueError:
            raise ValidationError({"member": "Name the member by their UUID."}) from None
        rows = stored_entries(self.get_object(), self.paginate_queryset, wanted, member)
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

    @extend_schema(methods=["GET"], responses=RegisterInspectionPreviewSerializer)
    @extend_schema(
        methods=["POST"],
        request=RegisterInspectionRequestSerializer,
        responses={(200, "text/csv"): OpenApiTypes.BINARY},
    )
    @action(detail=True, methods=["get", "post"], url_path="register/inspection-copy")
    def register_inspection_copy(self, request, uuid=None):
        token = self.get_object()
        if request.method == "GET":
            preview = preview_company_inspection_copy(actor=request.user, token=token)
            return Response(RegisterInspectionPreviewSerializer(preview).data)
        serializer = RegisterInspectionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = prepare_company_inspection_copy(actor=request.user, token=token, **serializer.validated_data)
        response = HttpResponse(content, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="register-{token.symbol}-inspection-copy.csv"'
        return response

    @extend_schema(
        methods=["GET"],
        parameters=[OpenApiParameter("sequence", OpenApiTypes.INT, required=True)],
        responses=RegisterCertificatePreviewSerializer,
    )
    @extend_schema(
        methods=["POST"],
        request=RegisterCertificateRequestSerializer,
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    @action(detail=True, methods=["get", "post"], url_path="register/certificate")
    def register_certificate(self, request, uuid=None):
        token = self.get_object()
        if request.method == "GET":
            serializer = RegisterCertificateSelectionSerializer(data=request.query_params)
            serializer.is_valid(raise_exception=True)
            preview = preview_company_certificate(actor=request.user, token=token, **serializer.validated_data)
            return Response(RegisterCertificatePreviewSerializer(preview).data)
        serializer = RegisterCertificateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = prepare_company_certificate(actor=request.user, token=token, **serializer.validated_data)
        sequence = serializer.validated_data["sequence"]
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="certificate-{token.symbol}-{sequence}.pdf"'
        response["Cache-Control"] = "private, no-store"
        return response
