from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.db import atomic
from shared.views.base import AuthenticatedGenericViewSet
from tokens.services.register_particulars import lock_profile_save
from users.models.user_profile import UserProfile
from users.serializers import UserProfileSerializer
from users.serializers.account_actions import (
    AccountExportDataSerializer,
    DeletedAccountResponseSerializer,
)
from users.services import lifecycle
from users.services.profile import save_profile


class UserProfileViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, AuthenticatedGenericViewSet):
    serializer_class = UserProfileSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_field = "uuid"
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "full_name"]

    scoped_model = UserProfile
    operator_actions = frozenset({"partial_update"})
    operator_actions_because = (
        "A profile save that gives a full name or residential address brings the register particulars of every "
        "company that currently links this person as a member up to date in the same transaction, and registers "
        "are written only on the operator connection. Those companies and then this person's account are locked "
        "first, as register commands lock a company and then its actor, and a save that waited behind an account "
        "deletion stops there; then narrow() binds the save to the signed-in person's own "
        "locked profile row, and the save marks its transaction so the profile trigger still refuses provider "
        "identity results and any other person's row; the register guards accept only this person's own current "
        "links and their profile's values."
    )

    def narrow(self, queryset):
        queryset = queryset.filter(user_id=self.request.user.pk)
        queryset = queryset.select_related("citizenship_country")
        if getattr(self, "action", None) == "partial_update":
            return queryset.select_for_update(of=("self",))
        return queryset

    def perform_update(self, serializer):
        save_profile(self.request.user, serializer)

    @atomic()
    def partial_update(self, request, *args, **kwargs):
        lock_profile_save(request.user)
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
