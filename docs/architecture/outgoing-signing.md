# Outgoing signing foundation

[Architecture](README.md) · [Documentation](../README.md)

How the backend's operator key signs and sends chain transactions. The signer
authority rules and core API come first, then the two admission commands (the
Base Sepolia bootstrap with its legacy inventory, and the local chain), then
each family that uses the foundation: automatic swap approval, mint requests,
whitelist changes and approval refresh, capital increases, share issuances and
pause/unpause. NAV updates are in
[wallets and valuations](wallets-and-valuations.md#nav-updates).

Settlement-asset and yield-token `MintRequest` execution, whitelist add/remove
commands, share-token deployment and its automatic swap approval, capital
increases, share issuances, swap execution, pause/unpause and NAV updates use
the operator signing foundation. Signer admission starts closed. The
[deployment flow](contracts-and-issuance.md) binds its original receipt to
immutable deployment terms; an identifier lookup alone leaves the deployment
pending for attribution.

## Company decisions and signer authority

Company appointees authorise whitelist, issuance, capital and pause commands
through the [delivered workflows](../plans/company-managed-registers/README.md);
the technical signer and PostgreSQL operator role execute bounded accepted
instructions and confer no company appointment. Platform settlement-asset and
yield-token minting, signer admission and infrastructure recovery are not
delegated to company administrators. New unsigned work rechecks current
company, capability, mandate and exact terms before it can create its effect;
revocation never permits discarding or replacing already signed transactions,
which keep their recorded identity and bounded recovery. An uncertain
preparation or decision reply keeps its exact original body and key: current
read access recovers the retained receipt, including after the step's
appointment has expired or the proposal has changed stage, changed retries
conflict, and no replay after process loss is promised. Private journals stay
inaccessible to customer connections, and company self-service does not relax
the bootstrap, same-key writer drain or cutover requirements.

Every family takes its source and class locks before the outgoing operation and
signer locks and makes chain calls outside those locks. Temporary contention or
loss of an unsigned source holds the original unsigned claim with no signature,
attempt or nonce; only explicit revocation or database-clock expiry of the
consumed approval can fail a genuinely never-signed claim, and it does not
recategorise a definite preparation failure or signed work. Once signed, work
recovers its original bytes, nonce and receipt under operator authority after
any later loss of the human source. None of these projections is taken over by
the generic transaction monitor.

The foundation requires explicit signer admission. Existing and new
`SigningAccount` rows start `closed`, and a missing row is also closed. A nonce
counter, successful legacy status or inventory capture never grants admission.
The [fresh Base Sepolia bootstrap](#fresh-base-sepolia-admission) is the only
first-admission command for a public testnet, and
[local chain admission](#local-chain-admission) the only one for the local
development chain. Neither can reopen a signer or authorise legacy cutover, and
there is no admin edit surface. Admitted synthetic test fixtures establish a
test precondition only. Participant-signed approvals are the one settlement
writer outside this foundation, because the backend never holds the
participant's key: their delivery is journaled and replayed as exact bytes by
`tokens.SwapApprovalSubmission`, described in the
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
updates require the same claim and hash. Before a success or revert becomes
terminal, the receipt must name a nonzero block hash that matches the canonical
block read by its number. The service rereads the receipt and that block, and
checks the endpoint's chain directly before and after those reads. Missing,
provisional, changed or noncanonical evidence leaves the original signed attempt
unresolved. All these RPC reads finish before the recording transaction; its
claim and attempt fences are checked again under the lock.

A recorded revert permits a new claim and nonce while retaining the immutable
earlier attempt. Individual adapters may refuse restart: swap execution retains
a single original claim even after revert. Here `confirmed` means a successful
receipt with canonical inclusion was observed; confirmation depth, replacement
detection and reorg repair remain part of the separate finality work.

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

The PostgreSQL guards for every family are installed by
`shared/0002_database_guards`. A row without a dispatch UUID or company source
is historical work needing operator attribution, with no automatic retry or
legacy sender fallback ([legacy inventory](#legacy-inventory)); the owner
confirmed that ledova.io holds none
([decision](../decisions.md#backend-migration-baseline)).

## Fresh Base Sepolia admission

`bootstrap_fresh_signer --manifest PATH` is an operator command for the owner's
explicitly authorized fresh environment. It reads the chain and commits local
admission; it never signs or sends a transaction. The [redeploy sequence](../operations/chains.md#fresh-start-redeploy)
runs it before application processes, workers, companies or outgoing records
exist. The deploying key must be unused before the five core deployment sends,
exclusive to this environment, and the configured backend operator key.

The version-1 JSON manifest has exactly `version`, `chain_id`,
`operator_address`, `environment_id`, `authorization_reference`, `attestations`,
`contracts` and `transactions`. Version is integer `1`, chain is integer `84532`,
and the environment and authorization strings are nonempty, limited to 200 and
500 characters respectively. The three attestations are exactly `fresh_key`,
`isolated_environment` and `producers_stopped`, all literal `true`. Contracts
are exactly `share_token_factory`, `stablecoin` and `atomic_swap`, with distinct
nonzero lowercase or checksummed addresses. Transactions are five distinct
hashes in deployment order. Unknown or duplicate JSON keys are refused.
Addresses and hashes are normalized lowercase for the canonical manifest digest.

The verifier compares configuration and the configured key's public address,
reads the provider chain ID without the client cache, and requires the exact
zero-value transaction sequence from that sender: nonce 0 creates
`ShareTokenFactory(sender)`; nonce 1 creates `AUDY(sender)`; nonce 2 calls
`AUDY.addMinter(sender)`; nonce 3 creates `AtomicSwap(sender)`; nonce 4 calls
`AtomicSwap.setPaymentTokenApproval(AUDY, true)`. Creation bytes come from the
local Hardhat artifacts bound to their build-info; creation addresses must also
match the sender-and-nonce CREATE derivation.

Every receipt must succeed and have complete canonical evidence satisfying the
configured `evm:84532` **finalized** policy. Depth fallback is refused. Receipt
identity is fetched again after evidence collection. Runtime bytecode must match
the same build outside compiler-declared immutable slots; exact constructor bytes
bind those slots' initialization. Contract owners, AUDY minter, swap relayer and
payment-token approval must match. Both latest and pending sender nonces must be
exactly five. Provider uncertainty, missing artifacts or mismatched evidence leaves
admission closed.

The command refuses legacy source rows, unattributed chain transactions, imported
outgoing evidence, current outgoing operations or attempts, other signer state,
and any substantive inventory hold. Empty inventory captures can retain their
permanent coverage limitations; they confer no authority. The stopped-producer
attestation is necessary: opening an unsigned outgoing operation does not acquire
the signer lock, and the command cannot prove that another process or offline key
holder has stopped. Keep those producers stopped throughout verification and
commit.

The final transaction takes a deployment-wide admission lock, then locks the
signer and rechecks database history. Different fresh keys cannot both admit
against one apparently empty database. Only a missing signer or a closed
generation-zero, nonce-zero row can enter generation one with next nonce five.
The unique bootstrap receipt, manifest digest, artifact and build identities,
and chain evidence commit with admission. The receipt is operator-only and
PostgreSQL refuses UPDATE or DELETE. Exact manifest replay is recognized before
fresh-history and nonce checks, and returns unchanged only while that same
signer remains admitted at generation one; it preserves an advanced nonce.
Closure, any earlier admission, or a different manifest cannot be undone through
this command. The existing close and generation fences remain in force.

### Legacy inventory

`inventory_outgoing_history` reads whatever legacy operator signing history a
database holds. It never signs, contacts a provider, reserves or releases a
nonce, or edits a journal or status, and it refuses an application connection
or an enclosing transaction. Run it from `backend/` on the operator connection:

```bash
python manage.py inventory_outgoing_history
OUTGOING_CAPTURE_ID=$(python -c 'import uuid; print(uuid.uuid4())')
python manage.py inventory_outgoing_history --record --capture-id "$OUTGOING_CAPTURE_ID"
```

The first command only reports. `--record` commits a private capture, its
evidence rows and append-only cutover holds together under an advisory lock.
Re-entering the same capture ID with unchanged source returns the original
batch; changed source needs a new ID, and a later capture can add variants and
holds but never rewrites an earlier observation or clears its holds. Reports
carry counts and fixed reason codes (`missing_chain_provenance`,
`missing_signer_authorization`, `missing_raw_payload`) and always say
`cutover_authorized: false`;
raw payloads and source snapshots are operator-only, and PostgreSQL refuses
even operator UPDATE or DELETE on the three inventory tables. The bootstrap
above refuses while any evidence row, any hold beyond the two permanent
coverage limits, or any legacy source row exists, and a
[rebuilt database](../operations/upgrades.md#fresh-database-rebuild) carries no
legacy signer history, so the inventory is the emptiness check, not a cutover
path: offline or old-binary key use is not observable in these tables, and no
capture authorises activation.

## Local chain admission

`admit_local_signer` admits the configured `BLOCKCHAIN_OPERATOR_KEY` address on
the local development chain, chain id 31337, and on no other chain. The local
Compose stack runs it as the last step of its `migrate` service, after
`chain-deploy` has verified the core contracts; see
[the local chain](../operations/chains.md#the-local-stacks-chain). Outside any
database transaction it reads what the database recorded for the signer first
and the provider's chain id and mined nonce after, so a transaction mined and
recorded between the two reads cannot look missing. It then admits under the
signer lock with the same boundary as the other entry points: an operator
connection, autocommit and no enclosing transaction block.

The configured chain id must be the integer 31337, the operator key must be
valid, and the provider must answer 31337; otherwise nothing is admitted. A
missing signer, or a closed one that was never admitted (generation zero),
enters generation one with its nonce counter unchanged; an admitted signer is
returned unchanged, so the command is idempotent. A signer closed after
admission stays closed: as with the fresh bootstrap, this command cannot undo a
closure. Every run also refuses a chain that no longer holds what the database
recorded. Each nonce from the chain's mined count up to the signer's next
nonce must belong to a signed transaction still awaiting its receipt;
otherwise the chain was reset, or lost its latest blocks, without the database,
and signing would leave a nonce gap that the node never mines past. The output
is one JSON object naming the chain, the address, the generation and whether
anything changed.

## Automatic swap approval

Company empty deployments retain their original consumed approval and applying
actor separately from this technical approval. Every fresh deployment signature
rechecks its exact company source immediately before the local signature, and
original signed receipt recovery and this approval suffix keep their existing
association checks. See
[company deployment](../plans/company-managed-registers/company-deployments.md).

After the token projection and asset bridge succeed, a bounded operator
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
another observer finishes late.

The original successful receipt and a unique matching `ShareTokenApproved(token,
true)` event from the admitted contract confirm the approval. A retained revert
can be projected locally while the provider is unavailable. Explicit admin retry
requires current active staff with token change permission and a signed form
identifying the actor, deployment and exact completed failed claim. The previous
transaction's receipt survives retry; replay acknowledges accepted work without
opening another claim.

The app role cannot read or write approval metadata. The old direct Python
approval sender is removed; the standalone Hardhat deployment script remains in
the all-writer inventory. The swap relayer itself is converted (#619) and the
participant-signed approval is journaled (#6), both described in the
[swap settlement reference](../reference/swap-settlement.md).

## Mint requests

The asset mint page, yield-token mint page and request execution page all use
`tokens.services.mint_service`. Minting an active stablecoin on Base can precede
enabling that asset for settlement. Unsupported receiving chains have no mint
action, and direct mint-page requests are refused before creating a request.
A mint form retains a submission UUID across a repeated POST. Reusing it with
different terms or another actor is refused; a fresh form represents a
deliberate new mint. The service checks current active staff and the entry
point's model permission before admitting work. Admission commits the token,
deployment, chain, signer, recipient, raw amount, calldata and executing actor
before opening an outgoing operation.

Every new request has a dispatch UUID. Its outgoing key includes both request
and dispatch UUIDs. PostgreSQL freezes admitted terms and operation association,
requires a confirmed matching operation and original transaction projection for
completion, and refuses deletion of admitted requests. Execution checks current
deployment eligibility, signer configuration and on-chain minter permission
before signing. Signed recovery uses the recorded intent after configuration
changes; it never silently switches the recorded signer or deployment.

Once a settlement-asset mint is executed, by its execution or by recovery, the
AUDY holding of each verified Base wallet registered at the recipient address is
written from `balanceOf`, after the mint has committed; a holding that cannot be
written is logged and leaves the mint executed. A yield-token mint writes none.

A missing receipt or lost send acknowledgement leaves the request **Outcome
unresolved**. Use **Recover** on the same request. The five-minute
`recover_mint_requests` task selects at most 100 admitted unresolved requests,
oldest update first, using operator authority. It does not admit pending requests
or automatically restart terminal attempts. A recorded pre-signing failure or
revert permits an explicit **Retry** tied to the claim shown on that form;
replaying an old form cannot authorize a later attempt. Recovery updates the
transaction projection from its operation; if a worker stops before that
projection, the sweep repairs it without provider access or another signed
attempt. Here **Executed** means a successful receipt was observed, with
finality still governed by #7's remaining work.

## Whitelist changes

Company appointees prepare, approve and apply wallet instructions through the
[company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md).
A participant explicitly nominates one own Base wallet and its genuine retained
possession proof to the exact company and current GENERAL eligibility source.
Company reads expose that nomination's minimal facts, not an account wallet
directory. The private proof, nominee associations and signature bytes remain
operator-only. Historical VERIFIED status is not backfilled into proof.

A current personal company `admin` appointment satisfies each step; narrower
prepare/approve/apply/read capabilities remain. ADD freezes the nomination,
company, address, chain, actual registry, finite expiry and exact transaction
intent. Expiry cannot exceed its captured eligibility expiry. The factory's
`registryOf(acn)` must identify the company's actual deployed registry. REMOVE
freezes a genuine retained CONFIRMED or UNCHANGED ADD journal and its exact
company/registry/address, including historical NULL-source ADDs. Deletion of the
mutable wallet, entry or approval does not erase that original target.

Application consumes the retained approval and atomically admits and queues one
original `WhitelistChange`. Human applied status is admission, not chain
approval. The one write remains `setExpiry(address, uint64)`: ADD carries its
finite whole-second expiry and REMOVE writes zero. The nullable immutable source
link preserves old journals without invented company actors or approvals. New
staff/operator ADD/REMOVE and batch-add admission, whitelist-admin quick actions
and subscription-admin whitelisting are replaced; retained private entry reads,
sync/export and original technical recovery remain. Preparation and decision
receipts follow the [uncertain-reply rule](#company-decisions-and-signer-authority);
proposal, consumed approval, change, outgoing operation, claim and transaction
identities remain separate, and the clients scope saved state to the current
account and session.

The target advisory lock precedes the company/source locks, and a fresh
signature rechecks the captured nomination/proof, GENERAL source and expiry
with the company mandates. Permanent source loss on never-signed work fails the
original claim and projects that failure, releasing its target so a genuine
eligibility-loss REMOVE is not stranded behind it; it does not invent a
withdrawal or wallet-deletion cause.

`pending` and `executing` are unresolved; the original nested operation distinguishes
PREPARING from SIGNED. `confirmed` records the original successful transaction
outcome; `unchanged` records a real no-transaction observation; `failed` records a
known never-signed failure or revert. Later membership observations cannot complete
a signed command. The initial observation compares `expiresAt` with the intended
effect; a signed change instead uses original receipt/finality reconciliation.
An unresolved original serializes the exact chain/registry/address target.
Terminal outcome, local projection and target release commit together, and terminal
replay cannot overwrite newer membership.

Projection checks the original company/chain/registry/address and current mutable
entry association. It cannot recreate a deleted entry or redirect a receipt to
its replacement. See [whitelist recovery](../operations/recovery.md#whitelist-changes).

Every read the platform makes before acting asks the share class's own
registry, through the token's `whitelist()`: issuance execution and order
creation. Wallets > Send refuses a share class outright; a stablecoin sent from
Wallets > Send has no company registry to ask and is checked against stored
approvals instead, under the [EVM transfer rules](../reference/wallet-transfers.md#evm).
`GET /api/v1/trading/whitelist/<token>/<address>/status/` answers the registry
question for the share class at contract address `<token>`, for any signed-in
user and any address.

## Refreshing an approval

`whitelist.services.refresh` retains technical eligibility invalidation. It can
submit only REMOVE, using the exact recorded company decision or actual retained
standing, identity or wallet-loss cause. It does not add or renew approval,
authorise a new company instruction, or treat possession-proof refresh as wallet
deletion. A current exact-company GENERAL source can explain why no removal is
needed; absence of a genuine cause is diagnostic, not permission to write.

The sweep reads actual registry expiry. An already expired address needs no write:
its finite on-chain expiry lapses by itself. An unresolved predecessor is recovered
first. Missing receipts, time or current membership do not release an unresolved
signed operation.

Source/request withdrawal, company decision revocation, expiry and evidence purge
retain their applicable decision cause. Account standing/identity and wallet
verification loss/deletion retain actual prior facts and the actor where one
exists. Deleting a wallet captures company/registry/address targets before the
mutable entry and approval cascade and queues its removal after commit; the
retained `refresh_whitelist_targets` job finishes those removals, never
substitutes another actor or grants approval, and must stay because the approval
sweep cannot rediscover deleted targets
([whitelist recovery](../operations/recovery.md#whitelist-changes) owns its
cadence). These attributions remain independent of a new company instruction.

`refresh_whitelist_approvals` sweeps surviving approvals every five minutes;
`recover_whitelist_changes` recovers original unresolved journals. Unavailable
providers, actors, retained causes or workers remain pending/diagnostic rather than
inventing authority. Legacy accountless treasury entries have no fabricated
participant eligibility or possession source. Their retained chain expiry/history
is not a new treasury-admission policy. Normal operating intervals do not guarantee
a removal during a provider outage or unresolved chain outcome.

What a reader may conclude from an approval's status:

| Status    | What it says                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending` | A change for this wallet and company is admitted and unresolved. What the registry holds is unknown, and every platform read treats the wallet as not approved                                                                                                                                                                                    |
| `active`  | The last observation found the registry listing the wallet with this expiry. `is_listed` and the `live` queryset still apply the clock to it                                                                                                                                                                                                      |
| `removed` | The last observation found the registry holding zero for it. A removed row is not re-observed by `sync_all_entries`                                                                                                                                                                                                                               |
| `failed`  | The last change failed or reverted, and is logged at error level. What the registry holds is unknown and every platform read treats the wallet as not approved. `failed` is terminal for that command, so the refresh submits a new one; the thirty-minute sync re-observes the row and replaces the status with what the registry actually holds |

That is what failing closed means here, and its limits are worth stating. The
platform refuses at once, both on the registry read and on the eligibility
checks at order creation and signing. The registry itself cannot be forced
closed while the write is failing, so until a removal lands a direct contract
call can still move shares, and pausing the token is the operator's lever.

## Capital increases

The [company capital family](../plans/company-managed-registers/company-capital-increases.md)
prepares exact before-cap, delta and target with retained company authority.
Human approval admits no journal or job. Application consumes the exact personal
approval and commits the original `CapitalIncreaseExecution`, public `executing`
state and durable job together before signing or broadcast. Read-only chain and
captured-cap preflight precedes the decision transaction outside its locks.
Fresh owner/staff creation, submission, review and admission are retired.
Original private histories remain readable. Technical retry retains
`change_capitalincreaserequest` permission and a signed confirmation binding
request, dispatch, actor and exact failed claim; it supplies no new company
decision. Already signed recovery needs no renewed human authority.

The immutable intent retains the original token, company, actor, chain, signer,
contract, approved target and prior recorded cap. PostgreSQL guards freeze public
identity and non-draft terms, and prevent token cap/identity edits while the
request is executing. Pause/unpause remains available. The existing per-token
in-flight constraint is the hold; network reads, signing preparation and broadcast
do not hold that token lock. Failing a never-signed request after revocation or
expiry of its consumed approval releases the class slot while retaining the
intent and journal.

All signed attempts use the common nonce journal. Recovery retains the exact
original terminal receipt before verifying the cap event. Only a matching
`AuthorizedSharesUpdated(oldAmount, newAmount)` event from that contract permits
atomic completion and cap projection; replay cannot lower a later cap. Missing
receipts or events stay unresolved. Contradictory cap observations retain immutable
private attribution evidence and keep the public hold. A delayed preparer assists
a peer's already signed transaction instead of treating its cap change as unknown.

Unsigned failure and confirmed revert permit a deliberate retry of the exact
failed claim; retry admission reacquires the public slot and records that claim
before enqueueing. New company preparation refuses non-increasing or incoherent
terms before admission. Genuine predecessor superseded records retain their
original figures and attribution. A known failed request overtaken by a later
cap can also retire; an unresolved signed request cannot.

New and retry admission check legacy request states and unexplained
same-contract capital transactions, including orphaned and hashless records.
Only exact hashes from the admitted operations' signed attempts are exempt.
This conservative fence cannot establish absent historical authority or drain an
external same-key writer. See [operator recovery](../operations/recovery.md#capital-increases).

## Share issuances

`tokens.services.issuance_execution` admits a company-authorised
[non-paid chain grant](../plans/company-managed-registers/company-register-issues.md)
from its exact applied RegisterInstruction ISSUE and original consumed approval.
The personal company mandates, member/nomination/finite wallet approval, evidence
and intent are rechecked before a fresh signature. A known refusal in the paid
or legacy path becomes a definite unsigned failure with a safe explanation.
Finalised completion and original-member register recording are distinct
bounded transactions; executed but unentered allocations remain reserved until
the once-only ISSUE.

A [paid issue](../plans/company-managed-registers/company-paid-issues.md) uses
the same admission: its exact applied instruction consumes current company
approval and binds the original PAID subscription, request, private
`ShareIssuanceExecution` and exact job together. Preparation and approval admit
none of these execution effects. Current source and headroom checks precede new
signing; paid fulfilment does not reapply unrelated participant eligibility,
nomination or grant requirements. Original financial receipt/refund producers
remain separate until #868 changes them. Fresh staff paid ISSUE admission is
retired; historical accepted commands keep their original actor and source.
App connections cannot read or write private commands; public company reads
retain their existing shape.

Initial admission leaves the public request approved and the private command
queued. A refund that wins before the worker claim rejects the request and retains
a cancelled command in the same transaction. Delayed jobs return that cancellation
without opening an operation or creating a public issuance. The worker commits
executing state and its stamped public issuance before opening the outgoing
operation. From that claim onward, uncertainty blocks refunds. A definite unsigned
failure or policy-final original revert permits refund cancellation or an
explicit retry of that exact failed claim.

PostgreSQL guards freeze approved terms, dispatch identity, subscription linkage,
payment and share quantities. Recorded refunds cannot be reduced or undone.
Token identity stays fixed while new work can execute. Retained NULL-source paid
commands keep their applicable outgoing, token, subscription, request and
private-command suffix. Common-journal signing commits original bytes, nonce,
hash, public transaction and issuance association before broadcast.

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
the admitted contract address. The five-minute sweep recovers bounded batches of
accepted work. Completion calls `record_completed_effects` in the same
transaction; the [register recording rules](register.md) may retain the effect
as waiting for its opening, wallet link, attribution or applied instruction.

An admitted paid subscription retains its unique execution and immutable request
binding. Permanent consumed-appointment loss before any signature retains that
history and paid money; it does not renew authority, bind a second request or
automatically refund funds. An actual financial cancellation still requires its
existing refund/cancellation facts; further paid fund resolution policy belongs
to #868. See [issuance recovery](../operations/recovery.md#deployment-and-issuance).

## Pause and unpause

New pause/unpause work uses the six-operation company family described in the
[company instruction guide](../plans/company-managed-registers/company-pause-changes.md).
A current personal company appointment prepares an exact state, reason, authority
reference and private evidence. Approval records the human decision without a
journal, job, signature or state change. Application consumes that exact approval
and current applier authority, admitting one source-bound private `PauseChange`
and its durable recovery job atomically under the original proposal UUID.
Ownership and staff permissions provide no company mandate. The replaced fresh
owner POST and staff admin admission are retired; exact existing owner-row
POST replay and private GET recovery retain their original identity and direction.

A verified initial boolean at a recorded block may produce `observed`, with no
outgoing operation, signature or nonce. The decision is serialized against an
executing peer. Failing a never-signed original after revocation or expiry of
its consumed approval releases its target slot; definite preparation failures
retain their technical meaning. A unique original `Paused` or `Unpaused` event
from the admitted contract and sender, canonical successful receipt and
configured finality are required for confirmation. Current chain state cannot
replace that transaction's outcome.

The incomplete command reserves its chain and contract, including a confirmed or
observed outcome awaiting public projection. Company projection locks target,
company, class, source and journal on one operator alias before updating the
public state. A retained NULL-source pause projects through its original owner
path, and no operator fallback supplies that write. API and clients expose
requested state, genuine observation or original receipt separately from
current class state.
