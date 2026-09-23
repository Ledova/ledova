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
authority, and the integrity verifier replays the whole chain. For a class not
yet on chain, an applied
[import](../operations/register-foundation.md#importing-an-existing-register)
is the opening instead: it records the company's existing register as the
opening entry, checked against the ASIC extract's figures, and captures no chain
boundary, so nothing is recorded, waiting or reconciled for that class until it
is on chain. A wallet the
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
in chain order, in its own completion transaction unless something holds it back;
recording waits, without stalling the completion, at the first effect whose wallet
has no link, which needs attribution, or which no applied register instruction
covers.
An issue or transfer entry is dated the day it is made, so one that waited
carries the later date; the register refuses one dated before its latest entry.

An issue is approved only under a
[register instruction](../operations/register-foundation.md#register-instructions-for-issues):
the company owner lists the exact issuance requests, and offering subscriptions
for allotments, that a named director approved, with staff-verified documentary
authority, and staff review it. Applying it approves each listed request with the
reviewer, who becomes the issue entry's recorder, and allotment refuses a
subscription no applied instruction lists on its current terms. PostgreSQL keeps
instructions immutable, and keeps an issuance request's review decision and
reviewer out of the company's own connection. A class an import opened takes no
instruction until it is on chain, because nothing would record its issue or
transfer.

A settled transfer is entered only under a
[transfer instruction](../operations/register-foundation.md#register-instructions-for-transfers).
Directors decide after the settlement, so its entry waits for one: the
company owner lists the exact completed settlements a named director approved,
each with its seller, buyer and shares, under the same authority and review, and
staff refuse a director who is either party. Applying it records the transfers
that waited, still recorded by the transferor, whose signed order is the
instrument. A transfer the directors decline is not modelled: its settlement
keeps waiting and stays on the waiting list.

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
with their fold freshness. `GET /api/v1/tokens/{uuid}/register/waiting/` lists
those waiting effects in chain order, each with its wallets, shares and the
reason it waits. These routes and
`GET /api/v1/tokens/{uuid}/register/export/` are issuer-scoped, and the export of
a register with no opening is refused with 409 `register_not_initialized`. The
current-member API omits residential addresses, but former-member rows include
them. Each read of an opened register takes its head, issued supply, holdings,
waiting count and former members from one database snapshot, so an entry
recorded during the read cannot make them disagree.

A completed issue or transfer after the opening waits while its wallet has no
link, while no applied register instruction covers it, or while an earlier
effect waits; see
[recording](../operations/register-foundation.md#recording-issues-and-transfers-after-the-opening).
A waiting effect is counted, not included in any holding, so a register with
waiting effects is behind the chain until they are recorded. A count that cannot
be computed is `null` in the API and `unknown` in the CSV, and the waiting list
is `null` with it. A register an import opened has no boundary to classify
against: its count is 0 and its list empty while nothing has completed on chain
for the class, and both are `null` once something has. The count, the
[waiting list](../operations/register-foundation.md#the-issuers-waiting-list)
and recording walk the same classification, so the count is the list's length.

The CSV has three sections with different widths:

1. Current members: Member ID, Name, Residential address, Wallet addresses,
   Holder type, Class, Shares held, Percentage of issued supply, Balance source,
   Identity source, Date entered, Whitelist status and Amount paid. A member's
   wallets, and each wallet's whitelist status, are joined with `; `. A wallet's
   status is its approval for the class's company: Active, Expired once a
   recorded expiry has passed, Pending, Removed or Failed, or "Not approved for
   this company" when the wallet has an entry and no approval there.
2. Supply summary: issued supply, the total held by listed members, the
   completed effects waiting to be recorded when there are any, and the latest
   reconciliation with the chain, which for a class an import opened is
   `not on chain`.
3. Former members: retained particulars, cessation and fold freshness, which for
   a class an import opened is `not on chain` until the fold first reads it.

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

## Inspection copies

Section 173(3) requires a company to give a copy of its register within 7 days
after a proper request. Staff prepare it in admin, on the company's written
instruction, from the share class's **Register outputs** page; the
[runbook](../operations/register-foundation.md#preparing-an-inspection-copy)
has the steps. The page needs the register outputs change permission
(`tokens.change_registeroutput`), which opens nothing else: deploying or pausing
a class still needs share token change permission, and share token permissions
do not open the page. There is no API route. The company decides whether a
request is proper and hands the copy over.

[register_output.py](../../backend/tokens/admin/register_output.py) calls
`prepare_inspection_copy` in [register.py](../../backend/tokens/services/register.py),
which builds the register CSV above from one snapshot read with the export's own
code and adds a fourth section: the request date, the instruction's reference,
the recipient, the date the copy was produced, and whether that is more than 7
days after the request. `csv_cell` neutralises the entered text too.
Days are counted in Sydney's calendar. No state or territory capital's date is
ever ahead of Sydney's, so for a company elsewhere the late flag can err only
towards late, and a request dated that company's today is never refused as a
future date.
The flag counts calendar days and does not extend a limit that ends on a
weekend or public holiday, which also errs towards late.

Ledova keeps a fingerprint, not the file. Each copy is recorded in
`RegisterExport` as an `inspection_copy`, beside the fields every export
records, with the SHA-256 of the exact bytes served, the instruction's
reference, the request date, the recipient and the late flag, so the file and
its record agree. Database check constraints require an `inspection_copy` row
to carry all five and a `register_csv` row to carry none. A register with no
opening, a request date after today and a blank field are refused, and a
refusal records nothing. The records share the export records' update guard,
operator-only table and daily purge after the 2,557-day floor.

## Certificates

Section 1071H requires a company to have a certificate ready within 2 months
after an issue and within 1 month after a transfer is lodged. Staff prepare it
in admin, on the company's written instruction, from the share class's
**Register outputs** page, with the permission inspection copies use; the
[runbook](../operations/register-foundation.md#preparing-a-certificate) has the
steps. There is no API route. Ledova prepares the certificate unsigned and the
company executes it (owner decision, 22 September 2026).

`prepare_certificate` in [register.py](../../backend/tokens/services/register.py)
reads one entry of the class's own register, by its number, from one snapshot.
Only an issue or a transfer has a certificate. The PDF has a page for the member
the entry moved shares to, the allottee of an issue or the transferee of a
transfer, and for a transfer a balance certificate for the transferor when they
still hold shares after it. Pages are numbered from the entry, the moved shares
first, as 12-1 and 12-2, so no counter is kept. Each page shows the company, its
ACN, the share class, the member's name and residential address, the shares it
certifies, the member's holding in the class after the entry, and the entry's
number, date and hash, then an unsigned execution block. Holdings are replayed
from the entries up to and including the certified one, so a later entry does
not change them, and a balance certificate certifies that holding.

Names and addresses are the ones the register gives the member when the
certificate is prepared, resolved as in [membership and identity](#membership-and-identity),
not the ones current when the entry was made. A member whose wallets resolve to
different people, or who has no name or residential address on record, stops
the whole certificate, as do an entry that is not an issue or a transfer and a
number the class's register does not have. So does an entry a correction has
since reversed, and the refusal names the correction, so a certificate never
certifies shares the register has taken back. A refusal records nothing.

PyMuPDF renders each page from an HTML template in which every value is escaped,
so markup in a name prints as written, and it embeds the glyphs non-Latin names
need. It is imported only when a certificate is rendered;
[legal position 12](../legal/positions.md#12-pymupdf-an-agpl-runtime-dependency)
records its licence. The file carries no creation date or random identifier, so
preparing the same entry again gives the same bytes while the register, the
particulars and the PyMuPDF version stay the same.

Ledova keeps a fingerprint, not the file. Each certificate is recorded in
`RegisterExport` as a `certificate`, whose register sequence is the certified
entry's and whose member rows count its pages, with the SHA-256 of the exact
bytes served and the instruction's reference. A database check constraint
requires the digest, the instruction and one or two pages, and allows no former
rows and none of an inspection copy's request fields. The records share the
export records' update guard, operator-only table and daily purge after the
2,557-day floor.

## Notice figures

A company notifies ASIC of a share issue within 28 days (s254X), and a
proprietary company notifies changes to its members and share structure with
that notice or otherwise within 28 days (s178A, s178C and s178D);
[legal position 6](../legal/positions.md#6-where-and-in-what-form-the-register-is-kept)
lists these obligations. Staff prepare the figures for those notices in admin,
on the company's written instruction, from the share class's **Register
outputs** page, with the permission the other outputs use; the
[runbook](../operations/register-foundation.md#preparing-notice-figures) has
the steps. There is no API route. The company decides which notices the figures
support and lodges them: Ledova prepares figures, not a notice, and names no
ASIC form.

`prepare_notice_figures` in [register.py](../../backend/tokens/services/register.py)
reads, from one snapshot, the class's stored register and every issue, transfer
and correction entry whose effective date is on or after the first day of the
period, up to the register head. The opening is never listed. The CSV has four
sections, each after a heading row:

1. Identification: what the figures are for, the share class, the first day of
   the period, the register entry the figures run to (the head's sequence), the
   instruction's reference and the day they were produced.
2. Entries in the period: a row for each member an entry changed, in entry
   order, with the entry's number, kind and effective date, the entry a
   correction reverses, the member's ID and name, the signed change in shares
   and, for an issue, the amount paid.
3. The class at the register head: the issued supply, the number of members
   holding shares and the total amount paid.
4. The members those entries changed, in member-ID order, at the register head:
   name, residential address, shares held, 0 for a member who no longer holds
   any, and amount paid.

An issue's amount paid is the money backing of the issuance the entry recorded,
established as the register's Amount paid column establishes it; a member's is
the register's own, as [membership and identity](#membership-and-identity)
describes. Either reads `not recorded` where it is not established exactly,
never zero, and so does the class total unless every current member's amount
paid is established. A transfer or correction carries none. Names and addresses
are the ones the register gives when the figures are prepared; a member whose
wallets resolve to different people, or who is unidentified, is printed as the
register prints them rather than refused. Counts, entry numbers and changes are
written as plain numbers, so a negative change reads as one; every other value
goes through `csv_cell`, which puts a leading apostrophe before text that opens
with a formula character.

Days are counted in Sydney's calendar, as for inspection copies. A register with
no opening and a period starting after today are refused, and a refusal records
nothing. A period with no entries is not refused: its sections list none.

Ledova keeps a fingerprint, not the file. Each preparation is recorded in
`RegisterExport` as `notice_figures`, whose register sequence is the head's and
whose member rows count the changed members, with the first day of the period,
the instruction's reference and the SHA-256 of the exact bytes served. A
database check constraint requires the digest, the instruction and the period,
and allows no former rows and none of an inspection copy's request fields; a
second allows a period on no other kind. The records share the export records'
update guard, operator-only table and daily purge after the 2,557-day floor.

## Outputs due

The **Register outputs due** page shows staff every certificate and set of notice
figures still due across all share classes, with a link to the page that
prepares each for its class; the
[runbook](../operations/register-foundation.md#working-the-due-list) has the
steps. It is linked from the **Register outputs** list and needs the same
permission. `outputs_due` in [register.py](../../backend/tokens/services/register.py)
derives the list from one snapshot of the register entries, their settlement
orders and the export records, ordered by due date, then company, class and
entry number:

- **Certificates.** Each issue or transfer entry that no correction has reversed
  is listed until a `certificate` record of its class names its number. An issue
  is due two calendar months after its effective date. A transfer is due one
  calendar month after its settlement order, the swap order the entry records,
  was created, by Sydney's date; the order precedes the transfer's lodgement, so
  the date errs early.
- **Notice figures.** Each issue entry, and each transfer entry of a proprietary
  company, that no correction has reversed is listed until a `notice_figures`
  record of its class covers it: one whose period starts on or before the
  entry's effective date and that runs to the entry's number or later. It is due
  28 days after the effective date.

A calendar month ends on the same day number, or on the month's last day when
that month is shorter, so 31 January plus one month is 28 or 29 February. An
item is overdue once its due date is before today in Sydney's calendar. Openings
and corrections are never listed.

The list stores and records nothing, and knows what Ledova prepared, not what the
company lodged or delivered. An output the company produced elsewhere, or a
certificate it does not need, stays listed, and an entry whose record the daily
purge has removed after the 2,557-day floor is listed again.

## Reconciliation

[register_reconciliation.py](../../backend/tokens/services/register_reconciliation.py)
compares the stored register with a fresh canonical chain snapshot every six
hours, for each class with an applied opening; a class an import opened has none.
Every chain transfer after the opening must be accounted for by a recorded
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
`ImportedFormerMember` rows. Each ceased before a chain opening, or by the
register date of an import that is the opening. The holders API and
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
entry and that entry's company approvals, and leaves the approval on chain; durable [whitelist commands](outgoing-signing.md#whitelist-changes)
retain their original identity independently. Allotment identity stamps preserve
the member identity where one was resolved when shares were issued. Treasury relabeling or current profile guesses
must not replace that historical source.

## Publications to members

A [shareholder publication](shareholder-publications.md) is the first
member-readable projection of the register: its roll is resolved once from the
stored register at a record date and frozen, carrying the same four holder types
and the same refusal to name a member the register cannot name. It reads the
register and never writes to it.

Next: [legal positions](../legal/positions.md), [scheduled folds](../operations/jobs.md)
and [operator recovery](../operations/recovery.md).
