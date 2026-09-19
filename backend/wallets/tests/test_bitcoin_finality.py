from decimal import Decimal
from unittest.mock import patch

from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from shared.db import acting_for, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import WalletChainObservation
from wallets.services.holdings import sync_holding
from wallets.tasks.confirmation import confirm_pending_transaction
from wallets.tests.test_bitcoin_submission import (
    FIXTURE,
    REGTEST_GENESIS,
    BitcoinSubmissionFixture,
)


class BitcoinFinalityChecks(BitcoinSubmissionFixture):
    def setUp(self):
        super().setUp()
        network = override_settings(BITCOIN_NETWORK="regtest")
        network.enable()
        self.addCleanup(network.disable)
        self.submit_direct()
        self.head_height = 104
        self.block_hash = "22" * 32
        self.receipt = {
            "txid": FIXTURE["txid"],
            "blockhash": self.block_hash,
            "confirmations": 1,
            "fee": Decimal("0.0001"),
        }
        self.rpc_overrides.update(
            {
                "getrawtransaction": lambda params: self.receipt,
                "getbestblockhash": lambda params: f"{self.head_height:064x}",
                "getblockhash": lambda params: (
                    REGTEST_GENESIS if params[0] == 0 else self.block_hash if params[0] == 100 else f"{params[0]:064x}"
                ),
                "getblockheader": lambda params: {
                    "hash": params[0],
                    "height": 100 if params[0] == self.block_hash else int(params[0], 16),
                    "time": 1700000000,
                },
            }
        )
        policy = override_settings(
            WALLET_CHAIN_FINALITY_POLICIES={"bitcoin:" + REGTEST_GENESIS: {"mode": "depth", "depth": 6}}
        )
        policy.enable()
        self.addCleanup(policy.disable)
        for target, kwargs in (
            ("wallets.services.transaction_confirmation.sync_holding", {"wraps": sync_holding}),
            ("wallets.services.holdings.fetch_chain_balance", {"return_value": None}),
            ("wallets.services.transaction_confirmation.send_transaction_notification.defer", {}),
        ):
            boundary = patch(target, **kwargs)
            value = boundary.start()
            self.addCleanup(boundary.stop)
            if "fetch_chain_balance" in target:
                self.balance = value
            elif target.endswith(".defer"):
                self.notification = value

    def finish(self):
        return confirm_pending_transaction.func(FIXTURE["txid"], str(self.wallet.pk), principal_id=self.tenant.user.pk)

    def test_five_canonical_confirmations_wait_and_six_authorize_settlement(self):
        self.assertEqual(self.finish()["status"], "finality_pending")
        self.assertEqual(self.quantity(), Decimal("47.9999"))
        self.notification.assert_not_called()
        self.head_height = 105
        self.assertEqual(self.finish()["status"], "confirmed")
        tx = self.transactions()[0]
        self.assertIsNotNone(tx["finality_observation_id"])
        self.assertIsNotNone(tx["balance_reconciliation_token"])
        self.assertEqual(tx["deducted_amount"], Decimal("2.0001"))
        self.balance.return_value = Decimal("47.9999")
        self.assertEqual(self.finish()["status"], "reconciled")
        self.assertEqual(self.finish()["status"], "already_processed")
        self.notification.assert_called_once()
        with use_operator():
            self.assertEqual(
                list(WalletChainObservation.objects.order_by("generation").values_list("finality", flat=True)),
                ["waiting", "satisfied"],
            )

    def test_receipt_depth_claim_does_not_replace_canonical_head_depth(self):
        self.receipt["confirmations"] = 10000
        self.assertEqual(self.finish()["status"], "finality_pending")
        self.assertEqual(self.transactions()[0]["status"], "pending")
        self.head_height = 105
        self.assertEqual(self.finish()["status"], "confirmed")

    def test_orphaned_bitcoin_receipt_keeps_the_balance_cap(self):
        self.head_height = 105
        self.rpc_overrides["getblockhash"] = lambda params: (
            REGTEST_GENESIS if params[0] == 0 else "33" * 32 if params[0] == 100 else f"{params[0]:064x}"
        )
        self.rpc_overrides["getblockheader"] = lambda params: {
            "hash": params[0],
            "height": 100 if params[0] in (self.block_hash, "33" * 32) else int(params[0], 16),
            "time": 1700000000,
        }
        self.assertEqual(self.finish()["status"], "finality_pending")
        self.balance.return_value = Decimal("50")
        with acting_for(self.tenant.user.pk):
            self.assertIsNone(sync_holding(self.wallet, self.asset))
        self.assertEqual(self.quantity(), Decimal("47.9999"))
        self.notification.assert_not_called()

    def test_missing_or_wrong_bitcoin_identity_retains_the_local_hold(self):
        valid = self.receipt
        for receipt in ({}, {**valid, "txid": "ff" * 32}, {**valid, "confirmations": False}):
            with self.subTest(receipt=receipt):
                self.receipt = receipt
                self.assertEqual(self.finish()["status"], "finality_pending")
                self.assertEqual(self.quantity(), Decimal("47.9999"))
        self.receipt = valid
        self.head_height = 105
        self.assertEqual(self.finish()["status"], "confirmed")


class BitcoinFinalityTest(BitcoinFinalityChecks, APITransactionTestCase):
    pass


class ScopedBitcoinFinalityTest(RunsOnTheScopedConnection, BitcoinFinalityChecks, APITransactionTestCase):
    pass
