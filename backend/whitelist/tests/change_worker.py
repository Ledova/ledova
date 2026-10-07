import fcntl
import json
import os
import signal
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid5

import django

from blockchain.tests.outgoing_worker import await_file


def run(directory, phase, actor_id, company_id, submission_id, action="add"):
    os.environ["DJANGO_SETTINGS_MODULE"] = "ledova_backend.settings.test"
    from django.conf import settings

    database = json.loads(os.environ["WHITELIST_TEST_DATABASE"])
    if database["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("Whitelist crash tests require real PostgreSQL")
    settings.DATABASES = {"default": database}
    settings.PRIVATE_MEDIA_ROOT = os.environ["WHITELIST_TEST_PRIVATE_MEDIA_ROOT"]
    settings.BLOCKCHAIN_OPERATOR_KEY = "0x" + "11" * 32
    settings.BLOCKCHAIN_CHAIN_ID = 31337
    settings.SHARE_TOKEN_FACTORY_ADDRESS = "0x" + "c" * 40
    django.setup()

    from django.contrib.auth import get_user_model
    from web3 import Web3

    from blockchain.models import OutgoingOperation, SignedAttempt
    from blockchain.services import outgoing
    from blockchain.tests.outgoing_fixtures import receipt
    from companies.models import Company
    from whitelist.exceptions import WhitelistChangeConflict
    from whitelist.models import (
        CompanyWalletInstruction,
        CompanyWalletInstructionDecision,
    )
    from whitelist.services import changes, company_wallet_instructions
    from whitelist.services.company_wallet_instructions import (
        decide_wallet_instruction,
        preview_wallet_instruction_decision,
    )
    from whitelist.tests.change_fixtures import WhitelistNode

    actor = get_user_model().objects.get(pk=actor_id)
    company = Company.objects.get(pk=company_id)
    node = WhitelistNode()

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
        if phase == "race_pending" or not path.exists():
            return None
        with path.open() as stream:
            fcntl.flock(stream, fcntl.LOCK_SH)
            data = stream.read()
        if data and tx_hash in json.loads(data)["hashes"]:
            return receipt(SignedAttempt.objects.get(tx_hash=tx_hash))
        return None

    def signed(*args, **kwargs):
        result = original_sign(*args, **kwargs)
        if phase == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def projected(*args, **kwargs):
        result = original_project(*args, **kwargs)
        if phase == "projected" and result.status == "confirmed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    def before_commit(row, *args, **kwargs):
        result = original_save(row, *args, **kwargs)
        if row.status == "signed":
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    original_sign = outgoing.sign_operation
    original_project = changes._project
    original_save = OutgoingOperation.save
    node.client.send_raw_transaction.side_effect = send
    node.client.get_transaction_receipt.side_effect = observed
    with ExitStack() as stack:
        stack.enter_context(patch.object(changes, "get_base_chain_client", return_value=node.client))
        stack.enter_context(
            patch.object(company_wallet_instructions, "get_base_chain_client", return_value=node.client)
        )
        stack.enter_context(patch.object(outgoing, "sign_operation", signed))
        stack.enter_context(patch.object(changes, "_project", projected))
        if phase == "before_commit":
            stack.enter_context(patch.object(OutgoingOperation, "save", before_commit))
        if phase.startswith("race"):
            (directory / f"ready-{os.getpid()}").touch()
            await_file(directory / "go")
        try:
            proposal = CompanyWalletInstruction.objects.get(pk=submission_id, company=company, action=action)
            if proposal.status == "applied":
                prior = CompanyWalletInstructionDecision.objects.get(instruction=proposal, kind="apply")
                digest = prior.digest
            else:
                _, preview = preview_wallet_instruction_decision(
                    actor=actor,
                    instruction_id=proposal.pk,
                    appointment=proposal.preparing_appointment_id,
                    kind="apply",
                    reason="",
                )
                digest = preview["preview_digest"]
            applied = decide_wallet_instruction(
                actor=actor,
                instruction_id=proposal.pk,
                appointment=proposal.preparing_appointment_id,
                kind="apply",
                idempotency_key=uuid5(NAMESPACE_URL, f"whitelist-worker:{proposal.pk}"),
                preview_digest=digest,
                confirmation=True,
                reason="",
            )
            if phase == "admitted":
                os.kill(os.getpid(), signal.SIGKILL)
            result = changes.recover(applied.change_id)
            outcome = result.status
        except WhitelistChangeConflict:
            outcome = "conflict"
    print(json.dumps({"status": outcome}))


if __name__ == "__main__":
    run(Path(sys.argv[1]), *sys.argv[2:])
