# Register of members

[Architecture](README.md) · [Issuance](contracts-and-issuance.md)

The current-members register of one share class is its stored register for the
platform's ownership mirror. The company's legal records remain its source;
the [mirror decision](../decisions.md#existing-register-mirror-and-simple-setup)
leaves statutory history, lawful access arrangements and filings with the company.
[register.py](../../backend/tokens/services/register.py) serves the stored
holdings with each member's linked wallets and the identity and allotment
records, and reads no chain. Former members are stored separately.

## Who runs what

Openings, imports, corrections, wallet links, members' particulars,
[non-paid grants](../plans/company-managed-registers/register-grants.md),
[transfers](../plans/company-managed-registers/register-transfers.md),
[employee awards and vesting records](../plans/company-managed-registers/employee-awards.md),
[external capital and allotments](../plans/company-managed-registers/external-allotments.md),
reconciliation acknowledgement and inspection copies are company-run through
current appointments, with company-provided evidence. An award is a promised
entitlement recorded at `/api/v1/tokens/register-awards/` and
`register-award-vestings/`; shares reach the register only through a separate
approved grant that references it. An allotment at
`/api/v1/tokens/register-allotments/` keeps the external agreement, the
company's receipt attestation and the approved allotment as separate records,
and its application makes one ISSUE entry on an opened imported register.
Company readers prepare unsigned certificates and administrators prepare
complete imported/non-tokenised core packs; members receive only their own
retained certificate ([outputs](../plans/company-managed-registers/register-outputs.md)).
Platform staff still review settled-transfer instructions and prepare notice
figures and broader restricted packs on the company's written instruction.
`RegisterMember` is a shareholder record, not an appointment. An imported class
opens without a contract and accepts no chain issue or transfer instruction:
its grants, allotments and transfers are ledger events, a wallet is required
only for a chain action, and later tokenisation mirrors its holdings without
issuing them twice. Publications require a deployed or paused class until #870.

A register is opened once: by a company-run
[opening](../operations/register-foundation.md#opening-the-register-from-the-chain)
from one verified canonical chain boundary captured when the company prepares
it, or by an applied
[import](../operations/register-foundation.md#importing-an-existing-register),
which records the company's existing register as the opening entry and captures
no chain boundary. A wallet the opening did not map is linked to a member only
by a company-run [wallet link](../operations/register-foundation.md#linking-wallets-after-the-opening).
Completed chain effects are classified against the boundary from the
completion's finalized receipt and the canonical transfer history the boundary
retains: one in that history is represented by the opening, one in a later block
falls after it, and anything the evidence cannot place is held for operator
attribution. An opening whose captured boundary does not represent a completed
effect is refused. Settlement completion takes the same share-class lock as
issuance completion, so neither interleaves with an opening.

Each completion after the opening is
[recorded as an issue or transfer](../operations/register-foundation.md#recording-issues-and-transfers-after-the-opening)
in chain order, in its own completion transaction. Recording stops at the first
effect it cannot record: a wallet with no link, an issue or transfer no applied
instruction covers, a completion held for attribution, or an entry the register
refuses, such as a transfer whose seller's stored holding does not cover it
after a move outside settlement. Nothing is recorded past that effect, so the
stored holdings never skip ahead of the chain. The completion itself still
commits, because a register record must not stall the workflow; the reason is
logged. Recording resumes at the next completion in that share class, the next
applied wallet link in the company or the next applied register instruction for
that share class, each of which takes the share-class lock first (a wallet link
every class of its company), so a completion in progress cannot miss the new
link or cover. `register_inclusions` reports `recorded` for each effect. An
issue or transfer entry is dated the day it is made, so one that waited carries
the later date, and the register never dates one before its latest entry: while
the latest entry is dated after today, as with an opening whose boundary block's
time runs ahead of the platform's clock, the next issue or transfer waits as
`refused` until a recording on or after that date.

A company-authorised [non-paid chain grant](../plans/company-managed-registers/company-register-issues.md)
mints on a CHAIN-opened class, and only the finalised mint supplies the member's
once-only ISSUE entry. A [paid issue](../plans/company-managed-registers/company-paid-issues.md)
binds the company's preparation, approval and application to a recorded PAID
subscription and records its ISSUE once the wallet link exists; payment,
approval, mint and register recording remain separate. A settled transfer is
entered only under an applied
[transfer instruction](../operations/register-foundation.md#register-instructions-for-transfers)
listing the completed settlements a named director approved, still recorded by
the transferor, whose signed order is the instrument; a transfer the directors
decline keeps waiting. Company-run
[compensating corrections](../operations/register-foundation.md#compensating-corrections)
reverse one earlier entry exactly, retaining the original entry and evidence; an
applied correction changes the stored holdings and performs no chain
reconciliation.

## Event chain

A register belongs to one share class. Its first entry records the opening
state, including an explicitly empty state, and later entries are:

| Kind       | Effect                                                        |
| ---------- | ------------------------------------------------------------- |
| Issue      | Add a positive whole-share quantity to one member             |
| Transfer   | Subtract from one member and add the same quantity to another |
| Cessation  | Remove a member's entire holding in this class                |
| Correction | Compensate every quantity in one earlier entry exactly        |
| Mirror correction | Record the exact difference from a reviewed opening snapshot, retaining earlier copied records |

A transfer that empties a holding leaves a zero position; a cessation describes
the class holding, not membership across the company's other classes. A
correction can itself be compensated, but each original entry can be
compensated only once and no change can make a position negative. Recording a
cessation or correction burns, seizes or transfers nothing on chain. General
partial corrections and replacement transactions are not built. A bounded
mirror-opening correction retains the earlier copied snapshot and records the
exact difference under a fresh company confirmation, refusing later share,
deployment or member-access activity. A correction of copied particulars alone
keeps the event head unchanged and is retained in its snapshot and decisions.

PostgreSQL locks the register head, validates the event and member company,
assigns the next sequence, hashes the event with its predecessor and updates the
holdings and issued supply in the same transaction. Quantities are exact
integers bounded by the unsigned 256-bit range. A repeated operation UUID with
the same instructions returns its original entry; changed instructions
conflict. Entry payloads admit only member UUIDs and share changes, never names
or residential addresses. Triggers refuse entry and member rewrites and deletes,
and holdings or head writes outside event projection; the operator role has no
TRUNCATE privilege. The schema owner remains trusted: the hash chain is not an
externally anchored proof against a schema owner who rewrites the entire
history and every hash.

The hash input is a PostgreSQL JSONB array in this order: format marker
`ledova-register-v1`, entry UUID, register UUID, operation UUID, sequence,
kind, effective date, sorted changes, corrected-entry UUID, actor ID, previous
hash and creation time in UTC with microseconds. SHA-256 covers its UTF-8 JSONB
text; the first predecessor is 64 zeroes. `tokens_register_entry_hash` and
`tokens_register_entry_preimage`, installed from
`backend/tokens/database_guards.sql`, compute the digest and return the exact
text it covers; the [company pack](company-pack.md#hash-preimages) carries the
preimage beside each entry. Verification checks each digest and link, replays
positions and entry dates, and compares the resulting head and supply with
storage; an uninitialised head fails verification.

## Membership and identity

A row is one member with a positive stored holding. Its balance is that holding
and its percentage divides it by the register's issued supply, both maintained
by the stored events, so a read needs the database and no chain. A share class
whose register has no opening has no rows and reports `initialized: false`; an
opened register with no holdings reports `initialized: true` and no rows.

A row lists every wallet linked to the member in the company, and a member can
have none. Identity follows each wallet's whitelist entry through wallet,
account and profile, in bounded address chunks. Holder types are:

| Type           | Meaning                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `member`       | The wallets resolve to one profile, or through resolved identity stamps from allotment to one person                   |
| `treasury`     | The wallets resolve to one bare whitelisted treasury address with a label                                              |
| `ambiguous`    | The wallets resolve to different people, live or through their stamps, or one of them to more than one wallet or entry |
| `unidentified` | No wallet resolves to an identity                                                                                      |

Live identity is preferred when it is present and unambiguous. A member with no
live identity can fall back to the latest resolved identity stamp among its
wallets' completed allotments. Resolved stamps that differ in name or residential
address make the member `ambiguous`, as live identities that differ do. The row
names the source and stamp date. Where neither resolves, particulars recorded by
an [import](../operations/register-foundation.md#importing-an-existing-register)
or a company's [particulars change](../operations/register-foundation.md#changing-a-members-particulars)
fill in, from whichever is dated latest, or applied last of those sharing a
date: the member is a `member` named by its recorded name and residential
address, with the identity source "Recorded register particulars". The database
writes them only during the application of the import or change they name.
Particulars never replace a live identity or hide an ambiguous one (owner
decisions, 22 September and 5 October 2026). Otherwise a name without a resolved
stamp remains unidentified. Old unstamped issuances are not backfilled by
guessing identity.

A treasury label is not a live identity: it names a bare address and carries no
residential address. So a member held at a labelled treasury address, such as an
employee share trust, takes its recorded name and residential address from its
recorded particulars when it has them, with the identity source "Recorded
register particulars", and stays typed `treasury`. The CSV, the inspection copy,
certificates, the notice figures, the holders API and the publication roll all
read it that way, and so does the [former-member fold](#former-members) for a
treasury address that ceases. Without particulars the label still names it, with
no residential address. A treasury address beside another identity stays
`ambiguous`.

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

The web Company Register at `/company/register` reads every page of
`GET /api/v1/tokens/register/`, the share classes the signed-in person may read,
then the holders read below for each class of the selected company. It shows
current members and linked wallets, exact issued and authorised shares, unopened
registers and waiting-effect warnings. If any read fails, the page offers retry
and hides partial or stale register rows. It does not substitute wallet balances
for the stored register. Former members remain available in the register CSV,
downloaded from each class on Register or from the class page, and inspection
copies and unsigned certificates are prepared there too. Administrators obtain
supported core company packs there; notice figures and broader restricted packs
retain their staff workflow, as described below.

`GET /api/v1/tokens/{uuid}/holders/` returns whether the register is
initialised, current members with their wallets, the stored issued supply, the
number of completed effects still waiting to be recorded, and former members
with their fold freshness. `GET /api/v1/tokens/{uuid}/register/waiting/` lists
those waiting effects in chain order, each with its wallets, shares and the
reason it waits. `GET /api/v1/tokens/{uuid}/register/entries/` pages through the
recorded entries, newest first, each change naming its member as the register
does, with the links between an entry and the
[correction](../operations/register-foundation.md#compensating-corrections) that
reverses it. `GET /api/v1/tokens/register/` lists the share classes whose
register the caller may read, filterable by `company_uuid`. These routes and
`GET /api/v1/tokens/{uuid}/register/export/` admit the company owner and anyone
holding a current company appointment with `admin`, `read_register`, `prepare`,
`approve` or `apply`; preparing, approving or applying register changes means
working from the register's member particulars, so those capabilities read it
too. Other capabilities, delegation-only scope and staff or superuser status
grant none of them. `GET /api/v1/tokens/{uuid}/register/opening-holders/` is
narrower: it reads the chain holdings an
[opening](../operations/register-foundation.md#opening-the-register-from-the-chain)
must map for a class whose register is not opened, so only a current appointment
holding `admin` or `prepare` reads it. The export of a register with no opening is
refused with 409 `register_not_initialized`. The
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
`csv_cell` neutralises formula-opening user values. The export route refuses
`HEAD`, which would record a sheet it never sends.

The company shareholder tile counts distinct completed allotment addresses and
does no chain read. Operator identity queues also use allotment addresses and
apply no identity-stamp fallback. They can include former holders and miss
transfer-only holders; neither is a substitute for the register.

### Export records

Ledova keeps a fingerprint, not the file. Each output below is recorded in
`RegisterExport` once its bytes are built, with the requester's ID, the share
class, the kind, the register sequence exported, the current- and former-member
row counts and the time. A refused or failed output records nothing. Database
check constraints require each kind's own fields and refuse another kind's:

| Kind              | Sequence and rows                                    | Also records                                                                                                              |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `register_csv`    | The head; member rows as exported                    | Nothing more                                                                                                              |
| `inspection_copy` | The head; member rows as exported                    | SHA-256 of the bytes served, instruction reference, request date, recipient and late flag                                 |
| `certificate`     | The certified entry's; one or two pages              | SHA-256 of the bytes served and the instruction reference                                                                 |
| `notice_figures`  | The head's; the members the period's entries changed | SHA-256 of the bytes served, instruction reference and the first day of the period                                        |
| `company_pack`    | Each class's head, one row per class                 | SHA-256 of `manifest.json`, instruction reference and recipient ([company pack](company-pack.md#producing-and-recording)) |

Records cannot be rewritten. The table is operator-only, so no company or
customer route reads it and operators query it in admin. The daily
former-member purge removes records after the
[2,557-day floor](../operations/uploads.md#data-retention).

## Inspection copies

Section 173(3) requires a company to give a copy of its register within 7 days
after a proper request. Current exact-company appointees holding administration
or a register capability prepare it in the web/mobile **Register**
([company inspection copies](../plans/company-managed-registers/company-inspection-copies.md)).
Ownership and platform staff permissions supply no inspection-copy authority.
The company decides whether a request is proper and provides the copy.

[register_inspection_copies.py](../../backend/tokens/services/register_inspection_copies.py)
serves the company-authorised preview and generation behind the API. It calls
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

Each copy is recorded as an `inspection_copy` ([export records](#export-records)),
so the file and its record agree. A register with no opening, a request date
after today and a blank field are refused, and a refusal records nothing.
Preparation binds the exact appointment and a source fingerprint over the class,
sequence and base CSV bytes; generation refuses changed source or lost authority
and rechecks authority before committing the record. There is no staff
generation route.

## Certificates

Section 1071H requires a company to have a certificate ready within 2 months
after an issue and within 1 month after a transfer is lodged. Current company
readers prepare it through the Register's bounded certificate API on the
company's written instruction. The [output guide](../plans/company-managed-registers/register-outputs.md)
has the company preview and permitted member fulfilment steps. Ledova prepares
the certificate unsigned and the company executes it (owner decision,
22 September 2026). The routine staff preparation form is retired.

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

Each certificate is recorded as a `certificate` ([export records](#export-records)),
so the file and its record agree.

## Notice figures

A company notifies ASIC of a share issue within 28 days (s254X), and a
proprietary company notifies changes to its members and share structure with
that notice or otherwise within 28 days (s178A, s178C and s178D);
[legal position 6](../legal/positions.md#6-where-and-in-what-form-the-register-is-kept)
lists these obligations. Staff prepare the figures for those notices in admin,
on the company's written instruction, from the share class's **Register
outputs** page, with `tokens.change_registeroutput`; the
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

Each preparation is recorded as `notice_figures` ([export records](#export-records)),
so the file and its record agree.

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
never the register. A transfer of zero shares is ignored. A current company
appointment holding `admin` or `approve` acknowledges an investigated divergence
through the API, one row of the latest reconciliation at a time with a reason,
in an append-only record that keeps the earlier staff acknowledgements; later
runs treat each acknowledged row as explained. The
[runbook](../operations/register-foundation.md#reconciling-with-the-chain) lists
the discrepancies and what each asks.

## Former members

`former_holders.py` folds `Transfer` history through the provider's finalized
block and records cessations in `FormerHolder`. Particulars are frozen at first
recorded cessation: current profile at recording, otherwise a resolved allotment
stamp no later than cessation, otherwise the particulars recorded for the
member the wallet is linked to, otherwise a name recorded at allotment,
otherwise unknown. A labelled treasury address takes those recorded particulars
before its label. Refolding does not rewrite them.

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
cannot be recreated by a later full-history fold. Only the company owner,
current register appointees and the operator read them; the application role cannot write them. Pre-platform former
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

The API deletes neither a company nor a share class: both routes answer 405, so
a register is never removed through it. Delist a company that should close;
pause a class to stop transfers. Admin removal of test data still respects
protected relations.

Company documents and registry-check history are application evidence rather
than register membership rows. Wallet deletion still cascades its whitelist
entry and that entry's company approvals, and leaves the approval on chain; durable [whitelist commands](outgoing-signing.md#whitelist-changes)
retain their original identity independently. Allotment identity stamps preserve
the member identity where one was resolved when shares were issued. Treasury relabeling or current profile guesses
must not replace that historical source.

A [shareholder publication](shareholder-publications.md) freezes a roll from
this register at a record date and never writes to it, and a
[company pack](company-pack.md) carries every class's register, the decisions
behind its entries and their evidence copies.

Next: [legal positions](../legal/positions.md), [scheduled folds](../operations/jobs.md)
and [operator recovery](../operations/recovery.md).
