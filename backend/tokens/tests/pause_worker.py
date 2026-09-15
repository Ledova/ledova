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


def run(directory, phase, submission_id):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["PAUSE_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Pause crash evidence requires real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    django.setup()

    from django.db import connection
    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from tokens.models import PauseChange
    from tokens.services import pause_changes, pause_recovery
    from tokens.tests.pause_fixtures import PauseNode

    command = PauseChange.objects.get(pk=submission_id)
    node = PauseNode(command.contract_address)

    def send(raw):
        with (directory / "node.json").open("a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            stream.seek(0)
            data = stream.read()
            ledger = json.loads(data) if data else {"hashes": [], "broadcasts": [], "reverted": []}
            tx_hash = Web3.to_hex(Web3.keccak(raw))
            ledger["broadcasts"].append(Web3.to_hex(raw))
            if tx_hash not in ledger["hashes"]:
                ledger["hashes"].append(tx_hash)
            if phase == "reverted" and tx_hash not in ledger["reverted"]:
                ledger["reverted"].append(tx_hash)
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
        ledger = json.loads(data) if data else {"hashes": [], "reverted": []}
        if tx_hash in ledger["hashes"]:
            node.receipt_status = int(tx_hash not in ledger["reverted"])
            return node.receipt(SignedAttempt.objects.get(tx_hash=tx_hash))
        return None

    original_open = outgoing.open_operation
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    original_decide = pause_recovery._decide
    original_outcome = pause_recovery._record_outcome
    original_project = pause_changes.project

    def opened(*args, **kwargs):
        result = original_open(*args, **kwargs)
        if phase == "opened":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def signed(*args, **kwargs):
        if phase == "sign_wait":
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                process_id = cursor.fetchone()[0]
            marker = directory / "sign-ready.tmp"
            marker.write_text(str(process_id))
            marker.replace(directory / "sign-ready")
            await_file(directory / "sign-go")
        result = original_sign(*args, **kwargs)
        if phase == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def before_commit(row, *args, **kwargs):
        result = original_save(row, *args, **kwargs)
        if row.status == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def decided(*args, **kwargs):
        result = original_decide(*args, **kwargs)
        if phase == "decided":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def outcome(*args, **kwargs):
        if phase == "reverted":
            os.kill(os.getpid(), signal.SIGKILL)
        result = original_outcome(*args, **kwargs)
        if phase == "outcome":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def projected(*args, **kwargs):
        result = original_project(*args, **kwargs)
        if phase == "completed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    if phase == "observe_true":

        def approved(**kwargs):
            (directory / "observation-ready").touch()
            await_file(directory / "release-observation")
            return True

        node.contract.functions.paused.return_value.call.side_effect = approved
    with ExitStack() as stack:
        stack.enter_context(patch.object(pause_recovery, "get_base_chain_client", return_value=node.client))
        stack.enter_context(patch.object(outgoing, "open_operation", opened))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(pause_recovery, "_decide", decided))
        stack.enter_context(patch.object(pause_recovery, "_record_outcome", outcome))
        stack.enter_context(patch.object(pause_changes, "project", projected))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase == "race":
            (directory / f"ready-{os.getpid()}").touch()
            await_file(directory / "go")
        result = pause_recovery.recover(submission_id)
    print(json.dumps({"status": result.status, "completed": result.completed_at is not None}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
