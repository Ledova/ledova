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


def run(directory, phase, deployment_id, actor_id=None, confirmation=None):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["APPROVAL_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Approval crash evidence requires real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    settings.SHARE_TOKEN_FACTORY_ADDRESS = "0x" + "f" * 40
    settings.ATOMIC_SWAP_ADDRESS = "0x" + "d" * 40
    django.setup()

    from django.contrib.auth import get_user_model
    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from tokens.models import ShareToken, TokenDeployment
    from tokens.services import swap_approval
    from tokens.tests.swap_approval_fixtures import ApprovalNode, approval_receipt

    node = ApprovalNode()

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
            return approval_receipt(SignedAttempt.objects.get(tx_hash=tx_hash), int(tx_hash not in ledger["reverted"]))
        return None

    original_open = outgoing.open_operation
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    original_decide = swap_approval._decide
    original_outcome = swap_approval._record_outcome

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

    def decided(*args, **kwargs):
        result = original_decide(*args, **kwargs)
        if phase == "decided":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def outcome(*args, **kwargs):
        if phase == "reverted":
            os.kill(os.getpid(), signal.SIGKILL)
        return original_outcome(*args, **kwargs)

    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    if phase == "observe_true":

        def approved(**kwargs):
            (directory / "observation-ready").touch()
            await_file(directory / "release-observation")
            return True

        node.contract.functions.approvedShareTokens.return_value.call.side_effect = approved
    with ExitStack() as stack:
        stack.enter_context(patch.object(swap_approval, "get_base_chain_client", return_value=node.client))
        stack.enter_context(patch.object(outgoing, "open_operation", opened))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(swap_approval, "_decide", decided))
        stack.enter_context(patch.object(swap_approval, "_record_outcome", outcome))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase in ("race", "retry_race"):
            (directory / f"ready-{os.getpid()}").touch()
            await_file(directory / "go")
        if phase == "retry_race":
            command = TokenDeployment.objects.get(pk=deployment_id)
            token = ShareToken.objects.get(pk=command.token_id)
            swap_approval.retry(token, get_user_model().objects.get(pk=actor_id), confirmation)
        result = swap_approval.recover(deployment_id)
    print(json.dumps({"status": result}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
