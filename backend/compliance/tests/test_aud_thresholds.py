from datetime import timedelta
from decimal import Decimal
from io import StringIO
from itertools import count
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from assets.models import Asset, AssetChainDeployment, AssetSnapshot, ExchangeRate
from compliance.models import MonitoringRule
from compliance.services.transaction_monitoring import check_rule
from shared.tests.tenants import an_account
from users.constants import ACCOUNT_STATUS_ACTIVE
from wallets.models import Transaction, Wallet
from wallets.services.sync import sync_wallet

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

    def received(self, wallet, *amounts, contract=None):
        history = [
            {
                "tx_hash": f"0x{next(_hashes):064x}",
                "from_address": "0x" + "d" * 40,
                "to_address": wallet.address,
                "amount": str(amount),
                "contract_address": contract,
                "block_timestamp": timezone.now() - timedelta(minutes=5),
            }
            for amount in amounts
        ]
        client = MagicMock()
        client.get_transaction_history.return_value = history
        with patch("wallets.services.sync.get_blockchain_client", return_value=client), patch(
            "wallets.services.holdings.fetch_chain_balance", return_value=Decimal("0")
        ):
            self.assertEqual(sync_wallet(wallet)["transactions"], len(history))
        return [Transaction.objects.get(wallet=wallet, tx_hash=item["tx_hash"]) for item in history]

    def received_usd(self, wallet, *usd_values):
        return self.received(wallet, *(value / ETH_USD for value in usd_values))

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
        (earlier,) = self.received_usd(wallet, Decimal("100"))
        Transaction.objects.filter(pk=earlier.pk).update(created_at=timezone.now() - timedelta(days=120))
        (transfer,) = self.received_usd(wallet, Decimal("3500"))

        triggered, details = self.check("MON-008", account, transfer)

        self.assertTrue(triggered)
        self.assertEqual(details["transaction_amount"], 5600.0)

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
