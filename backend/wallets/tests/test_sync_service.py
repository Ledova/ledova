from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone

from assets.models import Asset
from shared.tests.tenants import an_account
from wallets.models import Holding, Transaction, Wallet
from wallets.services.sync import sync_wallet


class WalletSyncServiceTest(TestCase):
    def setUp(self):
        account = an_account("sync-service", account_number="SYNC-ACC")
        self.wallet = Wallet.objects.create(
            user_account=account,
            address="0x" + "c" * 40,
            chain="ethereum",
            verification_status="VERIFIED",
        )

    def test_unverified_wallet_is_skipped_without_touching_the_chain(self):
        self.wallet.verification_status = "PENDING"
        self.wallet.save(update_fields=["verification_status"])
        with patch("wallets.services.sync.get_blockchain_client") as get_client:
            self.assertEqual(sync_wallet(self.wallet)["status"], "skipped")
        get_client.assert_not_called()

    def test_sync_stamps_the_wallet_chain_on_every_fetched_transaction(self):
        client = MagicMock()
        client.get_transaction_history.return_value = [
            {
                "tx_hash": "0xabc",
                "from_address": "0x" + "d" * 40,
                "to_address": self.wallet.address,
                "amount": "1.5",
                "asset_symbol": "ETH",
                "block_timestamp": timezone.now(),
            }
        ]
        with patch("wallets.services.sync.get_blockchain_client", return_value=client) as get_client:
            result = sync_wallet(self.wallet)

        get_client.assert_called_once_with("ethereum")
        client.get_transaction_history.assert_called_once_with(self.wallet.address)
        self.assertEqual(result, {"status": "success", "transactions": 1, "holdings": 0})
        transaction = Transaction.objects.get(wallet=self.wallet, tx_hash="0xabc")
        self.assertEqual(transaction.chain, "ethereum")
        self.wallet.refresh_from_db()
        self.assertIsNotNone(self.wallet.last_synced_at)

    def test_chain_client_failure_is_reported_not_raised(self):
        with patch("wallets.services.sync.get_blockchain_client", side_effect=RuntimeError("boom")):
            result = sync_wallet(self.wallet)

        self.assertEqual(result, {"status": "error", "error": "Wallet sync could not finish. Please try again later."})
        self.assertFalse(Transaction.objects.filter(wallet=self.wallet).exists())

    def sync_with_balance(self, balance):
        client = MagicMock()
        client.get_transaction_history.return_value = []
        with patch("wallets.services.sync.get_blockchain_client", return_value=client), patch(
            "wallets.services.holdings.fetch_chain_balance", return_value=Decimal(balance)
        ):
            return sync_wallet(self.wallet)

    def test_hourly_refresh_rewrites_the_holding_balance(self):
        asset = Asset.objects.create(symbol="ETH", name="Ether", asset_type="native_crypto", is_verified=True)
        holding = Holding.objects.create(wallet=self.wallet, asset=asset, quantity=Decimal("1"))

        first = self.sync_with_balance("2")
        second = self.sync_with_balance("3")

        self.assertEqual((first["holdings"], second["holdings"]), (1, 1))
        holding.refresh_from_db()
        self.assertEqual(holding.quantity, Decimal("3"))
