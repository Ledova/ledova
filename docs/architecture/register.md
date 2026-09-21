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
stalling the completion, at the first effect whose wallet has no link, which
needs attribution, or which is an issue no applied register instruction covers.

An issue is approved only under a
[register instruction](../operations/register-foundation.md#register-instructions-for-issues):
the company owner lists the exact issuance requests, and offering subscriptions
for allotments, that a named director approved, with staff-verified documentary
authority, and staff review it. Applying it approves each listed request with the
reviewer, who becomes the issue entry's recorder, and allotment refuses a
subscription no applied instruction lists on its current terms. PostgreSQL keeps
instructions immutable, and keeps an issuance request's review decision and
reviewer out of the company's own connection. Transfers are not yet instructed.

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

Live identity is preferred when it is present and unambiguous. A member with no
live identity can fall back to the latest resolved identity stamp among its
wallets' completed allotments. Resolved stamps that differ in name or residential
address make the member `ambiguous`, as live identities that differ do. The row
names the source and stamp date. Where neither resolves, particulars recorded by
an [import](../operations/register-foundation.md#importing-an-existing-register)
fill in: the member is a `member` named by its recorded name and residential
address, with the identity source "Recorded register particulars". Particulars
never replace a live identity or hide an ambiguous one (owner decision,
22 September 2026). Otherwise a name without a resolved stamp remains
unidentified. Old unstamped issuances are not backfilled by guessing identity.

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

An applied import's date entered replaces both rules for a member the opening
carried in whose holding has been continuous since, because a continuing
member's date entered does not change; later issues and transfers leave it in
place. The import's amount paid applies only while that holding is also
unchanged since the import. A member who entered through a later entry keeps the
date and amount the stored register gives.

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
link, while an issue has no applied register instruction, or while an earlier
effect waits; see
[recording](../operations/register-foundation.md#recording-issues-and-transfers-after-the-opening).
A waiting effect is counted, not included in any holding, so a register with
waiting effects is behind the chain until they are recorded. A count that cannot
be computed is `null` in the API and `unknown` in the CSV.

The CSV has three sections with different widths:

1. Current members: Member ID, Name, Residential address, Wallet addresses,
   Holder type, Class, Shares held, Percentage of issued supply, Balance source,
   Identity source, Date entered, Whitelist status and Amount paid. A member's
   wallets, and each wallet's whitelist status, are joined with `; `.
2. Supply summary: issued supply, the total held by listed members, the
   completed effects waiting to be recorded when there are any, and the latest
   reconciliation with the chain.
3. Former members: retained particulars, cessation and fold freshness.

Read sections by their headers rather than assuming one width or column index.
`csv_cell` neutralizes formula-opening user values. Each export is recorded in
`RegisterExport` once its rows are built: the requester's ID, the share class,
the kind, the stored register sequence exported, the current- and former-member
row counts, and the time. A refused or failed export records nothing, and the
route refuses `HEAD`, which would record a sheet it never sends. The records are
kept for staff: the table is operator-only, so no issuer or customer route reads
it, and operators query it in admin. Records cannot be rewritten. The daily
former-member purge removes them after the same
[2,557-day floor](../operations/uploads.md#data-retention).

The company shareholder tile counts distinct completed allotment addresses and
does no chain read. Operator identity queues also use allotment addresses and
apply no identity-stamp fallback. They can include former holders and miss
transfer-only holders; neither is a substitute for the register.

## Reconciliation

[register_reconciliation.py](../../backend/tokens/services/register_reconciliation.py)
compares the stored register with a fresh canonical chain snapshot every six
hours. Every chain transfer after the opening must be accounted for by a recorded
effect, a waiting effect or an in-flight platform operation. Holdings and supply
must equal the stored ones plus those pending movements. Each run is retained as
`matched`, `discrepant` or `failed`; a chain failure fails the reconciliation,
never the register. A transfer of zero shares is ignored. Staff can acknowledge
an investigated divergence, one row at a time with a reason, in an append-only
record only the operator writes; later runs treat it as explained. The
[runbook](../operations/register-foundation.md#reconciling-with-the-chain) lists
the discrepancies and what each asks of an operator.

## Former members

`former_holders.py` folds `Transfer` history through the provider's finalized
block and records cessations in `FormerHolder`. Particulars are frozen at first
recorded cessation: current profile at recording, otherwise a resolved allotment
stamp no later than cessation, otherwise the particulars an import recorded for
the member the wallet is linked to, otherwise a name recorded at allotment,
otherwise unknown. Refolding does not rewrite them.

The fold sees wallets, not members. A cessation of a wallet linked to a member
who currently holds shares of the class is left out of the former members, in
the API and the CSV, only when it falls on or after that member's date entered:
the member held throughout, and emptying one linked wallet into another records
nothing in the stored register even though the fold sees that wallet cease. A
cessation before the member's date entered stays listed, because the member
ceased and holds again, and s169(3) keeps that cessation on the register. Before
the opening the fold cannot tell a wallet rotation from a cessation, so such a
rotation stays listed as well, the recoverable direction. An imported date
entered does not move that line: the comparison uses the date the stored register
and allotments give. The rows left out are kept, and still count against that
member's date entered and amount paid.

Each class fold is all-or-nothing. Failure leaves its last successful timestamp
and block unchanged and does not stop processing other classes. The register
marks a fold older than 24 hours, or one never completed, stale. GET never folds;
only successful background work clears that marker.

The retention floor and clock are documented in
[retention settings](../operations/uploads.md#data-retention). Purged former rows
cannot be recreated by a later full-history fold. Only the company owner and
operator read them; the application role cannot write them. Pre-platform former
members cannot be reconstructed from the chain; an import records them as
`ImportedFormerMember` rows. Each ceased before the opening. The holders API and
the CSV list them beside the folded ones, from the same snapshot, with no wallet
address or block, and the same daily job purges them from their date ceased.

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
