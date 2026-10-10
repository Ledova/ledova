from uuid import uuid4

from django.conf import settings
from django.utils import timezone

from blockchain.models import OutgoingOperation
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import BLOCK_HASH, KEY, chain_client
from shared.db import atomic, use_migrate
from shared.tests.retained_rows import retained_rows
from tokens.models import PauseChange, PauseChangeStatus
from tokens.services import pause_changes
from tokens.tests.retained_guards import PAUSE_GUARDS


def retain_pause_change(
    token, actor, paused=True, *, signed=False, executing=False, observed=False, authority="issuer", submission_id=None
):
    with use_migrate(), retained_rows(*PAUSE_GUARDS):
        intent = pause_changes.transaction_intent(token, paused)
        with pause_changes.target_transaction(intent["chain_id"], intent["to"]):
            current = pause_changes.lock_token(token.pk, token.company_id, actor.pk, authority)
            change = PauseChange.objects.create(
                pk=submission_id or uuid4(),
                token_id=current.pk,
                company_id=current.company_id,
                initiated_by=actor,
                authority=authority,
                paused=paused,
                chain_id=intent["chain_id"],
                contract_address=intent["to"],
                intent=intent,
            )
            if observed:
                change.status = PauseChangeStatus.OBSERVED
                change.observation = {
                    "block_number": 11,
                    "block_hash": BLOCK_HASH,
                    "observed_at": timezone.now().isoformat(),
                }
                change.save(update_fields=["status", "observation", "updated_at"])
            if signed or executing:
                change.status = PauseChangeStatus.EXECUTING
                change.save(update_fields=["status", "updated_at"])
        if signed or executing:
            claim = outgoing.open_operation(pause_changes.operation_key(change), **(intent | {"value": 0}))
            with atomic(durable=True):
                change.operation = OutgoingOperation.objects.get(pk=claim.operation_id)
                change.save(update_fields=["operation", "updated_at"])
            if signed:
                client = chain_client()
                client.assert_expected_chain.return_value = settings.BLOCKCHAIN_CHAIN_ID
                prepared = outgoing.prepare_operation(claim, client)
                outgoing.sign_operation(claim, prepared, KEY)
        change.refresh_from_db()
        return change
