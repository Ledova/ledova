from collections import defaultdict

from django.db.models import F, Q

from blockchain.models import OutgoingOperation, SignedAttempt
from tokens.models import RegisterEntry, RegisterEntryKind, SwapOrder, TokenDeployment

LINKS = (
    ("deployment", "token_deployment"),
    ("swap_approval", "swap_approval"),
    ("issuance", "share_issuance"),
    ("capital_increase", "capital_increase"),
    ("pause", "pause_change"),
)
SETTLED_BY = "swap_transaction__swap_orders"
OPERATION = (
    "pk",
    "operation_key",
    "intent",
    "status",
    "last_error",
    "created_at",
    "acknowledged_at",
    "block_number",
    "block_hash",
    "gas_used",
    "current_attempt__tx_hash",
)
ATTEMPT = ("operation_id", "tx_hash", "nonce", "signer__address", "signer__chain_id", "created_at")


def key(operation):
    return None if operation is None else operation.operation_key


def transaction_hash(transaction):
    return None if transaction is None else transaction.tx_hash


def _linked(company, token):
    rows = []
    for purpose, relation in LINKS:
        rows += [
            {**row, "purpose": purpose}
            for row in OutgoingOperation.objects.filter(
                **{f"{relation}__company_id": company.pk, f"{relation}__token_id": token.pk}
            ).values(*OPERATION, record=F(f"{relation}__uuid"))
        ]
    rows += [
        {**row, "purpose": "settlement"}
        for row in OutgoingOperation.objects.filter(
            **{f"{SETTLED_BY}__share_token": token, f"{SETTLED_BY}__share_token__company": company}
        ).values(*OPERATION, record=F(f"{SETTLED_BY}__uuid"))
    ]
    return rows


def _attempts(rows):
    attempts = defaultdict(list)
    for attempt in (
        SignedAttempt.objects.filter(operation_id__in=[row["pk"] for row in rows])
        .order_by("created_at", "uuid")
        .values(*ATTEMPT)
    ):
        attempts[attempt["operation_id"]].append(
            {
                "tx_hash": attempt["tx_hash"],
                "nonce": attempt["nonce"],
                "signer": attempt["signer__address"],
                "chain_id": attempt["signer__chain_id"],
                "signed_at": attempt["created_at"],
            }
        )
    return attempts


def operations(company, token) -> list:
    rows = _linked(company, token)
    attempts = _attempts(rows)
    return [
        {
            "key": row["operation_key"],
            "purpose": row["purpose"],
            "record": row["record"],
            "intent": row["intent"],
            "status": row["status"],
            "last_error": row["last_error"],
            "opened_at": row["created_at"],
            "acknowledged_at": row["acknowledged_at"],
            "receipt": (
                None
                if row["block_number"] is None
                else {"block_number": row["block_number"], "block_hash": row["block_hash"], "gas_used": row["gas_used"]}
            ),
            "current_attempt": row["current_attempt__tx_hash"],
            "attempts": attempts[row["pk"]],
        }
        for row in sorted(rows, key=lambda row: (row["created_at"], row["operation_key"]))
    ]


def deployment(company, token):
    record = (
        TokenDeployment.objects.filter(company_id=company.pk, token_id=token.pk)
        .select_related("operation", "transaction", "approval_operation", "approval_transaction")
        .first()
    )
    if record is None:
        return None
    return {
        "uuid": record.pk,
        "intent": record.intent,
        "operation": key(record.operation),
        "transaction": transaction_hash(record.transaction),
        "contract_address": record.contract_address or None,
        "attribution_required": record.attribution_required,
        "projected_at": record.projected_at,
        "swap_approval": {
            "intent": record.approval_intent,
            "outcome": record.approval_outcome or None,
            "operation": key(record.approval_operation),
            "transaction": transaction_hash(record.approval_transaction),
            "observation": record.approval_observation,
        },
    }


def settlements(company, token) -> list:
    swaps = list(
        SwapOrder.objects.filter(share_token=token, share_token__company=company)
        .filter(Q(transaction__isnull=False) | ~Q(tx_hash=""))
        .select_related("transaction__outgoing_operation")
        .order_by("created_at", "uuid")
    )
    entries = dict(
        RegisterEntry.objects.filter(
            register__token=token, kind=RegisterEntryKind.TRANSFER, operation_id__in=[swap.pk for swap in swaps]
        ).values_list("operation_id", "uuid")
    )
    return [
        {
            "uuid": swap.pk,
            "status": swap.status,
            "protocol_version": swap.settlement_protocol_version,
            "typed_data": (swap.settlement_context or {}).get("typed_data"),
            "order_hash": swap.order_hash,
            "digest": swap.settlement_digest or None,
            "seller_signature": swap.seller_signature or None,
            "buyer_signature": swap.buyer_signature or None,
            "transaction": transaction_hash(swap.transaction) or swap.tx_hash or None,
            "operation": key(None if swap.transaction is None else swap.transaction.outgoing_operation),
            "finalized_receipt": swap.finalized_receipt,
            "completed_at": swap.completed_at,
            "entry": entries.get(swap.pk),
        }
        for swap in swaps
    ]
