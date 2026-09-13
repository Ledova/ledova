# Swap settlement protocol

[Reference](README.md) · [Documentation](../README.md)

Captured settlement context, participant authorization and durable execution claims. These controls do not enable trading.

New matches use the immutable settlement context introduced by `tokens/0039`.
Coordinate backend, shared package, dashboard and mobile before deploying this
protocol: this backend phase alone does not complete the client recovery flow.
New-context swap requests require the exact swap, order, account and verified
wallet identity; signing and approval requests also require the recorded full
settlement digest. The existing unqualified request form remains for legacy
rows and returns `swap_context_refresh_required` for new-context rows. Exact
lookup preserves the original review display and decimal-string typed values
after expiry or configuration drift; it does not authorize a new signature or
approval under changed terms. Ordinary numeric order/swap fields are not a
lossless source for rebuilding those signed values.

The scoped approval-broadcast route verifies the actual signed bytes against
the captured party, chain, token, spender and existing unlimited approval value.
A confirmed result requires both the provider's returned hash and the receipt's
transaction hash to equal the computed signed-byte hash. Missing or conflicting
identity, or a send/receipt exception, returns `swap_approval_unconfirmed` with
HTTP 503, the original scoped identity and computed hash. Retain that identity
and check the original outcome; this is not confirmation, a new journal or
permission to rebroadcast. A matching receipt remains attributed to its original
context if the deadline or configuration changes during the wait. The general
transfer service is unchanged. Local signature-request and approval-data schema
envelopes use `anyOf` because valid scoped objects extend their legacy forms.

Provider admission uses the inherited cached `assert_expected_chain` result;
it is not a fresh endpoint-identity observation on every call. New claims retain
complete signed arguments and their original domain. A receipt that cannot be
attributed to that original chain/context leaves the claim unresolved.
`tokens/0040` permits a captured-party signature through either currently
authorized participant while the other order and wallet stay private. It first
refuses existing swap/parent identity drift without rewriting history, freezes
the order's owner tuple, and prevents replacing the two referenced order rows.
Case-only address spelling, economic/status updates, unreferenced order deletion
and legacy child-first deletion remain available. An unchanged V1 update must
prove one current captured participant to avoid both-parent derivation; INSERT,
legacy and the original operator/both-visible path retain their checks.
The captured-participant policy resolves the recorded first-signature refusal.
Swap-row RLS is installed; private cross-account matching and outcome writes
requiring both parent objects retain separate limits.
Such unresolved claims and reservations remain retained for existing operator
reconciliation; a successful signature response does not establish settlement.
Trading and outgoing signer activation remain unchanged.

- **One current swap execution is claimed before preparation.** A fresh READY
  row receives a transaction UUID and becomes EXECUTING in a durable transaction
  before balance checks, building, signing or sending. Competing callers cannot
  prepare another attempt. Signature writes also reread the locked swap. Shared
  order locks are acquired by primary key, followed by challenge, swap and
  current transaction locks where needed; matching then selects by the existing
  price/time priority. Receipt I/O runs outside these locks, and each outcome
  rechecks the order links, current UUID, both recorded hashes and fresh terminal
  transaction evidence before changing reservations. A local failure before any
  send can unwind once; a missing receipt, provider exception, monitor timeout,
  elapsed deadline or unattributed nonce use cannot. A process death after the
  claim leaves unresolved history. This does not supply durable signed-byte
  recovery, request idempotency, aggregate reservations, a complete cross-row
  state machine; those remain in #5 and #6.

## Unclaimed expiry

`expire_unclaimed_matches` releases the reserved share quantity of an expired
swap only when the current matching service marked it eligible at creation,
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
