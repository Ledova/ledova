import hashlib
import json
import logging
import re
from collections.abc import Mapping

import rlp
from django.conf import settings
from django.db import connections
from eth_account import Account
from web3 import Web3

from blockchain.constants import (
    FRESH_SIGNER_AUTHORIZATION_LENGTH,
    FRESH_SIGNER_BOOTSTRAP_LOCK,
    FRESH_SIGNER_CHAIN_ID,
    FRESH_SIGNER_ENVIRONMENT_LENGTH,
    FRESH_SIGNER_MANIFEST_VERSION,
    FRESH_SIGNER_MAX_INTEGER,
    FRESH_SIGNER_OBSERVATION_ATTEMPTS,
    FRESH_SIGNER_TRANSACTION_COUNT,
    FRESH_SIGNER_VALIDATOR_VERSION,
)
from blockchain.exceptions import FreshSignerBootstrapError
from blockchain.models import (
    BlockchainTransaction,
    FreshSignerBootstrap,
    OutgoingCutoverHold,
    OutgoingHistoryEvidence,
    OutgoingOperation,
    SignedAttempt,
    SignerAdmission,
    SigningAccount,
)
from blockchain.services.bootstrap_artifacts import (
    load_bootstrap_artifacts,
    verify_bootstrap_runtime,
)
from blockchain.services.outgoing_inventory import COVERAGE_LIMITS
from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import nonnegative_integer, normalized_hash
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.services.legacy_outgoing_sources import read_legacy_outgoing_sources
from wallets.models import ChainObservationFinality, ChainObservationResult
from wallets.services.chain_evidence import collect_chain_evidence
from wallets.services.chain_observations import finality_policy

logger = logging.getLogger(__name__)

MANIFEST_KEYS = {
    "version",
    "chain_id",
    "operator_address",
    "environment_id",
    "authorization_reference",
    "attestations",
    "contracts",
    "transactions",
}
CONTRACT_SETTINGS = {
    "share_token_factory": "SHARE_TOKEN_FACTORY_ADDRESS",
    "stablecoin": "STABLECOIN_CONTRACT_ADDRESS",
    "atomic_swap": "ATOMIC_SWAP_ADDRESS",
}
ATTESTATIONS = {"fresh_key", "isolated_environment", "producers_stopped"}
OBSERVATION_FAILURE_REASONS = {
    "network_mismatch",
    "head_unavailable",
    "network_changed",
    "head_changed",
    "receipt_unavailable",
    "receipt_block_replaced",
    "finality_unavailable",
    "policy_invalid",
    "policy_unconfigured",
    "finality_waiting",
    "provider_unavailable",
}


def require_bootstrap_boundary():
    if current_alias() == APP_ALIAS:
        raise FreshSignerBootstrapError("Fresh signer admission requires an operator connection.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise FreshSignerBootstrapError("Fresh signer admission requires autocommit outside every transaction block.")


def _address(value):
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value)
        or int(value[2:], 16) == 0
        or (value != value.lower() and not Web3.is_checksum_address(value))
    ):
        raise FreshSignerBootstrapError("A bootstrap address must be nonzero and lowercase or checksummed.")
    return value.lower()


