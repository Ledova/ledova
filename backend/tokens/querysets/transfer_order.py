from django.conf import settings
from django.db import models
from django.db.models import QuerySet

from shared.constants import BLOCKCHAIN_BASE, BLOCKCHAIN_ETHEREUM
from shared.utils.token_amounts import token_base_units_ceiling
from tokens.models.choices import (
    SwapOrderStatus,
    TransferOrderStatus,
    TransferOrderType,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED

COMMITTED_STATUSES = [
    TransferOrderStatus.OPEN,
    TransferOrderStatus.PARTIALLY_FILLED,
    TransferOrderStatus.MATCHED,
    TransferOrderStatus.PENDING_SIGNATURE,
    TransferOrderStatus.EXECUTING,
]


def signed_matching_admission(chain_id):
    return models.Q(
        submission__status="created",
        submission__owner_account_id=models.F("owner_account_id"),
        submission__wallet_id=models.F("wallet_id"),
        submission__token_id=models.F("token_id"),
        submission__wallet_address__iexact=models.F("wallet_address"),
        submission__chain_id=chain_id,
        submission__verifying_contract__iexact=models.F("token__contract_address"),
        submission__executed_challenge__consumed_at__isnull=False,
        wallet__verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        wallet__chain__in=(BLOCKCHAIN_ETHEREUM, BLOCKCHAIN_BASE),
        owner_account__user_profile__user__is_active=True,
    )


class TransferOrderQuerySet(QuerySet):
    def ownership_bound(self):
        return self.filter(
            wallet__user_account_id=models.F("owner_account_id"),
            wallet__address__iexact=models.F("wallet_address"),
        )

    def open(self):
        return self.filter(status=TransferOrderStatus.OPEN)

    def completed(self):
        return self.filter(status=TransferOrderStatus.COMPLETED)

    def active(self):
        return self.filter(
            status__in=[
                TransferOrderStatus.OPEN,
                TransferOrderStatus.MATCHED,
                TransferOrderStatus.PENDING_SIGNATURE,
                TransferOrderStatus.EXECUTING,
            ]
        )

    def buy_orders(self):
        return self.filter(order_type=TransferOrderType.BUY)

    def sell_orders(self):
        return self.filter(order_type=TransferOrderType.SELL)

    def open_or_partial(self):
        return self.filter(
            status__in=[TransferOrderStatus.OPEN, TransferOrderStatus.PARTIALLY_FILLED],
        )

    def admitted_to_match(self, order, chain_id):
        return self.filter(
            models.Q(owner_account_id=order.owner_account_id)
            | (signed_matching_admission(chain_id) & models.Q(payment_asset_id=order.payment_asset_id))
        )

    def advertised_liquidity(self):
        return (
            self.ownership_bound()
            .open_or_partial()
            .filter(
                signed_matching_admission(settings.BLOCKCHAIN_CHAIN_ID),
                quantity__gt=models.F("filled_quantity"),
                min_quantity__lte=models.F("quantity") - models.F("filled_quantity"),
            )
        )

    def committed_sell_quantity(self, token, wallet_address, exclude_uuid=None) -> int:
        orders = self.ownership_bound().filter(
            token=token,
            wallet_address__iexact=wallet_address,
            order_type=TransferOrderType.SELL,
            status__in=COMMITTED_STATUSES,
        )
        if exclude_uuid:
            orders = orders.exclude(uuid=exclude_uuid)
        unfilled = orders.aggregate(total=models.Sum(models.F("quantity") - models.F("filled_quantity")))["total"]
        held = orders.aggregate(
            total=models.Sum(
                "swap_as_sell__share_amount",
                filter=models.Q(swap_as_sell__status__in=SwapOrderStatus.unsettled()),
            )
        )["total"]
        return (unfilled or 0) + (held or 0)

    def committed_buy_payment(self, payment_asset, wallet_address, decimals, exclude_uuid=None) -> int:
        orders = self.ownership_bound().filter(
            payment_asset=payment_asset,
            wallet_address__iexact=wallet_address,
            order_type=TransferOrderType.BUY,
            status__in=COMMITTED_STATUSES,
        )
        if exclude_uuid:
            orders = orders.exclude(uuid=exclude_uuid)
        unfilled = sum(
            token_base_units_ceiling((row["quantity"] - row["filled_quantity"]) * row["price_per_share"], decimals)
            for row in orders.values("quantity", "filled_quantity", "price_per_share")
        )
        held = orders.aggregate(
            total=models.Sum(
                "swap_as_buy__payment_amount",
                filter=models.Q(swap_as_buy__status__in=SwapOrderStatus.unsettled()),
            )
        )["total"]
        return unfilled + (held or 0)

    def order_book_levels(self, token, order_type: str, limit: int = 20):
        qs = self.advertised_liquidity().filter(token=token)

        if order_type == TransferOrderType.BUY:
            qs = qs.buy_orders().order_by("-price_per_share")
        else:
            qs = qs.sell_orders().order_by("price_per_share")

        return qs.values("price_per_share").annotate(
            total_quantity=models.Sum(models.F("quantity") - models.F("filled_quantity")),
            order_count=models.Count("uuid"),
        )[:limit]

    def best_bid(self, token):
        return self.advertised_liquidity().buy_orders().filter(token=token).order_by("-price_per_share").first()

    def best_ask(self, token):
        return self.advertised_liquidity().sell_orders().filter(token=token).order_by("price_per_share").first()

    def with_relations(self):
        return self.select_related(
            "token",
            "token__company",
            "payment_asset",
            "wallet",
            "wallet__user_account",
            "owner_account",
            "matched_order",
        )

    def search(self, query):
        if not query:
            return self
        return self.filter(
            models.Q(wallet_address__icontains=query)
            | models.Q(token__symbol__icontains=query)
            | models.Q(token__name__icontains=query)
            | models.Q(tx_hash__icontains=query)
        )
