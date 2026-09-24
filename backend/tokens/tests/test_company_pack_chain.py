import base64
import io
import json
import zipfile
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import BinaryField
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from hexbytes import HexBytes
from web3 import Web3

from blockchain.models import OutgoingOperation, SignedAttempt
from blockchain.tests.outgoing_fixtures import BLOCK_HASH, CHAIN_ID, SENDER
from companies.models import Company, CompanyStatus
from shared.db import use_operator
from shared.tests.tenants import make_tenant
from tokens.models import (
    CapitalIncreaseExecution,
    CapitalIncreaseRequest,
    PauseChange,
    RegisterEntry,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareToken,
    SwapOrder,
    TokenDeployment,
)
from tokens.services import (
    capital_execution,
    deployment,
    issuance_execution,
    pause_changes,
    pause_recovery,
)
from tokens.services.capital_increase import submit_capital_increase
from tokens.services.company_pack import _json, produce_company_pack
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.tests import capital_fixtures
from tokens.tests.deployment_fixtures import (
    CREATED,
    FACTORY,
    DeploymentNode,
    delete_approval_jobs,
)
from tokens.tests.pause_fixtures import PauseNode
from tokens.tests.test_company_pack import (
    ADMIN_STORAGES,
    INSTRUCTION,
    ISOLATED,
    OPERATOR,
    PRODUCED_AT,
    RECIPIENT,
    ProducesPacks,
    consume,
    files_of,
    pack_company,
    pack_staff,
    remanifested,
    text_of,
    zipped,
)
from tokens.tests.test_register_openings import (
    SETTINGS,
    opening_fixture,
    opening_payload,
)
from tokens.tests.test_register_workflow_events import (
    SETTLEMENT,
    SettledTransferFixtures,
)
from tokens.tests.test_settlement_chain_agreement import factory_intent
from tokens.tests.test_swap_finality import CONTRACT, FINALIZED

SIGNED_BYTES = {
    "blockchain.OutgoingHistoryEvidence",
    "blockchain.SignedAttempt",
    "tokens.SwapApprovalSubmission",
    "wallets.BitcoinSubmission",
    "wallets.WalletSubmission",
}
EVIDENCE = (
    "| Record | Proves | Does not prove |\n"
    "| --- | --- | --- |\n"
    "| A register entry's hash and its link to the previous entry | The entry is unchanged since the database wrote "
    "it, and its place in the order | That the entry is right or authorised. The authority is the linked instruction "
    "and its document |\n"
    "| The finalized receipt on an issue or settlement | One provider reported the transaction in that block, with "
    "the named finality policy satisfied | Independent consensus |\n"
    "| An outgoing operation marked `confirmed` | A successful receipt was observed | Confirmation depth, "
    "replacement or reorg repair |\n"
    "| The two signatures on a settlement | The key for each address signed that order under that domain | Who the "
    "person is. Identity is the register's resolution, recorded with its source |\n"
    "| An opening's boundary | One provider reported those holdings and that supply at that block, with the named "
    "finality policy satisfied | Independent consensus |\n"
    "| A pause or settlement approval observed already in place | The contract was read in that state at that block "
    "| Which transaction put it there. The record is an observation, never transaction attribution |\n"
    "| Payment received on a subscription | Who entered what amount, and when | That money moved |\n"
)
FINALIZED_RECEIPT = {"policy": {"version": 1, "mode": "finalized"}, "gas_used": 21000}


def signed_bytes_sources():
    return {
        model._meta.label
        for model in apps.get_models()
        for field in model._meta.concrete_fields
        if isinstance(field, BinaryField) and field.name == "raw_transaction"
    }


def stored_signed_transactions():
    signed = {}
    with use_operator():
        for label in signed_bytes_sources():
            for pk, raw in apps.get_model(label).objects.values_list("pk", "raw_transaction"):
                if raw is not None:
                    signed[f"{label}:{pk}"] = bytes(raw)
        for pk, journal in ShareIssuance.objects.exclude(mint_journal=None).values_list("pk", "mint_journal"):
            for number, entry in enumerate(journal):
                if "raw_transaction" in entry:
                    signed[f"tokens.ShareIssuance:{pk}:{number}"] = bytes(HexBytes(entry["raw_transaction"]))
    return signed


