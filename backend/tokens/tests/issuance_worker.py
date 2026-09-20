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


def run(directory, phase, request_id, actor_id, confirmation):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["ISSUANCE_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Issuance crash controls require real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    django.setup()

    from django.contrib.auth import get_user_model
    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from blockchain.tests.outgoing_fixtures import receipt
    from tokens.models import ShareIssuanceExecution, ShareIssuanceRequest
    from tokens.services import issuance_execution
    from tokens.tests.issuance_fixtures import FINALITY_POLICIES, IssuanceNode

    settings.WALLET_CHAIN_FINALITY_POLICIES = FINALITY_POLICIES

    request = ShareIssuanceRequest.objects.get(pk=request_id)
    actor = get_user_model().objects.get(pk=actor_id)
    node = IssuanceNode()

    def ledger():
        path = directory / "node.json"
        if not path.exists():
            return {}
        with path.open() as stream:
            fcntl.flock(stream, fcntl.LOCK_SH)
            data = stream.read()
        return json.loads(data) if data else {}

    def send(raw):
        with (directory / "node.json").open("a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            stream.seek(0)
            data = stream.read()
            current = json.loads(data) if data else {"hashes": [], "broadcasts": []}
            tx_hash = Web3.to_hex(Web3.keccak(raw))
            current["broadcasts"].append(Web3.to_hex(raw))
            if tx_hash not in current["hashes"]:
                current["hashes"].append(tx_hash)
            if phase == "before_revert_projection":
                current.setdefault("reverted", []).append(tx_hash)
            stream.seek(0)
            stream.truncate()
            stream.write(json.dumps(current))
            stream.flush()
            os.fsync(stream.fileno())
        if phase == "accepted":
            os.kill(os.getpid(), signal.SIGKILL)
        return tx_hash

    def observed(tx_hash):
        current = ledger()
        if tx_hash not in current.get("hashes", []):
            return None
        attempt = SignedAttempt.objects.get(tx_hash=tx_hash)
        command = ShareIssuanceExecution.objects.get(operation=attempt.operation)
        return receipt(attempt, int(tx_hash not in current.get("reverted", []))) | {
            "to": command.intent["to"],
            "from": command.intent["sender"],
        }

    def preflight(*args, **kwargs):
        if phase == "preflight_wait":
            (directory / "preflight-ready").touch()
            await_file(directory / "continue")
        return original_preflight(*args, **kwargs)

    def started(*args, **kwargs):
        result = original_start(*args, **kwargs)
        if phase == "claimed":
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

    def projected(command, claim, **kwargs):
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if phase == "before_revert_projection" and operation.status == "reverted":
            os.kill(os.getpid(), signal.SIGKILL)
        if phase == "mined_before_projection" and operation.status == "confirmed":
            (directory / "mined").touch()
            await_file(directory / "finish-projection")
        return original_project(command, claim, **kwargs)

    def opened(*args, **kwargs):
        if phase == "delayed_open":
            (directory / "open-ready").touch()
            await_file(directory / "open")
        result = original_open(*args, **kwargs)
        if phase == "opened":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    original_open = outgoing.open_operation
    original_preflight = issuance_execution._preflight
    original_start = issuance_execution._start
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    original_project = issuance_execution._project
    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    with ExitStack() as stack:
        stack.enter_context(patch("tokens.services.issuance_execution.get_base_chain_client", return_value=node.client))
        stack.enter_context(patch("tokens.tasks.execute_review_request_task.defer"))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(outgoing, "open_operation", opened))
        stack.enter_context(patch("tokens.services.share_token_service.is_recipient_whitelisted", return_value=True))
        stack.enter_context(patch("tokens.services.share_token_service.seed_recipient_holding"))
        stack.enter_context(patch.object(issuance_execution, "_preflight", preflight))
        stack.enter_context(patch.object(issuance_execution, "_start", started))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase in ("before_revert_projection", "mined_before_projection"):
            stack.enter_context(patch.object(issuance_execution, "_project", projected))
        existing = ShareIssuanceExecution.objects.filter(request_id=request.pk).first()
        if phase != "recover" and (existing is None or existing.subscription_id is None):
            issuance_execution.admit(request, actor, confirmed=confirmation)
        if phase == "admitted":
            os.kill(os.getpid(), signal.SIGKILL)
        if phase == "race":
            (directory / f"ready-{os.getpid()}").touch()
            await_file(directory / "go")
        result = issuance_execution.recover(request.dispatch_id)
    print(json.dumps(result))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
