# Recovery and reconciliation

[Operations](README.md) · [Job schedule](jobs.md) · [Outgoing signing](../architecture/outgoing-signing.md)

Start with the affected record and its durable evidence. Restart a stopped worker
with current code and let the five-minute sweeps run; a timeout or missing
provider response does not prove a transaction was never submitted. Platform
staff recover an exact admitted operation and never decide a new deployment,
wallet approval, issue, capital change, pause, transfer, correction or payment:
a company appointee prepares, approves and applies those through the
[company workflows](../plans/company-managed-registers/README.md), and a
technical retry preserves the original actor, company source and signed history
rather than supplying a new mandate. [Outgoing signing](../architecture/outgoing-signing.md)
holds the invariants every sweep below follows; this page names only the
sweep, the admin action and what never to do. Backups that hold signed payloads
hold transactions that can be broadcast.

Base's Flashblocks-enabled RPC can return a provisional receipt with an all-zero
block hash before the block is sealed
([Flashblocks RPC specification](https://specs.optimism.io/protocol/flashblocks.html#flashblock-json-rpc-apis)).
Such a receipt completes nothing; recovery retains the signed bytes, claim and
nonce until the receipt and canonical block agree across rereads, and a
canonical receipt is still separate from the finalized head. An older terminal
record left with an all-zero block hash is not repaired by normal recovery,
which preserves terminal outcomes: an audited metadata correction must
independently establish the original signed intent, canonical receipt and
expected events, then update the inclusion metadata atomically. Never reset the
status, release the nonce, redeploy a contract or replace that signed attempt
merely to replace the placeholder.

## Deployment and issuance

- **Empty deployment** (`check_pending_token_deployments`, every five minutes).
  Application of a [company deployment proposal](../plans/company-managed-registers/company-deployments.md)
  admits the original job; it does not establish a deployed contract. After an
  unsigned technical failure, use **Retry Deployment** on the share class in
  admin: the confirmation binds the original class, deployment and failed claim,
  and the worker keeps the deployment and operation identities while admitting a
  new claim. A retry renews no company authority; fresh signing still needs the
  original current company source. A queue job marked succeeded can have
  returned an unresolved result, so read the deployment journal and the class's
  actual outcome before calling it complete; confirmation awaiting projection
  and an attributed projected outcome are different states. There is no
  reapproval or source-renewal route, and a legacy deployment without a company
  source cannot obtain a fresh signature. **Retry approval** on the same page
  reopens a failed [automatic swap approval](../architecture/outgoing-signing.md#automatic-swap-approval).
- **Share issuance** (`check_executing_issuance_requests`, bounded batches every
  five minutes; a command with an observed success or revert is eligible on
  every sweep, without the ten-minute stale cutoff used for unmined work, and
  each checked command moves to the back of the queue). A company
  [chain grant](../plans/company-managed-registers/company-register-issues.md)
  or [paid issue](../plans/company-managed-registers/company-paid-issues.md),
  delivered by [#951](https://github.com/Ledova/ledova/pull/951), admits the
  private `ShareIssuanceExecution`; completion waits for the configured finality
  policy and updates the issuance, request and subscription together, and
  register recording may still leave the effect
  [waiting](register-foundation.md#the-issuers-waiting-list). A known unsigned
  failure or policy-final original revert allows **Retry Execute** on the
  request, bound to that exact failed claim, or a refund that cancels the
  allotment; after the worker's executing claim, uncertainty keeps the refund
  hold. Permanent authority loss before any signature renews nothing, admits
  no second request and refunds nothing automatically; further financial
  resolution is #868 work
  ([share issuances](../architecture/outgoing-signing.md#share-issuances)).
- **Import-origin registers** admit no issuance execution, failed-retry or
  unsigned signing; their retained requests and journals remain, and deploying
  an imported zero book supplies no issuance workflow for it.
- The owner confirmed that pre-admission null-dispatch issuances, including
  signed legacy mint journals, are absent from ledova.io. Their legacy hash
  naming and recovery paths are retired. Admitted executions without a company
  source retain the recovery and refund controls above; existing records and
  [outgoing history](../reference/outgoing-history.md) evidence are preserved.
- **Settlement-asset and yield-token mints** (`recover_mint_requests`). Use
  **Recover** on a request whose outcome is unresolved and **Retry** after a
  recorded failure or revert, tied to the claim the form shows
  ([mint requests](../architecture/outgoing-signing.md#mint-requests)).

## Capital increases

`recover_capital_increases` processes admitted work in bounded batches every
five minutes. A [company capital increase](../plans/company-managed-registers/company-capital-increases.md)
commits its request and job before chain access; if a reply is lost, replay the
original company command with its body and key and read its receipt. A known
unsigned failure or original revert exposes **Retry Execute** on the request,
bound to that exact failed attempt; an old form cannot authorise another. A hold
for attribution retains its private observations: do not clear public status
or notes to bypass it, and do not read a matching current cap, a failure label,
a deleted request or a missing hash as proof that the approved transaction
executed or was never sent. Explicit revocation or expiry of a consumed
appointment can fail genuinely never-signed work and release the class slot;
signed work recovers its original bytes. Historical work follows the
[cutover process](../reference/outgoing-history.md); the invariants are in
[capital increases](../architecture/outgoing-signing.md#capital-increases).

## Subscriptions

`reconcile_subscriptions` moves a paid subscription to allotted only when its
linked issuance request has executed, repairing historical gaps; new admitted
issuance projects both atomically. `expire_unpaid_subscriptions` touches only
overdue, awaiting-payment rows with no recorded payment. A part-paid
subscription needs staff review. Read
[subscription guards](../architecture/subscriptions.md) before refunding or
retrying an allotment.

## Whitelist changes

`recover_whitelist_changes` processes at most 100 unresolved commands every
five minutes, oldest update first, broadcasting only original signed bytes;
`refresh_whitelist_approvals` sweeps surviving approvals and submits only
REMOVE under a retained cause; `refresh_whitelist_targets` retries a deleted
wallet's removal every five minutes without an attempt ceiling, and must be
kept because the approval sweep cannot rediscover deleted targets. Current
membership, a missing receipt or elapsed time releases nothing, and an opposite
change waits for the original to resolve.

Recover a lost reply by replaying the original nomination, preparation or
decision body and key under current read access; never replace a UUID, infer
chain approval from applied status, alter a job to impersonate another actor or
mark an uncertain outcome complete. Staff add/remove APIs and admin quick
actions admit no fresh decision. A company appointee can prepare REMOVE from a
genuine retained CONFIRMED or UNCHANGED ADD journal, including a historical
NULL-source ADD, even after wallet deletion; an approval-only row with no
journal is not invented into an ADD source. Restoring a read or an appointment
does not itself create a new approval, source renewal or replacement
instruction. Verify actual absence before retiring a blocked removal job. Pause uses its own company instruction. The
rules are in [whitelist changes](../architecture/outgoing-signing.md#whitelist-changes),
[refreshing an approval](../architecture/outgoing-signing.md#refreshing-an-approval)
and the [company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md).

### Holder standing review

The operator console's **Whitelist entries needing holder standing review**
counts investor accounts with an inactive login or rejected, suspended or
terminated investment standing that still hold a live or uncertain company
approval, each once, from the last observation and without reading the chain;
the approval inline retains the last observed company status and expiry.
A removed or expired approval stays listed while a live company decision
remains and standing is not refused, so staff inspect the specific company and
current eligibility before acting; the worklist authorises nothing.
Self-deletion disables login and retains evidence without terminating the
account or revoking an approval: review the account and decisions, record the
staff decision, then use the attributed refresh or the company's removal.
Treasury and company-only accounts are outside this queue.

## Wallet transfers and stale rows

Use the recorded journal and the matching [EVM](../reference/wallet-transfers.md#evm)
or [Bitcoin](../reference/wallet-transfers.md#bitcoin) protocol. Receipt confirmation
and balance reconciliation are separate; a five-minute sweep requeues durable
balance repair even after a transaction's status changes
([wallet reconciliation](../reference/wallet-reconciliation.md)). The two
retired cleanup tasks are in the [upgrade note](upgrades.md#retired-transaction-cleanup-tasks).
Do not infer compensation from timeouts; [transaction evidence](../reference/transaction-evidence.md)
explains receipt, canonicality and finality limits. Trading is enabled by
default; [orders](../reference/order-submissions.md) and
[swap settlement](../reference/swap-settlement.md) describe their own recovery.

## Stale registers

`fold_every_share_class` reads through the provider's finalized block. An
unreadable class keeps its last successful timestamp and block, the batch fails
afterwards so retry runs, and a never-read class or a fold older than 24 hours
is marked stale; register reads never clear the marker. Check provider
availability and retry the task. [Register architecture](../architecture/register.md#former-members)
defines the limits of reconstructing pre-platform history.

## Private file migrations

Read [private-storage migration procedures](../reference/private-storage-migrations.md)
and the [upgrade notes](upgrades.md) before serving a carried database. A
cleared file reference records a completed evidence purge; account deletion does
not shorten the retention horizon; storage deletion failures retain references
for retry ([retention and scanning](uploads.md)).

## Missing notifications or provider results

A running worker is required even for the in-app inbox. Check
[notification delivery](integrations.md#notifications-and-push) and the
provider's configuration before retrying a review or extraction. `GET /health/`
is answered before database access; 200 does not prove that workers, Redis,
PostgreSQL or the chain are healthy.

## Pause and unpause

`check_pending_pause_changes` runs the admitted job and, every five minutes,
recovers up to 100 incomplete commands untouched for ten minutes, oldest update
first, retaining original signed bytes and nonce or finishing an already
recorded outcome without provider access. Keep the original
[company preparation or decision](../plans/company-managed-registers/company-pause-changes.md)
body and key when a reply is lost; both clients recover the receipt by
repeating the original command, and a changed draft cannot rebuild its
authority. Approval alone admits no execution, a pending result does not mean
transfers have stopped or resumed, and a completed original outcome can differ
from the token's current state after a later request. The retained legacy
owner reminders keep **Check outcome** and **Retry same request** for an
existing exact row only; a never-admitted UUID receives an explicit
fresh-admission refusal, and fresh owner or staff submission is retired. Recover the original observation or
canonical receipt rather than creating a new command for an ambiguous outcome;
if a retained NULL-source projection cannot reach its original scoped class,
restore the correct identity, because no operator fallback bypasses that
barrier. A completed failure permits a deliberate new company preparation. The
contract is [pause and unpause](../architecture/outgoing-signing.md#pause-and-unpause).
