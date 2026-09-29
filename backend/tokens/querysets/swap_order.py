from django.db.models import Q, QuerySet

from tokens.models.choices import SwapOrderStatus


class SwapOrderQuerySet(QuerySet):
    def for_party_wallets(self, wallet_ids):
        if not wallet_ids:
            return self.none()
        return self.filter(Q(seller_wallet_id__in=wallet_ids) | Q(buyer_wallet_id__in=wallet_ids))

    def awaiting_signature(self):
        return self.filter(
            status__in=[
                SwapOrderStatus.CREATED,
                SwapOrderStatus.SELLER_SIGNED,
                SwapOrderStatus.BUYER_SIGNED,
            ],
        )

    def pending(self):
        return self.exclude(status__in=[SwapOrderStatus.COMPLETED, SwapOrderStatus.FAILED, SwapOrderStatus.EXPIRED])

    def with_related(self):
        return self.select_related("payment_asset").prefetch_related("share_token")

    def completed_for_token(self, token):
        return self.filter(share_token=token, status="completed").order_by("-completed_at", "-pk")
