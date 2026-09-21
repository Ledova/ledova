# Register of members

[Architecture](README.md) · [Issuance](contracts-and-issuance.md)

The current-members register of one share class is its stored register.
[register.py](../../backend/tokens/services/register.py) serves the stored
holdings with each member's linked wallets and the identity and allotment
records, and reads no chain. Former members are stored separately.

The [stored register foundation](../operations/register-foundation.md) adds member
references with durable wallet links, immutable events and a holdings projection
for #647. An [approved opening capture](../operations/register-foundation.md#approved-opening-capture-and-wallet-links)
initialises it from one verified canonical chain boundary under documentary
authority, and the integrity verifier replays the whole chain. A wallet the
opening did not map is linked to a member only by a
[reviewed link request](../operations/register-foundation.md#reviewed-wallet-links-after-the-opening)
carrying the same authority.
Opening review and an operator report classify completed effects against that
boundary from evidence both sides record: each completion's
finalized receipt, and the canonical transfer history the boundary retains. A
completion is represented by the opening only when its transaction is in that
history; one in a later block falls after it; anything the evidence cannot place,
including an earlier inclusion that was orphaned and every completion against a
boundary [captured before that history was retained](../operations/register-foundation.md#openings-captured-before-the-history-was-retained),
is held for operator attribution. An opening whose captured boundary does not
represent a completed effect is refused rather than applied over it. Settlement
completion takes the same share-class lock as issuance completion, so neither can
interleave with an opening. Each completion after the opening is
[recorded as an issue or transfer](../operations/register-foundation.md#recording-issues-and-transfers-after-the-opening)
in its own completion transaction, in chain order; recording waits, without
stalling the completion, at the first effect whose wallet has no link or which
needs attribution.

Owner-submitted [compensating corrections](../operations/register-foundation.md#reviewed-compensating-corrections)
now bind documentary authority to an exact reversal and register revision.
Permitted staff review and application commit together, retaining the original
entry and private evidence. An applied correction changes the stored holdings
the reads below serve; it performs no chain reconciliation.

## Membership and identity

A row is one member with a positive stored holding. Its balance is that holding
and its percentage divides it by the register's issued supply, both maintained
by the stored events, so a read needs the database and no chain. A share class
whose register has no opening has no rows and reports `initialized: false`; an
opened register with no holdings reports `initialized: true` and no rows.

A row lists every wallet linked to the member in the company, and a member can
have none. Identity follows each wallet's whitelist entry through wallet,
account and profile, in bounded address chunks. Holder types are:

| Type | Meaning |
| --- | --- |
| `member` | The wallets resolve to one profile, or through resolved identity stamps from allotment to one person |
| `treasury` | The wallets resolve to one bare whitelisted treasury address with a label |
| `ambiguous` | The wallets resolve to different people, live or through their stamps, or one of them to more than one wallet or entry |
| `unidentified` | No wallet resolves to an identity |

Live identity is preferred. A member with no live identity can fall back to the
latest resolved identity stamp among its wallets' completed allotments. Resolved
stamps that differ in name or residential address make the member `ambiguous`,
as live identities that differ do. The row names the source and stamp date; a
name without a resolved stamp remains unidentified. Old unstamped issuances are
not backfilled by guessing identity.

Allotments to the member's wallets provide consideration, not membership. Amount
paid is shown only for a holding that transfers have not touched and that is
still its paid allotments: every share is subscribed, subscribed quantity equals
the stored balance, and the subscription's `money_backing_shares` supports the
shares printed. A recorded transfer naming the member touches it, and so does a
folded cessation of one of its wallets from its first allotment to the opening.
A transfer before the opening that emptied none of its wallets and left its
quantity unchanged cannot be seen. Unallotted subscriptions, unsubscribed
holdings and quantity mismatches also leave it blank. A pending refund must not
inflate consideration; zero must not stand in for an unknown value.

Date entered is the stored holding's: the effective date of the event that took
the member from no shares to some. The earliest completed allotment to one of
the member's wallets replaces it only when that allotment is earlier and the
holding has been continuous since: the opening carried the member in, no later
entry took it to no shares, and the fold recorded no cessation of one of its
wallets from the allotment's date to the opening's. Otherwise a member the
opening carried in shows the opening's date, as one who held only through
transfers before the opening does.

A cessation counts in these two rules once the fold has read it; the
former-member section states how far the fold has read.

## API and export

`GET /api/v1/tokens/{uuid}/holders/` returns whether the register is
initialised, current members with their wallets, the stored issued supply, the
number of completed effects still waiting to be recorded, and former members
with their fold freshness. Both this route and
`GET /api/v1/tokens/{uuid}/register/export/` are issuer-scoped, and the export of
a register with no opening is refused with 409 `register_not_initialized`. The
current-member API omits residential addresses, but former-member rows include
them. Each read of an opened register takes its head, issued supply, holdings,
waiting count and former members from one database snapshot, so an entry
recorded during the read cannot make them disagree.

A completed issue or transfer after the opening waits while its wallet has no
link or an earlier effect waits; see
[recording](../operations/register-foundation.md#recording-issues-and-transfers-after-the-opening).
A waiting effect is counted, not included in any holding, so a register with
waiting effects is behind the chain until they are recorded. A count that cannot
be computed is `null` in the API and `unknown` in the CSV.

The CSV has three sections with different widths:

1. Current members: Member ID, Name, Residential address, Wallet addresses,
   Holder type, Class, Shares held, Percentage of issued supply, Balance source,
   Identity source, Date entered, Whitelist status and Amount paid. A member's
   wallets, and each wallet's whitelist status, are joined with `; `.
2. Supply summary: issued supply, the total held by listed members and, when
   there are any, the completed effects waiting to be recorded.
3. Former members: retained particulars, cessation and fold freshness.

Read sections by their headers rather than assuming one width or column index.
`csv_cell` neutralizes formula-opening user values. An export logs requesting
user ID and row count; there is no durable, queryable export audit model yet.
See the [stored-register work](https://github.com/Ledova/ledova/issues/647).

The company shareholder tile counts distinct completed allotment addresses and
does no chain read. Operator identity queues also use allotment addresses and
apply no identity-stamp fallback. They can include former holders and miss
transfer-only holders; neither is a substitute for the register.

## Former members

`former_holders.py` folds `Transfer` history through the provider's finalized
block and records cessations in `FormerHolder`. Particulars are frozen at first
recorded cessation: current profile at recording, otherwise an allotment stamp
no later than cessation, otherwise unknown. Refolding does not rewrite them.

The fold sees wallets, not members. A cessation whose wallet is linked to a
member who currently holds shares of the class is left out of the former
members, in the API and the CSV, because that member is listed as current: a
member who empties one linked wallet into another records nothing in the stored
register, yet the fold sees that wallet cease. The same rule hides a linked
wallet's cessation for a member who ceased and later holds again, for as long
as they hold. The rows left out are kept, and still count against that member's
date entered and amount paid.

Each class fold is all-or-nothing. Failure leaves its last successful timestamp
and block unchanged and does not stop processing other classes. The register
marks a fold older than 24 hours, or one never completed, stale. GET never folds;
only successful background work clears that marker.

The retention floor and clock are documented in
[retention settings](../operations/uploads.md#data-retention). Purged former rows
cannot be recreated by a later full-history fold. Only the company owner and
operator read them; the application role cannot write them. Pre-platform former
members cannot be reconstructed from the chain, and no import exists.

## Deletion protection

The register spine is `Company -> ShareToken -> {ShareIssuance,
ShareIssuanceRequest, CapitalIncreaseRequest, Offering, TransferOrder}`. Those
relations and `SwapOrder.share_token` use `PROTECT`. Subscription links to its
offering, account and wallet are also protected.

API company/share-class deletion returns 409 where records must remain.
`contract_address`, not deployment status, identifies a class that has been on
chain; a paused class still carries its register. Delist a company with on-chain
classes. Delete draft classes before deleting a company containing only drafts;
a company with no classes is deletable. Admin removal of test data still respects
protected relations.

Company documents and registry-check history are application evidence rather
than register membership rows. Wallet deletion still cascades its whitelist
entry; durable [whitelist commands](outgoing-signing.md#whitelist-changes)
retain their original identity independently. Allotment identity stamps preserve
the member identity where one was resolved when shares were issued. Treasury relabeling or current profile guesses
must not replace that historical source.

Next: [legal positions](../legal/positions.md), [scheduled folds](../operations/jobs.md)
and [operator recovery](../operations/recovery.md).
