import fcntl
import json
import os
import signal
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

import django

from blockchain.tests.outgoing_worker import await_file


def run(directory, phase, request_id, retry_of=None):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["DEPLOYMENT_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Deployment crash tests require real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    settings.SHARE_TOKEN_FACTORY_ADDRESS = "0x" + "f" * 40
    django.setup()

    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from blockchain.tests.outgoing_fixtures import receipt
    from tokens.models import ShareToken
    from tokens.services import deployment
    from tokens.tests.deployment_fixtures import CREATED, DeploymentNode

    token = ShareToken.objects.select_related("company").get(pk=request_id)
    node = DeploymentNode()

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

    def node_ledger():
        path = directory / "node.json"
        if not path.exists():
            return {"hashes": [], "reverted": []}
        with path.open() as stream:
            fcntl.flock(stream, fcntl.LOCK_SH)
            data = stream.read()
        return json.loads(data) if data else {"hashes": [], "reverted": []}

    def observed(tx_hash):
        ledger = node_ledger()
        if tx_hash in ledger["hashes"]:
            return receipt(SignedAttempt.objects.get(tx_hash=tx_hash), int(tx_hash not in ledger["reverted"]))
        return None

    def existing_address():
        ledger = node_ledger()
        return CREATED if set(ledger["hashes"]) - set(ledger["reverted"]) else "0x" + "0" * 40

    def admitted(*args, **kwargs):
        result = original_admit(*args, **kwargs)
        if phase == "admitted":
            os.kill(os.getpid(), signal.SIGKILL)
        if phase == "race":
            (directory / f"ready-{os.getpid()}").touch()
            await_file(directory / "go")
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

    original_admit = deployment._admit
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    original_project = deployment._project
    original_outcome = deployment.deployment_journal.record_outcome

    def projected(command):
        if phase == "before_projection":
            os.kill(os.getpid(), signal.SIGKILL)
        return original_project(command)

    def recorded_outcome(*args, **kwargs):
        if phase == "reverted":
            os.kill(os.getpid(), signal.SIGKILL)
        return original_outcome(*args, **kwargs)

    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    node.contract.functions.getTokenByIdentifier.return_value.call.side_effect = existing_address
    with ExitStack() as stack:
        stack.enter_context(patch("tokens.services.deployment.get_base_chain_client", return_value=node.client))
        stack.enter_context(
            patch("tokens.services.share_token_service.get_base_chain_client", return_value=node.client)
        )
        stack.enter_context(patch("tokens.services.share_token_service._approve_for_swap"))
        stack.enter_context(patch.object(deployment, "_admit", admitted))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(deployment, "_project", projected))
        stack.enter_context(patch.object(deployment.deployment_journal, "record_outcome", recorded_outcome))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase == "recover":
            result = deployment.recover(token.deployment_id)
        else:
            result = deployment.deploy_token(token, retry_of=UUID(retry_of) if retry_of else None)["contract_address"]
    print(json.dumps({"status": result}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
