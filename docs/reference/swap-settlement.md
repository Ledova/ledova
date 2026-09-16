# Swap settlement protocol

[Reference](README.md) · [Documentation](../README.md)

Captured settlement context, participant authorization and durable execution claims. These controls do not enable trading.

New matches use the immutable settlement context introduced by `tokens/0039`.
Coordinate backend, shared package, dashboard and mobile before deploying this
protocol: this backend phase alone does not complete the client recovery flow.
New-context swap requests require the exact swap, order, account and verified
wallet identity; signing and approval requests also require the recorded full
settlement digest. Initial authorized context lookup may omit that digest;
the response returns the original value for subsequent requests. Missing identity
fields return HTTP 400 validation errors. Exact-identity legacy V0 signing and
approval requests return HTTP 409 `legacy_swap_held`. Their missing recorded
domain cannot be reconstructed from current configuration. Exact
lookup preserves the original review display and decimal-string typed values
after expiry or configuration drift; it does not authorize a new signature or
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
current ownership and verification again; a list entry is not authorization.
Same-address wallets cannot substitute for the recorded wallet. List rows offer
review; exact amounts come from the fetched context before signing, never from
rounded numeric list fields. Signed sides remain visible only while another
owned side still needs a signature. Legacy history stays held for operator review.

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
response is confirmation, and the client keeps its saved hash as before.

The five-minute `recover_swap_approval_submissions` sweep attempts at most 100
pending rows, least recently attempted first. Each attempt verifies the bytes
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

Migration `tokens/0059` creates the journal and its trigger and adopts no earlier
approval: bytes sent before it have no row and are not replayed. Reversal refuses
while any row exists. See [upgrades](../operations/upgrades.md).
`tokens/0040` permits a captured-party signature through either currently
authorized participant while the other order and wallet stay private. It first
refuses existing swap/parent identity drift without rewriting history, freezes
the order's owner tuple, and prevents replacing the two referenced order rows.
Case-only address spelling, economic/status updates and unreferenced order
deletion remain available. Referenced legacy swaps are retained by the hold
described below. An unchanged V1 update must
prove one current captured participant to avoid both-parent derivation; INSERT,
legacy and the original operator/both-visible path retain their checks.
The captured-participant policy resolves the recorded first-signature refusal.
Swap-row RLS is installed; private cross-account matching and outcome writes
requiring both parent objects retain separate limits.
Such unresolved claims and reservations remain retained for existing operator
reconciliation; a successful signature response does not establish settlement.
Trading and outgoing signer activation remain unchanged.

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
stop or missing receipt cannot authorize a second transaction or nonce. The
five-minute sweep considers at most 100 admitted pending/submitted transactions
older than ten minutes, oldest update first, and separately at most 100 confirmed
or reverted transactions whose swap is still executing, which it passes to the
finality consumer below. It can recover admission before the common operation
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
capital reservation remains #5 work.

The finality consumer, `settle`, runs from the same sweep for every executing swap
whose transaction is confirmed or reverted. It reads the chain with the wallet
observer's evidence collector under the approved finality policy for the swap's
own network, `evm:<chain_id>`: the finalized head for Base Sepolia and Ethereum
Sepolia, and no policy for a local chain. It accepts only a canonical inclusion
whose finality is satisfied, then reads the receipt again and re-verifies the
`SwapExecuted` event before writing anything. A waiting head, a moving tip, an
unavailable finalized block, an orphaned receipt block or an unconfigured network
holds the swap for the next sweep. Nothing is resent: an inclusion that never
returns to the canonical chain stays executing for operator attribution and is
logged. Every chain read happens outside locks; the write locks both parents, the
swap and the transaction in that order and checks the recorded identities again,
so two workers cannot settle one swap twice and a settled swap is left alone
without another chain call.

