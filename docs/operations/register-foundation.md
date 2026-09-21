# Stored register foundation

[Operations](README.md) · [Register architecture](../architecture/register.md)

The first [#647](https://github.com/Ledova/ledova/issues/647) slices provide
company-scoped member references with durable wallet links, an append-only
share-event chain, stored holdings, an approved opening capture and reviewed
compensating corrections. It is a foundation for the authoritative register.
The HTTP and CSV register routes serve it once a share class's opening is
applied, and issuance and settlement then record each later completed effect in
it; opening review and the inclusion report classify completed effects against
the captured boundary, and a scheduled job reconciles it with the chain. Import
is still missing, so no real company's register may rely on it yet.

## Identity and events

A member has a UUID belonging to one company, independent of a wallet or platform
account. The owner chose this so imports can include walletless members and one
member can have multiple wallet links. Wallet links are durable insert-only
identity records created by the approved opening or a reviewed link request
below: one address resolves to
one member per company, and an existing link for a mapped address must agree
with the mapping. Retained personal particulars belong to later integration
work; the register routes name members from their wallets' identities and
allotment stamps. It never merges members
by matching names.

A register belongs to one share class. Its first entry records the opening state,
including an explicitly empty state. Subsequent event kinds are:

| Kind | Effect |
| --- | --- |
| Issue | Add a positive whole-share quantity to one member |
| Transfer | Subtract from one member and add the same quantity to another |
| Cessation | Remove a member's entire holding in this class |
| Correction | Compensate every quantity in one earlier entry exactly |

A transfer that empties a holding leaves a zero position. Cessation here describes
the class holding, not a conclusion about membership across the company's other
classes. Former-member recording remains on the existing path. A correction can
itself be compensated, but each original entry can be compensated only once and
no change can make a position negative. Partial corrections and general
replacement transactions remain later work; the reviewed evidence workflow for
corrections and openings is documented below. Recording a cessation or
correction does not burn, seize or transfer tokens on chain.

PostgreSQL locks the register head, validates the event and member company,
assigns the next sequence and hashes the event with its predecessor. It updates
the holdings and issued supply in the same transaction. Quantities are exact
integers bounded by the unsigned 256-bit range. A repeated operation UUID with
the same instructions returns its original entry; changed instructions conflict.

Entry payloads admit only member UUIDs and share changes. They contain no names
or residential addresses. Existing former-member retention and purge are
unchanged. Database triggers refuse entry/member rewrites and deletes, and
holdings/head writes outside event projection. The operator role has no TRUNCATE
privilege. The schema owner remains trusted and can alter database protections;
the hash chain is not an externally anchored proof against a schema owner who
rewrites the entire history and every hash.

The hash input is a PostgreSQL JSONB array in this order: format marker
`ledova-register-v1`, entry UUID, register UUID, operation UUID, sequence, kind,
effective date, sorted changes, corrected-entry UUID, actor ID, previous hash and
creation time in UTC with microseconds. SHA-256 covers its UTF-8 JSONB text. The
first predecessor is 64 zeroes. Verification checks each digest and link, replays
positions and entry dates, and compares the resulting head and supply with
storage. An uninitialized head fails verification.

## Synthetic operator exercise

Use an isolated PostgreSQL16 development database with configured app, operator
and migration roles, an existing synthetic company/share class, and an active
staff actor. Apply schema migrations only to that development database. Commands
select the operator connection explicitly; application connections can only read
their issuer's rows through RLS.

Create `opening.json` with synthetic UUIDs and whole-share amounts:

```json
{
  "operation_id": "78e39ef6-4c7c-4b38-8311-268ac67086b5",
  "effective_on": "2026-09-20",
  "holdings": [
    {"member": "b0169d39-35b2-4f97-aa0a-fb027c1b167f", "shares": "100"}
  ]
}
```

From `backend/`, substitute the existing synthetic token UUID and staff user ID:

```bash
python manage.py register_foundation load-synthetic-opening --token TOKEN_UUID --actor STAFF_USER_ID --input opening.json
python manage.py register_foundation verify --token TOKEN_UUID
```

Both commands print register/token IDs, event count, positive-holding member count,
issued supply and head hash. Loading the same file twice records one opening.
Invalid input rolls back newly created member references as well as the opening.
A successful verification with the chain unavailable proves storage integrity;
it does not prove chain reconciliation or director approval. No command calls a
provider or signs a transaction. A loaded opening initialises the register the
HTTP routes serve for that share class, so load one only into the development
database described above.

The migration refuses rollback once member/register records exist. New scoped
tables are explicitly associated with their creating migration in the grant
installer, so historical grant installation can run before those tables exist.
The creating migration installs their policies and grants; a missing table after
that migration is recorded remains an error.

## Inspecting a canonical chain snapshot

Before an opening can be activated, its chain quantities need one recorded
boundary. The read-only operator command below inspects an attributed deployment
on the configured local/testnet provider. It does not load an opening, record
member identities or change issuance completion timing.

```bash
python manage.py register_snapshot --token TOKEN_UUID > snapshot.json
```

The token must have its original confirmed deployment journal and transaction;
an unattributed legacy contract is refused. The network must have an approved
finality policy. Public testnets use their configured finalized boundary; local
depth policies select the last block with the required confirmations. The
provider needs historical contract calls and transfer logs, including support for
canonical block-hash `eth_call` requests. Unsupported or unavailable historical
reads are refused rather than replaced by current balances.

The JSON records the company, class, deployment transaction, network, contract,
block number/hash/date, finality policy, issued/authorized supply, positive
holdings and the canonical transfer history it folded: one entry per observed
transaction that moved shares, with its block number and block hash. A
transaction whose transfers all carry zero shares is folded but not listed,
since anyone can emit one with `burn(0)`. All share quantities are exact
integer strings; names and residential addresses are absent. The observed
transfer fold must agree with each observed participant's balance, including zero
balances, and total supply at that same hash. Duplicate or noncanonical logs,
inconsistent quantities, a reorg, a changed deployment/network/policy or
unavailable finality refuse the result.

Matching balances cannot establish that every historical log was returned: an
omitted self-transfer or round trip can leave all quantities unchanged. The
command therefore exports only the reconciled state candidate. It provides no
event-history export, entry/cessation dates or evidence of complete historical
membership. Those require separate evidence when an opening is activated or a
workflow event is recorded. This inspection neither approves nor imports the
register, and cannot guarantee future chain finality. No signing or database
writes take place.

Next: [the remaining register work](https://github.com/Ledova/ledova/issues/647)
and [backend verification](../development/testing.md#backend-verification).

## Reviewing documentary evidence

The register approval model uses documentary director authority submitted by
the company owner and verified by authorised staff. An owner account alone is
not proof of director authority. The company-document admin provides its
content-verification prerequisite; the correction and opening workflows below
are its current consumers.

In the company document admin, choose **Review and verify document**, open the
private file, review its company, document type and validity details, then confirm.
The action requires an active staff user with `companies.change_companydocument`
and the admin's object permission. The confirmation is bound to that reviewer and
document and expires after 15 minutes. Bulk verification and manually editable
verification flags have been removed.

Confirmation locks the company and document rows, then re-reads the file. It
records a SHA-256 fingerprint covering the file's bytes and its document/company
IDs, the company's registered name, ACN, ABN, type and owner, and the document's
type, name, storage key, size, MIME type, external URL and validity dates. A changed preview,
missing or empty file, wrong size, rejection or non-current validity is refused.
An external URL alone cannot establish file content and must be replaced by an
uploaded document before this review can be used.

PostgreSQL clears verification when the bound company identity, document details
or rejection reason change. The customer role may revoke verification but cannot
grant it. Notes alone do not revoke verification, including legacy rows without
a named reviewer. Older verified records keep their historical
flag without gaining a fabricated fingerprint; they need a fresh review before
they can supply content-bound evidence. Downgrade refuses to discard any recorded
fingerprints.

This is a record of what was verified at a time. Storage can become unavailable
or be changed outside the application, and validity can expire without a database
write. The correction and opening consumers therefore recheck the current file
against the recorded fingerprint, the company and the proposed change, and the
validity dates; the historical `is_verified` flag alone is insufficient. No
background storage monitoring or deletion/retention change is introduced here.
Documentary authority and an exact proposed register change remain separate
requirements of each approval workflow.

## Reviewed compensating corrections

The synthetic stored register accepts owner-submitted requests to reverse one
identified entry exactly. This is a compensation, not an editable replacement:
the original entry and its hash remain, and the new entry names the original.
Applying it changes the stored holdings the register routes serve; it broadcasts
no chain change. Replacement transactions and reconciliation remain #647 work.

An external issuer integration can use these authenticated routes:

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-corrections/` | Submit the owner's precise correction; return the retained request |
| `GET /api/v1/tokens/register-corrections/` | Paginated requests for companies currently owned by the caller |
| `GET /api/v1/tokens/register-corrections/{uuid}/` | Request, bound revision/evidence metadata and decision |
| `GET /api/v1/tokens/register-corrections/{uuid}/file/` | Authenticated attachment of the retained authority file |

For a synthetic exercise, use the register foundation command to create an
opening and identify the entry to compensate. Upload a synthetic signed resolution
through the existing company document route and have permitted staff complete its
content review. Submit this JSON as that company's owner, replacing UUIDs with
those from the exercise:

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000001",
  "corrects_id": "10000000-0000-4000-8000-000000000002",
  "document_id": "10000000-0000-4000-8000-000000000003",
  "effective_on": "2026-09-20",
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-1",
  "reason": "Reverse the identified erroneous synthetic entry"
}
```

The service derives the exact inverse share changes and captures the register's
current sequence/hash. One reviewed uploaded file must include the authority for
this precise correction. A director resolution names the approving director;
`court_order` instead uses a court reference and an empty `approving_director`.
An owner account is not proof of director authority. Staff document verification
alone does not approve the correction. External-only links and legacy verification
flags without content binding cannot supply its evidence.

In **Admin → Tokens → Register corrections**, open the request's review link.
An active staff user with change permission must inspect the retained file, named
authority, company identity, original entry, inverse quantities, date and register
revision, then explicitly confirm authority and choose **Approve and apply**.
The confirmation is reviewer-specific and expires after fifteen minutes. Approval,
its compensating entry and the holdings projection commit together; a failure
rolls them all back. Repeated identical submission/decision returns the existing
result, while conflicting UUID reuse is refused. The database prevents rewriting
or deleting the request and prevents the customer role from deciding it.

A changed register revision, company identity or original document makes
application unavailable. Missing, rejected, expired or altered evidence also
refuses application, including replacement with different bytes of the same size.
A retained copy is checked against the verified content again at application.
Reject an obsolete request with a reason, then submit corrected intent with a new
UUID and freshly reviewed evidence. Rejection remains available even when a file
is unavailable. An already compensated entry cannot be compensated a second time.
An inverse that would make a current holding negative is refused by the existing
register guard. Use the foundation verifier to check the resulting event chain
and projection; that is not a claim of chain reconciliation.

The owner chose private retention without automatic expiry for correction
requests and authority files during the synthetic-only experiment. Ordinary
request deletion is blocked. Deleting the original company document does not
delete the retained copy or decision, but prevents a pending request from being
applied. Committed copies are protected by their retained row; copies left by a
rolled-back or interrupted submission fall under the existing 24-hour orphan
sweep. Account/company deletion still respects protected register relations.
Production retention needs its own decision before real data is admitted.
Classification evidence, former-member retention and future export records have
independent policies; this choice does not change them.

## Approved opening capture and wallet links

The stored register can be initialised from a verified canonical boundary using
the same documentary-authority model as corrections. The company owner submits
an opening proposal for one deployed share class: an exact mapping of boundary
wallet addresses to company member IDs, the reviewed company document carrying
the authority, and either a director resolution naming the approving director or
a distinct court order with a reference and reason. There are no free-typed
quantities or dates: the opening's effective date is the captured boundary date
and its share changes are the boundary's holdings grouped by the mapped members.
The proposal retains a private copy of the authority file.

Walletless members and several wallets per member are supported. One address
resolves to one member per company; an existing wallet link for a mapped address
must agree with the mapping, and a mapping may not repeat an address. Member
personal particulars are still not stored: names and residential addresses
remain outside these records until the import milestone, which keeps them for
the former-member retention floor the owner chose on 21 September 2026.

An external issuer integration can use these authenticated routes:

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-openings/` | Submit the owner's opening proposal; return the retained request |
| `GET /api/v1/tokens/register-openings/` | Paginated requests for companies currently owned by the caller |
| `GET /api/v1/tokens/register-openings/{uuid}/` | Request, captured boundary, mapping and decision |
| `GET /api/v1/tokens/register-openings/{uuid}/file/` | Authenticated attachment of the retained authority file |

Submission accepts this JSON, replacing UUIDs with those from the exercise. The
mapping must cover exactly the boundary's holding addresses before review.

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000011",
  "token_id": "10000000-0000-4000-8000-000000000012",
  "document_id": "10000000-0000-4000-8000-000000000013",
  "mapping": [
    {"address": "0x1111111111111111111111111111111111111111", "member": "10000000-0000-4000-8000-000000000014"}
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-OPENING-1",
  "reason": "Establish the register from the attributed deployment boundary"
}
```

Opening the staff review captures a fresh canonical snapshot (the section
above), including the canonical transfer history that later classification needs,
and binds it to the proposal; the mapping must cover exactly the boundary's
holding addresses, no missing and no unknown address. Database guards
freeze the proposal after submission except for that one-time boundary capture,
the staff decision and the review fields. A repeated review rechecks the
boundary block's current canonicity and the approved finality policy instead of
re-capturing, and issues a fresh reviewer-bound confirmation.

In **Admin → Tokens → Register openings**, open the request's review link. An
active staff user with change permission must inspect the retained file, named
authority, company identity, captured boundary, deployment provenance, supply
reconciliation and the address-to-member mapping, then explicitly confirm and
choose **Approve and apply**. Application rechecks the reviewer-bound expiring
confirmation, the retained evidence, the boundary and that the register is still
uninitialized under the share-class lock, then commits the members, wallet
links, the OPENING entry (the register's first entry) and the decision
atomically; a failure rolls them all back. Repeated identical submission and
decision is idempotent, including after the confirmation expires, while
conflicting UUID reuse is refused. The database prevents rewriting or deleting
the request and the wallet links, refuses a mapping value that is not a JSON
string, and prevents the customer role from deciding or capturing anything.

An explicitly empty boundary produces an explicit empty opening, distinct from
an uninitialized register. An already-initialised register refuses a further
opening at submission and at application. A boundary that is no longer
canonical, a changed finality policy, changed company/document evidence or a
register initialised in the meantime refuses application; rejection with a
reason remains available. Issuance and settlement completion both take the same
share-class lock, so neither can interleave with an opening application.

Retention follows the owner's correction decision: opening proposals, their
retained authority copies and the captured boundary are retained without
automatic expiry during the synthetic-only experiment; ordinary deletion is
blocked, the retained copy survives source-document deletion and deleting the
source prevents a pending application. Production retention needs its own
decision before real data. Applying an opening initialises the register the
holders and CSV routes serve; until then they report it as not initialised.

## Reviewed wallet links after the opening

A wallet that no opening mapped, such as a new subscriber's, a first-time
buyer's or another wallet of an existing member, is linked to a company member
by a reviewed request (owner decision, 21 September 2026). The company owner
submits an exact mapping of wallet addresses to member IDs with the same
documentary authority an opening carries. A member ID may be new or may already
belong to the company. Links are company-wide, so one link serves every share
class. The request retains a private copy of the authority file.

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-links/` | Submit the owner's link request; return the retained request |
| `GET /api/v1/tokens/register-links/` | Paginated requests for companies currently owned by the caller |
| `GET /api/v1/tokens/register-links/{uuid}/` | Request, mapping and decision |
| `GET /api/v1/tokens/register-links/{uuid}/file/` | Authenticated attachment of the retained authority file |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000021",
  "company_id": "10000000-0000-4000-8000-000000000022",
  "document_id": "10000000-0000-4000-8000-000000000013",
  "mapping": [
    {"address": "0x3333333333333333333333333333333333333333", "member": "10000000-0000-4000-8000-000000000024"}
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-LINK-1",
  "reason": "Link the new subscriber's wallet to their member record"
}
```

In **Admin → Tokens → Register wallet links**, open the request's review link.
An active staff user with change permission inspects the retained file, the
named authority, the company identity and each address-member pair, then
explicitly confirms and chooses **Approve and apply**. Application rechecks the
reviewer-bound, expiring confirmation and the retained evidence under the
company lock, then creates any new members and the links atomically; a failure
rolls both back.

An address already linked in the company is refused at submission, at review and
at application, including one linked by another request or an opening after
this one was submitted. Rejection with a reason stays available. Repeated
identical submissions and decisions are idempotent, and conflicting UUID reuse is
refused. The database keeps requests immutable and undeletable, refuses forged
or customer-role decisions, and refuses an application that leaves a mapped
wallet unlinked. Retention follows openings and corrections.

A link records no register event of its own. Applying it records any issue or
transfer that was [waiting for it](#recording-issues-and-transfers-after-the-opening).

## Classifying completed inclusions

The boundary an opening captures fixes which economic effects the opening already
represents. Each completed issuance and settlement for that share class carries
the finalized receipt recorded when it completed — its block number, block hash,
gas and the approved finality policy — and the captured boundary carries the
canonical transfer history it folded. Classification asks whether the
completion's transaction is in that history:

| Classification | Meaning |
| --- | --- |
| `unopened` | The share class has no applied opening, so nothing represents the effect yet |
| `opening` | The completion's transaction is in the boundary's canonical history, at the same block and hash, so the opening's holdings already contain it |
| `after_opening` | The completion is in a later block than the boundary and absent from its history |
| `attribution` | The boundary's own evidence cannot place the completion, so an operator must resolve it |

A lower block number is not ancestry. A completion at an earlier height whose
transaction is missing from the captured history was orphaned, or belongs to
another chain, and is held for `attribution` rather than read as represented, as
is a completion recorded after the boundary yet present in its history. A missing
or malformed history is not an empty one: it cannot show that a transaction was
absent, so every completion is held for `attribution` against it, whatever its
height.

Review and application refuse an opening whose captured boundary leaves any
completed effect unrepresented, naming the effect, its block and the reason, and
refuse a boundary without a valid history outright; PostgreSQL refuses to apply
one too. The boundary is captured once and then frozen, so the remedy for a
pending opening is a fresh opening whose new boundary covers the effect, with the
mapping that boundary requires; reject the superseded proposal with a reason.
That refusal is what keeps the gap between capture and application closed: a
completion cannot land in it unobserved, because both completions take the
share-class lock the application holds.

These are the effects the platform itself completes. A holder's own on-chain
transfer, made outside settlement, is not one of them: the boundary's holdings
already contain it up to the boundary block, and anything later is a
reconciliation question rather than a classified completion.

A completed effect with no recorded finalized receipt is refused outright rather
than classified. Issuance execution wrote a terminal status and a confirmed
transaction block before it waited for finality, so those fields cannot show that
an older completion passed the policy; only the recorded receipt can. Such
completions, and settlements completed before settlement evidence was retained,
need operator attribution before any boundary can represent or exclude them. The
database enforces the same rule going forward: a completed issuance must record
its finalized receipt, bound to its original confirmed mint journal, and recorded
evidence can never be rewritten, removed or dropped by a downgrade.

The read-only operator command below reports the boundary and each
classification. It performs no provider read and writes nothing:

```bash
python manage.py register_inclusions --token TOKEN_UUID
```

### Openings captured before the history was retained

`tokens/0066` introduced the retained history and rewrites no existing opening,
so a boundary captured before it has none. What that means depends on whether
the opening was applied:

| Opening | Behaviour | Remedy |
| --- | --- | --- |
| Pending | Review and application refuse it, and PostgreSQL refuses its application | Reject it with a reason, then submit a fresh opening, whose review captures a boundary with history |
| Applied | It remains the register's opening, and every completion classifies as `attribution` against it | None implemented |

An applied opening cannot be recaptured. The register is initialised, so a fresh
opening is refused at submission and at application, and the applied opening's
boundary and OPENING entry are immutable. Holding every completion for
attribution keeps a later workflow from recording an effect the opening may
already contain. Resolving such a register needs a separately specified recovery
procedure, and none exists yet.

## Recording issues and transfers after the opening

Once a share class has an applied opening, each completed issuance and settlement
that classifies `after_opening` is recorded as a register event in the same
transaction that completes it:

| Effect | Entry | Recorded by | Effective date |
| --- | --- | --- | --- |
| Issuance | `issue` of the minted shares to the recipient's linked member | The staff member who approved the issuance request | The completion date (UTC) |
| Settlement | `transfer` from the seller's linked member to the buyer's | The transferor, whose signed order is the instrument | The completion date (UTC) |

The entry's operation ID is the completed issuance or settlement, so recording is
idempotent. Only an issue or transfer entry counts: a correction or opening that
reuses a completion's ID does not mark it recorded. The completion then waits,
with the register's refusal logged. An effect the opening already represents records nothing, and so does
a settlement between two wallets of the same member, since no holding changes.

Recording follows chain order: by block, then by the transaction index the
completion's finalized receipt records. A completion finalized before
`tokens/0068` has no index; within its block it follows the kind and ID.
Recording stops at the first effect it cannot record:
a wallet with no link, a completion held for attribution, or an entry the
register refuses, such as a transfer whose seller's stored holding does not cover
it after a move outside settlement. Nothing is recorded past that effect, so the
stored holdings never skip ahead of the chain. The completion itself still
commits, because a register record must not stall the workflow; the reason is
logged. Recording resumes at the next completion in that share class or the next
applied wallet link in the company, so an effect waits until one of those runs
after its cause is resolved. Applying a
reviewed wallet link records whatever was waiting for it; it takes each share
class's lock first, so a completion in progress cannot miss the new link.
`register_inclusions` reports `recorded` for each effect.

## Reading the register

The holders route and the CSV export serve the stored holdings with the chain
unreachable; the [register architecture](../architecture/register.md#api-and-export)
describes both. Before a share class's opening is applied, holders report
`initialized: false` and the export is refused with 409
`register_not_initialized`: submit and review an opening to start it. A positive
`waitingEffects` count, or the CSV's "Completed effects waiting to be recorded"
row, means completions are not yet in the holdings. Run `register_inclusions`
for that share class to find the first unrecorded effect: an unlinked wallet
needs a reviewed link request, and an effect held for attribution waits for the
attribution procedure. A count of `null`, or `unknown` in the CSV, means the
completions could not be classified, or the register has no captured boundary to
classify them against, as with one loaded by the synthetic command above;
`register_inclusions` prints the refusal or a null boundary.

## Reconciling with the chain

Every six hours, at :50 UTC, `reconcile_every_register` reconciles each share
class that has an applied opening. It reads the chain; it writes only
reconciliation records, never a register entry. It captures a fresh canonical
snapshot at the finality boundary, as an opening's review does, and compares it
with the stored register under the share-class lock that completions take:

- every chain transfer after the opening boundary must be a recorded effect, a
  completed effect still waiting to be recorded, or an issuance or settlement
  still executing whose current signed transaction is the one on chain and whose
  receipt, if one is recorded yet, succeeded. A completed, failed or cancelled
  operation explains nothing, and nor does a superseded attempt or one whose
  recorded revert the chain contradicts, which is held for operator attribution;
- every completed effect after the opening must be on chain in the block, number
  and hash, that its receipt names;
- each member's linked wallets must hold its stored shares plus those pending
  movements, an unlinked address only what pending movements give it, and the
  issued supply must equal the stored supply plus pending issues. An effect
  recorded beyond the snapshot block is left out of the comparison. A completion
  held for attribution accounts for its own transfer but moves nothing, since
  its place relative to the opening is what is unknown.

A transfer of zero shares is ignored, and a discrepancy staff have
[acknowledged](#acknowledging-a-discrepancy) is treated as explained.

The stored register row is locked for the comparison, so a correction cannot
land between reading the supply and reading the holdings. A snapshot below the
opening's boundary block, from a lagging provider or a deeper finality policy,
is never compared: the stored holdings are as at the opening, and an older chain
state would report differences that do not exist.

Each run is retained in `RegisterReconciliation`: `matched`, `discrepant` with
its discrepancies, or `failed` with the reason it could not compare: the chain
could not be read, or its snapshot is below the opening boundary. The record
also keeps the block and the register sequence compared. A chain failure is a
failed reconciliation; the register reads are unaffected. Discrepancies are
logged at error level, which is the alert, and the CSV summary states the
latest result. The job tries every share class, then fails if any could not be
reconciled. A class whose run raised rather than recording `failed` keeps its
previous result in the CSV, so the failed job is the signal to look at.

| Discrepancy | Meaning and next step |
| --- | --- |
| `unrecognised_transfer` | A chain transfer after the opening that no recorded, waiting or executing platform operation accounts for, such as a direct token transfer between whitelisted wallets. A transfer of zero shares is never reported. Investigate it; if it is accepted, [acknowledge](#acknowledging-a-discrepancy) it and the rows it causes, otherwise dispute it with the holders |
| `missing_transfer` | A completed effect whose transaction is not on chain in its block. Treat it as a reorganisation: stop, and attribute it before relying on the register. It cannot be acknowledged |
| `member`, `unlinked`, `supply` | Holdings or supply that differ from the stored register plus pending movements and earlier acknowledgements. They accompany one of the others, or follow an applied correction, which changes the stored register and not the chain. Acknowledge them once their cause is understood |
| `attribution` | A completion the evidence cannot place, as in [classification](#classifying-completed-inclusions). It cannot be acknowledged |

To reconcile one share class on demand, from `backend/`:

```bash
python manage.py register_reconcile --token TOKEN_UUID
```

It prints the retained record. The database refuses to rewrite or delete a
reconciliation, or to record one inconsistent with its status. Only the
operator records them, and the issuer reads its own. Downgrading `tokens/0070`
refuses while any exist.

### Acknowledging a discrepancy

The register itself cannot follow a divergence it did not cause: no reviewed
entry records an outside transfer, and a correction only compensates an
existing entry. Once staff have investigated a divergence and accepted it, they
acknowledge it, one row at a time, from the share class's latest
reconciliation, from `backend/`:

```bash
python manage.py register_acknowledge --reconciliation RECONCILIATION_UUID \
    --discrepancy POSITION --reason "WHY IT IS ACCEPTED" --actor STAFF_USER_ID
```

`POSITION` counts from zero through the record's `discrepancies`, in the order
`register_reconcile` prints them. Later runs treat the row as explained:

- an acknowledged `unrecognised_transfer` is not reported again for that
  transaction hash;
- an acknowledged `member`, `unlinked` or `supply` row keeps its difference,
  chain minus expected, and later runs add it to the expected side for that
  member, address or the supply. A further change for the same key is reported
  as a new difference.

Accepting an outside transfer therefore takes its `unrecognised_transfer` row
and the `member` or `unlinked` rows it caused. An applied correction's effect is
acknowledged the same way, through the `member` and `supply` rows it leaves.
Once every row is acknowledged, the next run is `matched`. An acknowledgement
explains a divergence; it records nothing in the register, whose holdings stay
as recorded. `attribution` and `missing_transfer` cannot be acknowledged: they
need the attribution procedure, which is still
[#647](https://github.com/Ledova/ledova/issues/647) work.

Each acknowledgement is retained with the reconciliation, the exact row, the
reason, the staff member and the time, and the command prints it. The command
takes rows of the latest reconciliation only, under the share-class lock a run
holds, so no divergence is counted twice; for a row of an older record,
reconcile again and use the new one. The database refuses to change or delete
an acknowledgement, a row that is not verbatim in the class's reconciliation, a
second acknowledgement of the same row, a blank reason, a user who is not
active staff, and any insert from the app role. Only the operator reads them;
the issuer sees the reconciliation result they produce.

Next: [the remaining register work](https://github.com/Ledova/ledova/issues/647)
and [register architecture](../architecture/register.md).
