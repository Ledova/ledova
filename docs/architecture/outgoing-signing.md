# Outgoing signing foundation

[Architecture](README.md) · [Documentation](../README.md)

Settlement-asset and yield-token `MintRequest` execution, whitelist add/remove
commands, share-token deployment and its automatic swap approval, capital increases, share issuances, swap execution, pause/unpause and NAV updates use the
operator signing foundation. Signer
admission remains closed. The [deployment flow](contracts-and-issuance.md) binds
its original receipt to immutable deployment terms; an identifier lookup alone
leaves the deployment pending for attribution.

The foundation now requires explicit signer admission. Existing and new
`SigningAccount` rows start `closed`, and a missing row is also closed. A nonce
counter, successful legacy status or inventory capture never grants admission.
There is no activation command or admin edit surface; admitted synthetic test
fixtures establish a test precondition only. Participant-signed approvals are the
one settlement writer outside this foundation, because the backend never holds
the participant's key: their delivery is journaled and replayed as exact bytes
by `tokens.SwapApprovalSubmission`, described in the
[swap settlement reference](../reference/swap-settlement.md#participant-approvals).

`close_signer_admission(chain_id=..., sender=...)` is an operator-only service
that closes an account and advances its admission generation. It preserves
claims, outcomes, counters and every signed payload. Missing accounts are created
closed. Closure blocks preparation RPC, new signing and exact-byte broadcast;
receipt reconciliation remains available. Preparation records the generation,
and signing checks it again under the operation and signer locks. A delayed
preparer cannot survive a close/reopen cycle. The maximum signed 64-bit generation
is reserved for closure, so an admitted account can always close; further
advancement at that maximum is refused without wrap or reset.

Broadcast admission takes a short operation-then-signer lock and commits before
RPC. A call that crossed this boundary before closure may still send and record
its result afterward. Closure is a drain barrier, not instant cancellation or
credential revocation. Already signed reservations and exact-byte recovery must
survive that interval.

Before a later adapter is activated, every old same-key process and signing tool
must drain and lose credential access. Recapture history after that drain, bind
trusted authorization and intent, and import reservations or quarantine unresolved
signers. Every remaining same-key writer must use the foundation or be disabled
without legacy fallback. Old binaries do not consult this admission guard.
Provider absence, terminal history or today's key and chain cannot establish
historical authorization or release a nonce. App-role handoff and each adapter's
durable transaction boundary still require proof. After signed activity, rollback
cannot restore legacy sending with that key. Admission and the staged inventory
do not establish a global nonce guarantee or resolve old business operations.

Callers provide a stable operation key and immutable intent: chain, sender,
target, value and calldata. Reusing a key with different terms is refused.
`prepare_operation` reads the endpoint, pending nonce, gas price and gas estimate
outside database transactions. `sign_operation` then locks the operation followed
by the chain-and-sender account, allocates a nonce from the greater of the observed
pending nonce and the durable counter, and signs locally without RPC. The signed
bytes, fixed hash, nonce reservation and operation pointer commit together before
`broadcast_operation` can submit anything. All service entry points refuse an
enclosing database transaction or disabled autocommit.

Signing an already prepared claim returns the winning attempt once another
worker has signed, provided the signer remains admitted at the same generation.
Restarting an unsigned failed attempt changes its claim identifier and fences out
delayed workers. Once signed, uncertainty never authorizes another nonce: retries
validate and broadcast the saved bytes, and missing receipts, provider errors,
already-known responses and nonce errors leave the operation unresolved. Receipt
updates require the same claim and hash. A recorded revert permits a new claim
and nonce while retaining the immutable earlier attempt. Individual adapters may
refuse restart: swap execution retains a single original claim even after revert.
Here `confirmed` means
a successful receipt was observed; confirmation depth, replacement detection and
reorg repair remain part of the separate finality work.

This initial API signs EIP-155 legacy gas-price transactions, including contract
creation. Chain IDs and gas limits fit a positive signed 64-bit database integer;
allocated nonces stop one below its maximum so the next counter still fits.
Transaction value and gas price accept unsigned 256-bit values. PostgreSQL
enforces immutable attempts, monotonic signer counters and guarded operation
transitions. All three tables deny application-role access, even with a user
principal; operator access is required. They have no admin or serializer surface;
the [company pack](company-pack.md#chain-evidence) carries each operation's
intent, status and receipt and each attempt's hash, nonce, signer and chain id,
and never the signed payload. Signed payloads are broadcast capabilities and
belong in protected backups; errors retain a category rather than provider or
database exception text.

For existing databases, read [outgoing history and cutover constraints](../reference/outgoing-history.md).

## Automatic swap approval

After the issuer's token projection and asset bridge succeed, a bounded operator
transaction commits `projected_at`, a frozen approval disposition and the exact
`recover_swap_approval` job together on the existing private `TokenDeployment`.
Approval runs asynchronously and never reverses a successful deployment. It has
separate intent, outcome, outgoing operation and transaction fields; factory
deployment evidence is never reused or reset. The five-minute approval sweep
selects admitted pending/executing approvals independently of deployment recovery.

Admission captures the original deployment's chain and signer, the attributed
share-token address, the configured swap target and the exact approval calldata.
A missing, malformed or zero swap address records `not_configured` with no
approval authority. Historical projected deployments retain blank approval fields.
Later settings cannot admit, enable or retarget either category automatically.
Before fresh signing, configuration must still match the original intent.

An initial verified `approvedShareTokens` reading at a recorded block can produce
`observed_approved` without a local transaction. Its immutable block/time evidence
records observation, never transaction attribution. A false reading commits an
executing decision before opening the common operation. From that point, current
approval state cannot replace the original transaction's result, including when
another observer finishes late. Signed uncertainty retains its bytes, hash and nonce.

The original successful receipt and a unique matching `ShareTokenApproved(token,
true)` event from the admitted contract confirm the approval. A retained revert
can be projected locally while the provider is unavailable. Explicit admin retry
requires current active staff with token change permission and a signed form
identifying the actor, deployment and exact completed failed claim. The previous
transaction's receipt survives retry; replay acknowledges accepted work without
opening another claim. The generic transaction monitor excludes this adapter.

Migrations `tokens/0049` and `0050` preserve historical rows, guard admission and
immutable associations, and refuse reversal after an approval disposition exists.
The app role cannot read or write approval metadata. The old direct Python
approval sender is removed. The standalone Hardhat deployment script remains in
the all-writer inventory; this conversion does not establish the all-writer
signer cutover, which remains #6 acceptance, or finality, which remains #7's.
The swap relayer itself is converted (#619) and the participant-signed approval
is journaled (#6), both described in the
[swap settlement reference](../reference/swap-settlement.md).

## Mint requests

The asset mint page, yield-token mint page and request execution page all use
`tokens.services.mint_service`. Minting an active stablecoin on Base can precede
enabling that asset for settlement. Unsupported receiving chains have no mint
action, and direct mint-page requests are refused before creating a request.
A mint form retains a submission UUID across a
repeated POST. Reusing it with different terms or another actor is refused; a
fresh form represents a deliberate new mint. The service checks current active
staff and the entry point's model permission before admitting work. It refuses
application authority and enclosing transactions. Admission commits the token,
deployment, chain, signer, recipient, raw amount, calldata and executing actor
before opening an outgoing operation. Later recovery is operator-owned accepted
work, even if the original actor subsequently loses permission.

Every new request has a dispatch UUID. Its outgoing key includes both request
and dispatch UUIDs. PostgreSQL freezes admitted terms and operation association,
requires a confirmed matching operation and original transaction projection for
completion, and refuses deletion of admitted requests. Execution checks current
deployment eligibility, signer configuration and on-chain minter permission
before signing. Signed recovery uses the recorded intent after configuration
changes; it never silently switches the recorded signer or deployment.

A missing receipt or lost send acknowledgement leaves the request **Outcome
unresolved**. Use **Recover** on the same request. The five-minute
`recover_mint_requests` task selects at most 100 admitted unresolved requests,
oldest update first, using operator authority. It does not admit pending requests
or automatically restart terminal attempts. A recorded pre-signing failure or
revert permits an explicit **Retry** tied to the claim shown on that form;
replaying an old form cannot authorize a later attempt. Every signed attempt
survives, and recovery updates the transaction projection from its operation.
An explicit retry retains the previous revert and its receipt fields before
opening another attempt. If a worker stops before that projection, the sweep
repairs it without provider access or another signed attempt.
The generic transaction monitor excludes those projections. Here **Executed**
means a successful receipt was observed, with finality still governed by #7's
remaining work.

Migration `tokens/0042` leaves every old request's dispatch UUID null, preserving
all statuses and transaction references. An old binary inserting after migration
also leaves it null. These requests are historical work requiring operator
attribution, with no automatic retry, generation backfill or legacy sender
fallback. The migration refuses reversal once any request has been admitted.
Deploying this adapter does not authorize signer activation: the drain,
attribution and all-writer cutover requirements above still apply.

## Whitelist changes

The staff-only operator API, whitelist-admin actions and subscription-admin
whitelisting use `whitelist.services.changes`. Each change names the company
whose registry it writes: admission reads `registryOf(acn)` from the configured
factory and refuses a company with no share class on chain. The one write is
`setExpiry(address, uint64)`: an addition carries the expiry staff chose, or
`type(uint64).max` when they left it blank, and a removal writes zero. Each
accepted `WhitelistChange` freezes its submission UUID, actor, entry-point
authority, action, requested wallet identity, company, expiry, chain, registry,
address and transaction intent. The private command
table reuses the outgoing foundation's signed bytes and nonce reservations.
Application connections cannot read or write it. Admission requires active staff
and the originating admin model permission; recovery of accepted work is operator
owned even after the initiating actor loses permission.

Operator scripts calling `POST /api/v1/whitelist/add/` or `remove/` must supply
`submission_id`, `wallet_address` and `company`, the company's UUID; `add/` also
takes an optional `expires_at`, and a blank or null one never expires. Each
`batch-add/` member carries its own UUID. The API's camel-case transport also
accepts `submissionId`, `walletAddress` and `expiresAt`. Retain the UUID across
transport retries. The response identifies the original command, its company,
expiry, status and original transaction hash when signed; the nullable nested
`approval` describes the wallet's current approval in that company and may
reflect a later command. It is absent when the recorded entry was deleted, no
longer belongs to the command's address, or the approval has since moved to
another registry.
`pending` and `executing` are unresolved, `confirmed` records a successful receipt,
`unchanged` records that no transaction was needed, and `failed` records a known
pre-signing failure or revert. Single unresolved submissions return 202 when
processing returns normally, while provider/infrastructure failures return a safe
503 and require recovery with the same UUID. Batch responses distinguish
successful, failed and pending members, including unresolved infrastructure errors.

Reusing a UUID with changed terms or authority is refused. A completed UUID always
returns its original outcome; it never repeats an add after a later removal.
A deliberate new command, including a retry after a known failure, needs a new
UUID. Signed admin confirmation forms retain per-entry UUIDs across repeated POSTs
and bind the actor, action and selected entries. A fresh form represents new work.
An unresolved command blocks every competing UUID for the same chain, registry
and address, including an opposite change and a removal with no local entry.
There is no contradictory-intent queue.

Admission commits before checking membership. That initial check reads the
registry's `expiresAt` and either records no change required, when it already
equals the requested expiry, or commits the decision to send; later membership observations
cannot complete a signed command. Network calls run outside transactions and
target locks. Before sending, the change re-reads `registryOf(acn)` and refuses
if the company's registry has moved. Projection checks the chain, the approval's
registry and the entry address, and locks the wallet against a concurrent
identity edit. An old registry's receipt or observation cannot rewrite the
current registry's approval.
Terminal outcome, local membership projection and target release
commit together, and replaying a terminal command cannot overwrite newer membership.
The generic transaction monitor excludes these projections. Sync remains an
observation of membership; the recovery job uses the original outgoing receipt
and signed bytes. The admin page suppresses fresh quick actions while work is
unresolved. See [whitelist recovery](../operations/recovery.md#whitelist-changes).

Migrations `whitelist/0005` and `0006` create the command table, revoke app-role
access and guard immutable terms, original associations and terminal outcomes.
`whitelist/0007` moves approval state from the entry to the per-company
`WhitelistApproval` table, adds the company and expiry to the command, and
replaces the guard so the stored calldata must be exactly
`setExpiry(address, expiry)` for the command's address and expiry. It refuses to
run while any command written for the retired global registry exists: see the
[fresh-start redeploy](../operations/chains.md#fresh-start-redeploy). The guard
refuses reversal after command admission. The optional entry and company
references are immutable UUID snapshots, so customer wallet deletion can still
cascade its mutable entry and its approvals without reading the private command
table. Approvals are staff-only in code, like the entry they belong to, because
that cascade runs on the customer's connection. Accepted work and signed history
survive deletion; recovery cannot recreate that entry or redirect its result to
a replacement. Neither this adapter nor approval sync establishes receipt
finality or complete same-key writer cutover.

Every read the platform makes before acting asks the share class's own
registry, through the token's `whitelist()`: issuance execution, transfer
preparation for both parties and order creation. A stablecoin transfer has no
company registry to ask, so it checks instead that each party holds a live
stored approval for at least one company. `GET /api/v1/trading/whitelist/<token>/<address>/status/`
answers the same question for the share class at contract address `<token>`,
for any signed-in user and any address. Creating an order and signing a swap
also require a live investor classification for the share class's company, from
the same predicate the offering paths use; order creation records the refusal as
`investor_not_eligible` and signing answers 403.


## Refreshing an approval

`whitelist.services.refresh` works out what a company's registry should allow
for one approval row, and submits a change through `whitelist.services.changes`
only when that differs from what the registry already holds:

- the account is not in good standing, or has no live classification covering
  that company: zero, which removes the wallet;
- otherwise the latest `expires_at` among its live classifications for that
  company, and never expires when one of them carries no expiry;
- an entry with no investor account - a treasury, issuer, founder or imported
  member wallet - keeps the expiry staff entered, and the refresh never
  overwrites it.

The comparison is by effect rather than by value, because an expiry already in
the past and a removal are the same thing to the registry. So an ordinary
classification expiry needs no write at all: the chain holds the classification's
own expiry and lapses by itself. Running the refresh twice over one row submits
nothing the second time, and a row whose own change is still unresolved is left
to recovery.

Four actions trigger it, each attributed to the actor behind it under the
`refresh` authority: revoking or verifying a classification, which attributes to
the reviewing staff member; changing an account's status in the admin; and
deleting or relinking a wallet, which attributes to its holder through the API
or to the staff member in the admin. A holder is not staff, so that entry point
accepts only a removal from them, and an addition still requires staff. Deleting
a wallet cascades its entry and its approvals, so the removals are enqueued
before the row disappears and the job runs a minute later, once the deletion has
either committed or rolled back.

`refresh_whitelist_approvals` sweeps every approval every five minutes as the
safety net. It submits under the staff member whose review decided the outcome,
and where no actor explains the change - an account status edited outside the
admin, for instance - it lists the row at error level for staff instead of
writing. So the platform refuses at once and the chain follows within fifteen
minutes in normal operation: one sweep interval plus one
`recover_whitelist_changes` interval. There is no lease, so an approval does not
lapse by itself between classification expiries.

What a reader may conclude from an approval's status:

| Status | What it says |
| --- | --- |
| `pending` | A change for this wallet and company is admitted and unresolved. What the registry holds is unknown, and every platform read treats the wallet as not approved |
| `active` | The last observation found the registry listing the wallet with this expiry. `is_listed` and the `live` queryset still apply the clock to it |
| `removed` | The last observation found the registry holding zero for it. A removed row is not re-observed by `sync_all_entries` |
| `failed` | The last change failed or reverted, and is logged at error level. What the registry holds is unknown and every platform read treats the wallet as not approved. `failed` is terminal for that command, so the refresh submits a new one; the thirty-minute sync re-observes the row and replaces the status with what the registry actually holds |

That is what failing closed means here, and its limits are worth stating. The
platform refuses at once, both on the registry read and on the classification
checks at order creation and signing. The registry itself cannot be forced
closed while the write is failing, so until a removal lands a direct contract
call can still move shares, and pausing the token is the operator's lever.

## Capital increases

`tokens.services.capital_execution` admits staff-admin execution with current
`change_capitalincreaserequest` permission. Its signed confirmation binds the
request, dispatch identity, actor and exact failed claim when retrying. Admission
commits the private `CapitalIncreaseExecution`, public `executing` state and job
together before RPC. Recovery is operator-owned after admission; it does not
need renewed customer or staff permission. The issuer's ordinary draft, edit,
submit and delete paths never read the private journal.

The immutable intent retains the original token, company, actor, chain, signer,
contract, approved target and prior recorded cap. PostgreSQL guards freeze public
identity and non-draft terms, and prevent token cap/identity edits while the
request is executing. Pause/unpause remains available. The existing per-token
in-flight constraint is the hold; network reads, signing preparation and broadcast
do not hold that token lock. Operation locks precede token, request and command
locks whenever an operation exists.

All signed attempts use the common nonce journal. Recovery retains the exact
original terminal receipt before verifying the cap event. Only a matching
`AuthorizedSharesUpdated(oldAmount, newAmount)` event from that contract permits
atomic completion and cap projection; replay cannot lower a later cap. Missing
receipts or events stay unresolved. Contradictory cap observations retain immutable
private attribution evidence and keep the public hold. A delayed preparer assists
a peer's already signed transaction instead of treating its cap change as unknown.
The generic transaction monitor excludes these projections.

Unsigned failure and confirmed revert permit a deliberate retry of the exact
failed claim. Retry admission reacquires the public slot and records that claim
before enqueueing. Replaying a stale form cannot reopen a newer failed attempt,
and the previous reverted transaction survives. A new, provably unsigned request
whose target no longer raises the recorded cap can retire as `superseded` without
an operation. A known failed request overtaken by a later cap can also retire;
an unresolved signed request cannot.

Migrations `tokens/0045` and `0046` preserve historical requests and transactions
with null dispatch identities, restrict private access and refuse reversal after
admission. New and retry admission check legacy request states and unexplained
same-contract capital transactions, including orphaned and hashless records.
Only exact hashes from the admitted operations' signed attempts are exempt.
This conservative fence cannot establish absent historical authority or drain an
external same-key writer; complete cutover and receipt finality remain separate
programme acceptance. See [operator recovery](../operations/recovery.md#capital-increases).


## Share issuances

`tokens.services.issuance_execution` admits approved share requests with current
active staff authority and the originating admin model permission. A standalone
execution confirmation binds the request, dispatch UUID, actor and failed claim.
Subscription allotment commits its approved request, subscription association,
private `ShareIssuanceExecution` and exact job together. App connections cannot
read or write private commands; public issuer reads retain their existing shape.
Accepted recovery remains operator-owned after the initiating actor loses access.

Initial admission leaves the public request approved and the private command
queued. A refund that wins before the worker claim rejects the request and retains
a cancelled command in the same transaction. Delayed jobs return that cancellation
without opening an operation or creating a public issuance. The worker commits
executing state and its stamped public issuance before opening the outgoing
operation. From that claim onward, uncertainty blocks refunds. A definite unsigned
failure or policy-final original revert permits refund cancellation or an explicit retry of
that exact failed claim. Reverts retain the original transaction and signed bytes.

PostgreSQL guards freeze approved terms, dispatch identity, subscription linkage,
payment and share quantities. Recorded refunds cannot be reduced or undone.
Token identity stays fixed while new work can execute. Lock order is outgoing
operation, token, subscription, request and private command; chain reads and sends
run outside those transactions. Common-journal signing commits original bytes,
nonce, hash, public transaction and issuance association before broadcast.

Recovery retains the first receipt before checking finality. A transaction marked
confirmed or reverted is evidence of that first inclusion; the issuance remains
executing until the existing `WALLET_CHAIN_FINALITY_POLICIES` rule for its original
network is satisfied. This uses the same canonical-block evidence reader as swap
settlement. Missing or invalid policy, unavailable evidence, a changing head or an
orphaned receipt leaves the command and its refund hold pending.

Before completion, recovery re-reads the original transaction and verifies the
finalized inclusion, sender, contract and, for success, one matching zero-address
`Transfer` for the approved recipient and amount. A same-outcome reinclusion may
complete at its newly verified block: the public transaction and issuance record
that final inclusion while the immutable outgoing journal retains the first one.
A changed success/revert outcome remains held for operator attribution. The
locked projection rechecks the original claim, attempt and current finality
policy. Private completion, public issuance, request and subscription allotment
commit atomically. Terminal replay preserves that outcome; a holding refresh uses
the admitted contract address. Unknown sends reuse the original bytes and nonce.
Missing receipts or events never permit a fresh attempt. The five-minute sweep
recovers bounded batches of accepted work. Register event recording remains
[integration work](register.md) after this finality prerequisite.

Migrations `tokens/0047` and `0048` leave every historical dispatch null and retain
its fields and mint journal without adoption. New private metadata has no
customer-facing foreign-key dependency. Guard reversal refuses existing commands,
including cancelled admissions. Historical recovery can replay validated saved
bytes or observe a named hash, but cannot sign fresh work. Ambiguous journals,
missing records after execution and hashless legacy mints remain held. Original
ID-less revert entries remain valid historical evidence. Naming checks exact
transaction terms and prevents reuse of another issuance's retained historical
hash. See [issuance recovery](../operations/recovery.md#deployment-and-issuance).

## Pause and unpause

Each intentional pause/unpause submission has its own UUID and private `PauseChange`.
The issuer API accepts `submissionId`; staff confirmations bind that UUID to the
actor, token and desired state. Bounded operator admission locks the company and
token, checks the fresh actor, freezes the chain, contract and calldata, and
commits the exact recovery job with the command. Public token state stays unchanged
until an outcome can be projected. Current issuer ownership is required on API
submission and retrieval; staff privileges never widen the issuer API.

An authorized new submission blocked by an incomplete command is retained as a
completed unsigned `failed` refusal, with no job or outgoing operation. Its UUID
can never turn into a delayed action after the blocker clears. This lets clients
retrieve and dismiss a definite refusal without treating an ambiguous missing
response or 404 as cancellation. Invalid identity or authority is not admitted.

A verified initial boolean at a recorded block may produce `observed`, with no
outgoing operation. The decision is serialized against an executing peer. Known
unsigned authority, lifecycle or configuration refusals can finish as `failed`
only while no outgoing operation exists; temporary provider failures retain the
pending command. Once executing, recovery uses the original outgoing key, signed
bytes, nonce and receipt. A unique original `Paused` or `Unpaused` event from the
admitted contract and sender is required for confirmation. Current chain state
cannot stand in for a signed transaction's outcome. A new attempt after a terminal
failure needs a new submission UUID; the foundation cannot reopen a pause command.

The incomplete command reserves its chain and contract, including a confirmed or
observed outcome awaiting public projection. Projection holds the target advisory
lock and private command lock, then updates the token on the admitted issuer's
scoped connection. It commits that update before completing the private command.
If either commit response is lost, the retained barrier permits an idempotent
repeat and prevents a newer opposite command overtaking the old projection. A
completed replay returns before updating the token. If ownership or original
identity no longer permits projection, recovery keeps the outcome and barrier;
there is no operator fallback for an issuer's public write.

Signing locks operation, signer, command, company, token and the freshly read
actor. Projection holds no outgoing/account lock or operator company/token lock
while its scoped connection updates the token. Actor flags are protected through
signing; permission grants are checked fresh after target waits. This does not
establish a global fence against all later concurrent group/permission changes.
Network operations run outside database transactions.

Migrations `tokens/0051` and `0052` preserve historical token states without
admitting pause history, restrict private-role access and refuse reversal with
commands present. API responses expose the original submission outcome separately
from current token status. The dashboard verifies identifier retention before every POST, guards
issuer-session changes, recovers after reload and dismisses only resolved outcomes.
The old direct sender and unconditional status helpers are removed. Historical
attribution, all-writer cutover and finality remain separate requirements.