A final successful inclusion completes the swap. `completed_at` is the settlement
clock, when finality was observed, not the block time. Parents keep their filled
quantity, take the transaction hash, and become `completed` when fully filled or
return to `partially_filled` otherwise, where they can be modified or cancelled
again. `swap_completed` is published after commit, and the market's last price
moves at this point rather than at the first receipt. A reverted inclusion
releases the reservation only once that revert is itself final, through the same
unwind as an unsigned failure; its first receipt holds. A transaction re-included
in a different block completes when the same hash is final there and the event
re-verifies; the frozen receipt summary on the operation and transaction records
the first-seen inclusion and is not rewritten.

Migrations `blockchain/0007` and `tokens/0057` bind the existing transaction to its
common operation and guard admission, complete intent bytes, immutable identities,
original signed evidence and retained outcomes. Application connections cannot
read or write the private journal. Historical unmarked transactions gain no
admission or signing authority; they stay held for attribution. Reversal refuses
once admitted execution exists. The generic monitor remains excluded, and the
old direct executor and receipt-driven financial completion are removed.
`tokens/0058` replaces the swap guard: `executing` to `completed` is legal only
with a confirmed admitted journal, its confirmed operation, a matching hash and a
completion time; `executing` to `failed` also with a reverted journal; `completed`
and `failed` are terminal. PostgreSQL cannot see finality, so that remains the
service's guarantee, carried by its tests. Other adapters still complete at their
first receipt; only swaps hold a financial reservation. A local chain never
settles a swap unless [`LOCAL_CHAIN_FINALITY_DEPTH`](../operations/chains.md#blockchain)
is set.

## Legacy history hold

`tokens/0056_hold_legacy_swaps` retains V0 rows without rewriting signatures,
deadlines, hashes or outcomes. Its PostgreSQL trigger rejects every UPDATE and
DELETE, including operator writes and parent cascades. Reversing that migration
refuses while any V0 history remains. Existing signatures are retained evidence;
this server-side hold does not revoke signatures already disclosed on chain.

V0 cannot create signing data, accept signatures, prepare approvals or claim an
execution. Delayed execution callbacks and the dedicated recovery and expiry
sweeps leave its history and reservations unchanged for operator attribution.
No operator attribution or re-enabling endpoint is introduced. Legacy request
discovery and response schema alternatives have been removed after the client
cutover. The existing swap list still returns eligible V0 history.

The generic transaction monitor excludes every atomic-swap transaction, every
`tokens.SwapOrder` business reference and every transaction linked by a swap,
even when the other associations are missing or inconsistent. It rechecks that
exclusion after receipt I/O before writing an outcome. Admitted V1 outcomes stay
with the dedicated recovery worker, which verifies the original context and
success event before recording receipt evidence. It leaves financial state held.
Unattributed history stays pending; this does not add finality or reorg handling.

## Unclaimed expiry

`expire_unclaimed_matches` releases the reserved share quantity of an expired
V1 swap only when the current matching service marked it eligible at creation,
both orders still name that match, and no execution claim, transaction record,
hash or other active match exists. The sweep locks both orders in identifier
order, then the current swap, and commits each release separately. It preserves
previously filled quantities and signed terms, marks the swap `expired`, and
publishes `swap_expired` so both clients refresh their orders and swaps. A retry
cannot release the same reservation twice. Signing still stops at the recorded
deadline; the worker makes eligible orders available on its next minute sweep.
The order book and best prices include reopened partially filled orders using
only their remaining quantity.

`tokens/0036_swap_expiry_eligibility` leaves existing rows ineligible and prevents
changing the marker on PostgreSQL. Do not backfill it: missing transaction data
in a legacy row does not establish that nothing was sent. Deploy this code to
all API and worker processes and stop older processes before permitting new
matches; the eligibility marker describes the current service's durable claim
protocol. Claimed, executing, inconsistent and legacy matches retain their
reservations for reconciliation. This sweep does not inspect the chain, refund
money, cancel a broadcast or change an existing signature/deadline. Trading
remains disabled by default.
