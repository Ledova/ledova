# Secondary trading

[Architecture](README.md) · [Product scope](../product.md)

The secondary market has order, matching and settlement code, but trading stays
disabled by default pending the remaining hardening work. `trading_enabled`
middleware refuses every method under `/api/v1/trading/orders/`, `wallets/`,
`transfers/`, `swaps/` and `events/`. The read-only token market and whitelist
status sit outside those prefixes. Enabling the flag does not establish safety.

## Intent and settlement

Deliberate new orders receive account-scoped submission UUIDs. Cancel and modify
actions use separate action UUIDs. Retries retain those identities; equal terms
do not make two deliberate actions the same action. Immutable intent and recorded
outcomes survive changes to the current order. An inaccessible or missing recovery
lookup never proves that an earlier request failed to commit.

Matching captures settlement domain, exact signed values and participant context.
New signatures and approvals recheck a current authorized participant against
that context. Execution claims the current swap before preparing or sending;
receipt I/O stays outside locks, and outcomes recheck the durable claim.

The expiry sweep releases only matches whose eligibility marker and recorded
state prove they have no execution claim or competing reservation. Legacy,
claimed or inconsistent matches remain retained for reconciliation. A missing
receipt, age or nonce use alone cannot release a reservation.

Current swap policies are installed; their existence does not complete every
settlement, reservation or signer guarantee. See [tenancy](tenancy.md) for access
boundaries and the [roadmap](../roadmap.md#phase-4--secondary-transfers) for scope.

## Protocol detail

- [Create, cancel and modify protocols](../reference/order-submissions.md):
  canonical values, client persistence, replay and compatibility behavior.
- [Swap settlement](../reference/swap-settlement.md): captured identity,
  approval attribution, execution locking and unresolved outcomes.
- [Recovery](../operations/recovery.md): operator response to pending work.

The Redis event stream uses after-commit publication and has no transactional
outbox or exactly-once delivery guarantee. Recovery of database state does not
guarantee an event was delivered.
