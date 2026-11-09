from shared.views.base import AuthenticatedListViewSet
from users.models.financial_profile import FinancialProfile
from users.serializers.financial_profile import FinancialProfileSerializer


class FinancialProfileViewSet(AuthenticatedListViewSet):
    serializer_class = FinancialProfileSerializer
    http_method_names = ["get", "head", "options"]

    ordering = ["created_at"]
    ordering_fields = ["created_at"]

    scoped_model = FinancialProfile
