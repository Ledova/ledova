from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from web3 import Web3

from shared.views import AuthenticatedListViewSet
from tokens.models import SwapOrder
from tokens.serializers.swap_order import SwapOrderListSerializer
from wallets.models import Wallet


class SwapOrderViewSet(AuthenticatedListViewSet):

    serializer_class = SwapOrderListSerializer
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "status"]

    scoped_model = SwapOrder

    def narrow(self, queryset):
        return queryset.awaiting_signature().with_related()

    @extend_schema(parameters=[OpenApiParameter("wallet_address", str, required=True)])
    def list(self, request, *args, **kwargs):
        wallet_address = request.query_params.get("wallet_address")
        if not wallet_address:
            raise ValidationError({"wallet_address": "This query parameter is required."})

        wallet_address = wallet_address.strip()
        if not Web3.is_address(wallet_address):
            raise NotFound("Wallet not found.")
        wallets = Wallet.objects.owned_by(request.user).verified_evm()
        requested_wallet_ids = list(wallets.filter(address__iexact=wallet_address).values_list("uuid", flat=True))
        if not requested_wallet_ids:
            raise NotFound("Wallet not found.")

        swap_orders = self.filter_queryset(self.get_queryset().for_party_wallets(requested_wallet_ids))
        page = self.paginate_queryset(swap_orders)
        rows = page if page is not None else list(swap_orders)
        party_wallet_ids = {wallet_id for swap in rows for wallet_id in (swap.seller_wallet_id, swap.buyer_wallet_id)}
        viewer_wallets = {
            str(wallet_id): (str(account_id), address.casefold())
            for wallet_id, account_id, address in wallets.filter(pk__in=party_wallet_ids).values_list(
                "uuid", "user_account_id", "address"
            )
        }
        context = {**self.get_serializer_context(), "viewer_wallets": viewer_wallets}
        serializer = self.get_serializer(rows, many=True, context=context)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)
