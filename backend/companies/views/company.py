from django.http import FileResponse
from drf_spectacular.utils import OpenApiTypes, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from companies.filters import CompanyFilter
from companies.models import Company
from companies.serializers import (
    CompanyActivateSerializer,
    CompanyActivationAttemptSerializer,
    CompanyDetailSerializer,
    CompanyListSerializer,
    CompanyRegistrationSerializer,
    CompanyUpdateSerializer,
)
from companies.serializers.pack import (
    CompanyPackRequestSerializer,
    CompanyPacksSerializer,
)
from companies.services.activation import activate_company
from shared.db import set_principal
from shared.views import AuthenticatedModelViewSet
from tokens.exceptions import RegisterIntegrityError
from tokens.services.company_pack_outputs import prepare_company_pack
from tokens.services.output_history import company_pack_history


class CompanyViewSet(AuthenticatedModelViewSet):
    operator_actions = frozenset({"list", "retrieve", "activate", "pack", "packs"})
    operator_actions_because = (
        "Company metadata reads retain the exact current owner alongside current personal administration. "
        "Private documents and contact remain separately administration-scoped. Activation requires "
        "the exact current personal administrator appointment and actor-bound service checks. Company pack "
        "download captures one supported complete archive, refuses restricted categories and rechecks the "
        "personal administrator and tenant before recording the immutable delivery audit. The list of earlier "
        "packs requires the same current personal administrator and shows only packs prepared by people appointed "
        "at the company, never one platform staff produced."
    )
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_class = CompanyFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "name", "status"]

    scoped_model = Company

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.action in {"list", "retrieve", "activate"}:
            set_principal(request.user.pk)

    def get_serializer_class(self):
        if self.action == "create":
            return CompanyRegistrationSerializer
        if self.action == "list":
            return CompanyListSerializer
        if self.action == "partial_update":
            return CompanyUpdateSerializer
        if self.action == "activate":
            return CompanyActivateSerializer
        return CompanyDetailSerializer

    @extend_schema(
        responses=inline_serializer(
            name="CompanyRegistered",
            fields={"message": serializers.CharField(), "company": CompanyDetailSerializer()},
        )
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        company = serializer.save()

        response_serializer = CompanyDetailSerializer(company, context=self.get_serializer_context())
        return Response(
            {
                "message": "Company registered successfully. Establish company authority to activate your register.",
                "company": response_serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=CompanyUpdateSerializer, responses=CompanyDetailSerializer)
    def partial_update(self, request, *args, **kwargs):
        company = self.get_object()
        serializer = self.get_serializer(company, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        company = serializer.save()
        return Response(CompanyDetailSerializer(company, context=self.get_serializer_context()).data)

    @extend_schema(
        request=CompanyActivateSerializer,
        responses=inline_serializer(
            name="CompanyActivated",
            fields={
                "message": serializers.CharField(),
                "company": CompanyDetailSerializer(),
                "attempt": CompanyActivationAttemptSerializer(),
            },
        ),
    )
    @action(detail=True, methods=["post"])
    def activate(self, request, uuid=None):
        company = self.get_object()
        serializer = CompanyActivateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        company, attempt = activate_company(actor=request.user, company_id=company.pk, **serializer.validated_data)
        return Response(
            {
                "message": (
                    "Company activated."
                    if attempt.applied_at
                    else "Activation check retained. Resolve the reported result and retry with a new request key."
                ),
                "company": CompanyDetailSerializer(company, context=self.get_serializer_context()).data,
                "attempt": CompanyActivationAttemptSerializer(attempt).data,
            }
        )

    @extend_schema(request=CompanyPackRequestSerializer, responses={(200, "application/zip"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["post"])
    def pack(self, request, uuid=None):
        company = self.get_object()
        serializer = CompanyPackRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            archive, filename = prepare_company_pack(
                actor=request.user, company_id=company.pk, **serializer.validated_data
            )
        except RegisterIntegrityError as error:
            raise ValidationError(str(error)) from error
        response = FileResponse(archive, as_attachment=True, filename=filename, content_type="application/zip")
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(responses=CompanyPacksSerializer)
    @action(detail=True, methods=["get"])
    def packs(self, request, uuid=None):
        packs = company_pack_history(actor=request.user, company_id=self.get_object().pk)
        return Response(CompanyPacksSerializer({"packs": packs}).data)

    def narrow(self, queryset):
        if self.action in {"list", "retrieve"}:
            return queryset.readable_by(self.request.user)
        if self.action in {"activate", "pack", "packs"}:
            return queryset.for_activation(self.request.user, self.kwargs.get("uuid"))
        if self.action == "partial_update":
            return queryset.administrable_by(self.request.user)
        return queryset.owned_by(self.request.user)
