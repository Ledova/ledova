import fcntl
import json
import os
import signal
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import django

from blockchain.tests.outgoing_worker import await_file


def run(directory, phase, transaction_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["SWAP_EXECUTION_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Swap crash evidence requires PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    settings.ATOMIC_SWAP_ADDRESS = "0x" + "9d" * 20
    django.setup()

    from django.contrib.auth import get_user_model
    from django.db.models import QuerySet
    from web3 import Web3

    from blockchain.models import (
        BlockchainTransaction,
        OutgoingOperation,
        SignedAttempt,
    )
    from blockchain.services import outgoing
    from tokens.models import SwapOrder
    from tokens.services import swap_execution
    from tokens.tests.swap_execution_fixtures import ExecutionNode, execution_receipt
    from tokens.tests.swap_state_fixtures import BUYER

    if phase == "admission":
        admission = json.loads(os.environ["SWAP_EXECUTION_TEST_ADMISSION"])
        with patch.object(swap_execution, "publish_trading_event"):
            swap_execution.submit_signature(
                SwapOrder.objects.get(pk=admission["swap_uuid"]),
                admission["signature"],
                BUYER.address,
                user=get_user_model().objects.get(pk=admission["actor_id"]),
                participant="buyer",
            )
        os.kill(os.getpid(), signal.SIGKILL)
    record = BlockchainTransaction.objects.get(pk=transaction_id)
    node = ExecutionNode(record.function_args)

    def send(raw):
        with (directory / "node.json").open("a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            stream.seek(0)
            data = stream.read()
            ledger = json.loads(data) if data else {"hashes": [], "broadcasts": []}
            tx_hash = Web3.to_hex(Web3.keccak(raw))
            ledger["broadcasts"].append(Web3.to_hex(raw))
            if tx_hash not in ledger["hashes"]:
                ledger["hashes"].append(tx_hash)
            stream.seek(0)
            stream.truncate()
            stream.write(json.dumps(ledger))
            stream.flush()
            os.fsync(stream.fileno())
        if phase == "accepted":
            os.kill(os.getpid(), signal.SIGKILL)
        return tx_hash

    def observed(tx_hash):
        path = directory / "node.json"
        if not path.exists():
            return None
        with path.open() as stream:
            fcntl.flock(stream, fcntl.LOCK_SH)
            data = stream.read()
        ledger = json.loads(data) if data else {"hashes": []}
        if tx_hash in ledger["hashes"]:
            mined = execution_receipt(SignedAttempt.objects.get(tx_hash=tx_hash), record.function_args)
            node.mine(tx_hash, mined)
            return mined
        return None

    original_get = QuerySet.get
    raced = False

    def delayed_get(queryset, *args, **kwargs):
        nonlocal raced
        try:
            return original_get(queryset, *args, **kwargs)
        except OutgoingOperation.DoesNotExist:
            if phase.startswith("race-") and queryset.model is OutgoingOperation and not raced:
                raced = True
                (directory / f"ready-{os.getpid()}").touch()
                await_file(directory / "go")
                if phase == "race-delayed":
                    await_file(directory / "winner-finished")
            raise

    original_open = outgoing.open_operation
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    original_project = swap_execution._project

    def opened(*args, **kwargs):
        result = original_open(*args, **kwargs)
        if phase == "opened":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def signed(*args, **kwargs):
        result = original_sign(*args, **kwargs)
        if phase == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def before_commit(row, *args, **kwargs):
        result = original_save(row, *args, **kwargs)
        if row.status == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def project(*args, **kwargs):
        if phase == "receipt":
            os.kill(os.getpid(), signal.SIGKILL)
        return original_project(*args, **kwargs)

    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    with ExitStack() as stack:
        stack.enter_context(patch.object(swap_execution, "publish_trading_event"))
        stack.enter_context(patch.object(QuerySet, "get", delayed_get))
        stack.enter_context(patch.object(outgoing, "open_operation", opened))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(swap_execution, "_project", project))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        result = swap_execution.recover(transaction_id, client=node.client)
    if phase == "race-winner":
        (directory / "winner-finished").touch()
    print(json.dumps({"status": result}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
