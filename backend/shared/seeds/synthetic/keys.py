import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import timedelta

import base58
import bech32
from bitcoin_message_tool import bmt
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_keys import keys
from eth_utils import keccak

from wallets.services.wallets import generate_verification_challenge

NAMESPACE = "ledova-demo-seed"
HARDHAT_MNEMONIC = "test test test test test test test test test test test junk"
SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
HARDENED = 0x80000000
EVM_ACCOUNT_PATH = (44 + HARDENED, 60 + HARDENED, 0 + HARDENED, 0)
EVM_ACCOUNT_PATH_TEXT = "m/44'/60'/0'/0"
CHALLENGE_LEAD = timedelta(seconds=40)
NONCE_LINE = re.compile(r"^Nonce: [0-9a-f]+$", re.MULTILINE)


@dataclass(frozen=True)
class Derivation:
    path: str
    fingerprint: str
    index: int
    parent_public_key: str
    parent_chain_code: str
    parent_path: str


@dataclass(frozen=True)
class HardwareKey:
    key: bytes
    derivation: Derivation


def secret(*labels):
    return keccak(text="/".join((NAMESPACE, *(str(label) for label in labels))))


def evm_address(key):
    return Account.from_key(key).address


def compressed_public_key(key):
    return keys.PrivateKey(key).public_key.to_compressed_bytes()


def hash160(data):
    return hashlib.new("ripemd160", hashlib.sha256(data).digest()).digest()


def bitcoin_address(key):
    return bech32.bech32_encode("tb", [0] + bech32.convertbits(hash160(compressed_public_key(key)), 8, 5))


def counterparty_address(chain, number):
    key = secret("counterparty", chain, number)
    return bitcoin_address(key) if chain == "bitcoin" else evm_address(key)


def transaction_hash(chain, *labels):
    digest = secret("transaction", chain, *labels).hex()
    return digest if chain == "bitcoin" else f"0x{digest}"


def block_hash(chain, number):
    digest = secret("block", chain, number).hex()
    return f"00000000{digest[8:]}" if chain == "bitcoin" else f"0x{digest}"


def _child(key, chain_code, index):
    data = (b"\x00" + key if index >= HARDENED else compressed_public_key(key)) + index.to_bytes(4, "big")
    digest = hmac.new(chain_code, data, hashlib.sha512).digest()
    child = (int.from_bytes(digest[:32], "big") + int.from_bytes(key, "big")) % SECP256K1_ORDER
    return child.to_bytes(32, "big"), digest[32:]


def _master(seed):
    digest = hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()
    return digest[:32], digest[32:]


def hardware_keys(seed, indexes):
    master_key, master_code = _master(seed)
    fingerprint = hash160(compressed_public_key(master_key))[:4].hex()
    key, chain_code = master_key, master_code
    for index in EVM_ACCOUNT_PATH:
        key, chain_code = _child(key, chain_code, index)
    parent_public_key = compressed_public_key(key).hex()
    return [
        HardwareKey(
            key=_child(key, chain_code, index)[0],
            derivation=Derivation(
                path=f"{EVM_ACCOUNT_PATH_TEXT}/{index}",
                fingerprint=fingerprint,
                index=index,
                parent_public_key=parent_public_key,
                parent_chain_code=chain_code.hex(),
                parent_path=EVM_ACCOUNT_PATH_TEXT,
            ),
        )
        for index in indexes
    ]


def hardhat_seed():
    return hashlib.pbkdf2_hmac("sha512", HARDHAT_MNEMONIC.encode(), b"mnemonic", 2048)


def hardhat_keys(indexes):
    return hardware_keys(hardhat_seed(), indexes)


def challenge(address, issued_at):
    nonce = secret("challenge", address, int(issued_at.timestamp()))[:16].hex()
    return NONCE_LINE.sub(f"Nonce: {nonce}", generate_verification_challenge(address, issued_at), count=1)


def sign(chain, key, message):
    if chain == "bitcoin":
        wif = base58.b58encode_check(b"\xef" + key + b"\x01").decode("ascii")
        return bmt.sign_message(wif, "p2wpkh", message, deterministic=True)[2]
    return Account.from_key(key).sign_message(encode_defunct(text=message)).signature.to_0x_hex()


def device_token(*labels):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    value = int.from_bytes(secret("device", *labels), "big")
    characters = []
    for _ in range(22):
        value, remainder = divmod(value, len(alphabet))
        characters.append(alphabet[remainder])
    return f"ExponentPushToken[{''.join(characters)}]"
