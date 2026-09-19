from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import acting_for, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Holding, HoldingSnapshot, Transaction
from wallets.services import transaction_confirmation
from wallets.services.chain_observations import (
    claim_chain_observation,
    observe_wallet_chain,
)
from wallets.services.holdings import sync_holding
from wallets.tasks.confirmation import confirm_pending_transaction
from wallets.tests.test_chain_observations import ChainObservationFixture


class WalletFinalityFixture(ChainObservationFixture):
    def setUp(self):
        super().setUp()
        self.balance = None
        self.balance_reads = []
        for target, kwargs in (
            ("wallets.services.transaction_confirmation.sync_holding", {"wraps": sync_holding}),
            ("wallets.services.holdings.fetch_chain_balance", {"side_effect": self.read_balance}),
            ("wallets.services.transaction_confirmation.send_transaction_notification.defer", {}),
        ):
            boundary = patch(target, **kwargs)
            result = boundary.start()
            self.addCleanup(boundary.stop)
            if target.endswith(".defer"):
                self.notification = result

    def read_balance(self, wallet, asset):
        from django.db import connections

        from shared.db import current_alias

        self.balance_reads.append((current_alias(), connections[current_alias()].in_atomic_block))
        return self.balance

    def finish(self):
        return confirm_pending_transaction.func(
            self.signed_transfer.hash.to_0x_hex(), str(self.wallet.pk), principal_id=self.tenant.user.pk
        )

    def settle(self):
        with acting_for(self.tenant.user.pk):
            return transaction_confirmation.settle_observed_transaction(
                self.signed_transfer.hash.to_0x_hex(), wallet=self.wallet
            )

    def repair(self):
        with acting_for(self.tenant.user.pk):
            return transaction_confirmation.reconcile_transaction(
                self.signed_transfer.hash.to_0x_hex(), wallet=self.wallet
            )

    def quantity(self):
        with use_operator():
            return Holding.objects.get(pk=self.holding.pk).quantity

    def second_submission(self):
        signed = self.signed(nonce=4, value=10**18)
        with patch("wallets.services.submissions.get_blockchain_client", return_value=self.provider(signed)):
            return self.submit_direct(signed)


