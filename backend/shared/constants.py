BLOCKCHAIN_ETHEREUM = "ethereum"
BLOCKCHAIN_BITCOIN = "bitcoin"
BLOCKCHAIN_POLYGON = "polygon"
BLOCKCHAIN_SOLANA = "solana"
BLOCKCHAIN_AVALANCHE = "avalanche"
BLOCKCHAIN_ARBITRUM = "arbitrum"
BLOCKCHAIN_OPTIMISM = "optimism"
BLOCKCHAIN_BASE = "base"

VALID_BLOCKCHAINS = {
    BLOCKCHAIN_ETHEREUM,
    BLOCKCHAIN_BITCOIN,
    BLOCKCHAIN_POLYGON,
    BLOCKCHAIN_SOLANA,
    BLOCKCHAIN_AVALANCHE,
    BLOCKCHAIN_ARBITRUM,
    BLOCKCHAIN_OPTIMISM,
    BLOCKCHAIN_BASE,
}

EVM_BLOCKCHAINS = {
    BLOCKCHAIN_ETHEREUM,
    BLOCKCHAIN_POLYGON,
    BLOCKCHAIN_AVALANCHE,
    BLOCKCHAIN_ARBITRUM,
    BLOCKCHAIN_OPTIMISM,
    BLOCKCHAIN_BASE,
}

SUPPORTED_CHAINS = {
    BLOCKCHAIN_ETHEREUM,
    BLOCKCHAIN_BITCOIN,
    BLOCKCHAIN_BASE,
}

NATIVE_ASSET_TO_CHAIN = {
    "ETH": BLOCKCHAIN_ETHEREUM,
    "BTC": BLOCKCHAIN_BITCOIN,
    "POL": BLOCKCHAIN_POLYGON,
    "MATIC": BLOCKCHAIN_POLYGON,
    "SOL": BLOCKCHAIN_SOLANA,
    "AVAX": BLOCKCHAIN_AVALANCHE,
}

CHAIN_TO_NATIVE_ASSET = {
    BLOCKCHAIN_ETHEREUM: "ETH",
    BLOCKCHAIN_BITCOIN: "BTC",
    BLOCKCHAIN_POLYGON: "POL",
    BLOCKCHAIN_SOLANA: "SOL",
    BLOCKCHAIN_AVALANCHE: "AVAX",
    BLOCKCHAIN_ARBITRUM: "ETH",
    BLOCKCHAIN_OPTIMISM: "ETH",
    BLOCKCHAIN_BASE: "ETH",
}

NATIVE_ASSET_DECIMALS = {"BTC": 8, "ETH": 18, "POL": 18, "SOL": 9, "AVAX": 18}


def supported_chain_choices() -> list[str]:
    return sorted(SUPPORTED_CHAINS)


def normalize_chain(chain: str) -> str:
    if not chain:
        return ""
    normalized = chain.lower()
    if normalized in VALID_BLOCKCHAINS:
        return normalized
    upper = chain.upper()
    mapped = NATIVE_ASSET_TO_CHAIN.get(upper)
    if mapped:
        return mapped
    return normalized


def get_native_asset_symbol(chain: str) -> str:
    normalized = normalize_chain(chain)
    return CHAIN_TO_NATIVE_ASSET.get(normalized, normalized.upper())
