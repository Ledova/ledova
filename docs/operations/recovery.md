# Recovery and reconciliation

[Operations](README.md) · [Job schedule](jobs.md)

Start with the affected record and its durable evidence. Restart a stopped worker
with current code and use the existing reconciliation path. A timeout or missing
provider response does not prove a transaction was never submitted.

## Deployment and issuance

Deployment, capital and issuance sweeps recover accepted work; see the
[issuance flow](../architecture/contracts-and-issuance.md). New share issuances
use the private `ShareIssuanceExecution` command and common signing journal.
`check_executing_issuance_requests` processes bounded batches every five minutes.
It checks the original receipt and may replay the same saved bytes, hash and
nonce. Provider absence never authorizes another attempt. Backups containing
signed payloads contain transactions that can be broadcast.

Initial queued subscription allotment can be cancelled by a valid refund. That
cancellation is durable even if the old task arrives later. After the worker's
executing claim, unknown delivery keeps the refund hold. A known unsigned failure
or policy-final original revert allows refund cancellation or a fresh admin retry confirmation
for that exact failed claim. Reverted transactions and signed history remain
recorded. A first receipt alone leaves execution and the refund hold pending.
New completion waits for the configured network finality policy and updates the
issuance, request and subscription together. Missing policy/provider evidence or
a changed receipt outcome remains held; see the
[issuance finality boundary](../architecture/outgoing-signing.md#share-issuances).

Historical null-dispatch requests keep their old journal and transaction fields.
Recovery validates saved signed bytes before replay; a named hash without bytes
can only be observed. A recognized unsigned journal can be abandoned by the stale
sweep, retaining evidence for refund handling. Historical recovery never signs a
new attempt. Missing or malformed history does not prove no send occurred.

Hashless legacy rows remain held. After the grace period, use **Record legacy
transaction hash** in admin with a mint identified from operator history. Naming
validates the exact contract, recipient and amount and refuses a hash already
attributed to another issuance, including retained reverted history. There is no
Release claim action. Historical finality and complete same-key writer cutover remain separate
programme requirements; see [outgoing signing](../architecture/outgoing-signing.md).

## Capital increases

The five-minute `recover_capital_increases` operator task processes admitted
capital work in bounded batches. The admin execution page commits its durable
request and job before chain access. If a response is lost, reload that request:
its original signed transaction is recovered, never replaced merely because a
receipt is missing. Admin shows its hash and safe error category while unresolved.

A known unsigned failure or original reverted transaction exposes a fresh retry
confirmation bound to that exact failed attempt. Old forms cannot authorize
another attempt. Attribution holds retain their original private observations;
do not clear public status or notes to bypass them. Matching the current cap,
a historical failure label, a deleted request or a missing hash does not establish
that the approved transaction executed or that no send occurred. Historical work
still needs the [cutover process](../reference/outgoing-history.md).

## Subscriptions

`reconcile_subscriptions` moves a paid subscription to allotted only when its linked
issuance request has executed. This repairs historical gaps between issuance
and the subscription update; new admitted issuance projects both atomically. `expire_unpaid_subscriptions` touches only overdue,
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

Trading is enabled by default. [Order](../reference/order-submissions.md),
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

## Pause and unpause

Keep the original pause submission when a response is lost. The dashboard's
**Check outcome** reads it and **Retry same request** repeats its identifier;
neither action creates new intent. Reloading retains the reminder on the same
browser and issuer account. Staff can repeat the same signed confirmation and
read **Latest pause request** on the token page. A pending response does not mean
transfers have stopped or resumed.

The exact job runs after durable admission. Every five minutes,
`check_pending_pause_changes` also recovers up to 100 incomplete commands untouched
for ten minutes, oldest update first. It retains original signed bytes and nonce,
or finishes an already recorded outcome without provider access. A completed
original outcome can differ from the token's current state after a later request.

An unresolved request blocks new requests for that chain and contract. Known
authorized competing requests receive a permanent unsigned refusal, which can be
dismissed. Replaying that UUID always returns its refusal, even after the earlier
operation resolves; a deliberate later action needs a new submission. Other
unresolved responses must keep their saved identifier. Known
unsigned authority refusals release this barrier; transient provider failures and
signed uncertainty do not. If a confirmed or observed outcome cannot reach its
original issuer-scoped token, restore the correct identity/authority and recover
that submission. Do not change private status or create an operator projection to
bypass the barrier. A completed failure permits a deliberate new submission.
See the [pause recovery contract](../architecture/outgoing-signing.md#pause-and-unpause).
