from rest_framework import mixins

from shared.views import AuthenticatedGenericViewSet
from tokens.filters import CapitalIncreaseFilter
from tokens.models import CapitalIncreaseRequest
from tokens.serializers import CapitalIncreaseListSerializer


class CapitalIncreaseViewSet(mixins.ListModelMixin, AuthenticatedGenericViewSet):
    lookup_field = "uuid"
    filterset_class = CapitalIncreaseFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "status", "additional_shares"]
    scoped_model = CapitalIncreaseRequest
    serializer_class = CapitalIncreaseListSerializer
    operator_actions = frozenset({"list"})
    operator_actions_because = (
        "The retained private capital request list requires the original company's current owner scope. "
        "Current company preparation and decisions use their separate bounded register instruction."
    )

    def narrow(self, queryset):
        if not self.request.user.is_authenticated:
            return queryset.none()
        return queryset.filter(company__owner=self.request.user).with_relations()
