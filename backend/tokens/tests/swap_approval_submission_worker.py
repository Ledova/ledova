import fcntl
import json
import os
import signal
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import django


def run(directory, phase, swap_id, actor_id, raw_hex):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["APPROVAL_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Approval crash evidence requires real PostgreSQL")
    settings.DATABASES = {"default": database}
    for key, value in json.loads(os.environ["APPROVAL_TEST_SETTINGS"]).items():
        setattr(settings, key, value)
    django.setup()

    from web3 import Web3

    from integrations.base_chain.exceptions import BaseChainTransactionError
    from shared.db import use_operator
    from tokens.models import SwapApprovalSubmission, SwapOrder
    from tokens.services import approval_submissions, atomic_swap_service

    raw = bytes.fromhex(raw_hex.removeprefix("0x"))
    tx_hash = Web3.keccak(raw).to_0x_hex()
    ledger_path = directory / "node.json"

    def ledger(update=None):
        with ledger_path.open("a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            stream.seek(0)
            data = stream.read()
            state = json.loads(data) if data else {"broadcasts": [], "mined": []}
            if update is not None:
                update(state)
                stream.seek(0)
                stream.truncate()
                stream.write(json.dumps(state))
                stream.flush()
                os.fsync(stream.fileno())
        return state

    def receipt_for(observed):
        if observed not in ledger()["mined"]:
            return None
        return {
            "transactionHash": observed,
            "status": 1,
            "blockNumber": 7,
            "blockHash": "0x" + "ef" * 32,
            "gasUsed": 21000,
        }

    def send(sent):
        def accept(state):
            state["broadcasts"].append(Web3.to_hex(sent))
            state["mined"].append(Web3.keccak(bytes(sent)).to_0x_hex())

        ledger(accept)
        if phase == "accepted":
            os.kill(os.getpid(), signal.SIGKILL)
        return Web3.keccak(bytes(sent)).to_0x_hex()

    def wait(observed, timeout=120):
        receipt = receipt_for(observed)
        if receipt is None:
            raise BaseChainTransactionError("Transaction not found")
        return receipt

    client = Mock(chain_id=settings.BLOCKCHAIN_CHAIN_ID)
    client.assert_expected_chain = Mock(return_value=settings.BLOCKCHAIN_CHAIN_ID)
    client.w3.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID
    client.w3.eth.get_transaction_count.return_value = 0
    client.to_checksum_address.side_effect = Web3.to_checksum_address
    client.send_raw_transaction.side_effect = send
    client.get_transaction_receipt.side_effect = receipt_for
    client.receipt_even_if_reverted.side_effect = wait

    original_record = approval_submissions.record
    original_receipt = approval_submissions._record_receipt

    def committed(*args, **kwargs):
        result = original_record(*args, **kwargs)
        if phase == "committed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def received(*args, **kwargs):
        if phase == "received":
            os.kill(os.getpid(), signal.SIGKILL)
        return original_receipt(*args, **kwargs)

    with ExitStack() as stack:
        stack.enter_context(patch.object(atomic_swap_service, "get_base_chain_client", return_value=client))
        stack.enter_context(patch.object(approval_submissions, "record", committed))
        stack.enter_context(patch.object(approval_submissions, "_record_receipt", received))
        if phase == "recover":
            with use_operator():
                submission = SwapApprovalSubmission.objects.get(tx_hash=tx_hash)
                outcome = approval_submissions.attempt(submission.pk, client=client)
            print(json.dumps({"outcome": outcome}))
            return
        swap = SwapOrder.objects.get(pk=swap_id)
        atomic_swap_service.broadcast_settlement_approval(
            swap, "seller", raw_hex, lambda snapshot: SwapOrder.objects.get(pk=snapshot.pk), int(actor_id)
        )
    print(json.dumps({"outcome": "confirmed"}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