def _hash(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        raise FreshSignerBootstrapError("A bootstrap transaction hash is invalid.")
    return value.lower()


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != expected:
        raise FreshSignerBootstrapError("The bootstrap manifest schema is invalid.")


def validate_bootstrap_manifest(manifest):
    _keys(manifest, MANIFEST_KEYS)
    if type(manifest["version"]) is not int or manifest["version"] != FRESH_SIGNER_MANIFEST_VERSION:
        raise FreshSignerBootstrapError("The bootstrap manifest version is unsupported.")
    if type(manifest["chain_id"]) is not int or manifest["chain_id"] != FRESH_SIGNER_CHAIN_ID:
        raise FreshSignerBootstrapError("Fresh signer admission is restricted to Base Sepolia.")
    _keys(manifest["contracts"], set(CONTRACT_SETTINGS))
    _keys(manifest["attestations"], ATTESTATIONS)
    if any(value is not True for value in manifest["attestations"].values()):
        raise FreshSignerBootstrapError("Fresh key, isolated environment and stopped producers must be attested.")
    for key, maximum in (
        ("environment_id", FRESH_SIGNER_ENVIRONMENT_LENGTH),
        ("authorization_reference", FRESH_SIGNER_AUTHORIZATION_LENGTH),
    ):
        value = manifest[key]
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            raise FreshSignerBootstrapError("A bounded environment identity and authorization reference are required.")
    transactions = manifest["transactions"]
    if not isinstance(transactions, list) or len(transactions) != FRESH_SIGNER_TRANSACTION_COUNT:
        raise FreshSignerBootstrapError("The manifest must name exactly five bootstrap transactions.")
    normalized = manifest | {
        "operator_address": _address(manifest["operator_address"]),
        "contracts": {key: _address(value) for key, value in manifest["contracts"].items()},
        "transactions": [_hash(value) for value in transactions],
    }
    if len(set(normalized["transactions"])) != FRESH_SIGNER_TRANSACTION_COUNT:
        raise FreshSignerBootstrapError("Bootstrap transaction hashes must be distinct.")
    if len(set(normalized["contracts"].values())) != len(CONTRACT_SETTINGS):
        raise FreshSignerBootstrapError("Bootstrap contract addresses must be distinct.")
    return json.loads(json.dumps(normalized))


def _configuration(manifest):
    if type(settings.BLOCKCHAIN_CHAIN_ID) is not int or settings.BLOCKCHAIN_CHAIN_ID != FRESH_SIGNER_CHAIN_ID:
        raise FreshSignerBootstrapError("The configured chain must be Base Sepolia.")
    try:
        address = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address.lower()
    except Exception:
        raise FreshSignerBootstrapError("A valid configured operator key is required.") from None
    if address != manifest["operator_address"]:
        raise FreshSignerBootstrapError("The configured operator key does not match the manifest.")
    if any(
        _address(getattr(settings, setting)) != manifest["contracts"][key] for key, setting in CONTRACT_SETTINGS.items()
    ):
        raise FreshSignerBootstrapError("Configured contracts do not match the manifest.")


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _result(record, unchanged):
    return {"bootstrap_id": str(record.pk), "manifest_digest": record.manifest_digest, "unchanged": unchanged}


def _replay(signer, digest):
    if signer is None:
        return None
    record = FreshSignerBootstrap.objects.filter(signer=signer).first()
    if record is None:
        return None
    if record.manifest_digest != digest:
        raise FreshSignerBootstrapError("This signer already has a different bootstrap manifest.")
    if signer.admission_state != SignerAdmission.ADMITTED or signer.admission_generation != 1:
        raise FreshSignerBootstrapError("A closed or subsequently admitted signer cannot be reopened by bootstrap.")
    return _result(record, True)


def _fresh_signer(signer):
    if signer is not None and (
        signer.admission_state != SignerAdmission.CLOSED or signer.admission_generation != 0 or signer.next_nonce != 0
    ):
        raise FreshSignerBootstrapError("Bootstrap requires an unused signer at closed generation zero and nonce zero.")


def _fresh_history(signer):
    if (
        OutgoingOperation.objects.exists()
        or SignedAttempt.objects.exists()
        or OutgoingHistoryEvidence.objects.exists()
        or BlockchainTransaction.objects.exists()
        or FreshSignerBootstrap.objects.exists()
        or OutgoingCutoverHold.objects.exclude(reason__in=COVERAGE_LIMITS).exists()
        or SigningAccount.objects.exclude(pk=signer.pk if signer is not None else None).exists()
        or read_legacy_outgoing_sources()
    ):
        raise FreshSignerBootstrapError("Fresh admission refuses existing outgoing, imported or legacy source history.")


def _provider_chain(client):
    actual = client.w3.eth.chain_id
    if type(actual) is not int or actual != FRESH_SIGNER_CHAIN_ID:
        raise FreshSignerBootstrapError("The provider is not currently on Base Sepolia.")


def _create_address(sender, nonce):
    return Web3.to_hex(Web3.keccak(rlp.encode([bytes.fromhex(sender[2:]), nonce]))[-20:])


def _terms(manifest, artifacts):
    sender, contracts = manifest["operator_address"], manifest["contracts"]
    creations = ((0, "share_token_factory"), (1, "stablecoin"), (3, "atomic_swap"))
    provider = Web3()
    builders = {
        key: provider.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
        for key, artifact in artifacts.items()
    }
    terms = {}
    for nonce, key in creations:
        if contracts[key] != _create_address(sender, nonce):
            raise FreshSignerBootstrapError("A manifest contract address is not the expected CREATE address.")
        terms[nonce] = {
            "to": None,
            "data": builders[key].constructor(Web3.to_checksum_address(sender)).data_in_transaction,
            "contract_address": contracts[key],
        }
    terms[2] = {
        "to": contracts["stablecoin"],
        "data": builders["stablecoin"].encode_abi("addMinter", args=[Web3.to_checksum_address(sender)]),
        "contract_address": None,
    }
    terms[4] = {
        "to": contracts["atomic_swap"],
        "data": builders["atomic_swap"].encode_abi(
            "setPaymentTokenApproval", args=[Web3.to_checksum_address(contracts["stablecoin"]), True]
        ),
        "contract_address": None,
    }
    return terms


def _receipt_identity(receipt, tx_hash, sender, terms):
    if not isinstance(receipt, Mapping):
        raise FreshSignerBootstrapError("A bootstrap receipt is missing.")
    identity = {
        "transaction_hash": normalized_hash(receipt.get("transactionHash")),
        "block_hash": normalized_hash(receipt.get("blockHash")),
        "block_number": nonnegative_integer(receipt.get("blockNumber"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True),
        "transaction_index": nonnegative_integer(
            receipt.get("transactionIndex"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True
        ),
        "status": nonnegative_integer(receipt.get("status"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True),
        "sender": _address(receipt.get("from")),
        "to": _address(receipt["to"]) if receipt.get("to") is not None else None,
        "contract_address": (
            _address(receipt["contractAddress"]) if receipt.get("contractAddress") is not None else None
        ),
    }
    if (
        identity["transaction_hash"] != tx_hash[2:]
        or identity["block_hash"] is None
        or identity["block_number"] is None
        or identity["transaction_index"] is None
        or identity["status"] != 1
        or identity["sender"] != sender
        or identity["to"] != terms["to"]
        or identity["contract_address"] != terms["contract_address"]
    ):
        raise FreshSignerBootstrapError("A bootstrap receipt has an unexpected identity or outcome.")
    return identity


def _transaction(client, tx_hash, nonce, sender, terms):
    transaction = client.get_transaction(tx_hash)
    if not isinstance(transaction, Mapping):
        raise FreshSignerBootstrapError("A bootstrap transaction is missing.")
    data = transaction.get("input")
    if isinstance(data, (bytes, bytearray)):
        data = Web3.to_hex(data)
    if (
        normalized_hash(transaction.get("hash")) != tx_hash[2:]
        or nonnegative_integer(transaction.get("chainId"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True)
        != FRESH_SIGNER_CHAIN_ID
        or nonnegative_integer(transaction.get("nonce"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True) != nonce
        or nonnegative_integer(transaction.get("value"), maximum=FRESH_SIGNER_MAX_INTEGER, encoded=True) != 0
        or _address(transaction.get("from")) != sender
        or (_address(transaction["to"]) if transaction.get("to") is not None else None) != terms["to"]
        or not isinstance(data, str)
        or data.lower() != terms["data"].lower()
    ):
        raise FreshSignerBootstrapError("A bootstrap transaction differs from the trusted deployment sequence.")
    return {"nonce": nonce, "value": "0", "to": terms["to"], "input_keccak": Web3.to_hex(Web3.keccak(hexstr=data))}


def _read_observation(client, tx_hash, policy):
    for _ in range(FRESH_SIGNER_OBSERVATION_ATTEMPTS):
        evidence = collect_chain_evidence(
            client,
            chain=BLOCKCHAIN_BASE,
            network=f"evm:{FRESH_SIGNER_CHAIN_ID}",
            tx_hash=tx_hash,
            previous_block=None,
            policy=policy,
        )
        if (
            evidence.get("result") != ChainObservationResult.UNKNOWN
            or evidence.get("finality") != ChainObservationFinality.UNKNOWN
            or evidence.get("reason") != "head_changed"
        ):
            break
    return evidence


def _chain_evidence(client, manifest, artifacts):
    _provider_chain(client)
    policy = finality_policy(f"evm:{FRESH_SIGNER_CHAIN_ID}", BLOCKCHAIN_BASE)
    if policy.get("mode") != "finalized":
        raise FreshSignerBootstrapError(
            "Fresh admission requires the approved finalized policy without depth fallback."
        )
    sender = manifest["operator_address"]
    expected = _terms(manifest, artifacts)
    observations = []
    for nonce, tx_hash in enumerate(manifest["transactions"]):
        _provider_chain(client)
        terms = _transaction(client, tx_hash, nonce, sender, expected[nonce])
        receipt = _receipt_identity(client.get_transaction_receipt(tx_hash), tx_hash, sender, expected[nonce])
        evidence = _read_observation(client, tx_hash, policy)
        details = evidence.get("evidence", {})
        observed = details.get("receipt") or {}
        if (
            evidence.get("result") != ChainObservationResult.INCLUDED
            or evidence.get("finality") != ChainObservationFinality.SATISFIED
            or details.get("complete") is not True
            or observed.get("succeeded") is not True
            or observed.get("hash") != "0x" + receipt["block_hash"]
            or observed.get("height") != receipt["block_number"]
            or observed.get("timestamp") is None
            or observed.get("actual_fee") is None
        ):
            reason = evidence.get("reason")
            if reason not in OBSERVATION_FAILURE_REASONS:
                reason = "incomplete_or_unsuccessful"
            raise FreshSignerBootstrapError(
                "Bootstrap transactions require complete successful canonical finalized evidence "
                f"(transaction index {nonce}, reason {reason})."
            )
        if _receipt_identity(client.get_transaction_receipt(tx_hash), tx_hash, sender, expected[nonce]) != receipt:
            raise FreshSignerBootstrapError("A bootstrap receipt changed during verification.")
        _provider_chain(client)
        observations.append({"transaction": terms, "receipt": receipt, "observation": evidence})
    states = {}
    for key, address in manifest["contracts"].items():
        checksum = Web3.to_checksum_address(address)
        code = bytes(client.w3.eth.get_code(checksum))
        verify_bootstrap_runtime(code, artifacts[key])
        contract = client.w3.eth.contract(address=checksum, abi=artifacts[key]["abi"])
        if _address(contract.functions.owner().call()) != sender:
            raise FreshSignerBootstrapError("A bootstrap contract is not owned by the configured operator.")
        if key == "stablecoin" and contract.functions.minters(Web3.to_checksum_address(sender)).call() is not True:
            raise FreshSignerBootstrapError("The configured operator is not the stablecoin minter.")
        if key == "atomic_swap" and (
            contract.functions.relayers(Web3.to_checksum_address(sender)).call() is not True
            or contract.functions.approvedPaymentTokens(
                Web3.to_checksum_address(manifest["contracts"]["stablecoin"])
            ).call()
            is not True
        ):
            raise FreshSignerBootstrapError("The swap relayer or payment-token approval is missing.")
        states[key] = {"code_keccak": Web3.to_hex(Web3.keccak(code)), "owner": sender}
    _provider_chain(client)
    for block in ("latest", "pending"):
        count = client.w3.eth.get_transaction_count(Web3.to_checksum_address(sender), block)
        if type(count) is not int or count != FRESH_SIGNER_TRANSACTION_COUNT:
            raise FreshSignerBootstrapError("The operator latest and pending nonces must both be exactly five.")
    return {"policy": policy, "transactions": observations, "contracts": states}


def _lock_bootstrap():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [FRESH_SIGNER_BOOTSTRAP_LOCK])


def bootstrap_fresh_signer(manifest):
    require_bootstrap_boundary()
    manifest = validate_bootstrap_manifest(manifest)
    _configuration(manifest)
    digest = _digest(manifest)
    try:
        with atomic(durable=True):
            signer = (
                SigningAccount.objects.select_for_update()
                .filter(chain_id=FRESH_SIGNER_CHAIN_ID, address=manifest["operator_address"])
                .first()
            )
            replay = _replay(signer, digest)
            if replay is not None:
                return replay
            _fresh_signer(signer)
            _fresh_history(signer)
        artifacts = load_bootstrap_artifacts()
        evidence = _chain_evidence(get_base_chain_client(), manifest, artifacts)
        with atomic(durable=True):
            _lock_bootstrap()
            signer, _ = SigningAccount.objects.get_or_create(
                chain_id=FRESH_SIGNER_CHAIN_ID, address=manifest["operator_address"]
            )
            signer = SigningAccount.objects.select_for_update().get(pk=signer.pk)
            replay = _replay(signer, digest)
            if replay is not None:
                return replay
            _fresh_signer(signer)
            _fresh_history(signer)
            record = FreshSignerBootstrap.objects.create(
                signer=signer,
                manifest_digest=digest,
                validator_version=FRESH_SIGNER_VALIDATOR_VERSION,
                manifest=manifest,
                artifact_identities={key: artifact["identity"] for key, artifact in artifacts.items()},
                chain_evidence=evidence,
            )
            signer.admission_state = SignerAdmission.ADMITTED
            signer.admission_generation = 1
            signer.next_nonce = FRESH_SIGNER_TRANSACTION_COUNT
            signer.save(update_fields=["admission_state", "admission_generation", "next_nonce", "updated_at"])
        return _result(record, False)
    except FreshSignerBootstrapError:
        raise
    except Exception as exc:
        logger.error("Fresh signer bootstrap verification or commit failed (%s)", type(exc).__name__)
        raise FreshSignerBootstrapError("Fresh signer admission could not be verified or committed.") from None
