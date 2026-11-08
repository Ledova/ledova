from whitelist.models import WhitelistInvalidationCause
from whitelist.services.eligibility_invalidation import record_invalidation


def refresh_targets(targets, actor=None, remove_only=False, *, cause=None, invalidation_id=None):
    return {"checked": 0, "submitted": 0, "unattributed": 0, "errors": 0}


def enqueue_for_account(
    account_id, actor=None, delay=0, *, cause=WhitelistInvalidationCause.STANDING_LOSS, cause_fields
):
    return record_invalidation(account_id, cause, actor=actor, cause_fields=cause_fields)


def enqueue_for_wallet(wallet_id, actor, delay=0, remove_only=False):
    from wallets.models import Wallet

    wallet = Wallet.objects.get(pk=wallet_id)
    return record_invalidation(
        wallet.user_account_id,
        WhitelistInvalidationCause.WALLET_REMOVAL,
        actor=actor,
        wallet_id=wallet.pk,
        address=wallet.address,
    )


def sweep():
    return {"checked": 0, "submitted": 0, "unattributed": 0, "errors": 0}
