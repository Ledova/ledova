from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from companies.models import CompanyAuthorityRequest
from companies.serializers.authority_request import (
    CompanyAuthorityRequestSerializer,
    CompanyAuthorityRequestUploadSerializer,
    CompanyAuthorityRequestWithdrawalSerializer,
)
from companies.services.authority_requests import (
    submit_authority_request,
    withdraw_authority_request,
)
from shared.views import AuthenticatedGenericViewSet, stream_stored_file
from shared.views.uploads import UploadProtectedView


class CompanyAuthorityRequestViewSet(
    UploadProtectedView, mixins.ListModelMixin, mixins.RetrieveModelMixin, AuthenticatedGenericViewSet
):
    queryset = CompanyAuthorityRequest.objects.none()
    serializer_class = CompanyAuthorityRequestSerializer
    scoped_model = CompanyAuthorityRequest
    lookup_field = "uuid"
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["company"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.is_active or not request.user.is_email_verified:
            raise PermissionDenied(
                "An active account with verified email is required to access company authority requests."
            )

    def narrow(self, queryset):
        return queryset.filter(requester=self.request.user).select_related("withdrawal")

    def get_serializer_class(self):
        if self.action == "create":
            return CompanyAuthorityRequestUploadSerializer
        if self.action == "withdraw":
            return CompanyAuthorityRequestWithdrawalSerializer
        return self.serializer_class

    @extend_schema(responses={201: CompanyAuthorityRequestSerializer, 200: CompanyAuthorityRequestSerializer})
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        proposal, created = submit_authority_request(
            requester=request.user,
            company_id=data["company"],
            **{key: value for key, value in data.items() if key != "company"}
        )
        response = CompanyAuthorityRequestSerializer(proposal, context=self.get_serializer_context())
        return Response(response.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.mime_type, proposal.original_filename, as_attachment=True)

    @extend_schema(
        request=CompanyAuthorityRequestWithdrawalSerializer, responses={200: CompanyAuthorityRequestSerializer}
    )
    @action(detail=True, methods=["post"])
    def withdraw(self, request, uuid=None):
        proposal = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        withdrawn = withdraw_authority_request(requester=request.user, request_id=proposal.pk)
        response = CompanyAuthorityRequestSerializer(withdrawn, context=self.get_serializer_context())
        return Response(response.data)
