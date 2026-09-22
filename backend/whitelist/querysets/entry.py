from django.db.models import Q, QuerySet
from django.db.models.functions import Lower

from shared.constants import BLOCKCHAIN_BASE


class WhitelistEntryQuerySet(QuerySet):

    def for_registry(self):
        return self.filter(Q(wallet__chain=BLOCKCHAIN_BASE) | Q(wallet__isnull=True))

    def filter_by_address(self, address):
        if address:
            return self.for_registry().filter(Q(wallet__address__iexact=address) | Q(address__iexact=address))
        return self.none()

    def for_addresses(self, addresses):
        keys = sorted({(address or "").strip().lower() for address in addresses} - {""})
        if not keys:
            return self.none()
        return (
            self.for_registry()
            .annotate(registry_wallet_address=Lower("wallet__address"), registry_address=Lower("address"))
            .filter(Q(registry_wallet_address__in=keys) | Q(registry_address__in=keys))
        )

    def with_holder_identity(self):
        return self.select_related("wallet__user_account").prefetch_related("wallet__user_account__user_profile__user")

    def matching_identity(self, entry_id, address):
        return self.filter(pk=entry_id).filter(
            Q(wallet__isnull=True, address__iexact=address)
            | Q(wallet__chain=BLOCKCHAIN_BASE, wallet__address__iexact=address)
        )
