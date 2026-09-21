import logging
from collections import defaultdict
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import NamedTuple
from uuid import UUID

from rest_framework.exceptions import PermissionDenied
from web3 import Web3

from blockchain.models import OutgoingStatus, TransactionStatus
from integrations.base_chain import get_base_chain_client
from integrations.blockchain.receipts import nonnegative_integer, normalized_hash
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, current_alias
from tokens.constants import MAX_UINT256
from tokens.exceptions import RegisterUnavailableException
from tokens.models import ShareToken, ShareTokenStatus, TokenDeployment
from tokens.services.share_token_service import transfer_logs
from wallets.services.chain_observations import finality_policy
from wallets.services.receipt_readers import MAX_BLOCK_NUMBER

logger = logging.getLogger(__name__)
ZERO_ADDRESS = "0x" + "0" * 40


class RegisterSnapshotTarget(NamedTuple):
    token_id: UUID
    company_id: UUID
    deployment_id: UUID
    chain_id: int
    contract_address: str
    deployment_tx_hash: str
    deployment_block: int
    deployment_hash: str


def _unavailable(message):
    raise RegisterUnavailableException(message)


def _number(value, maximum=MAX_UINT256):
    result = nonnegative_integer(value, maximum=maximum)
    if result is None:
        _unavailable("The snapshot contains an invalid integer quantity or block number.")
    return result


def _hash(value):
    result = normalized_hash(value)
    if result is None:
        _unavailable("The snapshot contains an invalid transaction or block hash.")
    return "0x" + result


def _address(value):
    if not isinstance(value, str) or not Web3.is_address(value):
        _unavailable("The snapshot contains an invalid contract or participant address.")
    return Web3.to_checksum_address(value)


def _target(token_id):
    token = ShareToken.objects.select_related("deployment_transaction").get(pk=token_id)
    deployment = (
        TokenDeployment.objects.select_related("operation__current_attempt")
        .filter(pk=token.deployment_id, token_id=token.pk, company_id=token.company_id)
        .first()
    )
    record = token.deployment_transaction
    if (
        token.status not in (ShareTokenStatus.DEPLOYED, ShareTokenStatus.PAUSED)
        or deployment is None
        or deployment.attribution_required
        or deployment.projected_at is None
        or record is None
        or record.status != TransactionStatus.CONFIRMED
        or deployment.transaction_id != record.pk
        or token.deployment_tx_hash != record.tx_hash
        or not token.contract_address
        or deployment.contract_address.lower() != token.contract_address.lower()
        or deployment.operation is None
        or deployment.operation.status != OutgoingStatus.CONFIRMED
        or deployment.operation.current_attempt is None
        or deployment.operation.current_attempt.tx_hash != record.tx_hash
        or deployment.operation.block_number != record.block_number
        or deployment.operation.block_hash != record.block_hash
    ):
        _unavailable("The share class requires its attributed deployment before a register snapshot can be read.")
    chain_id = _number(deployment.intent.get("chain_id"), MAX_BLOCK_NUMBER)
    return RegisterSnapshotTarget(
        token.pk,
        token.company_id,
        deployment.pk,
        chain_id,
        _address(token.contract_address),
        _hash(record.tx_hash),
        _number(record.block_number, MAX_BLOCK_NUMBER),
        _hash(record.block_hash),
    )


def _block(client, identifier):
    block = client.w3.eth.get_block(identifier)
    if not isinstance(block, Mapping):
        _unavailable("The register snapshot block is unavailable.")
    result = {
        "number": _number(block.get("number"), MAX_BLOCK_NUMBER),
        "hash": _hash(block.get("hash")),
        "timestamp": _number(block.get("timestamp"), MAX_BLOCK_NUMBER),
    }
    if isinstance(identifier, int) and result["number"] != identifier:
        _unavailable("The provider returned a different block from the requested height.")
    return result


def _boundary(client, policy):
    if policy["mode"] == "finalized":
        return _block(client, "finalized")
    if policy["mode"] == "depth":
        head = _block(client, "latest")
        height = head["number"] - policy["depth"] + 1
        if height >= 0:
            return _block(client, height)
    _unavailable("A register snapshot requires an available block under the approved finality policy.")


def _observed_entries(contract, target, boundary):
    entries = []
    for event in transfer_logs(contract, target.deployment_block, boundary["number"]):
        height = _number(event["blockNumber"], MAX_BLOCK_NUMBER)
        if (
            not target.deployment_block <= height <= boundary["number"]
            or event.get("removed", False) is not False
            or _address(event["address"]) != target.contract_address
        ):
            _unavailable("Transfer history is outside the requested canonical contract and block range.")
        entries.append(
            {
                "from": _address(event["args"]["from"]),
                "to": _address(event["args"]["to"]),
                "shares": _number(event["args"]["value"]),
                "block_number": height,
                "block_hash": _hash(event["blockHash"]),
                "transaction": _hash(event["transactionHash"]),
                "log_index": _number(event["logIndex"], MAX_BLOCK_NUMBER),
            }
        )
        if entries[-1]["from"] == entries[-1]["to"] == ZERO_ADDRESS and entries[-1]["shares"]:
            _unavailable("Transfer history contains a positive transfer without a participant.")
    entries.sort(key=lambda entry: (entry["block_number"], entry["log_index"]))
    if len({(entry["block_number"], entry["log_index"]) for entry in entries}) != len(entries):
        _unavailable("Transfer history repeats an event.")
    return entries


