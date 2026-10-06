from django.db import IntegrityError
from rest_framework.exceptions import ValidationError

from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic
from wallets.constants import WALLET_VERIFICATION_STATUS_PENDING
from wallets.models import Wallet
from whitelist.constants import WALLET_REFRESH_DELAY_SECONDS
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_wallet

DUPLICATE_WALLET = "This wallet address has already been added to your account on this network."


def _refuse_duplicate(wallet):
    matches = Wallet.objects.filter_by_address(wallet.address, chain=wallet.chain).filter(
        user_account_id=wallet.user_account_id
    )
    if not wallet._state.adding:
        matches = matches.exclude(pk=wallet.pk)
    if matches.exists():
        raise ValidationError({"address": DUPLICATE_WALLET}) from None


def register_wallet(**fields):
    wallet = Wallet(**fields, verification_status=WALLET_VERIFICATION_STATUS_PENDING)
    try:
        with atomic():
            wallet.save(force_insert=True)
            portfolio = wallet.user_account.portfolios.order_by("created_at", "uuid").first()
            if portfolio:
                portfolio.wallets.add(wallet)
    except IntegrityError:
        _refuse_duplicate(wallet)
        raise
    return wallet


def update_wallet(wallet, fields):
    for name, value in fields.items():
        setattr(wallet, name, value)
    try:
        with atomic():
            wallet.save()
    except IntegrityError:
        _refuse_duplicate(wallet)
        raise
    return wallet


def delete_wallet(user, wallet_id):
    with invalidation_writer_context(user):
        wallet = Wallet.objects.owned_by(user).select_for_update().get(pk=wallet_id)
        if wallet.chain == BLOCKCHAIN_BASE:
            enqueue_for_wallet(wallet.pk, user, WALLET_REFRESH_DELAY_SECONDS, remove_only=True)
        wallet.delete()
