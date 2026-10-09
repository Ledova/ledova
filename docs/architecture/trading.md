# Secondary trading

[Architecture](README.md) · [Product scope](../product.md)

The secondary market has order, matching and settlement code, and trading is
enabled by default. `trading_enabled`
middleware refuses every method under `/api/v1/trading/orders/`, `wallets/`,
`swaps/` and `events/` when the flag is off, and an operator can
disable it per deployment in Django admin. The read-only token market and
the per-share-class whitelist status sit outside those prefixes. The flag does not establish
safety: releases require the human checks in
[#624](https://github.com/Ledova/ledova/issues/624), and operation with real
participants follows the [regulatory pathway](../regulatory-pathway.md).

## Company decisions alongside trading

The secondary protocol settles in a configured stablecoin from pre-funded
wallets; an AUD price or AUDY balance is not a direct AUD payment method, and
new settlement work is deferred ([#869](https://github.com/Ledova/ledova/issues/869)).
Company eligibility decisions and company wallet approvals feed the checks below
through the delivered company workflows. A company appointment confers no access
to investors' private orders and no authority to sign for their wallets, and a
settled transfer still enters the register through a staff-reviewed director
instruction until #869. `trading_enabled` is an operations switch, not a product
mode.

## Intent and settlement

Private orders remain visible and editable only to their owners; staff see every
order and settlement read-only in the admin
([the market pages](../operations/operator-console.md#the-market)). Eligible market
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
Creating an order and signing a swap both require the acting party to hold a
current [eligibility decision](companies-and-eligibility.md#participant-eligibility)
from the share class's company, in addition to the wallet, registry and balance
checks. Either party may relay the other's captured signature, so the check
follows the signature rather than the caller: the account that signed must hold
the decision, not whoever submits it. A party whose decision lapses or is
revoked between the two keeps their signature but cannot add another, and the
share token itself refuses the settlement.

Deliberate new orders receive account-scoped submission UUIDs. Cancel and modify
actions use separate action UUIDs. Retries retain those identities; equal terms
do not make two deliberate actions the same action. Immutable intent and recorded
outcomes survive changes to the current order. An inaccessible or missing recovery
lookup never proves that an earlier request failed to commit.

Owned order lists and details retain rows when the current share class becomes
inaccessible. They display the visible class identity where available, otherwise
the recorded create-admission identity. Legacy orders without that record return
explicit null names, symbols and contract addresses. Search includes visible
class identity and the owner's recorded admission identity. Pending swaps retain
their recorded V1 display; inaccessible legacy class names and symbols are null.
These reads preserve the existing order and wallet ownership checks and do not
make a hidden class public or authorize a new trading action.

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
hold until an explicit depth override is configured. Once a swap completes, both
parties' share and settlement-asset holdings are written from the chain, as
[wallets](wallets-and-valuations.md#a-share-holding-names-its-class) describes.

Selling reads the chosen wallet's balance of every deployed class and of the
settlement asset from the chain (`GET /api/v1/trading/wallets/balances/`). A
class or the settlement asset is left out of the answer only when its call
returns no data and the node, asked again at once, reports the configured chain
(`eth_chainId`) and no contract code at that address (`eth_getCode`): nothing is
deployed there. That is logged with its symbol and address, and the wallet's
other classes can still be sold. Every other failure answers 503 rather than a
partial list that would say the wallet holds nothing: a node that cannot be
reached or does not answer in time, any JSON-RPC error (web3 reports some, rate
limits and internal errors among them, as contract errors), a revert, a node on
another chain, missing return data where the address has code, and a check that
cannot be made.

The expiry sweep releases only matches whose eligibility marker and recorded
state prove they have no execution claim or competing reservation. Legacy,
claimed or inconsistent matches remain retained for reconciliation. A missing
receipt, age or nonce use alone cannot release a reservation.

Current swap policies are installed; their existence does not complete every
settlement, reservation or signer guarantee. See [tenancy](tenancy.md) for access
boundaries and the [Phase 0 residuals](https://github.com/Ledova/ledova/issues/646)
for scope.

## One match, never crossed

An order takes one match at a time: once when it is placed, and once more each
time its current match settles with shares left over. While a match is pending
the whole order is out of the book, its remainder included. An order rests in
the book (`open` or `partially_filled`) only at a price that does not cross the
other side's listed orders, a bid at or above the best ask or an ask at or
below the best bid. Otherwise it is held back (`held`): it is not listed, no
other order matches it, it still counts against the wallet's balance, and its
owner can modify or cancel it. The rule applies wherever an order would rest:
when it is placed and nothing it crosses can take it (its own wallet's order, a
minimum fill it cannot meet), when its match settles with shares left, when its
match lapses or reverts, and when it is modified. A lapsed or reverted match
returns its two orders oldest first, so the order that was resting usually
rests again and the one that took it is held, since the two still cross.

Every minute `place_held_orders` gives each held order, oldest first, its next
single match by the same price and time priority as a new order, or lists it
once it no longer crosses and publishes `order_listed`, so both clients refresh
the book and the owner's orders. It never pairs two orders whose match already lapsed
or failed, because whoever did not sign would leave the new match to lapse
again, and an order awaiting signatures cannot be cancelled. A held order that
crosses only such an order, or only orders it cannot trade with, stays held
until they leave the book or its owner changes it. The investor sees the order
as `Held Back`, or `Partially Filled, Remainder Held Back` once part of it has
traded. The owner chose this rule on 2 October 2026
([decision](../decisions.md#payments-and-settlement)).

Each placement decides from the orders already committed, so two crossing
orders placed at the same moment can both come to rest. The same sweep then
reads each class's listed book and, while its best bid is at or above its best
ask, holds back the newer of the two and publishes `order_held`; the next sweep
gives that order its match like any held order. A book crossed this way is
uncrossed by the next minute's sweep, with no lock beyond the one order it
holds, taken without waiting; an order busy at that moment waits for the
following sweep.

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
- Two crossing orders committed at the same moment can both rest until the
  next minute's sweep holds back the newer of the two, because each placement
  sees only committed orders and no placement waits on another
  ([decision](../decisions.md#payments-and-settlement)). Every sequence of
  placements, settlements, lapses, modifications and cancellations leaves the
  book uncrossed.
- Editing an order does not run matching: an edit that would cross is held back
  and takes its match from the minute's sweep.

These are accepted boundaries of this version, not scheduled work. The separate
[owner direction on bounded cross-account matching](https://github.com/Ledova/ledova/issues/646#issuecomment-5745448042)
preserves private-order visibility.
