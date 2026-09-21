import logging
from collections import defaultdict

from django.db.models.functions import Lower
from rest_framework.exceptions import ValidationError

from blockchain.models import SignedAttempt
from integrations.blockchain.receipts import normalized_hash
from shared.db import atomic
from tokens.exceptions import RegisterUnavailableException
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMemberWallet,
    RegisterPosition,
    RegisterReconciliation,
    RegisterReconciliationStatus,
    ShareIssuance,
    ShareIssuanceExecution,
    ShareRegister,
    ShareToken,
    SwapOrder,
)
from tokens.services.register_inclusions import (
    ATTRIBUTION,
    ISSUE,
    OPENING,
    _operator,
    _recorded,
    classify_inclusion,
    completed_inclusions,
    opening_boundary,
)
from tokens.services.register_snapshot import capture_snapshot

logger = logging.getLogger(__name__)

ISSUANCE_OPERATION = "share-issuance:"
SWAP_OPERATION = "swap-execution:"


def _swap_movement(swap):
    return [(swap.seller_address, -swap.share_amount), (swap.buyer_address, swap.share_amount)], 0


def _completed_movement(inclusion):
    if inclusion["kind"] == ISSUE:
        issuance = ShareIssuance.objects.get(pk=inclusion["source"])
        return [(issuance.recipient_address, int(issuance.amount))], int(issuance.amount)
    return _swap_movement(SwapOrder.objects.get(pk=inclusion["source"]))


def _in_flight(token, transactions):
    movements = {}
    attempts = (
        SignedAttempt.objects.annotate(lowered=Lower("tx_hash"))
        .filter(lowered__in=[f"0x{transaction}" for transaction in transactions])
        .select_related("operation")
    )
    for attempt in attempts:
        transaction = normalized_hash(attempt.tx_hash)
        key = attempt.operation.operation_key
        if key.startswith(ISSUANCE_OPERATION):
            execution = ShareIssuanceExecution.objects.filter(pk=key.rsplit(":", 1)[1], token_id=token.pk).first()
            if execution is not None:
                amount = int(execution.intent["amount"])
                movements[transaction] = ([(execution.intent["recipient"], amount)], amount)
        elif key.startswith(SWAP_OPERATION):
            swap = SwapOrder.objects.filter(transaction_id=key[len(SWAP_OPERATION) :], share_token=token).first()
            if swap is not None:
                movements[transaction] = _swap_movement(swap)
    return movements


def _compare(token, snapshot):
    boundary = opening_boundary(token.pk)
    register = ShareRegister.objects.get(token=token)
    height = snapshot["block"]["number"]
    history = {normalized_hash(entry["transaction"]): entry["block"] for entry in snapshot["history"]}
    try:
        inclusions = completed_inclusions(token.pk)
    except ValidationError as exc:
        return [{"kind": "attribution", "detail": " ".join(str(item) for item in exc.detail)}], register.sequence
    recorded = _recorded(token.pk)
    positions = defaultdict(int)
    for position in RegisterPosition.objects.filter(register=register):
        positions[str(position.member_id)] += int(position.shares)
    supply = int(register.issued_supply)
    pending = defaultdict(int)
    pending_supply = 0
    explained = set()
    discrepancies = []
    for inclusion in inclusions:
        classification = classify_inclusion(boundary, inclusion)
        if classification == OPENING:
            continue
        if classification == ATTRIBUTION:
            discrepancies.append({"kind": "attribution", "effect": inclusion["kind"], "source": inclusion["source"]})
            continue
        if inclusion["block_number"] > height:
            if inclusion["source"] in recorded:
                entry = RegisterEntry.objects.get(register=register, operation_id=inclusion["source"])
                for change in entry.changes:
                    positions[change["member"]] -= int(change["shares"])
                    if entry.kind == RegisterEntryKind.ISSUE:
                        supply -= int(change["shares"])
            continue
        if history.get(inclusion["transaction"]) != inclusion["block_number"]:
            discrepancies.append(
                {
                    "kind": "missing_transfer",
                    "effect": inclusion["kind"],
                    "source": inclusion["source"],
                    "transaction": f"0x{inclusion['transaction']}",
                }
            )
            continue
        explained.add(inclusion["transaction"])
        if inclusion["source"] not in recorded:
            deltas, issued = _completed_movement(inclusion)
            for address, delta in deltas:
                pending[address.lower()] += delta
            pending_supply += issued
    unexplained = {
        transaction: block
        for transaction, block in history.items()
        if block > boundary["block"]["number"] and transaction not in explained
    }
    for transaction, (deltas, issued) in _in_flight(token, unexplained).items():
        for address, delta in deltas:
            pending[address.lower()] += delta
        pending_supply += issued
        del unexplained[transaction]
    for transaction, block in sorted(unexplained.items(), key=lambda item: (item[1], item[0])):
        discrepancies.append({"kind": "unrecognised_transfer", "transaction": f"0x{transaction}", "block": block})
    links = {
        link.address.lower(): str(link.member_id)
        for link in RegisterMemberWallet.objects.filter(company_id=token.company_id)
    }
    chain_members, chain_unlinked = defaultdict(int), defaultdict(int)
    for holding in snapshot["holdings"]:
        address = holding["address"].lower()
        if address in links:
            chain_members[links[address]] += int(holding["shares"])
        else:
            chain_unlinked[address] += int(holding["shares"])
    expected_members, expected_unlinked = defaultdict(int, positions), defaultdict(int)
    for address, delta in pending.items():
        if address in links:
            expected_members[links[address]] += delta
        else:
            expected_unlinked[address] += delta
    for member in sorted(set(chain_members) | set(expected_members)):
        if chain_members[member] != expected_members[member]:
            discrepancies.append(
                {
                    "kind": "member",
                    "member": member,
                    "chain": str(chain_members[member]),
                    "expected": str(expected_members[member]),
                }
            )
    for address in sorted(set(chain_unlinked) | set(expected_unlinked)):
        if chain_unlinked[address] != expected_unlinked[address]:
            discrepancies.append(
                {
                    "kind": "unlinked",
                    "address": address,
                    "chain": str(chain_unlinked[address]),
                    "expected": str(expected_unlinked[address]),
                }
            )
    if int(snapshot["issued_supply"]) != supply + pending_supply:
        discrepancies.append(
            {"kind": "supply", "chain": snapshot["issued_supply"], "expected": str(supply + pending_supply)}
        )
    return discrepancies, register.sequence


def reconcile_register(token_id, *, client=None):
    _operator()
    token = ShareToken.objects.get(pk=token_id)
    if opening_boundary(token.pk) is None:
        return None
    try:
        snapshot = capture_snapshot(token.pk, client=client)
    except RegisterUnavailableException as exc:
        logger.warning("Register reconciliation for share class %s could not read the chain", token.pk)
        return RegisterReconciliation.objects.create(
            token=token, status=RegisterReconciliationStatus.FAILED, failure=str(exc.detail)
        )
    with atomic():
        locked = ShareToken.objects.select_for_update().get(pk=token.pk)
        discrepancies, sequence = _compare(locked, snapshot)
        record = RegisterReconciliation.objects.create(
            token=locked,
            status=RegisterReconciliationStatus.DISCREPANT if discrepancies else RegisterReconciliationStatus.MATCHED,
            block_number=snapshot["block"]["number"],
            block_hash=snapshot["block"]["hash"],
            register_sequence=sequence,
            discrepancies=discrepancies,
        )
    if discrepancies:
        logger.error(
            "Register reconciliation for share class %s found %s discrepancies at block %s",
            token.pk,
            len(discrepancies),
            snapshot["block"]["number"],
        )
    return record
