# Recovery and reconciliation

[Operations](README.md) · [Job schedule](jobs.md)

Start with the affected record and its durable evidence. Restart a stopped worker
with current code and use the existing reconciliation path. A timeout or missing
provider response does not prove a transaction was never submitted.

## Deployment and issuance

Deployment and capital-increase sweeps recover interrupted work; see the
[issuance flow](../architecture/contracts-and-issuance.md). Issuances created after
`tokens/0034` retain a private mint journal. Each signed hash and payload is committed
before submission. The payload includes nonce and chain ID, and mint execution
refuses an enclosing database transaction that could roll back that identity.
Backups containing the journal contain signed transactions that can be broadcast.

Retrying or running `check_executing_issuance_requests` reads the receipt and may
resubmit **the same signed bytes**. Duplicate, nonce-too-low and provider-unavailable
responses remain unresolved; they never authorize a fresh nonce. A confirmed revert
permits a new signed attempt while retaining the prior attempt. Global signer nonce
coordination and receipt finality remain separate hardening work.

An attempt proven by its journal to have stopped before signing can be closed by
the stale sweep and retried. A delayed worker cannot submit that closed attempt.
Legacy null journals cannot prove this; hashless legacy rows remain unresolved,
including historical failed rows, and block refunds. After the legacy grace period,
use **Record legacy transaction hash** in admin with the identified mint from
operator transaction history. There is no Release claim action. A legacy row with
a hash can reconcile receipts but cannot replay without stored signed bytes.

## Subscriptions

`reconcile_subscriptions` moves a paid subscription to allotted only when its linked
issuance request has executed. This repairs a worker stop between on-chain issuance
and the subscription update. `expire_unpaid_subscriptions` touches only overdue,
awaiting-payment rows with no recorded payment. Part-paid subscriptions need operator
review. See [subscription guards](../architecture/subscriptions.md) before refunding
or retrying an allotment.

## Whitelist changes

Keep the original submission UUID when an API response is lost or the outcome is
unresolved. Repeating the same add/remove request or signed admin confirmation
recovers that command. The five-minute `recover_whitelist_changes` operator task
also processes at most 100 unresolved commands, oldest update first. It may
broadcast only the original signed bytes through the admitted signer; receipt
reconciliation remains available after admission closes.

An opposite change is refused until the earlier operation resolves. Current
membership, a missing receipt or elapsed time does not release that operation.
A completed failure requires a deliberate new submission to try again. A stale
confirmation cannot authorize that retry. Inspect legacy unknown transactions
through the attribution/cutover process; the adapter never adopts or resends them
automatically. The [whitelist contract](../architecture/outgoing-signing.md#whitelist-changes)
describes API outcomes, durable boundaries and historical limits.

## Wallet transfers and stale rows

Use the recorded journal and the matching [EVM](../reference/evm-transfers.md) or
[Bitcoin](../reference/bitcoin-transfers.md) protocol. Receipt confirmation and
balance reconciliation are separate; a five-minute sweep requeues durable balance
repair even after a transaction's status changes. See [wallet reconciliation](../reference/wallet-reconciliation.md).

Legacy `cleanup_failed_transactions` and `cleanup_stale_pending_transactions`
handlers only report overdue unresolved counts. They do not fail transactions,
release reservations or refund balances, and are no longer periodic. Restart old
workers to load that behavior. Reviewing historically failed rows and hashless
operator submissions remains separate work; do not infer compensation from timeouts.
[Transaction evidence](../reference/transaction-evidence.md) explains receipt,
canonicality and finality limits. Evidence collection does not settle balances.

Trading remains off. [Order](../reference/order-submissions.md),
[swap](../reference/swap-settlement.md) and [outgoing-signing](../architecture/outgoing-signing.md)
references describe their own recovery and activation constraints.

## Stale registers

`fold_every_share_class` reads through the provider's finalized block. An unreadable
class retains its last successful timestamp/block; the batch fails afterward so
retry runs. A never-read class or a fold older than 24 hours is marked stale.
Register GETs do not write or clear that marker. Inspect provider availability and
retry the task; [register design](../architecture/register.md) defines the limits
of reconstructing pre-platform history.

## Private file migrations

Read [private-storage migration procedures](../reference/private-storage-migrations.md)
and the relevant [upgrade notes](upgrades.md) before serving a carried database.
A cleared file reference records completed evidence purge; account deletion does
not shorten the retention horizon. Storage deletion failures retain references
for retry. See [retention and scanning](uploads.md).

## Missing notifications or provider results

A running worker is required even for the in-app inbox. Check [notification delivery](integrations.md#notifications-and-push)
and the provider-specific configuration before retrying a review or extraction.
`GET /health/` is answered before database access; 200 does not prove that workers,
Redis, PostgreSQL or the chain are healthy.
