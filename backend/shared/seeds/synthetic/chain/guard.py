from django.conf import settings
from eth_account import Account
from web3 import HTTPProvider, Web3

from blockchain.constants import LOCAL_SIGNER_CHAIN_ID
from blockchain.models import SignerAdmission, SigningAccount
from shared.constants import BLOCKCHAIN_BASE
from wallets.services.chain_observations import finality_policy

CONTRACT_SETTINGS = ("SHARE_TOKEN_FACTORY_ADDRESS", "STABLECOIN_CONTRACT_ADDRESS", "ATOMIC_SWAP_ADDRESS")
FINAL_MODES = ("depth", "finalized")
PROBE_TIMEOUT = 5
NOT_LOCAL = "BLOCKCHAIN_CHAIN_ID is {chain_id}, and the chain layer writes only to the local chain ({local})."
UNSET = "{names} {verb} not set."
NO_FINALITY = "LOCAL_CHAIN_FINALITY_DEPTH is not set, so no issuance on the local chain would ever complete."
BAD_KEY = "BLOCKCHAIN_OPERATOR_KEY is not a valid private key."
NOT_ADMITTED = "The operator signer is not admitted for chain {local}; python manage.py admit_local_signer admits it."
UNREACHABLE = "No node answers at BLOCKCHAIN_RPC_URL."
WRONG_CHAIN = "The node at BLOCKCHAIN_RPC_URL serves chain {chain_id}, not {local}."
NO_CODE = "{name} has no contract code on the node; the core contracts are not deployed there."
GET_THE_CHAIN = (
    "To add it, start the local stack with make dev-up, which serves chain 31337 with the core contracts and "
    "admits the operator signer, then run make dev-seed again."
)


def operator_address():
    return Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address


def _settings_refusal():
    chain_id = settings.BLOCKCHAIN_CHAIN_ID
    if chain_id != LOCAL_SIGNER_CHAIN_ID:
        return NOT_LOCAL.format(chain_id=chain_id, local=LOCAL_SIGNER_CHAIN_ID)
    missing = [name for name in ("BLOCKCHAIN_OPERATOR_KEY", *CONTRACT_SETTINGS) if not getattr(settings, name, "")]
    if missing:
        return UNSET.format(names=", ".join(missing), verb="is" if len(missing) == 1 else "are")
    if finality_policy(f"evm:{LOCAL_SIGNER_CHAIN_ID}", BLOCKCHAIN_BASE)["mode"] not in FINAL_MODES:
        return NO_FINALITY
    try:
        operator_address()
    except Exception:
        return BAD_KEY
    return None


def _signer_refusal():
    admitted = SigningAccount.objects.filter(
        chain_id=LOCAL_SIGNER_CHAIN_ID,
        address=operator_address().lower(),
        admission_state=SignerAdmission.ADMITTED,
    ).exists()
    return None if admitted else NOT_ADMITTED.format(local=LOCAL_SIGNER_CHAIN_ID)


def _node_refusal():
    node = Web3(HTTPProvider(settings.BLOCKCHAIN_RPC_URL, request_kwargs={"timeout": PROBE_TIMEOUT}))
    try:
        chain_id = node.eth.chain_id
        codes = {
            name: node.eth.get_code(Web3.to_checksum_address(getattr(settings, name))) for name in CONTRACT_SETTINGS
        }
    except Exception:
        return UNREACHABLE
    if chain_id != LOCAL_SIGNER_CHAIN_ID:
        return WRONG_CHAIN.format(chain_id=chain_id, local=LOCAL_SIGNER_CHAIN_ID)
    empty = next((name for name, code in codes.items() if not code), None)
    return NO_CODE.format(name=empty) if empty else None


def chain_refusal():
    return _settings_refusal() or _signer_refusal() or _node_refusal()
