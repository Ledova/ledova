def lock_orders(queryset, *, nowait=False):
    return list(queryset.order_by("pk").select_for_update(of=("self",), nowait=nowait))


def swap_terms(swap):
    return (
        swap.sell_order_id,
        swap.buy_order_id,
        swap.seller_wallet_id,
        swap.buyer_wallet_id,
        swap.share_token_id,
        swap.payment_asset_id,
        swap.seller_address,
        swap.buyer_address,
        swap.share_amount,
        swap.payment_amount,
        swap.nonce,
        swap.order_hash,
        swap.expires_at,
        swap.expiry_release_eligible,
        swap.settlement_protocol_version,
        swap.settlement_context,
        swap.settlement_digest,
    )


def hash_identity(value):
    if not value:
        return ""
    if isinstance(value, bytes):
        return value.hex()
    return value.lower().removeprefix("0x")
