from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from companies.exceptions import InvalidStatusTransitionException
from companies.filters import CompanyFilter
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyStatus,
)
from companies.serializers import (
    CompanyActivateSerializer,
    CompanyActivationAttemptSerializer,
    CompanyDetailSerializer,
    CompanyListSerializer,
    CompanyRegistrationSerializer,
    CompanyStatusUpdateSerializer,
    CompanyUpdateSerializer,
)
from companies.services import transition_company
from companies.services.activation import activate_company
from shared.db import set_principal
from shared.views import AuthenticatedModelViewSet


class CompanyViewSet(AuthenticatedModelViewSet):
    administrative_actions = frozenset({"status_update"})
    operator_actions = administrative_actions | frozenset({"list", "retrieve", "activate"})
    operator_actions_because = (
        "Company metadata reads retain the exact current owner alongside current personal administration. "
        "Private documents and contact remain separately administration-scoped. Activation requires "
        "the exact current personal administrator appointment and actor-bound service checks."
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
        if self.action == "status_update":
            return CompanyStatusUpdateSerializer
        return CompanyDetailSerializer

    def get_permissions(self):
        if self.action in self.administrative_actions:
            return [IsAdminUser()]
        return super().get_permissions()

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
        responses=inline_serializer(
            name="CompanyStatusUpdated",
            fields={"message": serializers.CharField(), "company": CompanyDetailSerializer()},
        )
    )
    @action(detail=True, methods=["post"], url_path="status")
    def status_update(self, request, uuid=None):
        company = self.get_object()

        serializer = CompanyStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_status = serializer.validated_data["status"]
        reason = serializer.validated_data.get("reason", "")

        transitions = {
            CompanyStatus.ACTIVE: ("set_active", {}),
            CompanyStatus.WARNING: ("issue_warning", {"reason": reason}),
            CompanyStatus.SUSPENDED: ("suspend", {"reason": reason}),
            CompanyStatus.DELISTED: ("delist", {"reason": reason}),
        }
        if new_status not in transitions:
            raise InvalidStatusTransitionException(
                from_status=company.get_status_display(),
                to_status=CompanyStatus(new_status).label,
            )
        method, kwargs = transitions[new_status]
        declaration = {
            key: serializer.validated_data[key]
            for key in ("declarant_name", "board_resolution_reference", "attest_officeholder")
            if key in serializer.validated_data
        }
        company = transition_company(company, method, actor=request.user, declaration=declaration, **kwargs)

        return Response(
            {
                "message": f"Company status updated to {company.get_status_display()}",
                "company": CompanyDetailSerializer(
                    company, context={**self.get_serializer_context(), "company_review": True}
                ).data,
            }
        )

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

    def narrow(self, queryset):
        if self.action in self.administrative_actions:
            return queryset
        if self.action in {"list", "retrieve"}:
            return queryset.readable_by(self.request.user)
        if self.action == "activate":
            sources = CompanyAppointment.objects.current_for(
                self.request.user,
                self.kwargs.get("uuid"),
                at=timezone.now(),
                identity_required=False,
            )
            return queryset.filter(
                pk__in=sources.filter(capabilities__contains=[CompanyCapability.ADMIN]).values("company_id")
            )
        if self.action == "partial_update":
            return queryset.administrable_by(self.request.user)
        return queryset.owned_by(self.request.user)
