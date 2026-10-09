# Swap settlement protocol

[Reference](README.md) · [Documentation](../README.md)

Captured settlement context, participant authorisation, durable execution claims and what PostgreSQL freezes. Trading is enabled by default; [secondary trading](../architecture/trading.md) describes the flag.

New matches use the immutable settlement context introduced by `tokens/0039`.
The backend, shared package, dashboard and mobile carry this protocol together.
New-context swap requests require the exact swap, order, account and verified
wallet identity; signing and approval requests also require the recorded full
settlement digest. Initial authorised context lookup may omit that digest;
the response returns the original value for subsequent requests. Missing identity
fields return HTTP 400 validation errors. Exact-identity legacy V0 signing and
approval requests return HTTP 409 `legacy_swap_held`. Their missing recorded
domain cannot be reconstructed from current configuration. Exact
lookup preserves the original review display and decimal-string typed values
after expiry or configuration drift; it does not authorise a new signature or
approval under changed terms. Ordinary numeric order/swap fields are not a
lossless source for rebuilding those signed values.

The swap list supplies `viewerParties`: each entry names a recorded buyer or
seller role, account UUID and wallet UUID that still belongs to the authenticated
viewer and is verified with the original address. It never exposes the other
participant's private account or wallet identifiers. V0 rows have no entries.
The projection includes both owned sides regardless of which wallet address
selected the row, so combining wallet lists cannot discard a signing side.

Dashboard and mobile use those identities to select an available unsigned side,
then fetch the exact original context without a digest. They pin the returned
digest for every subsequent approval and signature request. The lookup checks
current ownership and verification again; a list entry is not authorisation.
Same-address wallets cannot substitute for the recorded wallet. List rows offer
review; exact amounts come from the fetched context before signing, never from
rounded numeric list fields. Signed sides remain visible only while another
owned side still needs a signature. Legacy history stays held for operator
attribution.

## The reviewed intent

The owner's decision of 16 September 2026 stands: V1 is the signed protocol —
the EIP-712 `SwapOrder` typed data over the `LedovaAtomicSwap` domain — and no
new protocol is introduced. V0 history stays held for operator attribution and
is never adopted, replayed or re-signed by this contract.

