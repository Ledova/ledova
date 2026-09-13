from django.db.models import F, Q, QuerySet
from django.db.models.functions import Lower

from shared.constants import EVM_BLOCKCHAINS, normalize_chain


class TransactionQuerySet(QuerySet):
    def filter_by_address(self, address, *, chain):
        chain = normalize_chain(chain)
        suffix = "__iexact" if chain in EVM_BLOCKCHAINS else ""
        return self.filter(chain=chain).filter(
            Q(**{"from_address" + suffix: address}) | Q(**{"to_address" + suffix: address})
        )

    def filter_by_direction(self, direction, wallet_uuid=None):
        if direction not in ("incoming", "outgoing"):
            return self

        queryset = self.filter(wallet__uuid=wallet_uuid) if wallet_uuid else self
        if direction == "incoming":
            return queryset.annotate(
                wallet_addr_lower=Lower("wallet__address"), to_addr_lower=Lower("to_address")
            ).filter(to_addr_lower=F("wallet_addr_lower"))
        return queryset.annotate(
            wallet_addr_lower=Lower("wallet__address"), from_addr_lower=Lower("from_address")
        ).filter(from_addr_lower=F("wallet_addr_lower"))

    def with_optimized_data(self):
        return self.select_related("asset", "wallet", "wallet__user_account")
