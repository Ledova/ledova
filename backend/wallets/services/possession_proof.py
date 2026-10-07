from contextlib import contextmanager
from datetime import timedelta

from django.conf import settings
from django.db import connections

from shared.db import current_alias
from wallets.models import WalletPossessionProof


@contextmanager
def proof_producer():
    active_connection = connections[current_alias()]
    with active_connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('app.wallet_proof_operation', true)")
        previous = cursor.fetchone()[0] or ""
        cursor.execute("SELECT set_config('app.wallet_proof_operation', 'complete', false)")
    try:
        yield
    finally:
        with active_connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.wallet_proof_operation', %s, false)", [previous])


def retain_possession_proof(wallet, actor, signature, completed_at):
    proof = WalletPossessionProof.objects.create(
        wallet_id=wallet.pk,
        account_id=wallet.user_account_id,
        profile_id=wallet.user_account.user_profile_id,
        verified_by=actor,
        address=wallet.address,
        chain=wallet.chain,
        challenge=wallet.verification_challenge,
        challenge_issued_at=wallet.verification_challenge_issued_at,
        challenge_expires_at=wallet.verification_challenge_issued_at
        + timedelta(minutes=settings.WALLET_VERIFICATION_CHALLENGE_MINUTES),
        signature=signature,
        completed_at=completed_at,
        digest="",
    )
    proof.refresh_from_db(fields=["completed_at", "digest"])
    return proof


def current_possession_proof(wallet):
    return WalletPossessionProof.objects.filter(
        wallet_id=wallet.pk,
        account_id=wallet.user_account_id,
        profile_id=wallet.user_account.user_profile_id,
        verified_by_id=wallet.user_account.user_profile.user_id,
        address=wallet.address,
        chain=wallet.chain,
        signature=wallet.verification_signature,
        completed_at=wallet.verified_at,
    ).first()