A newly matched swap captures its settlement context before anything is signed:
the typed domain (name, version, `chainId`, `verifyingContract`) and message
(seller, buyer, share token, payment token, share amount, payment amount,
nonce, deadline), the parties bound to their exact order, account, wallet and
payment asset, the deployment that priced the payment, the digest, and the
`order_hash`. `capture_settlement_context` refuses a share token whose recorded
deployment names a chain other than the domain about to be signed, including
one whose deployment row cannot be read, with the terminal
`settlement_chain_disagreement` refusal that
[order creation](order-submissions.md#creating-an-order) records. Newly matched
swaps use the owner-selected 15-minute signing window
(`SWAP_ORDER_EXPIRY_HOURS`, 0.25); every recorded deadline and issued signature
predating that decision keeps its own. Two deliberate orders with equal terms
remain two submissions, two orders and two swaps. Order creation resolves the
operator's single active, deployed, supported settlement asset, so two signed
orders form a swap. The captured context is what the parties review; every
stage re-checks it under its locks through the admission matrix below, and
[what PostgreSQL freezes](#what-postgresql-freezes) lists the migrations that
hold it.

## The settlement admission matrix

Every `swap/*` route on the order resource resolves the exact swap context and
re-checks admission before it answers. The resolver,
`resolve_exact_swap_context` (`trading_order_access.py`), binds the caller's
order, account and verified wallet to the swap's recorded settlement context
and names the caller's party; anything else is an ordinary not-found. The
re-check, `require_pending_settlement`, requires a pending status, no
transaction, a live signed deadline and a settlement context that still matches
current configuration.

| Route | Resolves | Re-checks |
| --- | --- | --- |
| `GET swap/` | identity lookup, repeated after an optional approval-journal read | the re-check result is reported as `admission_refusal` rather than raised; a stale supplied digest or a legacy row still refuses with HTTP 409 through the resolver |
| `POST swap/sign` | exact identity | `submit_signature` re-reads the swap, verifies the signature against the recorded terms, and under the operator lock re-authorises the actor, account and wallet (`_lock_authority`) and re-checks drift, deadline and status before storing |
| `GET swap/approval-status` | identity lookup | re-check, then a fresh resolve and re-check before answering |
| `GET swap/approval-data` | identity lookup | re-check, then a fresh resolve and re-check before answering, on both outcomes |
| `POST swap/approval-broadcast` | exact identity | the service re-checks before decoding, re-invokes the route's fresh resolver, and the recording transaction re-checks the locked swap and its digest |

`backend/tokens/tests/test_settlement_admission_rules.py` holds the matrix as a
rule: every `swap/*` action in the trading viewset must reach the resolver and a
re-check — its own, or a declared service leg that itself performs its declared
re-check — so a new route that skips either fails that test by name. Route
discovery reads the literal `url_path` of the `@action` decorator, as every
current route declares one, and the service-leg rules hold the presence of the
declared calls, not their placement inside a lock or transaction; both limits
are stated in the rule's own failure message, and the legs' placement is the
prose above.

Delivery and recovery re-authorise the *recorded* actor under the lock
(`_lock_command(authority=True)` to `_lock_authority`), never a fresh one. The
finality consumer `settle` deliberately performs no actor authorisation at all:
finality is not an actor's action, and the rule records that exemption — its own
body reaches neither the resolver, the re-check nor the authority lock. The swap
*list* is a wallet-scoped read under row-level security, not an admission, and
is outside this matrix.

## Payment units

New matches calculate payment from the share quantity and execution price using
the deployed payment token's decimals. Calculation and context capture share one
deployment snapshot. The total must be exactly representable, positive and fit
the stored signed 64-bit integer range; shares must also be positive whole
integers in that range. No amount is rounded or truncated. A fractional price is
allowed when its total is representable: 100 shares at 1.23 require 123 units of
a zero-decimal token, while three shares at that price cannot settle. Matching
tries candidates in price/time order and skips proposed fills that are
unrepresentable or out of range. Each skipped attempt rolls back without changing
the resting order, its reservations or the proposed quantity. The first usable
fill wins within the signed price limit. If every otherwise-compatible candidate
fails this amount check, the [submission protocol](order-submissions.md#creating-an-order)
records a permanent refusal. With no compatible candidate, the order stays open.

V1 market history decodes the original raw payment with its captured deployment
scale, including older V1 records whose quoted price disagreed with the signed
amount. It does not replace that amount with the quote or rewrite signatures,
context or digest. Legacy V0 market reads retain their existing asset-pricing
scale because no deployment snapshot was recorded. Both market reads select
the latest completed swap by completion time, then identifier, and preserve
exact payment digits without floating-point conversion. These read rules do not
grant permission to execute historical swaps.

## Participant approvals

The scoped approval-broadcast route verifies the actual signed bytes against
the captured party, chain, token, spender and existing unlimited approval value,
then records them before any RPC. Inside one bounded operator transaction it
locks the swap row, reuses the `SwapApprovalSubmission` that already holds the
same bytes, refuses different bytes at a recorded sender nonce with HTTP 409
`swap_approval_conflict`, and otherwise inserts the exact bytes, their locally
computed hash, nonce, sender, token, spender, settlement digest, participant
identity and requesting actor. The row commits before the send, so a lost
response or a killed process cannot lose the effect. The journal is operator-only
and `(chain_id, tx_hash)` and `(chain_id, sender_address, nonce)` are unique
across every swap; PostgreSQL freezes the identity, writes the outcome once and
refuses insertion unless the referenced V1 swap is still pending.

Outside that transaction the recorded row is attempted: a row that already holds
its receipt answers HTTP 200 with no RPC; otherwise the bytes are sent, the
acknowledgement is recorded when the node returns the computed hash, and the
request waits a few seconds for the receipt. A receipt whose transaction hash
equals the computed hash is recorded as `confirmed` or `reverted` with its block
and gas, and it remains attributed to the original context if the deadline or
configuration changes during the wait. Only `confirmed` answers HTTP 200.
Everything else returns `swap_approval_unconfirmed` with HTTP 503, the original
scoped identity and computed hash. Its detail states the recorded row's own
outcome. While the row is pending the approval is recorded and recovery is in
progress: do not sign another approval for that swap. A `reverted` or
`superseded` row says the approval took no effect and is no longer replayed,
which is the state in which `approval-data` prepares a fresh one below. Neither
response is confirmation, and the client keeps its saved hash until exact
outcome recovery establishes a definite result.

The existing `GET swap/` accepts one optional `approval_tx_hash`. Its
`approval_outcome` is absent when no hash was requested, null when no authorised
journal row matches, or the original `tx_hash` and
`pending|confirmed|reverted|superseded` outcome. This is a bounded operator read
of the supplied hash, captured chain, sender, token and spender, and the current
party's account and wallet. Authorisation is resolved again after the read.
It returns no signed bytes and makes no provider call, so expiry, configuration
drift or a provider outage cannot prevent reading a recorded outcome. An
unlimited approval can serve another swap with identical effect terms for the
same account and wallet; its journal's first swap is not its only valid consumer.

Both clients recover saved approval hashes through that exact-context read.
They validate the returned context and requested hash before clearing a
`confirmed`, `reverted` or `superseded` reminder and displaying its outcome.
Pending, missing, inaccessible or malformed evidence remains unresolved, as
does an older server response without the optional field. Storage removal
failure retains the reminder and allows another check. A sufficient allowance
does not establish the original transaction's outcome. Recovery never signs or
sends a new approval: after a definite failure, a still-admitted settlement can
use the existing fresh approval review.

The five-minute `recover_swap_approval_submissions` sweep attempts at most 100
pending rows, least recently updated first. An attempt advances that activity
timestamp before checking identity or reading a provider, so an unavailable
row cannot repeatedly monopolize a bounded batch. The send timestamp remains
separate and controls the existing resend interval. Each attempt verifies the bytes
against the recorded identity, reads the endpoint's current chain ID, and looks
for the receipt by hash first, recording it when found. With no receipt, a
sender whose mined nonce has passed the recorded nonce marks the row
`superseded`. Otherwise the exact bytes are resent, at most once a minute across
route and sweep, only while the swap is still pending, its captured context
still matches the current configuration and the signed deadline is live; after
the deadline or after drift nothing is resent and the row is observed until a
receipt or the nonce moves. Rows are retained indefinitely. The sweep never
signs, never allocates a nonce and never sends bytes it did not record.

`approval-data` refuses with HTTP 409 `swap_approval_pending` while a submission
for the same chain, sender, token and spender is pending, so a second device
cannot prepare a competing approval; a fresh approval is prepared only after
`confirmed`, `reverted` or `superseded`. Execution admission still proceeds on
an included approval without waiting for finality. Approval data otherwise has
two mutually exclusive outcomes: sufficient allowance, or an approval
transaction with the original identity. Signing and approval schemas describe
only the exact settlement contract, and the general transfer service is
unchanged.

Approval provider admission still uses the inherited cached `assert_expected_chain`
result. Execution recovery additionally reads the endpoint's current chain ID
before observation and delivery. Execution admission retains complete signed
arguments and their original domain. A receipt that cannot be attributed to that
original chain/context leaves the claim unresolved.

`tokens/0059` creates the journal and its trigger and adopts no earlier
approval: bytes sent before it have no row and are not replayed, and reversal
refuses while any row exists; see
[the upgrade note](../operations/upgrades.md#database-migrations). `tokens/0040`
permits a captured-party signature through either currently authorised
participant while the other order and wallet stay private; its freeze is in the
[table below](#what-postgresql-freezes). Swap-row RLS is installed; private
cross-account matching and outcome writes requiring both parent objects retain
separate limits. Unresolved claims and reservations remain retained for
existing operator reconciliation; a successful signature response does not
establish settlement. Participant swap approval submissions admit no signer:
the operator's automatic swap approval and swap execution stay under the
[outgoing foundation's admission](../architecture/outgoing-signing.md).

## Durable execution

The completing signature, a private `BlockchainTransaction` admission and its
`recover_swap_execution` job commit together. Admission records the authenticated
caller's original account participant and actor, even when that participant relays
the other party's valid signature. Both parties' private parent orders are changed
through a bounded operator transaction. If no valid relayer key is configured,
both signatures remain READY; an explicit exact signature replay can admit the
execution later. A sweep never invents the initiating actor.

Recovery binds the original transaction to `swap-execution:<transaction UUID>`
in the [outgoing foundation](../architecture/outgoing-signing.md). It uses the
recorded chain, relayer, target and full ABI calldata. Before any send, the common
signed bytes, hash and nonce reservation commit with both transaction and swap
hashes. Competing workers recover the same operation. A lost response, process
stop or missing receipt cannot authorise a second transaction or nonce. Before
each resend, recovery reads the relayer's mined transaction count; once it passes
the attempt's nonce, the attempt's own bytes go through the
[nonce-spend reader](transaction-evidence.md#evm-nonce-spend-evidence) and the
swap holds for operator attribution with nothing resent. The warning names the
consuming hash and its kind when the provider can answer for them, and names the
reason it could not when it cannot. The foundation cannot replace or cancel a
signed attempt, so a spend made outside it is recorded, never adopted, and a
stuck relayer nonce has no supported remedy. The five-minute sweep considers at
most 100 admitted pending/submitted transactions older than ten minutes, oldest
update first, and separately at most 100 confirmed or reverted transactions whose
swap is still executing, which it passes to the finality consumer below. It can recover admission before the common operation
exists and a receipt retained before its local projection.

Fresh preparation/signing requires the original caller's active ownership and
verified wallet, unchanged settlement configuration and a live signed deadline.
Signed delivery checks those conditions again, plus current signer admission,
before the send. Locks commit before RPC; a call that crossed the boundary may
still send after a concurrent change. Closing admission is a drain barrier.
Original receipt observation remains available after authority, key, domain or
deadline changes, provided the original chain remains reachable. No new authority
is inferred from that observation.

Success requires the original receipt hash, sender, target and one correctly
decoded `SwapExecuted` event with the exact digest, parties, tokens and amounts.
The event must belong to the receipt's transaction and block. A contradictory,
removed, missing or duplicate event stays unresolved. Revert evidence must name
the original transaction. The common operation retains its first receipt summary;
full event evidence is verified before storing that summary. Later finality or
financial processing must re-read and verify the original inclusion, holding when
that evidence is unavailable or contradictory.

Both successful and reverted signed receipts leave the public swap EXECUTING and
parent reservations held until finality. Only a proven unsigned preparation
failure can fail the swap before that and unwind its reservation once. This
adapter never restarts its original claim, including after a revert. Aggregate
capital reservation was resolved by owner decision on 16 September 2026:
[#625](https://github.com/Ledova/ledova/issues/625) closed as not planned, and
the per-row guards and triggers stand, with the sell-side
[#620](https://github.com/Ledova/ledova/issues/620) and buyer-side
[#626](https://github.com/Ledova/ledova/issues/626) commitment checks.

The finality consumer, `settle`, runs from the same sweep for every executing
swap whose transaction is confirmed or reverted. It reads the chain with the
wallet observer's evidence collector under the
[approved finality policy](transaction-evidence.md#wallet-chain-observations)
for the swap's own network, accepts only a canonical inclusion whose finality
is satisfied, then reads the receipt again and re-verifies the `SwapExecuted`
event before writing anything; anything else holds the swap for the next sweep,
and nothing is resent, so an inclusion that never returns to the canonical
chain stays executing for operator attribution and is logged. Every chain read
happens outside locks; the write locks both parents, the swap and the
transaction in that order and checks the recorded identities again, so two
workers cannot settle one swap twice and a settled swap is left alone without
another chain call.

Completion also rechecks the configured finality policy under those locks. The
swap's `finalized_receipt` records the verified final block number/hash, gas and
policy in the same transaction as completion or final failure and the parent
updates. A same-outcome reinclusion may have a different block from the first
receipt; both the common operation and the transaction retain their immutable
first summaries. Register integration must use the swap's final inclusion when
comparing settlement against an opening boundary. The database validates the
evidence shape and freezes it on settlement; provider evidence is verified by
the service, not proven by those database checks.

Migration `tokens/0063` adds nullable evidence without attributing earlier
completed swaps. Such historical null evidence remains explicit and cannot be
backfilled through an ordinary update. New signed settlement requires evidence;
unsigned preparation failures retain none. Reversal refuses once evidence has
been recorded, so downgrade cannot discard it. Company-run register openings
from the chain, which read that final inclusion, are documented in
[the register](../architecture/register.md).

A final successful inclusion completes the swap. `completed_at` is the settlement
clock, when finality was observed, not the block time. Parents keep their filled
quantity, take the transaction hash, and become `completed` when fully filled.
A parent with shares left returns to the book as `partially_filled`, or is held
back (`held`) when its price would cross the book, and takes its next single match
from the minute's sweep ([one match, never crossed](../architecture/trading.md#one-match-never-crossed));
either way it can be modified or cancelled again. `swap_completed` is published
after commit, and the market's last price moves at this point rather than at the
first receipt. A reverted inclusion releases the reservation only once that
revert is itself final, through the same unwind as an unsigned failure, which
returns both parents as the expiry sweep does; its first receipt holds. A transaction re-included
in a different block completes when the same hash is final there and the event
re-verifies; the frozen receipt summary on the operation and transaction records
the first-seen inclusion and is not rewritten. A re-inclusion whose finalized
outcome differs from the first receipt's, a revert finalized as a success or the
reverse, is held for operator attribution: the sweep logs both outcomes once per
pass and neither completes nor releases the swap.

PostgreSQL cannot see finality, so that remains the service's guarantee,
carried by its tests. Other adapters still complete at their first receipt;
only swaps hold a financial reservation. A local chain never settles a swap
unless [`LOCAL_CHAIN_FINALITY_DEPTH`](../operations/chains.md#blockchain)
is set.

## What PostgreSQL freezes

| Migration | Freezes |
| --- | --- |
| `tokens/0039` | The settlement context, digest and `order_hash` cannot be replaced, and the fifteen-field swap identity (uuid, both parents, both wallets, token, payment asset, both addresses, both amounts, nonce, order hash, expiry, creation) is immutable; new swaps must carry protocol 1 and name both parent orders with matching tokens, types, wallets and addresses; a recorded settlement identity cannot be deleted |
| `tokens/0040` | Each order's owner identity (uuid, account, wallet, address) cannot change, and a referenced parent order cannot be replaced; a captured party's signature is permitted through either currently authorised participant while the other order and wallet stay private |
| `tokens/0056` | Every V0 row is held: all UPDATE and DELETE attempts on it, including operator writes and parent cascades, are rejected |
| `tokens/0057` | Execution admission is frozen: exact addresses, supported exact integers, both original 65-byte signatures and the original chain; transaction identity, admission and arguments are immutable, the first receipt summary, first submission time and original nonce are retained, and historical transactions gain no new signing authority; admission requires its original actor and participant, its original V1 order, arguments equal to the original settlement and signatures, an unclaimed ready order and an empty journal; failure requires proof that the original operation never signed; the original claim cannot restart, including after a revert |
| `tokens/0058` | Fresh swaps start without signatures or execution claims; claimed swaps retain their journal, signatures and execution hash; `executing` becomes `completed` only with a confirmed admitted journal, its confirmed operation, a matching hash and a completion time, or `failed` with a reverted journal or a proved unsigned failure whose journal holds no hash; `completed` and `failed` are terminal; signed swaps remain held until finality |
| `blockchain/0004` | Outgoing transaction history cannot be changed or deleted; signer identity and reserved nonces cannot be rewound; outgoing operation identity cannot be changed |
| `blockchain/0007` | An admitted swap transaction binds exactly one outgoing operation (one-to-one, protected), and at most one admitted swap transaction exists per swap |

Adjacent guarantees carry related, narrower rules: `tokens/0037` freezes order
submission identity and terminal outcomes, `tokens/0055` and `tokens/0060` the
recordable refusal codes, `tokens/0059` the participant approval journal. They
are named here for the map, not folded into the intent freeze above.
Application connections cannot read or write the private execution journal.
Historical unmarked transactions gain no admission or signing authority; they
stay held for attribution. Reversal of `blockchain/0007` and `tokens/0057`
refuses once admitted execution exists, and of `tokens/0056` while any V0
history remains. The generic monitor remains excluded, and the old direct
executor and receipt-driven financial completion are removed.

## Legacy history hold

`tokens/0056_hold_legacy_swaps` retains V0 rows without rewriting signatures,
deadlines, hashes or outcomes; its trigger is in the
[freeze table](#what-postgresql-freezes). Existing signatures are retained
evidence; this server-side hold does not revoke signatures already disclosed on
chain.

V0 cannot create signing data, accept signatures, prepare approvals or claim an
execution. Delayed execution callbacks and the dedicated recovery and expiry
sweeps leave its history and reservations unchanged for operator attribution.
No operator attribution or re-enabling endpoint is introduced. Legacy request
discovery and response schema alternatives have been removed after the client
cutover. The existing swap list still returns eligible V0 history.

The generic transaction monitor's exclusion of every atomic-swap transaction,
and the dedicated recovery worker's verification before it records receipt
evidence, are in [receipt attribution](transaction-evidence.md#receipt-attribution).

## Unclaimed expiry

`expire_unclaimed_matches` releases the reserved share quantity of an expired
V1 swap only when the current matching service marked it eligible at creation,
both orders still name that match, and no execution claim, transaction record,
hash or other active match exists. The sweep locks both orders in identifier
order, then the current swap, as [the trading lock graph](order-submissions.md#the-trading-lock-graph)
requires, and commits each release separately. It preserves
previously filled quantities and signed terms, marks the swap `expired`, and
publishes `swap_expired` so both clients refresh their orders and swaps. A retry
cannot release the same reservation twice. Signing still stops at the recorded
deadline; the worker makes eligible orders available on its next minute sweep.
The two orders return oldest first: each rests in the book, which counts only its
remaining quantity, unless its price would cross the book, when it is held back.
The two still cross each other, so the one placed later, usually the order that
took the match, is held, and the held-order sweep never pairs them again.

`tokens/0036_swap_expiry_eligibility` leaves existing rows ineligible and prevents
changing the marker on PostgreSQL. Do not backfill it: missing transaction data
in a legacy row does not establish that nothing was sent. Deploy this code to
all API and worker processes and stop older processes before permitting new
matches; the eligibility marker describes the current service's durable claim
protocol. Claimed, executing, inconsistent and legacy matches retain their
reservations for reconciliation. This sweep does not inspect the chain, refund
money, cancel a broadcast or change an existing signature/deadline. Trading is
enabled by default.
