from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedGenericViewSet
from users.models import CompanyEligibilityRequest
from users.serializers.company_eligibility import (
    CompanyEligibilityDecisionCreateSerializer,
    CompanyEligibilityDecisionPreviewResultSerializer,
    CompanyEligibilityDecisionPreviewSerializer,
    CompanyEligibilityRequestCreateSerializer,
    CompanyEligibilityRequestPreviewResultSerializer,
    CompanyEligibilityRequestPreviewSerializer,
    CompanyEligibilityRequestSerializer,
    CompanyEligibilityRequestWithdrawalCreateSerializer,
    CompanyEligibilityRevocationCreateSerializer,
)
from users.services.company_eligibility import (
    company_eligibility_requests,
    decide_eligibility_request,
    preview_eligibility_decision,
    preview_eligibility_request,
    revoke_eligibility_decision,
    submit_eligibility_request,
    withdraw_eligibility_request,
)


class CompanyEligibilityRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AuthenticatedGenericViewSet):
    queryset = CompanyEligibilityRequest.objects.none()
    serializer_class = CompanyEligibilityRequestSerializer
    scoped_model = CompanyEligibilityRequest
    lookup_field = "uuid"
    http_method_names = ["get", "post", "head", "options"]
    ordering_fields = ["submitted_at", "uuid"]

    def narrow(self, queryset):
        return queryset.filter(user_account__user_profile__user=self.request.user).select_related(
            "decision__revocation", "withdrawal"
        )

    def get_serializer_class(self):
        if self.action == "create":
            return CompanyEligibilityRequestCreateSerializer
        if self.action == "preview":
            return CompanyEligibilityRequestPreviewSerializer
        if self.action == "withdraw":
            return CompanyEligibilityRequestWithdrawalCreateSerializer
        return self.serializer_class

    @extend_schema(
        request=CompanyEligibilityRequestCreateSerializer,
        responses={201: CompanyEligibilityRequestSerializer, 200: CompanyEligibilityRequestSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal, created = submit_eligibility_request(actor=request.user, **serializer.validated_data)
        response = CompanyEligibilityRequestSerializer(proposal, context=self.get_serializer_context())
        return Response(response.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(
        request=CompanyEligibilityRequestPreviewSerializer,
        responses={200: CompanyEligibilityRequestPreviewResultSerializer},
    )
    @action(detail=False, methods=["post"])
    def preview(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preview = preview_eligibility_request(actor=request.user, **serializer.validated_data)
        response = CompanyEligibilityRequestPreviewResultSerializer(preview, context=self.get_serializer_context())
        return Response(response.data)

    @extend_schema(
        request=CompanyEligibilityRequestWithdrawalCreateSerializer,
        responses={200: CompanyEligibilityRequestSerializer},
    )
    @action(detail=True, methods=["post"])
    def withdraw(self, request, uuid=None):
        proposal = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        withdrawn = withdraw_eligibility_request(
            actor=request.user, request_id=proposal.pk, **serializer.validated_data
        )
        response = CompanyEligibilityRequestSerializer(withdrawn, context=self.get_serializer_context())
        return Response(response.data)


class CompanyEligibilityQueueViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, AuthenticatedGenericViewSet):
    queryset = CompanyEligibilityRequest.objects.none()
    serializer_class = CompanyEligibilityRequestSerializer
    scoped_model = CompanyEligibilityRequest
    lookup_field = "uuid"
    http_method_names = ["get", "post", "head", "options"]
    ordering_fields = ["submitted_at", "uuid"]

    def narrow(self, queryset):
        permitted = company_eligibility_requests(self.request.user, self.kwargs["company_uuid"])
        return queryset.filter(company_id=self.kwargs["company_uuid"], pk__in=permitted.values("pk")).select_related(
            "decision__revocation", "withdrawal"
        )

    def get_serializer_class(self):
        if self.action == "decision_preview":
            return CompanyEligibilityDecisionPreviewSerializer
        if self.action == "decide":
            return CompanyEligibilityDecisionCreateSerializer
        if self.action == "revoke":
            return CompanyEligibilityRevocationCreateSerializer
        return self.serializer_class

    @extend_schema(
        request=CompanyEligibilityDecisionPreviewSerializer,
        responses={200: CompanyEligibilityDecisionPreviewResultSerializer},
    )
    @action(detail=True, methods=["post"], url_path="decision-preview")
    def decision_preview(self, request, company_uuid=None, uuid=None):
        proposal = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preview = preview_eligibility_decision(
            actor=request.user, request_id=proposal.pk, company_id=company_uuid, **serializer.validated_data
        )
        response = CompanyEligibilityDecisionPreviewResultSerializer(preview, context=self.get_serializer_context())
        return Response(response.data)

    @extend_schema(
        request=CompanyEligibilityDecisionCreateSerializer, responses={200: CompanyEligibilityRequestSerializer}
    )
    @action(detail=True, methods=["post"])
    def decide(self, request, company_uuid=None, uuid=None):
        proposal = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        decided = decide_eligibility_request(
            actor=request.user, request_id=proposal.pk, company_id=company_uuid, **serializer.validated_data
        )
        response = CompanyEligibilityRequestSerializer(decided, context=self.get_serializer_context())
        return Response(response.data)

    @extend_schema(
        request=CompanyEligibilityRevocationCreateSerializer, responses={200: CompanyEligibilityRequestSerializer}
    )
    @action(detail=True, methods=["post"])
    def revoke(self, request, company_uuid=None, uuid=None):
        proposal = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revoked = revoke_eligibility_decision(
            actor=request.user, request_id=proposal.pk, company_id=company_uuid, **serializer.validated_data
        )
        response = CompanyEligibilityRequestSerializer(revoked, context=self.get_serializer_context())
        return Response(response.data)
