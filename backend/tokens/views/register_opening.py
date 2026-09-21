from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import RegisterOpening, RegisterWalletLink
from tokens.serializers.register_opening import (
    RegisterOpeningCreateSerializer,
    RegisterOpeningSerializer,
    RegisterWalletLinkCreateSerializer,
    RegisterWalletLinkSerializer,
)
from tokens.services.register_openings import submit_link, submit_opening


class RegisterOpeningViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterOpening.objects.none()
    serializer_class = RegisterOpeningSerializer
    scoped_model = RegisterOpening
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.filter(company__owner=self.request.user)

    @extend_schema(request=RegisterOpeningCreateSerializer, responses={201: RegisterOpeningSerializer})
    def create(self, request):
        serializer = RegisterOpeningCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_opening(actor=request.user, **serializer.validated_data)
        return Response(RegisterOpeningSerializer(proposal).data, status=201)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)


class RegisterWalletLinkViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterWalletLink.objects.none()
    serializer_class = RegisterWalletLinkSerializer
    scoped_model = RegisterWalletLink
    ordering = ["-created_at", "-uuid"]
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.filter(company__owner=self.request.user)

    @extend_schema(request=RegisterWalletLinkCreateSerializer, responses={201: RegisterWalletLinkSerializer})
    def create(self, request):
        serializer = RegisterWalletLinkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = submit_link(actor=request.user, **serializer.validated_data)
        return Response(RegisterWalletLinkSerializer(proposal).data, status=201)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        proposal = self.get_object()
        return stream_stored_file(proposal.file, proposal.evidence_snapshot["mime_type"], as_attachment=True)
