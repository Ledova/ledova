from django.core.exceptions import ImproperlyConfigured

SUPPORTED_EVM_CHAIN_IDS = frozenset({1337, 31337, 84532, 11155111})
LOCAL_EVM_CHAIN_IDS = frozenset({1337, 31337})
SUPPORTED_BITCOIN_NETWORKS = frozenset({"regtest", "test"})
BITCOIN_TEST_GENESIS = "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943"
APPROVED_FINALITY_POLICIES = {
    "evm:84532": {"mode": "finalized"},
    "evm:11155111": {"mode": "finalized"},
    f"bitcoin:{BITCOIN_TEST_GENESIS}": {"mode": "depth", "depth": 6},
}


def parse_evm_chain_id(value: str, setting_name: str) -> int:
    try:
        chain_id = int(value)
    except (TypeError, ValueError) as exc:
        raise ImproperlyConfigured(f"{setting_name} must be an integer chain ID") from exc

    if chain_id not in SUPPORTED_EVM_CHAIN_IDS:
        raise ImproperlyConfigured(f"{setting_name}={chain_id} is not a supported local or public-testnet chain ID")
    return chain_id


def local_finality_policies(value: str, chain_id: int) -> dict:
    if not value:
        return {}
    if chain_id not in LOCAL_EVM_CHAIN_IDS:
        raise ImproperlyConfigured("LOCAL_CHAIN_FINALITY_DEPTH applies only to a local chain id")
    try:
        depth = int(value)
    except ValueError as exc:
        raise ImproperlyConfigured("LOCAL_CHAIN_FINALITY_DEPTH must be a positive integer") from exc
    if depth <= 0:
        raise ImproperlyConfigured("LOCAL_CHAIN_FINALITY_DEPTH must be a positive integer")
    return {f"evm:{chain_id}": {"mode": "depth", "depth": depth}}


def parse_bitcoin_network(value: str) -> str:
    network = value.strip().lower()
    if network not in SUPPORTED_BITCOIN_NETWORKS:
        raise ImproperlyConfigured("BITCOIN_NETWORK must be 'test' or 'regtest'")
    return network