def carried(content, signed):
    blobs = [content, *files_of(content).values()]
    lowered = [blob.lower() for blob in blobs]
    return sorted(
        label
        for label, raw in signed.items()
        if any(form in blob for blob in blobs for form in (raw, base64.b64encode(raw), base64.urlsafe_b64encode(raw)))
        or any(raw.hex().encode() in blob for blob in lowered)
    )


def deflated(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    return buffer.getvalue()


def rewritten(files, path, change):
    content = json.loads(files[path])
    change(content)
    return zipped(remanifested({**files, path: json.dumps(content).encode()}))


def attempts_of(operation):
    return [
        {
            "tx_hash": attempt.tx_hash,
            "nonce": attempt.nonce,
            "signer": attempt.signer.address,
            "chain_id": attempt.signer.chain_id,
            "signed_at": attempt.created_at.isoformat(),
        }
        for attempt in SignedAttempt.objects.filter(operation=operation)
        .select_related("signer")
        .order_by("created_at", "uuid")
    ]


def listed(operation, purpose, record):
    operation = OutgoingOperation.objects.select_related("current_attempt").get(pk=operation.pk)
    return {
        "key": operation.operation_key,
        "purpose": purpose,
        "record": str(record),
        "intent": operation.intent,
        "status": operation.status,
        "last_error": operation.last_error,
        "opened_at": operation.created_at.isoformat(),
        "acknowledged_at": operation.acknowledged_at.isoformat(),
        "receipt": (
            None
            if operation.block_number is None
            else {
                "block_number": operation.block_number,
                "block_hash": operation.block_hash,
                "gas_used": operation.gas_used,
            }
        ),
        "current_attempt": operation.current_attempt.tx_hash,
        "attempts": attempts_of(operation),
    }


def paused(token, owner, value, *, confirmed=True):
    node = PauseNode(token.contract_address)
    node.paused, node.confirmed = not value, confirmed
    with patch("tokens.services.pause_recovery.get_base_chain_client", return_value=node.client), use_operator():
        change = pause_changes.submit(ShareToken.objects.get(pk=token.pk), owner, uuid4(), value)
        return pause_recovery.recover(change.pk)


def raised(request, owner, *, reverted_first):
    node = capital_fixtures.CapitalNode()
    actor = get_user_model().objects.create_superuser(email=f"capital-{uuid4()}@example.test", password="synthetic")
    with patch("tokens.services.capital_execution.get_base_chain_client", return_value=node.client), use_operator():
        request = CapitalIncreaseRequest.objects.get(pk=request.pk)
        submit_capital_increase(request, owner)
        request.approve(actor)
        if reverted_first:
            node.receipt_status = 0
            capital_execution.recover(capital_fixtures.admit(request, actor).pk)
            node.receipt_status = 1
        capital_execution.recover(capital_fixtures.admit(request, actor).pk)
        return CapitalIncreaseExecution.objects.select_related("operation__current_attempt", "transaction").get(
            request_id=request.pk
        )


def produced(company, owner):
    with use_operator():
        archive, _ = produce_company_pack(company, owner, instruction=INSTRUCTION, recipient=RECIPIENT)
    return archive.read()


def chain_records(operations, records):
    with use_operator():
        hashes = SignedAttempt.objects.filter(operation__in=operations).values_list("tx_hash", flat=True)
        return [str(value).lower() for value in (*(item.operation_key for item in operations), *hashes, *records)]


class ChainFixtures(SettledTransferFixtures):
    def setUp(self):
        super().setUp()
        self.open_register()
        self.complete()
        executed = self.admitted()
        with use_operator():
            issuance_execution.recover(executed.pk)
        self.instruct()
        with use_operator():
            self.token = ShareToken.objects.get(pk=self.swap.share_token_id)
            self.company = Company.objects.get(pk=self.token.company_id)
        self.capital = raised(self.fixture.seller.capital_increase, self.owner, reverted_first=True)
        self.second = self.deployed(self.fixture.seller.token)
        self.pause = paused(self.token, self.owner, True)
        self.unpause = paused(self.token, self.owner, False, confirmed=False)
        with use_operator():
            self.executed = ShareIssuanceExecution.objects.select_related("operation", "transaction").get(
                pk=executed.pk
            )
            self.swap = SwapOrder.objects.select_related("transaction__outgoing_operation__current_attempt").get(
                pk=self.swap.pk
            )
            self.settlement = self.swap.transaction.outgoing_operation
            self.deployment = TokenDeployment.objects.select_related("operation", "transaction").get(
                token_id=self.second.pk
            )

    def deployed(self, token):
        node = DeploymentNode()
        with use_operator():
            Company.objects.filter(pk=token.company_id).update(
                status=CompanyStatus.ACTIVE, operator_wallet=self.fixture.seller.wallet
            )
            token = ShareToken.objects.get(pk=token.pk)
            with patch("tokens.tasks.deploy_share_token_task.defer"):
                deployment.start_deployment(token, principal_id=self.owner.pk)
            self.addCleanup(delete_approval_jobs, token.deployment_id)
            with (
                patch("tokens.services.deployment.get_base_chain_client", return_value=node.client),
                patch("tokens.services.share_token_service.get_base_chain_client", return_value=node.client),
            ):
                deployment.deploy_token(token)
            return ShareToken.objects.get(pk=token.pk)

    def operations(self):
        return [
            self.settlement,
            self.executed.operation,
            self.capital.operation,
            self.pause.operation,
            self.unpause.operation,
            self.deployment.operation,
        ]

    def pack(self, company=None):
        return produced(company or self.company, self.owner)

    def read(self, files, name, token=None):
        return json.loads(files[f"classes/{(token or self.token).pk}/{name}"])


@override_settings(**SETTLEMENT, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY, WALLET_CHAIN_FINALITY_POLICIES=FINALIZED)
class CompanyPackChainTest(ChainFixtures, TransactionTestCase):
    def test_the_chain_file_lists_every_operation_with_its_intent_status_receipt_and_each_signed_attempt(self):
        files = files_of(self.pack())

        with use_operator():
            self.assertEqual(
                self.read(files, "chain.json")["operations"],
                [
                    listed(self.settlement, "settlement", self.swap.pk),
                    listed(self.executed.operation, "issuance", self.executed.pk),
                    listed(self.capital.operation, "capital_increase", self.capital.pk),
                    listed(self.pause.operation, "pause", self.pause.pk),
                    listed(self.unpause.operation, "pause", self.unpause.pk),
                ],
            )
            self.assertEqual(
                self.read(files, "chain.json", self.second)["operations"],
                [listed(self.deployment.operation, "deployment", self.deployment.pk)],
            )
            reverted, retried = SignedAttempt.objects.filter(operation=self.capital.operation).order_by("nonce")
        capital = self.read(files, "chain.json")["operations"][2]
        self.assertEqual(
            ([attempt["tx_hash"] for attempt in capital["attempts"]], capital["current_attempt"], capital["status"]),
            ([reverted.tx_hash, retried.tx_hash], retried.tx_hash, "confirmed"),
        )
        self.assertEqual(
            [
                (operation["status"], len(operation["attempts"]), operation["receipt"] is None)
                for operation in self.read(files, "chain.json")["operations"]
            ],
            [("confirmed", 1, False)] * 2 + [("confirmed", 2, False), ("confirmed", 1, False), ("signed", 1, True)],
        )

    def test_the_deployment_record_is_carried_in_full_with_its_swap_approval(self):
        files = files_of(self.pack())

        record = self.deployment
        self.assertEqual(
            self.read(files, "chain.json", self.second)["deployment"],
            {
                "uuid": str(record.pk),
                "intent": record.intent,
                "operation": f"token-deployment:{record.pk}",
                "transaction": record.transaction.tx_hash,
                "contract_address": CREATED,
                "attribution_required": False,
                "projected_at": record.projected_at.isoformat(),
                "swap_approval": {
                    "intent": record.approval_intent,
                    "outcome": "pending",
                    "operation": None,
                    "transaction": None,
                    "observation": None,
                },
            },
        )
        self.assertEqual(
            (record.intent["sender"], record.approval_intent["to"], record.approval_intent["token"]),
            (SENDER.lower(), CONTRACT.lower(), CREATED.lower()),
        )
        self.assertIsNone(self.read(files, "chain.json")["deployment"])
        self.assertEqual(
            [
                (item["symbol"], item["owner_at_deployment"], item["approved_on"])
                for item in json.loads(files["contracts/contracts.json"])["classes"]
            ],
            [("DEP", None, None), ("DRF", SENDER.lower(), CONTRACT.lower())],
        )

    def test_each_settlement_carries_its_signed_order_domain_both_signatures_and_finalized_receipt(self):
        content = self.pack()

        files = files_of(content)
        swap = self.swap
        with use_operator():
            entry = RegisterEntry.objects.get(operation_id=swap.pk)
        self.assertEqual(
            self.read(files, "settlements.json"),
            [
                {
                    "uuid": str(swap.pk),
                    "status": "completed",
                    "protocol_version": 1,
                    "typed_data": swap.settlement_context["typed_data"],
                    "order_hash": swap.order_hash,
                    "digest": swap.settlement_digest,
                    "seller_signature": self.fixture.signatures["seller"],
                    "buyer_signature": self.fixture.signatures["buyer"],
                    "transaction": self.settlement.current_attempt.tx_hash,
                    "operation": f"swap-execution:{swap.transaction_id}",
                    "finalized_receipt": {**FINALIZED_RECEIPT, "block_number": 12, "block_hash": BLOCK_HASH},
                    "completed_at": swap.completed_at.isoformat(),
                    "entry": str(entry.pk),
                }
            ],
        )
        self.assertEqual(
            swap.settlement_context["typed_data"]["domain"],
            {
                "name": "LedovaAtomicSwap",
                "version": "1",
                "chainId": str(CHAIN_ID),
                "verifyingContract": Web3.to_checksum_address(CONTRACT),
            },
        )
        self.assertEqual((entry.kind, self.read(files, "settlements.json", self.second)), ("transfer", []))
        parties = [
            swap.settlement_context[side][field]
            for side in ("seller", "buyer")
            for field in ("order_uuid", "owner_account_uuid", "wallet_uuid")
        ]
        text = text_of(content)
        self.assertTrue(all(parties) and str(swap.pk) in text)
        self.assertEqual([party for party in parties if party in text], [])

    def test_issues_capital_increases_and_pauses_name_the_transactions_and_operations_that_carried_them(self):
        files = files_of(self.pack())

        executed, capital = self.executed, self.capital
        issue = self.read(files, "issues.json")["issues"][0]
        self.assertEqual(
            (issue["issuance"]["transaction"], issue["execution"]),
            (
                executed.transaction.tx_hash,
                {
                    "uuid": str(executed.pk),
                    "status": "executed",
                    "authority": executed.authority,
                    "intent": executed.intent,
                    "operation": executed.operation.operation_key,
                    "transaction": executed.transaction.tx_hash,
                    "finalized_receipt": {**FINALIZED_RECEIPT, "block_number": 14, "block_hash": "0x" + f"{14:064x}"},
                },
            ),
        )
        klass = self.read(files, "class.json")
        self.assertEqual(
            klass["cap_increases"][0]["execution"],
            {
                "uuid": str(capital.pk),
                "intent": capital.intent,
                "operation": capital.operation.operation_key,
                "transaction": capital.transaction.tx_hash,
                "attribution_evidence": None,
                "projected_at": capital.projected_at.isoformat(),
            },
        )
        self.assertEqual(capital.transaction.tx_hash, capital.operation.current_attempt.tx_hash)
        with use_operator():
            changes = list(
                PauseChange.objects.filter(token_id=self.token.pk).select_related("operation").order_by("created_at")
            )
        self.assertEqual(
            [
                {
                    key: pause[key]
                    for key in ("uuid", "status", "intent", "observation", "operation", "contract_address")
                }
                for pause in klass["pauses"]
            ],
            [
                {
                    "uuid": str(change.pk),
                    "status": status,
                    "intent": change.intent,
                    "observation": None,
                    "operation": change.operation.operation_key,
                    "contract_address": self.token.contract_address.lower(),
                }
                for change, status in zip(changes, ("confirmed", "executing"), strict=True)
            ],
        )
        self.assertEqual([change.intent["data"] for change in changes], ["0x8456cb59", "0x3f4ba83a"])

    def test_no_stored_signed_transaction_appears_anywhere_in_the_pack(self):
        content = self.pack()

        signed = stored_signed_transactions()
        self.assertEqual(signed_bytes_sources(), SIGNED_BYTES)
        with use_operator():
            ours = {
                f"blockchain.SignedAttempt:{pk}"
                for pk in SignedAttempt.objects.filter(operation__in=self.operations()).values_list("pk", flat=True)
            }
        self.assertEqual((len(ours), ours <= set(signed)), (7, True))
        self.assertEqual(carried(content, signed), [])

        label = min(ours, key=lambda item: len(signed[item]))
        planted = signed[label].hex()
        with use_operator():
            original = Company.objects.get(pk=self.company.pk).trading_name
            Company.objects.filter(pk=self.company.pk).update(trading_name=planted)
        self.assertEqual(carried(self.pack(), signed), [label])

        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(trading_name=original)
        self.assertEqual(carried(self.pack(), signed), [])

    def test_the_readme_states_what_the_evidence_proves_and_the_handover_calls_in_order(self):
        readme = files_of(self.pack())["README.md"].decode()

        dep, drf = self.token.contract_address, self.second.contract_address
        swap, acn = CONTRACT.lower(), self.company.acn
        self.assertIn(EVIDENCE, readme)
        self.assertIn(f"| Share class DEP | `{dep}` | not recorded |", readme)
        self.assertIn(f"| Share class DRF | `{drf}` | `{SENDER.lower()}` |", readme)
        handover = readme[readme.index("### Handing over control") : readme.index("Whoever owns the registry")]
        self.assertEqual(
            handover,
            "### Handing over control\n\n"
            "To continue with another provider, the company instructs Ledova's operator in writing to do the "
            "following, in this order, from the owner named above. This pack explains the handover and does not "
            "perform it.\n\n"
            "1. Wait until nothing Ledova has admitted for the company is unresolved: no class still `deploying`, no "
            "settlement approval `pending` or `executing`, no issue's execution `queued` or `executing`, no capital "
            "increase `executing`, no pause `pending` or `executing`, no settlement `executing`, and no approval "
            "change in `approvals.json` `pending` or `executing`. At the as-at time these were unresolved:\n\n"
            "   | Class | What | Record | Status |\n"
            "   | --- | --- | --- | --- |\n"
            f"   | DEP | pause | `{self.unpause.pk}` | executing |\n"
            f"   | DRF | swap_approval | `{self.deployment.pk}` | pending |\n\n"
            "2. Withdraw each deployed share class from the settlement contract, so its relayer can no longer "
            "settle trades in it:\n"
            f"   - DEP: Ledova recorded no approval of it on a settlement contract. If `approvedShareTokens({dep})` is "
            f"true on `{swap}`, call `setShareTokenApproval({dep}, false)` there.\n"
            f"   - DRF: on `{swap}`, call `setShareTokenApproval({drf}, false)`.\n"
            "3. Transfer each deployed share class:\n"
            f"   - DEP: on `{dep}`, call `transferOwnership(newOwner)`.\n"
            f"   - DRF: on `{drf}`, call `transferOwnership(newOwner)`.\n"
            "4. Transfer the company's registry:\n"
            f'   - read its address with `registryOf("{acn}")` on the share class factory, and call '
            "`transferOwnership(newOwner)` on it.\n\n",
        )

    def test_the_consumer_checks_the_chain_evidence_offline_and_names_what_breaks(self):
        content = self.pack()

        result = consume(content, *ISOLATED)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        files = files_of(content)
        folder = f"classes/{self.token.pk}"
        chain_path, class_path, settlements_path = (
            f"{folder}/chain.json",
            f"{folder}/class.json",
            f"{folder}/settlements.json",
        )
        chain = json.loads(files[chain_path])
        current = chain["operations"][2]["current_attempt"]
        first = chain["operations"][0]["attempts"][0]["tx_hash"]
        pause_key = chain["operations"][3]["key"]
        issue_entry = next(entry for entry in json.loads(files[f"{folder}/entries.json"]) if entry["kind"] == "issue")

        def unlinked(klass):
            klass["pauses"][0]["operation"] = None

        for tampering, tampered, refused in (
            (
                "a current attempt left out",
                rewritten(files, chain_path, lambda copy: copy["operations"][2]["attempts"].pop()),
                f"{chain_path} operation 3: its current attempt {current} is not one of its attempts",
            ),
            (
                "an attempt hash malformed",
                rewritten(
                    files, chain_path, lambda copy: copy["operations"][0]["attempts"][0].update(tx_hash=first.upper())
                ),
                f"{chain_path} operation 1: attempt {first.upper()} has no well-formed hash, signer, nonce and chain",
            ),
            (
                "an operation left out",
                rewritten(files, chain_path, lambda copy: copy["operations"].pop(3)),
                f"{chain_path}: the pause {self.pause.pk} names operation {pause_key}, which is not listed for it",
            ),
            (
                "a record's operation link dropped",
                rewritten(files, class_path, unlinked),
                f"{chain_path}: operation {pause_key} is named by no record",
            ),
            (
                "a settlement pointed at the issue entry",
                rewritten(files, settlements_path, lambda copy: copy[0].update(entry=issue_entry["uuid"])),
                f"{settlements_path} settlement 1: entry {issue_entry['uuid']} is not its transfer in entries.json",
            ),
            (
                "a settlement's transaction malformed",
                rewritten(files, settlements_path, lambda copy: copy[0].update(transaction="0x12")),
                f"{settlements_path} settlement 1: its transaction is not a well-formed hash",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(tampered, *ISOLATED)

                self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", f"REFUSED {refused}\n"))

    def test_another_companys_pack_carries_none_of_this_companys_chain_evidence(self):
        with use_operator():
            other = make_tenant("pack-chain-b")
        other_pause = paused(other.deployed_token, other.user, True)
        other_capital = raised(other.capital_increase, other.user, reverted_first=False)
        ours = chain_records(
            self.operations(),
            (
                self.swap.pk,
                self.swap.order_hash,
                self.swap.settlement_digest,
                self.swap.seller_signature,
                self.swap.buyer_signature,
                self.executed.pk,
                self.capital.pk,
                self.pause.pk,
                self.unpause.pk,
                self.deployment.pk,
            ),
        )
        theirs = chain_records([other_pause.operation, other_capital.operation], (other_pause.pk, other_capital.pk))

        our_text, their_text = text_of(self.pack()), text_of(self.pack(other.company))

        self.assertEqual((len(ours), len(theirs)), (23, 6))
        self.assertEqual([record for record in ours if record not in our_text], [])
        self.assertEqual([record for record in theirs if record not in their_text], [])
        self.assertEqual([record for record in ours if record in their_text], [])
        self.assertEqual([record for record in theirs if record in our_text], [])


class CompanyPackScanTest(SimpleTestCase):
    def test_the_scan_finds_signed_bytes_raw_in_hexadecimal_or_in_base64_in_a_stored_or_deflated_file(self):
        raw = bytes(range(7, 107))
        signed = {"planted": raw}

        for form in (
            raw,
            raw.hex().encode(),
            raw.hex().upper().encode(),
            b"0x" + raw.hex().encode(),
            base64.b64encode(raw),
            base64.urlsafe_b64encode(raw),
        ):
            for archive in (zipped, deflated):
                with self.subTest(form=form[:8], archive=archive.__name__):
                    self.assertEqual(carried(archive({"chain.json": b'{"x": "' + form + b'"}'}), signed), ["planted"])
        self.assertEqual(carried(deflated({"chain.json": raw.hex()[:-2].encode()}), signed), [])

    def test_bytes_cannot_be_written_into_a_pack_file(self):
        for value in (b"\xf8\x6b", bytearray(b"\xf8\x6b"), memoryview(b"\xf8\x6b")):
            with (
                self.subTest(kind=type(value).__name__),
                self.assertRaisesMessage(TypeError, "value is not written into a company pack"),
            ):
                _json({"raw_transaction": value})
        identifier = uuid4()
        self.assertEqual(
            json.loads(_json({"at": PRODUCED_AT, "id": identifier, "amount": Decimal("2.50")})),
            {"at": PRODUCED_AT.isoformat(), "id": str(identifier), "amount": "2.50"},
        )


@override_settings(**SETTINGS)
class CompanyPackOpeningBoundaryTest(TransactionTestCase):
    def setUp(self):
        self.tenant, owner, reviewer, document, target, node = opening_fixture()
        proposal = submit_opening(actor=owner, **opening_payload(document, target))
        _, confirmation = prepare_opening_review(proposal_id=proposal.pk, reviewer=reviewer, client=node.client)
        self.opening = decide_opening(
            proposal_id=proposal.pk, reviewer=reviewer, confirmation=confirmation, decision="apply", client=node.client
        )
        self.files = files_of(produced(self.tenant.company, owner))
        self.folder = f"classes/{self.tenant.token.pk}"

    def test_an_applied_opening_carries_its_boundary_and_the_consumer_checks_its_entry_against_it(self):
        authority_path = f"{self.folder}/authority.json"
        opening = json.loads(self.files[authority_path])["openings"][0]
        entry = json.loads(self.files[f"{self.folder}/entries.json"])[0]

        self.assertEqual(
            (opening["uuid"], opening["boundary"], opening["entry"]),
            (str(self.opening.pk), self.opening.boundary, str(self.opening.applied_entry_id)),
        )
        self.assertEqual(
            sorted((row["address"].lower(), row["shares"]) for row in opening["boundary"]["holdings"]),
            [("0x" + "1" * 40, "80"), ("0x" + "2" * 40, "20")],
        )
        self.assertEqual(entry["effective_on"], opening["boundary"]["block"]["date"])
        result = consume(zipped(self.files), *ISOLATED)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        where = f"{authority_path} openings 1"
        holder = opening["boundary"]["holdings"][-1]["address"]

        def changed(change):
            return rewritten(self.files, authority_path, lambda copy: change(copy["openings"][0]))

        for tampering, tampered, refused in (
            (
                "a holding changed",
                changed(lambda record: record["boundary"]["holdings"][0].update(shares="81")),
                f"{where}: entry {entry['uuid']} is not the boundary's holdings on the boundary's date",
            ),
            (
                "the boundary's date changed",
                changed(lambda record: record["boundary"]["block"].update(date="2020-01-01")),
                f"{where}: entry {entry['uuid']} is not the boundary's holdings on the boundary's date",
            ),
            (
                "a holder's mapping removed",
                changed(
                    lambda record: record.update(
                        mapping=[link for link in record["mapping"] if link["address"].lower() != holder.lower()]
                    )
                ),
                f"{where}: wallet {holder} holds shares at the boundary and is mapped to no member",
            ),
            (
                "the boundary removed",
                changed(lambda record: record.update(boundary=None)),
                f"{where}: an applied opening carries the boundary it was reviewed against",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(tampered, *ISOLATED)

                self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", f"REFUSED {refused}\n"))

    def test_the_deployment_names_its_confirmed_operation_and_a_swap_approval_that_was_not_configured(self):
        chain = json.loads(self.files[f"{self.folder}/chain.json"])

        with use_operator():
            record = TokenDeployment.objects.select_related("operation").get(token_id=self.tenant.token.pk)
            operation = listed(record.operation, "deployment", record.pk)
            address = ShareToken.objects.get(pk=self.tenant.token.pk).contract_address
        self.assertEqual(chain["operations"], [operation])
        self.assertEqual(
            (chain["deployment"]["operation"], chain["deployment"]["swap_approval"]),
            (
                operation["key"],
                {
                    "intent": None,
                    "outcome": "not_configured",
                    "operation": None,
                    "transaction": None,
                    "observation": None,
                },
            ),
        )
        self.assertEqual((operation["status"], len(operation["attempts"])), ("confirmed", 1))
        self.assertIn(
            f"   - {self.tenant.token.symbol}: Ledova recorded no approval of it on a settlement contract. If "
            f"`approvedShareTokens({address})` is true on a settlement contract, call "
            f"`setShareTokenApproval({address}, false)` there.\n",
            self.files["README.md"].decode(),
        )


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackRegistryOwnerTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.client.force_login(pack_staff("pack-registry-staff"))

    def test_the_registry_is_named_with_the_owner_of_its_classes_and_handed_over_last(self):
        readme = files_of(self.pack())["README.md"].decode()

        self.assertIn(
            f"| The company's registry | `{self.a.registry}` | `{OPERATOR}`, the owner of its share classes |", readme
        )
        self.assertIn("Nothing was unresolved at the as-at time.\n2. Withdraw", readme)
        self.assertIn(
            "3. Transfer each deployed share class:\n"
            f"   - DEP: on `{self.a.ordinary.contract_address}`, call `transferOwnership(newOwner)`.\n"
            "4. Transfer the company's registry:\n"
            f"   - on `{self.a.registry}`, call `transferOwnership(newOwner)`.\n",
            readme,
        )

    def test_classes_deployed_by_different_keys_leave_the_registry_owner_unestablished(self):
        other = "0x" + "0f" * 20
        ShareToken.objects.filter(pk=self.a.preference.pk).update(contract_address="0x" + "d1" * 20, status="deployed")
        TokenDeployment.objects.create(
            token_id=self.a.preference.pk,
            company_id=self.a.company.pk,
            intent={**factory_intent(self.a.preference, settings.BLOCKCHAIN_CHAIN_ID), "sender": other},
        )

        files = files_of(self.pack())

        self.assertIsNone(json.loads(files["contracts/contracts.json"])["registries"][0]["owner"])
        self.assertIn(
            f"| The company's registry | `{self.a.registry}` | the owner of its share classes, which Ledova's records "
            "do not establish |",
            files["README.md"].decode(),
        )
