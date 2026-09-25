import json
from copy import deepcopy
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TransactionTestCase, override_settings

from blockchain.exceptions import FreshSignerBootstrapError
from blockchain.models import (
    BlockchainTransaction,
    FreshSignerBootstrap,
    OutgoingOperation,
    SigningAccount,
)
from blockchain.services.fresh_signer import bootstrap_fresh_signer
from blockchain.services.outgoing import close_signer_admission
from blockchain.services.outgoing_inventory import collect_inventory, record_inventory
from blockchain.tests.fresh_signer_fixtures import (
    CHAIN_ID,
    SENDER,
    FreshSignerFixture,
)
from shared.db import atomic
from whitelist.models import WhitelistEntry


class FreshSignerTest(FreshSignerFixture, TransactionTestCase):
    def reject(self, manifest=None):
        with self.assertRaises(FreshSignerBootstrapError):
            bootstrap_fresh_signer(manifest or self.manifest)
        self.assertFalse(FreshSignerBootstrap.objects.exists())
        self.assertFalse(SigningAccount.objects.filter(admission_state="admitted").exists())

    def test_complete_finalized_five_transaction_manifest_admits_and_records_evidence(self):
        result = bootstrap_fresh_signer(self.manifest)
        self.assertFalse(result["unchanged"])
        signer = SigningAccount.objects.get()
        self.assertEqual((signer.admission_state, signer.admission_generation, signer.next_nonce), ("admitted", 1, 5))
        record = FreshSignerBootstrap.objects.get()
        self.assertEqual(str(record.pk), result["bootstrap_id"])
        self.assertEqual(len(record.artifact_identities), 3)
        self.assertEqual(len(record.chain_evidence["transactions"]), 5)
        self.assertEqual(record.chain_evidence["policy"], {"version": 1, "mode": "finalized"})
        self.assertTrue(
            all(item["observation"]["evidence"]["complete"] for item in record.chain_evidence["transactions"])
        )
        self.chain.send_raw_transaction.assert_not_called()
        self.chain.sign_transaction.assert_not_called()

    def test_exact_replay_precedes_history_and_provider_checks_and_preserves_advanced_nonce(self):
        first = bootstrap_fresh_signer(self.manifest)
        SigningAccount.objects.update(next_nonce=9)
        OutgoingOperation.objects.create(operation_key="synthetic-later-work", intent={}, claim_id=uuid4())
        self.chain.reset_mock()
        self.chain.w3.eth.chain_id = 1
        replay = bootstrap_fresh_signer(deepcopy(self.manifest))
        self.assertEqual(replay, first | {"unchanged": True})
        self.assertEqual(SigningAccount.objects.get().next_nonce, 9)
        self.assertEqual(FreshSignerBootstrap.objects.count(), 1)
        self.assertEqual(self.chain.mock_calls, [])
        different = deepcopy(self.manifest)
        different["authorization_reference"] = "different-authorization"
        with self.assertRaisesMessage(FreshSignerBootstrapError, "different bootstrap"):
            bootstrap_fresh_signer(different)

    def test_closing_a_bootstrapped_signer_cannot_be_undone_by_replay(self):
        bootstrap_fresh_signer(self.manifest)
        close_signer_admission(chain_id=CHAIN_ID, sender=SENDER)
        with self.assertRaisesMessage(FreshSignerBootstrapError, "cannot be reopened"):
            bootstrap_fresh_signer(self.manifest)
        self.assertEqual(SigningAccount.objects.get().admission_generation, 2)
        self.assertEqual(SigningAccount.objects.get().admission_state, "closed")

    def test_close_before_first_bootstrap_is_not_initial_generation_zero(self):
        close_signer_admission(chain_id=CHAIN_ID, sender=SENDER)
        self.reject()
        self.assertEqual(SigningAccount.objects.get().admission_generation, 1)
        self.chain.get_transaction.assert_not_called()

    def test_unused_closed_row_is_accepted_but_used_counter_is_not(self):
        signer = SigningAccount.objects.create(chain_id=CHAIN_ID, address=SENDER.lower())
        SigningAccount.objects.filter(pk=signer.pk).update(next_nonce=1)
        self.reject()
        self.assertEqual(SigningAccount.objects.get().next_nonce, 1)

    def test_schema_unknown_missing_bool_version_nonlist_and_attestations_fail_closed(self):
        mutations = [
            lambda m: m.update(extra=True),
            lambda m: m.pop("version"),
            lambda m: m.update(version=True),
            lambda m: m.update(version=2),
            lambda m: m.update(chain_id="84532"),
            lambda m: m.update(environment_id=" "),
            lambda m: m.update(environment_id="x" * 201),
            lambda m: m.update(authorization_reference="x" * 501),
            lambda m: m.update(transactions=tuple(m["transactions"])),
            lambda m: m["transactions"].pop(),
            lambda m: m["transactions"].__setitem__(4, m["transactions"][0]),
            lambda m: m["contracts"].update(extra=SENDER),
            lambda m: m["attestations"].update(extra=True),
            lambda m: m["attestations"].update(fresh_key=1),
            lambda m: m["attestations"].update(producers_stopped=False),
            lambda m: m["attestations"].pop("isolated_environment"),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                manifest = deepcopy(self.manifest)
                mutation(manifest)
                self.reject(manifest)
        self.assertFalse(SigningAccount.objects.exists())
        bootstrap_fresh_signer(self.manifest)

    def test_configured_chain_key_and_contract_disagreement_are_refused(self):
        for changes in (
            {"BLOCKCHAIN_CHAIN_ID": 31337},
            {"BLOCKCHAIN_OPERATOR_KEY": "0x" + "22" * 32},
            {"SHARE_TOKEN_FACTORY_ADDRESS": SENDER},
        ):
            with self.subTest(changes=list(changes)), override_settings(**changes):
                self.reject()
        self.chain.get_transaction.assert_not_called()
        bootstrap_fresh_signer(self.manifest)

    def test_uncached_provider_chain_refuses_even_when_cached_assertion_matches(self):
        self.chain.w3.eth.chain_id = 1
        self.assertEqual(self.chain.assert_expected_chain(), CHAIN_ID)
        self.reject()
        self.chain.w3.eth.chain_id = CHAIN_ID
        bootstrap_fresh_signer(self.manifest)

    def test_transaction_chain_sender_nonce_hash_value_and_exact_creation_or_call_bytes(self):
        for nonce, changes in (
            (0, {"chainId": 1}),
            (1, {"from": "0x" + "22" * 20}),
            (2, {"nonce": 3}),
            (3, {"hash": "0x" + "aa" * 32}),
            (4, {"value": 1}),
            (0, {"input": "0x6000"}),
            (2, {"input": "0x"}),
            (4, {"to": SENDER}),
        ):
            tx_hash = self.manifest["transactions"][nonce]
            original = deepcopy(self.transactions[tx_hash])
            with self.subTest(nonce=nonce, changes=changes):
                self.transactions[tx_hash].update(changes)
                self.reject()
            self.transactions[tx_hash] = original
        bootstrap_fresh_signer(self.manifest)

    def test_receipt_creation_address_sender_outcome_block_and_hash_must_match(self):
        tx_hash = self.manifest["transactions"][0]
        original = deepcopy(self.receipts[tx_hash])
        for changes in (
            {"contractAddress": SENDER},
            {"from": "0x" + "22" * 20},
            {"status": 0},
            {"transactionHash": "0x" + "ff" * 32},
            {"blockHash": "0x" + "aa" * 32},
            {"transactionIndex": None},
        ):
            with self.subTest(changes=changes):
                self.receipts[tx_hash].update(changes)
                self.reject()
                self.receipts[tx_hash] = deepcopy(original)
        bootstrap_fresh_signer(self.manifest)

    def test_second_receipt_identity_must_match_the_finalized_observation(self):
        original = self.chain.get_transaction_receipt.side_effect
        deliveries = 0

        def changed(tx_hash):
            nonlocal deliveries
            deliveries += 1
            receipt = original(tx_hash)
            if deliveries == 3:
                receipt["transactionIndex"] = 1
            return receipt

        self.chain.get_transaction_receipt.side_effect = changed
        self.reject()
        self.chain.get_transaction_receipt.side_effect = original
        bootstrap_fresh_signer(self.manifest)

    def test_finalized_policy_and_canonical_complete_receipt_evidence_are_required(self):
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES={"evm:84532": {"mode": "depth", "depth": 1}}):
            self.reject()
        original = self.chain.w3.eth.get_block.side_effect

        def unavailable(identifier):
            if identifier == "finalized":
                raise RuntimeError("synthetic unavailable tag")
            return original(identifier)

        self.chain.w3.eth.get_block.side_effect = unavailable
        self.reject()
        self.chain.w3.eth.get_block.side_effect = original
        tx_hash = self.manifest["transactions"][0]
        price = self.receipts[tx_hash].pop("effectiveGasPrice")
        self.reject()
        self.receipts[tx_hash]["effectiveGasPrice"] = price
        bootstrap_fresh_signer(self.manifest)

    def test_deployed_code_owner_minter_relayer_and_payment_approval_are_required(self):
        original = self.chain.w3.eth.get_code.side_effect
        self.chain.w3.eth.get_code.side_effect = lambda address: b"wrong"
        self.reject()
        self.chain.w3.eth.get_code.side_effect = original
        for key, field, wrong in (
            ("share_token_factory", "owner", "0x" + "22" * 20),
            ("stablecoin", "minters", False),
            ("atomic_swap", "relayers", False),
            ("atomic_swap", "approvedPaymentTokens", False),
        ):
            call = getattr(self.contracts[self.manifest["contracts"][key].lower()].functions, field).return_value.call
            before = call.return_value
            with self.subTest(field=field):
                call.return_value = wrong
                self.reject()
                call.return_value = before
        bootstrap_fresh_signer(self.manifest)

    def test_latest_and_pending_nonces_must_both_be_exactly_five(self):
        for latest, pending in ((4, 5), (5, 6), (6, 6), (True, 5)):
            with self.subTest(latest=latest, pending=pending):
                self.chain.w3.eth.get_transaction_count.side_effect = lambda address, block: (
                    latest if block == "latest" else pending
                )
                self.reject()
        self.chain.w3.eth.get_transaction_count.side_effect = None
        bootstrap_fresh_signer(self.manifest)

    def test_unattributed_legacy_history_and_unsigned_current_operations_are_refused(self):
        BlockchainTransaction.objects.create(from_address="", tx_type="other")
        self.reject()
        self.chain.get_transaction.assert_not_called()

    def test_current_operation_blocks_first_admission_even_without_signed_attempt(self):
        OutgoingOperation.objects.create(operation_key="synthetic-existing", intent={}, claim_id=uuid4())
        self.reject()
        self.chain.get_transaction.assert_not_called()

    def test_empty_inventory_permanent_limitations_do_not_authorize_or_prevent_verified_fresh_admission(self):
        report = record_inventory(collect_inventory(), uuid4())
        self.assertFalse(report["cutover_authorized"])
        self.assertEqual(report["evidence_count"], 0)
        self.assertFalse(SigningAccount.objects.exists())
        bootstrap_fresh_signer(self.manifest)

    def test_history_is_rechecked_after_provider_observations(self):
        original = self.chain.w3.eth.get_transaction_count

        def appeared(address, block):
            if block == "pending":
                OutgoingOperation.objects.create(operation_key="synthetic-racing-producer", intent={}, claim_id=uuid4())
            return 5

        original.side_effect = appeared
        self.reject()
        self.assertFalse(SigningAccount.objects.exists())

    def test_failed_admission_rolls_back_receipt_and_signer_together(self):
        signer = SigningAccount.objects.create(chain_id=CHAIN_ID, address=SENDER.lower())

        def fail_after_receipt(*args, **kwargs):
            self.assertTrue(FreshSignerBootstrap.objects.exists())
            raise RuntimeError("synthetic failure after receipt insert")

        with patch.object(SigningAccount, "save", side_effect=fail_after_receipt):
            self.reject()
        signer.refresh_from_db()
        self.assertEqual((signer.admission_state, signer.admission_generation, signer.next_nonce), ("closed", 0, 0))
        bootstrap_fresh_signer(self.manifest)

    def test_app_boundary_outer_atomic_and_disabled_autocommit_are_refused(self):
        with patch("blockchain.services.fresh_signer.current_alias", return_value="app"):
            self.reject()
        with atomic():
            self.reject()
        connection.set_autocommit(False)
        try:
            self.reject()
        finally:
            connection.rollback()
            connection.set_autocommit(True)
        self.chain.get_transaction.assert_not_called()
        bootstrap_fresh_signer(self.manifest)

    def test_command_reads_strict_json_and_duplicate_keys_are_refused(self):
        path = self.directory / "manifest.json"
        path.write_text('{"version":1,"version":1}')
        with self.assertRaisesMessage(CommandError, "duplicate keys"):
            call_command("bootstrap_fresh_signer", manifest=path, stdout=StringIO())
        path.write_text(json.dumps(self.manifest))
        output = StringIO()
        call_command("bootstrap_fresh_signer", manifest=path, stdout=output)
        self.assertFalse(json.loads(output.getvalue())["unchanged"])

    def test_existing_unused_closed_signer_can_be_admitted(self):
        signer = SigningAccount.objects.create(chain_id=CHAIN_ID, address=SENDER.lower())
        bootstrap_fresh_signer(self.manifest)
        self.assertEqual(SigningAccount.objects.get().pk, signer.pk)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 5)

    def test_unlinked_legacy_source_is_refused_without_a_current_outgoing_operation(self):
        WhitelistEntry.objects.create(address=SENDER)
        self.reject()
        self.chain.get_transaction.assert_not_called()

    def test_imported_inventory_evidence_is_refused_even_after_the_live_source_is_gone(self):
        source = BlockchainTransaction.objects.create(from_address="", tx_type="other")
        report = record_inventory(collect_inventory(), uuid4())
        self.assertEqual(report["evidence_count"], 1)
        source.delete()
        self.reject()
        self.chain.get_transaction.assert_not_called()

    def test_changed_artifact_build_binding_or_missing_artifacts_refuse_before_rpc(self):
        path = self.directory / "contracts" / "artifacts" / "contracts" / "AUDY.sol" / "AUDY.json"
        original = path.read_text()
        changed = json.loads(original)
        changed["bytecode"] = "0x6000"
        path.write_text(json.dumps(changed))
        self.reject()
        path.unlink()
        self.reject()
        self.chain.get_transaction.assert_not_called()
        path.write_text(original)
        bootstrap_fresh_signer(self.manifest)

    def test_finalized_tag_before_a_receipt_cannot_admit(self):
        original = self.chain.w3.eth.get_block.side_effect
        self.chain.w3.eth.get_block.side_effect = lambda identifier: (
            original(1) if identifier == "finalized" else original(identifier)
        )
        self.reject()
        self.chain.w3.eth.get_block.side_effect = original
        bootstrap_fresh_signer(self.manifest)
