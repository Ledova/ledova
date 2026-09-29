from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.db import atomic
from shared.views.base import AuthenticatedGenericViewSet
from users.models.user_profile import UserProfile
from users.serializers import UserProfileSerializer
from users.serializers.account_actions import (
    AccountExportDataSerializer,
    DeletedAccountResponseSerializer,
)
from users.services import lifecycle


class UserProfileViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, AuthenticatedGenericViewSet):
    serializer_class = UserProfileSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_field = "uuid"
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "full_name"]

    scoped_model = UserProfile

    def narrow(self, queryset):
        queryset = queryset.filter(user_id=self.request.user.pk)
        queryset = queryset.select_related("citizenship_country")
        if getattr(self, "action", None) == "partial_update":
            return queryset.select_for_update(of=("self",))
        return queryset

    def perform_update(self, serializer):
        serializer.save()

    @atomic()
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    @extend_schema(responses=DeletedAccountResponseSerializer)
    @action(detail=False, methods=["post"], url_path="delete-account")
    def delete_account(self, request):
        lifecycle.delete_account(request.user)
        return Response({"message": "Your account has been successfully deleted."})

    @extend_schema(responses=AccountExportDataSerializer)
    @action(detail=False, methods=["get"], url_path="export-data")
    def export_data(self, request):
        return Response(lifecycle.export_account_data(request.user))
