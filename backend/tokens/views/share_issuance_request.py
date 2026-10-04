from shared.views import AuthenticatedListViewSet
from tokens.filters import ShareIssuanceRequestFilter
from tokens.models import ShareIssuanceRequest
from tokens.serializers import ShareIssuanceRequestSerializer


class ShareIssuanceRequestViewSet(AuthenticatedListViewSet):
    serializer_class = ShareIssuanceRequestSerializer
    filterset_class = ShareIssuanceRequestFilter
    ordering = ["-created_at", "-uuid"]
    ordering_fields = ["created_at", "status", "amount"]

    scoped_model = ShareIssuanceRequest
    operator_actions = frozenset({"list"})
    operator_actions_because = (
        "Issued request reads keep their exact current-company-owner scope independently of basic company "
        "administration. The queryset still requires this request actor as the current company owner."
    )

    def narrow(self, queryset):
        queryset = queryset.issued_by(self.request.user)
        return queryset.with_relations()
