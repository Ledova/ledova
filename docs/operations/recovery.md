# Recovery and reconciliation

[Operations](README.md) · [Job schedule](jobs.md)

Start with the affected record and its durable evidence. Restart a stopped worker
with current code and use the existing reconciliation path. A timeout or missing
provider response does not prove a transaction was never submitted.

These procedures recover the current implementation. Under the accepted
[company-managed register plan](../architecture/company-managed-registers.md),
platform support may recover an exact authorised operation but does not decide
a new issue, transfer, correction or company payment instruction. Preserve the
original actor, company authority evidence and signed history; a technical
retry is not a new company mandate. Staff-only confirmation paths below need
company-facing replacements before the ordinary journey meets that plan.

Base's Flashblocks-enabled RPC can return a provisional transaction receipt with
an empty block-hash placeholder before the block is sealed. Such a receipt does
not complete an outgoing operation: recovery retains its signed bytes, claim and
nonce until the receipt and canonical block agree across rereads. A successful
canonical receipt is still separate from the network's finalized head. See the
[Flashblocks RPC specification](https://specs.optimism.io/protocol/flashblocks.html#flashblock-json-rpc-apis).

An older terminal outgoing record with an all-zero block hash cannot be repaired
by repeating normal recovery, which preserves terminal outcomes. Retain its
original operation, attempt, transaction and domain journal. An audited metadata
correction must independently establish the original signed intent, canonical
receipt and expected events, then update matching inclusion metadata atomically.
Never reset the status, release the nonce, redeploy a contract or replace that
signed attempt merely to replace the placeholder.

## Deployment and issuance

New empty share-class deployments use the company's
[prepare, approve and apply workflow](../plans/company-managed-registers/company-deployments.md).
Application admits the original deployment job; it does not establish a deployed
contract. Fresh owner/staff deployment controls are retired.

An unsigned deployment holds when its exact consumed approval, applying mandate,
captured wallet, company/class terms or register boundary no longer apply. Source
contention leaves its original operation preparing, without a new signed attempt
or nonce. This increment provides no replacement, reapproval or source-renewal
route. Legacy deployments without a company source cannot obtain a fresh signature.
Already signed originals retain their bytes, attribution and normal receipt
recovery after source loss.

An actual unsigned technical failure retains the existing **Retry Deployment**
admin confirmation. It binds the original class, deployment and failed claim;
the worker retains the deployment and operation identities while admitting a new
claim. A retry does not renew company authority or replace the captured intent;
fresh signing still needs the original current company source and technical
signer admission. A queue job marked succeeded can have returned an unresolved
result, so check the deployment journal and actual class outcome before claiming
completion. Confirmation awaiting projection and an attributed projected outcome
remain separate.

Deployment, capital and issuance sweeps recover accepted work; see the
[issuance flow](../architecture/contracts-and-issuance.md). New share issuances
use the private `ShareIssuanceExecution` command and common signing journal.
`check_executing_issuance_requests` processes bounded batches every five minutes.
An executing command with an observed success or revert is eligible on every sweep,
without the ten-minute stale cutoff used for unmined work. The batch limit can delay
a particular command until a later sweep; each checked command moves to the back
of the ordered queue.
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

An import-origin register cannot admit new issuance execution, retry a failed
issuance into queued work or sign an unsigned issuance. Its retained requests
and journals remain. Already signed/confirmed original issuance still recovers
with its actual receipts and register-effect gaps; deploying an imported zero
book does not supply an attributed issuance workflow for that book.

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
capital work in bounded batches. Company application consumes the exact approval
and commits its durable request and job before chain access. If a response is lost,
replay that original company command and reload its receipt:
its original signed transaction is recovered, never replaced merely because a
receipt is missing. Admin shows its hash and safe error category while unresolved.

A known unsigned failure or original reverted transaction exposes a fresh retry
confirmation bound to that exact failed attempt. Old forms cannot authorize
another attempt. Attribution holds retain their original private observations;
do not clear public status or notes to bypass them. Matching the current cap,
a historical failure label, a deleted request or a missing hash does not establish
that the approved transaction executed or that no send occurred. Historical work
still needs the [cutover process](../reference/outgoing-history.md).

Unsigned company work must retain its current captured source before a fresh
signature or retry. Temporary source or provider unavailability and contention
keep the original claim. Explicit revocation or database-clock expiry of a consumed
appointment can fail genuinely never-signed work and release the class slot;
already signed work recovers its original bytes. Retained legacy unsigned work
does not acquire a new company mandate.

## Subscriptions

`reconcile_subscriptions` moves a paid subscription to allotted only when its linked
issuance request has executed. This repairs historical gaps between issuance
and the subscription update; new admitted issuance projects both atomically. `expire_unpaid_subscriptions` touches only overdue,
awaiting-payment rows with no recorded payment. Part-paid subscriptions need operator
review. See [subscription guards](../architecture/subscriptions.md) before refunding
or retrying an allotment.

## Whitelist changes

Each original change concerns one company's registry and one address. The
[company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md)
retains nomination, preparation and decision bodies/keys across uncertain replies.
Replay the original receipt under current permitted read access; do not replace a
UUID or infer chain approval from applied human status. Staff add/remove APIs and
admin quick actions do not admit fresh company decisions. Historical private
journals retain original-ID technical recovery.

The five-minute `recover_whitelist_changes` task processes at most 100 unresolved
commands, oldest update first. It broadcasts only original signed bytes through
the admitted signer and reconciles their real receipts/finality. Current membership,
a missing receipt or elapsed time does not release an unresolved signed operation.
An opposite change waits for that original to resolve.

Temporary source-row contention retains the same never-signed claim without a
new attempt/nonce. Genuine permanent company-source loss on an actually
never-signed claim conditionally records and projects its failure, releasing the
target for a real retained eligibility-loss removal. A worker that already signed
wins original recovery first. Possession-proof refresh is not a fabricated
withdrawal/deletion cause. Restoring a read or appointment does not itself create
a new approval, source renewal or replacement instruction.

Wallet deletion retains the `refresh_whitelist_targets` job after the mutable
entry and approvals disappear. Its actual prior cause, company, registry and
address remain. The job retries incomplete removals every five minutes without an
attempt ceiling, including provider failures before admission. Keep it: the
approval sweep cannot rediscover deleted targets. A known failed removal allows a
new bounded technical removal under that genuine cause; unresolved signed work
must finish first. No job substitutes another actor or grants approval.

Inspect pending journals/jobs with the named company's instruction history.
Restore original provider availability or valid source/standing where appropriate.
Do not alter a job to impersonate another actor or manually mark an uncertain
outcome complete. An authorised company appointee can prepare REMOVE from a
genuine retained CONFIRMED/UNCHANGED ADD journal, including a historical
NULL-source ADD, even after wallet deletion. An approval-only row with no genuine
journal is not invented into an ADD source; retain its diagnostic history and
resolve unsupported work explicitly. Verify actual absence before retiring a
blocked removal job. Missing workers/providers or unresolved receipts can exceed
normal operating intervals; existing token pause remains under its own current
authority until its #867 conversion.

### Holder standing review

The operator console's **Whitelist entries needing holder standing review** links
to the matching whitelist admin filter. It derives its count from investor
accounts with an inactive holder login or rejected, suspended or terminated
investment standing, and existing company approvals that are live in the last
observation or have an uncertain pending/failed status. Each entry counts once,
even if several companies have approved it. The approval inline retains the
last observed company status and expiry; this worklist does not query the chain.

An inactive holder's removed or expired approval also stays visible while a live,
company-applicable classification remains and investment standing is not refused.
That is a conservative review case: identity checks or other eligibility rules
may still prevent renewal. Staff must inspect the specific company and current
eligibility before deciding. The worklist never authorizes a change.

Self-deletion disables login and retains classification evidence; it does not
terminate the investment account or revoke an approval. Review the linked user
account and classifications, record the appropriate staff decision, then use the
existing attributed refresh or company removal process. Removal alone can be
reversed by the sweep while classification and investment standing still permit
approval. Once standing/classification is resolved and no live or uncertain
approval remains, the entry leaves the worklist. Treasury and company-only
accounts are outside this investor review queue.

## Wallet transfers and stale rows

Use the recorded journal and the matching [EVM](../reference/evm-transfers.md) or
[Bitcoin](../reference/bitcoin-transfers.md) protocol. Receipt confirmation and
balance reconciliation are separate; a five-minute sweep requeues durable balance
repair even after a transaction's status changes. See [wallet reconciliation](../reference/wallet-reconciliation.md).

The two retired cleanup tasks and how to clear jobs queued under them are in the
[upgrade note](upgrades.md#retired-transaction-cleanup-tasks).
Reviewing historically failed rows and hashless operator submissions remains
separate work; do not infer compensation from timeouts.
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
