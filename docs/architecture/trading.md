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

The Redis event stream uses after-commit publication and has no transactional
outbox or exactly-once delivery guarantee. Recovery of database state does not
guarantee an event was delivered.
