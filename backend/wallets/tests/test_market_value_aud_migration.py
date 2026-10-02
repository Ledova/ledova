from decimal import Decimal
from itertools import count

from django.test import TransactionTestCase

from assets.models import Asset, ExchangeRate
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import an_account
from wallets.models import Transaction, Wallet

BEFORE = [("wallets", "0022_delete_holdingsnapshot"), ("assets", "0014_native_chain_deployments")]
AFTER = [("wallets", "0023_transaction_market_value_aud")]
_hashes = count()


class MarketValueAudBackfillTest(TransactionTestCase):
    def setUp(self):
        self.ether = Asset.objects.create(symbol="ETH", name="Ether", asset_type="native_crypto", is_verified=True)
        self.audy = Asset.objects.create(symbol="AUDY", name="AUDY", asset_type="stablecoin", is_verified=True)
        self.wallet = Wallet.objects.create(
            user_account=an_account("aud-backfill"), address="0x" + "e" * 40, chain="base"
        )

    def tearDown(self):
        restore_every_migration()
        super().tearDown()

    def recorded(self, apps, asset, amount, market_value):
        return (
            apps.get_model("wallets", "Transaction")
            .objects.create(
                tx_hash=f"0x{next(_hashes):064x}",
                chain="base",
                from_address="0x" + "f" * 40,
                to_address=self.wallet.address,
                asset_id=asset.pk,
                amount=Decimal(amount),
                market_value=None if market_value is None else Decimal(market_value),
                wallet_id=self.wallet.pk,
                user_account_id=self.wallet.user_account_id,
            )
            .pk
        )

    def values_after_migrating(self, *rows):
        migrate_to(AFTER)
        values = dict(Transaction.objects.values_list("pk", "market_value_aud"))
        return [values[row] for row in rows]

    def test_each_valued_transaction_is_converted_at_the_stored_rate_and_aud_par_is_exact(self):
        ExchangeRate.objects.create(base_currency="USD", target_currency="AUD", rate=Decimal("1.6"))
        before = migrate_to(BEFORE)
        rows = (
            self.recorded(before, self.ether, "0.5", "1000.00"),
            self.recorded(before, self.audy, "5000", "3333.33"),
            self.recorded(before, self.audy, "250", None),
            self.recorded(before, self.ether, "0.1", None),
        )

        self.assertEqual(
            self.values_after_migrating(*rows), [Decimal("1600.00"), Decimal("5000.00"), Decimal("250.00"), None]
        )
        reversed_apps = migrate_to(BEFORE)
        fields = {field.name for field in reversed_apps.get_model("wallets", "Transaction")._meta.fields}
        self.assertNotIn("market_value_aud", fields)

    def test_without_a_stored_rate_only_aud_par_is_valued(self):
        before = migrate_to(BEFORE)
        rows = (self.recorded(before, self.ether, "0.5", "1000.00"), self.recorded(before, self.audy, "40", "26.25"))

        self.assertEqual(self.values_after_migrating(*rows), [None, Decimal("40.00")])
