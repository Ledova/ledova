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

    database = json.loads(os.environ["MINT_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Mint crash tests require real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    django.setup()

    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from blockchain.tests.outgoing_fixtures import receipt
    from tokens.models import MintRequest
    from tokens.services import mint_service
    from tokens.tests.mint_request_fixtures import MintNode

    request = MintRequest.objects.get(pk=request_id)
    node = MintNode()

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
        if data and tx_hash in json.loads(data)["hashes"]:
            return receipt(SignedAttempt.objects.get(tx_hash=tx_hash))
        return None

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

    original_admit = mint_service._admit
    original_sign = outgoing.sign_operation
    original_save = OutgoingOperation.save
    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    with ExitStack() as stack:
        stack.enter_context(patch("tokens.services.mint_service.get_base_chain_client", return_value=node.client))
        stack.enter_context(patch.object(mint_service, "_admit", admitted))
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase == "recover":
            result = mint_service.recover(request.pk)
        else:
            mint_service.execute(request, request.requested_by, retry_of=UUID(retry_of) if retry_of else None)
            result = request.status
    print(json.dumps({"status": result}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
