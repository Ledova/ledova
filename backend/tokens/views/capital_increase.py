from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import mixins, serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from shared.views import AuthenticatedGenericViewSet
from tokens.filters import CapitalIncreaseFilter
from tokens.models import CapitalIncreaseRequest, ShareToken
from tokens.serializers import (
    CapitalIncreaseCreateSerializer,
    CapitalIncreaseDetailSerializer,
    CapitalIncreaseListSerializer,
)
from tokens.serializers.capital_increase import CapitalIncreaseCreateRequestSerializer
from tokens.services.capital_increase import submit_capital_increase


class CapitalIncreaseViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, AuthenticatedGenericViewSet):
    lookup_field = "uuid"
    filterset_class = CapitalIncreaseFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "status", "additional_shares"]

    scoped_model = CapitalIncreaseRequest

    def get_serializer_class(self):
        if self.action == "create":
            return CapitalIncreaseCreateSerializer
        if self.action == "list":
            return CapitalIncreaseListSerializer
        return CapitalIncreaseDetailSerializer

    def narrow(self, queryset):
        return queryset.with_relations()

    def filter_queryset(self, queryset):
        if self.action == "list":
            return super().filter_queryset(queryset)
        return queryset

    @extend_schema(request=CapitalIncreaseCreateRequestSerializer, responses={201: CapitalIncreaseDetailSerializer})
    def create(self, request, *args, **kwargs):
        token_uuid = request.data.get("token")
        if not token_uuid:
            raise ValidationError({"token": "Token UUID is required."})
        token = get_object_or_404(ShareToken.objects.issued_by(request.user), uuid=token_uuid)

        serializer = self.get_serializer(data=request.data, context={**self.get_serializer_context(), "token": token})
        serializer.is_valid(raise_exception=True)
        capital_increase = serializer.save(token=token)
        return Response(CapitalIncreaseDetailSerializer(capital_increase).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        responses=inline_serializer(
            name="CapitalIncreaseSubmitted",
            fields={"message": serializers.CharField(), "request": CapitalIncreaseDetailSerializer()},
        )
    )
    @action(detail=True, methods=["post"])
    def submit(self, request, uuid=None):
        capital_increase = self.get_object()
        submit_capital_increase(capital_increase, request.user)
        return Response(
            {
                "message": "Capital increase request submitted for review.",
                "request": CapitalIncreaseDetailSerializer(capital_increase).data,
            }
        )
