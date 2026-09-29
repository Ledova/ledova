from shared.views import AuthenticatedListViewSet
from wallets.filters import TransactionFilter
from wallets.models import Transaction
from wallets.serializers import TransactionSerializer


class TransactionViewSet(AuthenticatedListViewSet):
    serializer_class = TransactionSerializer
    filterset_class = TransactionFilter
    ordering = ["-block_timestamp"]
    ordering_fields = ["block_timestamp", "chain"]

    scoped_model = Transaction

    def narrow(self, queryset):
        return queryset.filter(asset__is_verified=True).with_optimized_data()
