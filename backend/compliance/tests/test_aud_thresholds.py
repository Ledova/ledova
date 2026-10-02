from datetime import timedelta
from decimal import Decimal
from io import StringIO
from itertools import count
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from assets.models import Asset, AssetChainDeployment, AssetSnapshot, ExchangeRate
from compliance.models import ComplianceAlert, MonitoringRule
from compliance.services.transaction_monitoring import (
    TransactionMonitoringService,
    check_rule,
)
from shared.tests.tenants import an_account
from users.constants import ACCOUNT_STATUS_ACTIVE
from wallets.models import Transaction, Wallet
from wallets.services.sync import sync_wallet
from wallets.services.transaction_confirmation import create_pending_transaction

ETH_USD = Decimal("2000")
AUDY_CONTRACT = "0x" + "9" * 40
_hashes = count()


@override_settings(KYC_PROVIDER="", KYCAID_CRYPTO_MONITORING_ENABLED=False)
class AudThresholdTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        cls.ether = Asset.objects.create(symbol="ETH", name="Ether", asset_type="native_crypto", is_verified=True)
        cls.audy = Asset.objects.create(symbol="AUDY", name="AUDY", asset_type="stablecoin", is_verified=True)
        AssetChainDeployment.objects.create(asset=cls.audy, chain="base", contract_address=AUDY_CONTRACT, decimals=2)
        midnight = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        AssetSnapshot.objects.create(
            asset=cls.ether, price=ETH_USD, price_currency="USD", source_timestamp=midnight, data_source="manual"
        )
        AssetSnapshot.objects.create(
            asset=cls.audy,
            price=Decimal(1) / Decimal("1.5"),
            price_currency="USD",
            source_timestamp=midnight,
            data_source="par_reference",
        )

    def setUp(self):
        self.rate(Decimal("1.6"))

    def rate(self, value):
        ExchangeRate.objects.update_or_create(base_currency="USD", target_currency="AUD", defaults={"rate": value})

    def customer(self, label, activated_days_ago=400, chain="ethereum"):
        account = an_account(
            label,
            account_status=ACCOUNT_STATUS_ACTIVE,
            activation_date=timezone.now() - timedelta(days=activated_days_ago),
        )
        wallet = Wallet.objects.create(
            user_account=account, address="0x" + "c" * 40, chain=chain, verification_status="VERIFIED"
        )
        return account, wallet

    def received(self, wallet, *amounts, contract=None, happened=timedelta(minutes=5)):
        history = [
            {
                "tx_hash": f"0x{next(_hashes):064x}",
                "from_address": "0x" + "d" * 40,
                "to_address": wallet.address,
                "amount": str(amount),
                "contract_address": contract,
                "block_timestamp": timezone.now() - happened,
            }
            for amount in amounts
        ]
        self.synced(wallet, history)
        return [Transaction.objects.get(wallet=wallet, tx_hash=item["tx_hash"]) for item in history]

    def synced(self, wallet, history):
        client = MagicMock()
        client.get_transaction_history.return_value = history
        with patch("wallets.services.sync.get_blockchain_client", return_value=client), patch(
            "wallets.services.holdings.fetch_chain_balance", return_value=Decimal("0")
        ):
            return sync_wallet(wallet)

    def received_usd(self, wallet, *usd_values, happened=timedelta(minutes=5)):
        return self.received(wallet, *(value / ETH_USD for value in usd_values), happened=happened)

    def sent_from_the_app(self, wallet, usd_value):
        tx_hash = f"0x{next(_hashes):064x}"
        recorded = create_pending_transaction(wallet, tx_hash, "0x" + "e" * 40, usd_value / ETH_USD)
        return Transaction.objects.get(pk=recorded["transaction_id"])

    def check(self, code, account, transaction=None):
        return check_rule(MonitoringRule.objects.get(rule_code=code), transaction, account)

    def test_a_transfer_large_only_in_aud_is_a_large_transaction(self):
        account, wallet = self.customer("large-in-aud")
        (transfer,) = self.received_usd(wallet, Decimal("7000"))

        triggered, details = self.check("MON-001", account, transfer)

        self.assertTrue(triggered)
        self.assertEqual(details, {"amount": 11200.0, "threshold": 10000.0, "currency": "AUD"})

    def test_a_transfer_large_only_in_usd_is_not(self):
        self.rate(Decimal("0.8"))
        account, wallet = self.customer("large-in-usd")
        (transfer,) = self.received_usd(wallet, Decimal("10500"))

        self.assertEqual(self.check("MON-001", account, transfer), (False, {}))

    def test_three_transfers_just_under_ten_thousand_aud_are_structuring(self):
        account, wallet = self.customer("structuring-in-aud")
        self.received_usd(wallet, Decimal("5500"), Decimal("5600"), Decimal("6000"))

        triggered, details = self.check("MON-003", account)

        self.assertTrue(triggered)
        self.assertEqual(details["transaction_count"], 3)

    def test_three_transfers_just_under_ten_thousand_usd_are_not_structuring(self):
        account, wallet = self.customer("structuring-in-usd")
        self.received_usd(wallet, Decimal("9000"), Decimal("9100"), Decimal("9200"))

        self.assertEqual(self.check("MON-003", account), (False, {}))

    def test_fifty_thousand_aud_in_thirty_days_is_high_aggregate_volume(self):
        account, wallet = self.customer("volume-in-aud")
        self.received_usd(wallet, Decimal("16000"), Decimal("16000"))

        triggered, details = self.check("MON-007", account)

        self.assertTrue(triggered)
        self.assertEqual(details["total_volume"], 51200.0)

    def test_round_aud_amounts_are_counted(self):
        account, wallet = self.customer("round-in-aud")
        self.received_usd(wallet, Decimal("3125"), Decimal("6250"), Decimal("9375"))

        triggered, details = self.check("MON-010", account)

        self.assertTrue(triggered)
        self.assertEqual(sorted(details["round_amounts"]), [5000.0, 10000.0, 15000.0])

    def test_round_usd_amounts_are_not(self):
        account, wallet = self.customer("round-in-usd")
        self.received_usd(wallet, Decimal("5000"), Decimal("10000"), Decimal("15000"))

        self.assertEqual(self.check("MON-010", account), (False, {}))

    def test_an_aud_stablecoin_counts_at_its_par_whatever_the_rate_was_when_it_was_priced(self):
        account, wallet = self.customer("audy-round", chain="base")
        transfers = self.received(wallet, Decimal("5000"), Decimal("5000"), Decimal("10000"), contract=AUDY_CONTRACT)

        triggered, details = self.check("MON-010", account)

        self.assertTrue(triggered)
        self.assertEqual(sorted(details["round_amounts"]), [5000.0, 5000.0, 10000.0])
        self.assertEqual(self.check("MON-001", account, transfers[0]), (False, {}))

    def test_screening_starts_at_five_thousand_aud(self):
        account, wallet = self.customer("screened-in-aud")
        (transfer,) = self.received_usd(wallet, Decimal("3500"))

        triggered, details = self.check("MON-004", account, transfer)

        self.assertTrue(triggered)
        self.assertEqual(details["screening_trigger"], "large_transaction")

    def test_a_dormant_account_waking_with_five_thousand_aud_is_flagged(self):
        account, wallet = self.customer("dormant-in-aud")
        self.received_usd(wallet, Decimal("100"), happened=timedelta(days=120))
        (transfer,) = self.received_usd(wallet, Decimal("3500"))

        triggered, details = self.check("MON-008", account, transfer)

        self.assertTrue(triggered)
        self.assertEqual((details["transaction_amount"], details["days_inactive"]), (5600.0, 119))

    def test_history_imported_today_but_months_old_is_not_recent_activity(self):
        account, wallet = self.customer("old-history")
        self.received_usd(wallet, Decimal("5500"), Decimal("5600"), Decimal("6000"), happened=timedelta(days=60))
        self.received_usd(wallet, Decimal("16000"), Decimal("16000"), happened=timedelta(days=45))
        self.received_usd(wallet, Decimal("3125"), Decimal("6250"), Decimal("9375"), happened=timedelta(days=40))
        self.received_usd(wallet, Decimal("3750"))

        for code in ("MON-002", "MON-003", "MON-007", "MON-010"):
            self.assertEqual(self.check(code, account), (False, {}), code)

    def test_a_baseline_older_than_ninety_days_is_no_baseline(self):
        account, wallet = self.customer("old-baseline")
        self.received_usd(wallet, *[Decimal("1000")] * 5, happened=timedelta(days=100))
        (outsized,) = self.received_usd(wallet, Decimal("3750"))

        self.assertEqual(self.check("MON-009", account, outsized), (False, {}))

    def test_a_send_from_the_app_is_valued_and_checked_like_an_imported_one(self):
        account, wallet = self.customer("app-send")

        sent = self.sent_from_the_app(wallet, Decimal("7000"))
        result = TransactionMonitoringService.check_recorded_transaction(sent.pk)

        self.assertEqual((sent.market_value, sent.market_value_aud), (Decimal("7000.00"), Decimal("11200.00")))
        self.assertEqual(result["status"], "completed")
        alert = ComplianceAlert.objects.get(transaction=sent, triggered_rule="MON-001")
        self.assertEqual(alert.alert_data["amount"], 11200.0)

    def test_a_send_from_the_app_counts_once_and_before_it_is_mined(self):
        account, wallet = self.customer("app-send-synced")

        sent = self.sent_from_the_app(wallet, Decimal("20000"))
        self.assertIsNone(sent.block_timestamp)
        before_the_sync = self.check("MON-007", account)
        self.synced(
            wallet,
            [
                {
                    "tx_hash": sent.tx_hash,
                    "from_address": wallet.address,
                    "to_address": sent.to_address,
                    "amount": str(sent.amount),
                    "block_timestamp": timezone.now() - timedelta(minutes=1),
                }
            ],
        )

        self.assertEqual(Transaction.objects.filter(wallet=wallet).count(), 1)
        self.assertEqual(before_the_sync, (False, {}))
        self.assertEqual(self.check("MON-007", account), (False, {}))
        self.received_usd(wallet, Decimal("12000"))
        triggered, details = self.check("MON-007", account)
        self.assertTrue(triggered)
        self.assertEqual(details["total_volume"], 51200.0)

    def test_a_transfer_is_measured_against_the_customer_average_in_aud(self):
        account, wallet = self.customer("deviation-in-aud")
        self.received_usd(wallet, *[Decimal("1000")] * 5)
        (modest,) = self.received_usd(wallet, Decimal("2500"))
        self.assertEqual(self.check("MON-009", account, modest), (False, {}))

        (outsized,) = self.received_usd(wallet, Decimal("3750"))
        triggered, details = self.check("MON-009", account, outsized)
        self.assertTrue(triggered)
        self.assertEqual((details["transaction_amount"], details["average_amount"]), (6000.0, 2000.0))

    def test_a_new_customer_without_source_of_funds_is_flagged_at_ten_thousand_aud(self):
        account, wallet = self.customer("new-in-aud", activated_days_ago=5)
        (transfer,) = self.received_usd(wallet, Decimal("7000"))

        triggered, details = self.check("MON-006", account, transfer)

        self.assertTrue(triggered)
        self.assertEqual(details["amount"], 11200.0)
