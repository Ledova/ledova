from django.test import SimpleTestCase
from eth_account import Account
from eth_keys.constants import SECPK1_N
from web3 import Web3

from shared.tests.signed_transactions import high_s_transaction, with_signature_s
from tokens.services.signed_transactions import decode_signed_transaction

SIGNER = Account.from_key("0x" + "11" * 32)
CONTRACT = Web3.to_checksum_address("0x" + "ab" * 20)
CHAIN_ID = 84532


def _hex(signed) -> str:
    return "0x" + bytes(signed.raw_transaction).hex()


def sign_legacy(to=CONTRACT, chain_id=CHAIN_ID, value=5, data=b"") -> str:
    tx = {"nonce": 1, "gasPrice": 10**9, "gas": 100_000, "to": to, "value": value, "data": data}
    if chain_id is not None:
        tx["chainId"] = chain_id
    return _hex(SIGNER.sign_transaction(tx))


def sign_eip1559(to=CONTRACT, chain_id=CHAIN_ID, value=7, data="0x1234") -> str:
    tx = {
        "type": 2,
        "chainId": chain_id,
        "nonce": 1,
        "maxFeePerGas": 10**9,
        "maxPriorityFeePerGas": 10**8,
        "gas": 100_000,
        "to": to,
        "value": value,
        "data": data,
    }
    return _hex(SIGNER.sign_transaction(tx))


def sign_eip2930() -> str:
    return _hex(
        SIGNER.sign_transaction(
            {
                "type": 1,
                "chainId": CHAIN_ID,
                "nonce": 1,
                "gasPrice": 10**9,
                "gas": 100_000,
                "to": CONTRACT,
                "value": 7,
                "accessList": [],
            }
        )
    )


def _raw(signed_hex: str) -> bytes:
    return bytes.fromhex(signed_hex[2:])


class DecodeSignedTransactionTest(SimpleTestCase):
    def test_eip2930_transaction(self):
        decoded = decode_signed_transaction(_raw(sign_eip2930()))
        self.assertEqual(decoded.sender, SIGNER.address)
        self.assertEqual(decoded.to, CONTRACT)
        self.assertEqual(decoded.chain_id, CHAIN_ID)
        self.assertEqual(decoded.envelope_type, 1)

    def test_recoverable_high_s_twins_are_not_accepted_as_transactions(self):
        for signed in (sign_legacy(), sign_legacy(chain_id=None), sign_eip2930(), sign_eip1559()):
            with self.subTest(envelope=signed[:8]):
                raw = _raw(signed)
                self.assertEqual(decode_signed_transaction(raw).sender, SIGNER.address)
                altered = high_s_transaction(raw)
                self.assertEqual(Account.recover_transaction(altered), SIGNER.address)
                with self.assertRaises(ValueError):
                    decode_signed_transaction(altered)

    def test_signature_s_uses_the_protocol_boundaries_for_every_supported_envelope(self):
        for signed in (sign_legacy(), sign_legacy(chain_id=None), sign_eip2930(), sign_eip1559()):
            for s in (1, SECPK1_N // 2):
                with self.subTest(envelope=signed[:8], allowed_s=s):
                    raw = with_signature_s(_raw(signed), s)
                    self.assertEqual(decode_signed_transaction(raw).sender, Account.recover_transaction(raw))
            for s in (SECPK1_N // 2 + 1, SECPK1_N - 1):
                with self.subTest(envelope=signed[:8], refused_s=s), self.assertRaises(ValueError):
                    decode_signed_transaction(with_signature_s(_raw(signed), s))

    def test_legacy_transaction(self):
        decoded = decode_signed_transaction(_raw(sign_legacy(value=5, data=b"")))

        self.assertEqual(decoded.sender, SIGNER.address)
        self.assertEqual(decoded.to, CONTRACT)
        self.assertEqual(decoded.chain_id, CHAIN_ID)
        self.assertEqual(decoded.value, 5)
        self.assertEqual(decoded.data, b"")

    def test_eip1559_transaction(self):
        decoded = decode_signed_transaction(_raw(sign_eip1559(value=7, data="0x1234")))

        self.assertEqual(decoded.sender, SIGNER.address)
        self.assertEqual(decoded.to, CONTRACT)
        self.assertEqual(decoded.chain_id, CHAIN_ID)
        self.assertEqual(decoded.value, 7)
        self.assertEqual(decoded.data, bytes.fromhex("1234"))

    def test_pre_eip155_legacy_transaction_has_no_chain_id(self):
        decoded = decode_signed_transaction(_raw(sign_legacy(chain_id=None)))

        self.assertEqual(decoded.sender, SIGNER.address)
        self.assertIsNone(decoded.chain_id)

    def test_contract_creation_has_no_recipient(self):
        self.assertIsNone(decode_signed_transaction(_raw(sign_legacy(to=b"", data="0x6000"))).to)
        self.assertIsNone(decode_signed_transaction(_raw(sign_eip1559(to=b"", data="0x6000"))).to)

    def test_garbage_raises_value_error(self):
        for raw in (b"", b"\x02\x00", b"\xc0", b"\xf8\x00", bytes.fromhex("deadbeef")):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                decode_signed_transaction(raw)
