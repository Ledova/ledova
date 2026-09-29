from decimal import Decimal
from unittest.mock import patch

from django.test import SimpleTestCase

from wallets.exceptions import InvalidTransactionException
from wallets.services.transfers import (
    prepare_erc20_transaction,
    prepare_ethereum_transaction,
)

FROM = "0x" + "a" * 40
TO = "0x" + "b" * 40
CONTRACT = "0x" + "c" * 40


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
