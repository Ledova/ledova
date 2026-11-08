from rest_framework import mixins

from shared.db import atomic
from shared.views.base import AuthenticatedGenericViewSet
from users.models.financial_profile import FinancialProfile
from users.serializers.financial_profile import FinancialProfileSerializer
from users.services.accounts import lock_active_user
from users.services.financial_profile import create_financial_profile


class FinancialProfileViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.UpdateModelMixin, AuthenticatedGenericViewSet
):
    serializer_class = FinancialProfileSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_field = "uuid"

    ordering = ["created_at"]
    ordering_fields = ["created_at"]

    scoped_model = FinancialProfile

    def narrow(self, queryset):
        if getattr(self, "action", None) == "partial_update":
            return queryset.select_for_update()
        return queryset

    def perform_create(self, serializer):
        create_financial_profile(self.request.user, serializer)

    @atomic()
    def partial_update(self, request, *args, **kwargs):
        lock_active_user(request.user)
        return super().partial_update(request, *args, **kwargs)
