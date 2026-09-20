# Secondary trading

[Architecture](README.md) · [Product scope](../product.md)

The secondary market has order, matching and settlement code, and trading is
enabled by default. `trading_enabled`
middleware refuses every method under `/api/v1/trading/orders/`, `wallets/`,
`transfers/`, `swaps/` and `events/` when the flag is off, and an operator can
disable it per deployment in Django admin. The read-only token market and
whitelist status sit outside those prefixes. The flag does not establish
safety: releases require the human checks in
[#624](https://github.com/Ledova/ledova/issues/624), and operation with real
participants follows the [regulatory pathway](../regulatory-pathway.md).

## Intent and settlement

Private orders remain visible and editable only to their owners. Eligible market
readers see aggregated prices and remaining quantities from open or partially
filled orders that meet the same signed admission and current-authority checks
as foreign matching. Unjournaled, stale-domain, unverified-wallet and inactive-owner
orders do not advertise market liquidity. Quotes use the same uniquely configured,
active settlement asset and live deployment as new orders; absent or ambiguous
configuration suppresses quotes. These quotes are a snapshot, not a
reservation or a guarantee that a submitted order will match.
The bounded create service can match
across accounts after authorizing the caller's exact submission. A foreign
candidate needs a recorded signed create admission with the current wallet,
account, token and chain identity and the same payment asset. Its wallet must
still be verified and on EVM, with an active account owner. The matcher locks
one compatible candidate's wallet and account/profile/user authority and only
that incoming/candidate order pair without waiting. Each attempt uses a savepoint;
an unrepresentable settlement releases that candidate's locks before a fallback.
Candidates stream in database priority order in batches of 100, with no whole-book
Python sort or match list.
A busy or concurrently changed candidate returns a retryable response, preserving the pending
submission UUID and rolling back execution effects. Unjournaled orders
retain their same-account behavior; they gain no cross-account matching authority.
Both participants still approve and sign the captured settlement before execution.

Deliberate new orders receive account-scoped submission UUIDs. Cancel and modify
actions use separate action UUIDs. Retries retain those identities; equal terms
do not make two deliberate actions the same action. Immutable intent and recorded
outcomes survive changes to the current order. An inaccessible or missing recovery
lookup never proves that an earlier request failed to commit.

Matching captures settlement domain, exact signed values and participant context.
New signatures and approvals recheck a current authorized participant against
that context. The completing signature, original execution admission and recovery
job commit together. Recovery journals signed bytes and a shared signer nonce
before sending; receipt I/O stays outside locks. A verified receipt updates the
private execution evidence while the swap and its financial reservations remain
pending for finality. The same sweep settles the swap once its network's approved
finality policy is satisfied and the inclusion re-verifies: a successful swap
completes and its parents keep their fill, a final revert releases the
reservation once, and anything unknown, waiting or orphaned holds. Local chains
hold until an explicit depth override is configured.

The expiry sweep releases only matches whose eligibility marker and recorded
state prove they have no execution claim or competing reservation. Legacy,
claimed or inconsistent matches remain retained for reconciliation. A missing
receipt, age or nonce use alone cannot release a reservation.

Current swap policies are installed; their existence does not complete every
settlement, reservation or signer guarantee. See [tenancy](tenancy.md) for access
boundaries and the [Phase 0 residuals](https://github.com/Ledova/ledova/issues/646)
for scope.

## Protocol detail

- [Create, cancel and modify protocols](../reference/order-submissions.md):
  canonical values, client persistence, replay and compatibility behavior.
- [Swap settlement](../reference/swap-settlement.md): captured identity,
  approval attribution, execution locking and unresolved outcomes.
- [Recovery](../operations/recovery.md): operator response to pending work.

## Accepted experimental limits

The owner accepted these limits for the experimental version in
[#646](https://github.com/Ledova/ledova/issues/646#issuecomment-5745382310):

- The Redis event stream uses after-commit publication and has no transactional
  outbox or exactly-once delivery guarantee. Live updates may be missed until
  refresh; recovery of database state does not guarantee an event was delivered.
- Concurrently created crossing orders can both remain unmatched. No background
  sweep matches a crossed book.
- Editing an order does not run matching again.

These are accepted boundaries of this version, not scheduled work. The separate
[owner direction on bounded cross-account matching](https://github.com/Ledova/ledova/issues/646#issuecomment-5745448042)
preserves private-order visibility.