def _holdings(entries):
    balances = defaultdict(int)
    for entry in entries:
        sender, recipient, shares = entry["from"], entry["to"], entry["shares"]
        if sender != ZERO_ADDRESS:
            if balances[sender] < shares:
                _unavailable("Transfer history spends shares that were never received.")
            balances[sender] -= shares
        if recipient != ZERO_ADDRESS:
            balances[recipient] += shares
            _number(balances[recipient])
    return dict(balances)


def _contract_uint(client, target, boundary, function):
    value = client.w3.eth.call(
        {"to": target.contract_address, "data": function._encode_transaction_data()},
        block_identifier={"blockHash": boundary["hash"], "requireCanonical": True},
        ccip_read_enabled=False,
    )
    if not isinstance(value, bytes) or len(value) != 32:
        _unavailable("A pinned contract read did not return one exact unsigned integer.")
    return int.from_bytes(value, "big")


def read_snapshot(target, *, client):
    if client.assert_expected_chain() != target.chain_id:
        _unavailable("The provider is not on the share class's original deployment chain.")
    policy = finality_policy(f"evm:{target.chain_id}", BLOCKCHAIN_BASE)
    boundary = _boundary(client, policy)
    if boundary["number"] < target.deployment_block:
        _unavailable("The deployment has not reached the approved finality boundary.")
    if _block(client, target.deployment_block)["hash"] != target.deployment_hash:
        _unavailable("The original deployment block is no longer canonical; attribution is required.")
    if _block(client, boundary["number"]) != boundary:
        _unavailable("The register snapshot boundary changed before it could be read.")
    contract = client.load_contract("ShareToken", target.contract_address)
    if _contract_uint(client, target, boundary, contract.functions.decimals()) != 0:
        _unavailable("A share register requires whole-share contract units.")
    issued = _contract_uint(client, target, boundary, contract.functions.totalSupply())
    authorized = _contract_uint(client, target, boundary, contract.functions.authorizedShares())
    entries = _observed_entries(contract, target, boundary)
    balances = _holdings(entries)
    if issued > authorized or sum(balances.values()) != issued:
        _unavailable("Transfer history does not reconcile with the issued and authorized supply at this block.")
    for address, shares in balances.items():
        if _contract_uint(client, target, boundary, contract.functions.balanceOf(address)) != shares:
            _unavailable("Transfer history does not reconcile with every participant balance at this block.")
    hashes = {entry["block_number"]: entry["block_hash"] for entry in entries}
    for entry in entries:
        if entry["block_hash"] != hashes[entry["block_number"]]:
            _unavailable("Transfer history contains conflicting hashes for one block.")
    for height, block_hash in hashes.items():
        if _block(client, height)["hash"] != block_hash:
            _unavailable("Transfer history contains an event from a noncanonical block.")
    if (
        _block(client, boundary["number"]) != boundary
        or _boundary(client, policy)["number"] < boundary["number"]
        or client.assert_expected_chain() != target.chain_id
        or finality_policy(f"evm:{target.chain_id}", BLOCKCHAIN_BASE) != policy
    ):
        _unavailable("The snapshot's block, chain or finality policy changed during capture.")
    return {
        "version": 1,
        "token": str(target.token_id),
        "company": str(target.company_id),
        "deployment": str(target.deployment_id),
        "chain_id": target.chain_id,
        "contract_address": target.contract_address,
        "deployment_transaction": target.deployment_tx_hash,
        "deployment_block": target.deployment_block,
        "deployment_hash": target.deployment_hash,
        "block": {**boundary, "date": datetime.fromtimestamp(boundary["timestamp"], timezone.utc).date().isoformat()},
        "policy": policy,
        "issued_supply": str(issued),
        "authorized_supply": str(authorized),
        "holdings": [
            {"address": address, "shares": str(shares)} for address, shares in sorted(balances.items()) if shares
        ],
        "history": [
            {"block": block, "block_hash": hashes[block], "transaction": transaction}
            for block, transaction in sorted(
                {(entry["block_number"], entry["transaction"]) for entry in entries if entry["shares"]}
            )
        ],
    }


def capture_snapshot(token_id, *, client=None):
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register snapshot capture requires the operator connection.")
    try:
        target = _target(token_id)
        result = read_snapshot(target, client=client or get_base_chain_client())
        if _target(token_id) != target:
            _unavailable("The share class's deployment identity changed during capture.")
        return result
    except RegisterUnavailableException:
        raise
    except Exception as exc:
        logger.warning("Register snapshot for %s is unavailable: %s", token_id, type(exc).__name__)
        raise RegisterUnavailableException("A complete canonical register snapshot could not be read.") from None