class WalletFinalityChecks(WalletFinalityFixture):
    def test_refresh_cannot_restore_a_pending_local_deduction(self):
        with acting_for(self.tenant.user.pk), patch(
            "wallets.services.holdings.fetch_chain_balance", return_value=Decimal("10")
        ):
            sync_holding(self.wallet, self.native)
        with use_operator():
            self.holding.refresh_from_db()
        self.assertEqual(self.holding.quantity, Decimal("7.999958"))
        self.assertEqual(self.transactions()[0]["status"], "pending")

    def test_first_reverted_receipt_waits_for_finalized_head(self):
        self.observer.get_transaction_receipt.return_value["status"] = 0
        earlier = {"hash": "0x" + "33" * 32, "number": 99, "timestamp": 1700000000}
        self.observer.w3.eth.get_block.side_effect = lambda identifier: (
            self.head if identifier == "latest" else earlier if identifier in ("finalized", 99) else self.block
        )
        with patch("wallets.tasks.confirmation.get_blockchain_client", return_value=self.observer):
            confirm_pending_transaction.func(
                self.signed_transfer.hash.to_0x_hex(), str(self.wallet.pk), principal_id=self.tenant.user.pk
            )
        tx = self.transactions()[0]
        self.assertEqual(tx["status"], "pending")
        self.assertEqual(tx["deducted_amount"], Decimal("2.000042"))
        self.assertIsNone(tx["balance_reconciliation_token"])

    def test_capped_refresh_can_lower_a_balance_without_completing_a_sync_generation(self):
        with use_operator():
            self.holding.refresh_from_db()
            sync_version = self.holding.sync_version
            balance_version = self.holding.balance_version
        self.balance = Decimal("6")
        with acting_for(self.tenant.user.pk):
            self.assertIsNone(sync_holding(self.wallet, self.native))
        self.assertEqual(self.quantity(), Decimal("6"))
        with use_operator():
            self.holding.refresh_from_db()
            self.assertEqual(self.holding.sync_version, sync_version)
            self.assertNotEqual(self.holding.balance_version, balance_version)
            self.assertEqual(HoldingSnapshot.objects.get(holding=self.holding).quantity, Decimal("6"))

    def test_confirmed_transfer_keeps_maximum_fee_held_until_balance_repair_succeeds(self):
        self.observer.get_transaction_receipt.return_value["effectiveGasPrice"] = 10**9
        self.assertEqual(self.finish()["status"], "confirmed")
        tx = self.transactions()[0]
        self.assertEqual(tx["transaction_fee"], Decimal("0.000021"))
        self.assertIsNotNone(tx["finality_observation_id"])
        self.assertIsNotNone(tx["balance_reconciliation_token"])
        self.assertEqual(tx["deducted_amount"], Decimal("2.000042"))
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.assertEqual(self.finish()["status"], "reconciliation_pending")
        self.balance = Decimal("7.999979")
        self.assertEqual(self.finish()["status"], "reconciled")
        self.assertEqual(self.quantity(), self.balance)
        tx = self.transactions()[0]
        self.assertIsNone(tx["balance_reconciliation_token"])
        self.assertEqual(tx["deducted_amount"], Decimal("0"))
        self.assertEqual(self.finish()["status"], "already_processed")
        self.notification.assert_called_once()
        self.assertTrue(self.balance_reads)
        self.assertFalse(any(in_transaction for _, in_transaction in self.balance_reads))

    def test_final_revert_retains_debit_during_outage_then_repairs_actual_fee_without_double_refund(self):
        self.observer.get_transaction_receipt.return_value["status"] = 0
        self.assertEqual(self.finish()["status"], "failed")
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.assertEqual(self.transactions()[0]["deducted_amount"], Decimal("2.000042"))
        self.balance = Decimal("9.999958")
        self.assertTrue(self.repair())
        self.assertTrue(self.repair())
        self.assertEqual(self.quantity(), self.balance)
        self.notification.assert_called_once()

    def test_other_pending_transfers_prevent_a_completed_transfer_from_releasing_the_holding(self):
        second = self.second_submission()
        before = self.quantity()
        self.balance = Decimal("10")
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertEqual(self.quantity(), before)
        self.assertFalse(self.repair())
        with use_operator():
            first = Transaction.objects.get(pk=self.tx_id)
            self.assertIsNotNone(first.balance_reconciliation_token)
            self.assertEqual(Transaction.objects.get(tx_hash=second["txHash"]).status, "pending")
        self.observer.get_transaction_receipt.return_value["transactionHash"] = second["txHash"]
        self.assertEqual(
            confirm_pending_transaction.func(second["txHash"], str(self.wallet.pk), principal_id=self.tenant.user.pk)[
                "status"
            ],
            "confirmed",
        )
        self.assertTrue(self.repair())
        self.assertEqual(self.quantity(), Decimal("10"))

    def test_unrelated_asset_refresh_remains_available(self):
        from assets.models import Asset

        with use_operator():
            other = Asset.objects.create(symbol="OTHER", name="Other", asset_type="erc20_token", is_verified=True)
            Holding.objects.create(wallet=self.wallet, asset=other, quantity=1)
        self.balance = Decimal("5")
        with acting_for(self.tenant.user.pk):
            result = sync_holding(self.wallet, other)
        self.assertEqual(result.quantity, Decimal("5"))
        self.assertEqual(self.quantity(), Decimal("7.999958"))

    def test_an_earlier_final_observation_cannot_settle_after_a_newer_claim_started(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        claim_chain_observation(self.tx_id)
        self.assertEqual(self.settle()["status"], "observation_changed")
        self.assertEqual(self.transactions()[0]["status"], "pending")
        self.notification.assert_not_called()

    def test_a_changed_target_between_observation_and_settlement_remains_unresolved(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        with use_operator():
            Transaction.objects.filter(pk=self.tx_id).update(monitoring_completed_at=timezone.now())
        self.assertEqual(self.settle()["status"], "observation_changed")
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.assertEqual(self.finish()["status"], "confirmed")

    def test_policy_change_refuses_an_observation_collected_under_the_earlier_policy(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        with override_settings(
            WALLET_CHAIN_FINALITY_POLICIES={f"evm:{settings.BLOCKCHAIN_CHAIN_ID}": {"mode": "depth", "depth": 20}}
        ):
            self.assertEqual(self.settle()["status"], "observation_changed")
        self.assertEqual(self.transactions()[0]["status"], "pending")
        self.assertEqual(self.finish()["status"], "confirmed")

    def assert_policy_rollout_recovery(self, succeeded):
        self.observer.get_transaction_receipt.return_value["status"] = int(succeeded)
        outcome = "confirmed" if succeeded else "failed"
        self.assertEqual(self.finish()["status"], outcome)
        original = self.transactions()[0]["finality_observation_id"]
        self.balance = Decimal("7.999979" if succeeded else "9.999979")
        policy = {f"evm:{settings.BLOCKCHAIN_CHAIN_ID}": {"mode": "depth", "depth": 6}}
        with override_settings(WALLET_CHAIN_FINALITY_POLICIES=policy):
            self.assertEqual(self.finish()["status"], "reconciliation_pending")
            self.assertEqual(self.quantity(), Decimal("7.999958"))
            self.assertEqual(self.transactions()[0]["finality_observation_id"], original)
            self.head["number"] = 105
            self.assertEqual(self.finish()["status"], "reconciled")
            self.assertEqual(self.quantity(), self.balance)
        tx = self.transactions()[0]
        self.assertEqual(tx["status"], outcome)
        self.assertIsNone(tx["balance_reconciliation_token"])
        self.assertNotEqual(tx["finality_observation_id"], original)
        self.assertEqual(self.observations()[-1]["policy"], {"version": 1, "mode": "depth", "depth": 6})
        self.notification.assert_called_once()

    def test_policy_rollout_reauthorizes_unfinished_repair_only_after_fresh_satisfied_evidence(self):
        self.assert_policy_rollout_recovery(True)

    def test_policy_rollout_can_reauthorize_final_failure_repair_without_refunding_twice(self):
        self.assert_policy_rollout_recovery(False)

    def test_missing_or_malformed_evidence_retains_every_deduction_before_a_valid_control(self):
        valid = dict(self.observer.get_transaction_receipt.return_value)
        before = self.financial_state()
        malformed = [None, {}, {**valid, "transactionHash": "0x" + "ff" * 32}]
        malformed += [{**valid, "status": value} for value in (None, True, False, "0", "1", -1, 2, 1.0, [], {})]
        malformed += [{**valid, "blockHash": None}, {**valid, "blockNumber": None}]
        for receipt in malformed:
            with self.subTest(receipt=receipt):
                self.observer.get_transaction_receipt.return_value = receipt
                self.assertEqual(self.finish()["status"], "finality_pending")
                self.assertEqual(self.financial_state(), before)
        self.notification.assert_not_called()
        self.observer.get_transaction_receipt.return_value = valid
        self.assertEqual(self.finish()["status"], "confirmed")
        self.notification.assert_called_once()

    def test_flipped_outcome_is_held_for_attribution_even_when_the_new_receipt_is_final(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        self.observer.get_transaction_receipt.return_value["status"] = 0
        self.assertEqual(self.finish()["status"], "attribution_pending")
        self.assertEqual(self.transactions()[0]["status"], "pending")
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.notification.assert_not_called()

    def test_orphaned_inclusion_stays_pending_and_same_outcome_reinclusion_can_finish(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        replaced = {**self.block, "hash": "0x" + "aa" * 32}
        later = {**self.block, "hash": "0x" + "bb" * 32, "number": 101}
        self.observer.w3.eth.get_block.side_effect = lambda identifier: (
            self.head if identifier in ("latest", "finalized", 104) else replaced if identifier == 100 else later
        )
        self.assertEqual(self.finish()["status"], "finality_pending")
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.observer.get_transaction_receipt.return_value.update(blockHash=later["hash"], blockNumber=101)
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertEqual(self.transactions()[0]["block_number"], 101)

    def test_unattributed_local_history_cannot_gain_authority_from_a_receipt(self):
        with use_operator():
            legacy = Transaction.objects.create(
                wallet=self.wallet,
                asset=self.native,
                chain="base",
                tx_hash="0x" + "ee" * 32,
                from_address=self.wallet.address,
                amount=1,
                deducted_amount=1,
            )
        with patch("wallets.services.chain_observations.get_blockchain_client") as provider:
            result = confirm_pending_transaction.func(
                legacy.tx_hash, str(self.wallet.pk), principal_id=self.tenant.user.pk
            )
        self.assertEqual(result["status"], "attribution_pending")
        provider.assert_not_called()
        self.notification.assert_not_called()

    def test_legacy_terminal_repair_token_does_not_establish_finality(self):
        with use_operator():
            Transaction.objects.filter(pk=self.tx_id).update(status="failed", balance_reconciliation_token=uuid4())
        self.balance = Decimal("10")
        self.assertFalse(self.repair())
        with acting_for(self.tenant.user.pk):
            self.assertIsNone(sync_holding(self.wallet, self.native))
        self.assertEqual(self.quantity(), Decimal("7.999958"))

    def test_unavailable_finalized_head_retains_the_pending_debit(self):
        read = self.observer.w3.eth.get_block.side_effect

        def unavailable(identifier):
            if identifier == "finalized":
                raise ConnectionError("Synthetic finality outage")
            return read(identifier)

        self.observer.w3.eth.get_block.side_effect = unavailable
        self.assertEqual(self.finish()["status"], "finality_pending")
        self.assertEqual(self.quantity(), Decimal("7.999958"))
        self.assertEqual(self.observations()[0]["reason"], "finality_unavailable")

    def test_expired_cleanup_keeps_the_hold_and_the_sweep_eventually_recovers(self):
        from wallets.tasks.confirmation import (
            check_all_pending_transactions,
            cleanup_stale_pending_transactions,
        )

        with use_operator():
            Transaction.objects.filter(pk=self.tx_id).update(created_at=timezone.now() - timedelta(days=3))
            before = self.financial_state()
            self.assertEqual(cleanup_stale_pending_transactions.func(0), {"total": 1, "failed": 0})
            self.assertEqual(self.financial_state(), before)
            with patch("wallets.tasks.confirmation.confirm_pending_transaction.defer") as queued:
                self.assertEqual(check_all_pending_transactions.func(0), {"total": 1, "queued": 1})
        self.assertEqual(confirm_pending_transaction.func(**queued.call_args.kwargs)["status"], "confirmed")
        with use_operator(), patch("wallets.tasks.confirmation.confirm_pending_transaction.defer") as queued:
            self.assertEqual(check_all_pending_transactions.func(0), {"total": 1, "queued": 1})
        self.balance = Decimal("7.999958")
        self.assertEqual(confirm_pending_transaction.func(**queued.call_args.kwargs)["status"], "reconciled")

    def test_unknown_timestamp_stays_unknown_when_finality_otherwise_succeeds(self):
        self.block["timestamp"] = None
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertIsNone(self.transactions()[0]["block_timestamp"])

    def test_balance_writes_return_to_the_captured_principal_after_operator_observation(self):
        from shared.db import APP_ALIAS, configured

        self.balance = Decimal("7.999979")
        self.assertEqual(self.finish()["status"], "confirmed")
        self.assertEqual(self.balance_reads, [(configured(APP_ALIAS), False)])
        self.assertEqual(self.quantity(), self.balance)


class WalletFinalityTest(WalletFinalityChecks, APITransactionTestCase):
    pass


class ScopedWalletFinalityTest(RunsOnTheScopedConnection, WalletFinalityChecks, APITransactionTestCase):
    def test_foreign_principal_is_refused_before_operator_observation_or_balance_effect(self):
        from shared.tests.tenants import make_tenant

        with use_operator():
            other = make_tenant("finality-other")
        before = self.financial_state()
        with patch("wallets.tasks.confirmation.observe_wallet_chain") as observe:
            result = confirm_pending_transaction.func(
                self.signed_transfer.hash.to_0x_hex(), str(self.wallet.pk), principal_id=other.user.pk
            )
        self.assertEqual(result, {"status": "error", "error": "Wallet not found"})
        observe.assert_not_called()
        self.assertEqual(self.financial_state(), before)
        self.assertEqual(self.finish()["status"], "confirmed")
