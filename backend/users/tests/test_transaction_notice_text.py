from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from assets.models import Asset
from shared.tests.tenants import make_tenant
from users.models import Notification
from users.tasks.notifications import send_transaction_notification
from wallets.models import Transaction
from wallets.tests.share_symbol_fixtures import two_ordinary_classes


class TransactionNoticeTextTest(TestCase):
    def setUp(self):
        self.holder = make_tenant("notice-holder")
        push = patch("users.services.notifications.ExpoPushClient")
        self.addCleanup(push.stop)
        push.start().return_value.send_batch.return_value = [{"status": "ok"}]
        self.sent = 0

    def asset(self, symbol, asset_type, decimals):
        asset, _ = Asset.objects.get_or_create(
            symbol=symbol,
            defaults={"name": symbol, "asset_type": asset_type, "decimals": decimals, "is_verified": True},
        )
        return asset

    def notice(self, asset, amount, event_type="confirmed"):
        self.sent += 1
        transaction = Transaction.objects.create(
            wallet=self.holder.wallet,
            asset=asset,
            tx_hash="0x" + f"{self.sent:064x}",
            chain="base",
            from_address=self.holder.wallet.address,
            to_address="0x" + "3" * 40,
            amount=Decimal(amount),
        )
        send_transaction_notification.func(
            user_id=str(self.holder.user.pk), transaction_id=str(transaction.pk), event_type=event_type
        )
        row = Notification.objects.get(user=self.holder.user, data__transaction_id=str(transaction.pk))
        return row.title, row.body

    def test_a_confirmed_amount_reads_as_the_activity_list_shows_it(self):
        eth = self.asset("ETH", "native_crypto", 18)
        btc = self.asset("BTC", "native_crypto", 8)
        usdc = self.asset("USDC", "stablecoin", 6)
        audy = self.asset("AUDY", "stablecoin", 2)
        for asset, amount, shown in (
            (eth, "0.268752", "0.268752 ETH"),
            (btc, "0.00012345", "0.00012345 BTC"),
            (usdc, "1250", "1,250 USDC"),
            (audy, "12500.5", "12,500.5 AUDY"),
            (audy, "1000000", "1,000,000 AUDY"),
        ):
            with self.subTest(shown=shown):
                self.assertEqual(
                    self.notice(asset, amount),
                    ("Transaction Confirmed", f"Your transaction of {shown} has been confirmed."),
                )

    def test_a_failed_amount_reads_the_same_way(self):
        eth = self.asset("ETH", "native_crypto", 18)

        self.assertEqual(
            self.notice(eth, "0.268752", "failed"),
            ("Transaction Failed", "Your transaction of 0.268752 ETH has failed."),
        )

    def test_tiny_zero_and_long_amounts_stay_exact_and_never_go_scientific(self):
        eth = self.asset("ETH", "native_crypto", 18)
        for amount, shown in (
            ("0.000000000000000001", "0.000000000000000001"),
            ("0.0000001", "0.0000001"),
            ("0", "0"),
            ("123456789012.123456789012345678", "123,456,789,012.123456789012345678"),
        ):
            with self.subTest(amount=amount):
                _, body = self.notice(eth, amount)
                self.assertEqual(body, f"Your transaction of {shown} ETH has been confirmed.")

    def test_shares_read_by_their_class_symbol_with_the_company_not_the_bridged_asset_symbol(self):
        first_issuer = make_tenant("notice-first-issuer")
        second_issuer = make_tenant("notice-second-issuer")
        (_, first_asset), (_, second_asset) = two_ordinary_classes(first_issuer.company, second_issuer.company)
        self.assertEqual((first_asset.symbol, second_asset.symbol), ("ORD", f"ORD.{second_issuer.company.acn}"))

        for asset, company in ((first_asset, first_issuer.company), (second_asset, second_issuer.company)):
            with self.subTest(asset=asset.symbol):
                _, body = self.notice(asset, "100")
                self.assertEqual(body, f"Your transaction of 100 ORD ({company.name}) has been confirmed.")

    def test_a_security_that_resolves_no_class_reads_by_its_own_asset_symbol(self):
        _, body = self.notice(self.holder.refs.asset, "25")

        self.assertEqual(body, "Your transaction of 25 TENANT has been confirmed.")
