from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from users.models import UserAccount, UserProfile
from wallets.exceptions import InvalidTransactionException
from wallets.models import Wallet
from wallets.services import transfers
from wallets.services.transfers import (
    BITCOIN_DECIMAL_PLACES,
    prepare_bitcoin_transaction,
    prepare_erc20_transaction,
    prepare_ethereum_transaction,
)

FROM = "0x" + "a" * 40
TO = "0x" + "b" * 40
CONTRACT = "0x" + "c" * 40
BITCOIN_FROM = "tb1qsyntheticsatoshis"
BITCOIN_TO = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"


@patch("wallets.services.transfers.get_blockchain_client")
class APreparedAmountIsTheExactWeiAsAHexQuantityTest(SimpleTestCase):
    @staticmethod
    def prepare_native(get_client, amount):
        client = get_client.return_value
        client.get_gas_price.return_value = 10**9
        client.w3.eth.get_transaction_count.return_value = 7
        client.w3.eth.chain_id = 84532
        return prepare_ethereum_transaction("base", FROM, TO, Decimal(amount), Decimal("20"))

    def test_a_native_amount_is_sent_as_its_exact_wei(self, get_client):
        for amount, wei in (
            ("9.99999999", "0x8ac7230235dc1c00"),
            ("0.123456789012345678", "0x1b69b4ba630f34e"),
            ("1", "0xde0b6b3a7640000"),
        ):
            with self.subTest(amount=amount):
                self.assertEqual(self.prepare_native(get_client, amount)["transaction"]["value"], wei)

    def test_a_native_amount_finer_than_a_wei_is_refused_before_the_node_is_asked(self, get_client):
        with self.assertRaisesRegex(InvalidTransactionException, "more than 18 decimal places"):
            self.prepare_native(get_client, "0.1234567890123456789")
        get_client.assert_not_called()

    def test_a_native_amount_that_is_not_a_number_is_refused_as_an_amount(self, get_client):
        for amount in ("NaN", "Infinity"):
            with self.subTest(amount=amount):
                with self.assertRaisesRegex(InvalidTransactionException, "greater than zero"):
                    self.prepare_native(get_client, amount)
        get_client.assert_not_called()

    @staticmethod
    def prepare_token(get_client, amount, decimals):
        client = get_client.return_value
        client.estimate_erc20_transfer_gas.return_value = 60000
        client.get_gas_price.return_value = 10**9
        client.build_erc20_transfer_data.return_value = "0xa9059cbb"
        client.get_nonce.return_value = 7
        client.w3.eth.chain_id = 84532
        return prepare_erc20_transaction(
            "base", FROM, TO, Decimal(amount), Decimal("10"), Decimal("1"), CONTRACT, "TST", decimals
        )

    def test_a_token_transfer_sends_no_native_value(self, get_client):
        self.assertEqual(self.prepare_token(get_client, "1.5", 2)["transaction"]["value"], "0x0")

    def test_the_reviewed_amount_is_written_out_plainly_even_below_a_millionth(self, get_client):
        native = self.prepare_native(get_client, "0.0000001")
        self.assertEqual((native["amount_eth"], native["transaction"]["value"]), ("0.0000001", "0x174876e800"))
        self.assertEqual(self.prepare_token(get_client, "0.0000001", 8)["amount_token"], "0.0000001")


@patch("wallets.services.transfers.get_blockchain_client")
class APreparedBitcoinAmountIsWholeSatoshisTest(SimpleTestCase):
    @staticmethod
    def prepare(get_client, amount):
        get_client.return_value.get_gas_price.return_value = Decimal("2")
        return prepare_bitcoin_transaction(BITCOIN_FROM, BITCOIN_TO, Decimal(amount), Decimal("20"))

    def test_an_amount_finer_than_a_satoshi_is_refused_before_the_node_is_asked(self, get_client):
        for amount in ("0.123456789", "0.000000001", "1.000000001", "1E-100000"):
            with self.subTest(amount=amount):
                with self.assertRaisesMessage(InvalidTransactionException, BITCOIN_DECIMAL_PLACES):
                    self.prepare(get_client, amount)
        get_client.assert_not_called()

    def test_an_amount_in_whole_satoshis_is_prepared_as_their_count_and_written_plainly(self, get_client):
        for amount, satoshis, written in (
            ("0.12345678", 12345678, "0.12345678"),
            ("0.123456780000", 12345678, "0.12345678"),
            ("1E-8", 1, "0.00000001"),
            ("0.00000010", 10, "0.0000001"),
            ("1E+1", 1000000000, "10"),
        ):
            with self.subTest(amount=amount):
                prepared = self.prepare(get_client, amount)
                self.assertEqual((prepared["amount_satoshis"], prepared["amount_btc"]), (satoshis, written))

    def test_an_amount_that_is_not_a_number_is_refused_as_an_amount(self, get_client):
        for amount in ("NaN", "Infinity"):
            with self.subTest(amount=amount):
                with self.assertRaisesRegex(InvalidTransactionException, "greater than zero"):
                    self.prepare(get_client, amount)
        get_client.assert_not_called()


@patch.object(transfers, "_get_native_balance", return_value=Decimal("20"))
@patch("wallets.services.transfers.get_blockchain_client")
class ABitcoinAmountFinerThanASatoshiIsRefusedToTheSenderTest(APITestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(email="satoshis@example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user)
        account = UserAccount.objects.create(account_number="SATOSHIS", user_profile=profile)
        self.wallet = Wallet.objects.create(
            user_account=account, address=BITCOIN_FROM, chain="bitcoin", verification_status="VERIFIED"
        )
        self.client.force_authenticate(user)

    def test_prepare_transfer_answers_400_naming_the_eight_decimal_places(self, get_client, _balance):
        response = self.client.post(
            f"/api/wallets/{self.wallet.uuid}/prepare-transfer/",
            {"to_address": BITCOIN_TO, "amount_btc": "0.123456789"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], BITCOIN_DECIMAL_PLACES)
        get_client.assert_not_called()
