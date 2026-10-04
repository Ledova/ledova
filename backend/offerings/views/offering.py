from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework.decorators import action
from rest_framework.response import Response

from companies.services.administration import (
    company_owner_operation,
    require_company_documents,
)
from offerings.exceptions import OfferingRefusedException
from offerings.models import Offering, Subscription
from offerings.serializers import (
    IssuerSubscriptionSerializer,
    OfferingDetailSerializer,
    OfferingDocumentsSerializer,
    OfferingListSerializer,
    OfferingWithdrawSerializer,
    OfferingWriteSerializer,
)
from offerings.services import (
    attach_documents,
    lock_offering,
    submit_offering,
    transition_offering,
)
from shared.db import set_principal
from shared.views import AuthenticatedModelViewSet

NOT_DELETABLE = "Only a draft offering can be deleted."


@extend_schema_view(
    create=extend_schema(responses=OfferingDetailSerializer),
    partial_update=extend_schema(responses=OfferingDetailSerializer),
)
class OfferingViewSet(AuthenticatedModelViewSet):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "status", "opens_at"]

    scoped_model = Offering
    operator_actions = frozenset(
        {"list", "retrieve", "create", "partial_update", "destroy", "submit", "withdraw", "documents", "subscriptions"}
    )
    operator_actions_because = (
        "Existing offering access requires this request's exact current company owner, independently of basic "
        "company administration. Mutations lock and recheck that owner; supplied private documents remain "
        "bound to current personal administration. Existing offering review and status controls remain enforced."
    )

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        set_principal(request.user.pk)

    def narrow(self, queryset):
        queryset = queryset.issued_by(self.request.user)
        return queryset.with_relations()

    def get_serializer_class(self):
        if self.action in ["create", "partial_update"]:
            return OfferingWriteSerializer
        if self.action == "list":
            return OfferingListSerializer
        if self.action == "withdraw":
            return OfferingWithdrawSerializer
        if self.action == "documents":
            return OfferingDocumentsSerializer
        return OfferingDetailSerializer

    def perform_destroy(self, instance):
        with company_owner_operation(self.request.user, instance.company_id):
            instance.refresh_from_db()
            if not instance.can_be_deleted:
                raise OfferingRefusedException(NOT_DELETABLE)
            instance.delete()

    def perform_create(self, serializer):
        with company_owner_operation(self.request.user, serializer.validated_data["token"].company_id) as company:
            require_company_documents(company, self.request.user, serializer.validated_data.get("documents", []))
            serializer.save()

    def perform_update(self, serializer):
        with company_owner_operation(self.request.user, serializer.instance.company_id) as company:
            serializer.instance = lock_offering(serializer.instance)
            if not serializer.instance.can_be_edited:
                raise OfferingRefusedException("Only a current draft or rejected offering can be edited.")
            require_company_documents(company, self.request.user, serializer.validated_data.get("documents", []))
            serializer.save()

    @extend_schema(responses=OfferingDetailSerializer)
    @action(detail=True, methods=["post"])
    def submit(self, request, uuid=None):
        offering = self.get_object()
        with company_owner_operation(request.user, offering.company_id):
            offering.refresh_from_db()
            submit_offering(offering, submitted_by=request.user)
        return Response(OfferingDetailSerializer(offering, context=self.get_serializer_context()).data)

    @extend_schema(responses=IssuerSubscriptionSerializer(many=True), filters=False)
    @action(detail=True, methods=["get"])
    def subscriptions(self, request, uuid=None):
        offering = self.get_object()
        subscriptions = Subscription.objects.filter(offering__in=Offering.objects.issued_by(request.user)).for_issuer(
            offering
        )
        page = self.paginate_queryset(subscriptions)
        return self.get_paginated_response(IssuerSubscriptionSerializer(page, many=True).data)

    @extend_schema(responses=OfferingDetailSerializer)
    @action(detail=True, methods=["post"])
    def withdraw(self, request, uuid=None):
        offering = self.get_object()
        serializer = OfferingWithdrawSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with company_owner_operation(request.user, offering.company_id):
            offering.refresh_from_db()
            transition_offering(offering, "withdraw", reason=serializer.validated_data.get("reason") or "")
        return Response(OfferingDetailSerializer(offering, context=self.get_serializer_context()).data)

    @extend_schema(request=OfferingDocumentsSerializer, responses=OfferingDetailSerializer)
    @action(detail=True, methods=["post"])
    def documents(self, request, uuid=None):
        offering = self.get_object()
        serializer = OfferingDocumentsSerializer(
            data=request.data, context={**self.get_serializer_context(), "offering": offering}
        )
        serializer.is_valid(raise_exception=True)
        with company_owner_operation(request.user, offering.company_id) as company:
            offering = lock_offering(offering)
            require_company_documents(company, request.user, serializer.validated_data["documents"])
            offering = attach_documents(offering, serializer.validated_data["documents"])
        return Response(OfferingDetailSerializer(offering, context=self.get_serializer_context()).data)
