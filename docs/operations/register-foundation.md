# Stored register foundation

[Operations](README.md) · [Register architecture](../architecture/register.md)

The first [#647](https://github.com/Ledova/ledova/issues/647) slices provide
company-scoped member references with durable wallet links, an append-only
share-event chain, stored holdings, an approved opening capture and reviewed
compensating corrections. It is a foundation for the authoritative register.
The HTTP and CSV register routes serve it once a share class's opening is
applied, and issuance and settlement then record each later completed effect in
it, an issue only under an applied register instruction that a named director's
approval supports, and the issuer can list the effects still waiting and why;
opening review and the inclusion report classify completed
effects against the captured boundary, and a scheduled job reconciles it with the
chain. An
import adds an existing register's particulars and former members to a class
opened from the chain, and staff prepare
[inspection copies](#preparing-an-inspection-copy) of it and
[certificates](#preparing-a-certificate) for its issues and transfers on a
company's written instruction. A class not yet on chain cannot be opened from
an import yet, so no real company's register may rely on the foundation yet.

## Identity and events

A member has a UUID belonging to one company, independent of a wallet or platform
account. The owner chose this so imports can include walletless members and one
member can have multiple wallet links. Wallet links are durable insert-only
identity records created by the approved opening or a reviewed link request
below: one address resolves to
one member per company, and an existing link for a mapped address must agree
with the mapping. The register routes name members from their wallets'
identities and allotment stamps; an [import's](#importing-an-existing-register)
recorded particulars fill in only where neither resolves. It never merges members
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
current sequence/hash. The effective date may be today (UTC) or earlier, since a
rectification can be backdated; submission refuses a later one, which would hold
back [later issues and transfers](#recording-issues-and-transfers-after-the-opening)
until that date. One reviewed uploaded file must include the authority for
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
Classification evidence, former-member retention and export records have
independent policies; this choice does not change them. Export records follow
the 2,557-day floor, purged by the daily retention job.

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
must agree with the mapping, and a mapping may not repeat an address. An
opening stores no personal particulars; a later [import](#importing-an-existing-register)
records names and residential addresses.

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

## Register instructions for issues

An issue is the directors' act, so the platform approves one only once staff have
verified a named director's approval (owner decision 2, 22 September 2026). The
company owner submits a register instruction listing the exact issues
it approves, each with its recipient wallet and whole number of shares: a direct
issue by its issuance request, and an offering allotment by its subscription. It
names the approving director and carries the same verified company document an
opening does, and it retains a private copy of the authority file. Its kind is
`issue`; transfer instructions are later work.

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-instructions/` | Submit the owner's instruction; return the retained instruction |
| `GET /api/v1/tokens/register-instructions/` | Paginated instructions for companies currently owned by the caller |
| `GET /api/v1/tokens/register-instructions/{uuid}/` | Instruction, items and decision |
| `GET /api/v1/tokens/register-instructions/{uuid}/file/` | Authenticated attachment of the retained authority file |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000041",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "document_id": "10000000-0000-4000-8000-000000000013",
  "kind": "issue",
  "items": [
    {"request": "10000000-0000-4000-8000-000000000042", "recipient": "0x3333333333333333333333333333333333333333", "amount": "100"},
    {"subscription": "10000000-0000-4000-8000-000000000043", "recipient": "0x4444444444444444444444444444444444444444", "amount": "40"}
  ],
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-ISSUE-1",
  "reason": "Allot the shares the board resolved to issue"
}
```

Each item must belong to the share class and match the request's or
subscription's recipient and shares as they stand. It must also still await
approval: a request submitted or under review, or a paid subscription not yet
allotted. The one exception is an issue approved before `tokens/0073`, by the old
Approve action or an allotment, whose issue entry is not yet recorded. Listing it
adds the cover its entry waits for, without approving it again. An allotment is
always listed by its subscription, never by its request.

In **Admin → Tokens → Register instructions**, open the instruction's review
link. An active staff user with change permission inspects the retained file, the
named director, the authority reference and the company identity. They check each
item's exact terms, shown with the recipient wallet, the names it identifies, the
shares and the class, and that the director is not a recipient. Then they
explicitly confirm and choose **Approve and apply**. Submission, review and
application all refuse:

- an item whose recipient or shares differ from its request's or subscription's
  current terms, as when they change after submission;
- an item no longer awaiting approval, such as a request staff rejected or one
  another instruction approved;
- a director who is the recipient an item identifies, by the request's
  recipient name or the profile name of the account holding the recipient
  wallet.

Rejection with a reason stays available. Application rechecks the reviewer-bound,
expiring confirmation, the retained evidence and every item under the company and
share-class locks, then in one transaction:

- approves each listed request still awaiting approval, with the applying staff
  member as its reviewer, who is therefore the recorder of its issue entry;
- lets staff allot each listed subscription on exactly its listed terms;
- records any listed issue approved before `tokens/0073` that completed and was
  [waiting for cover](#recording-issues-and-transfers-after-the-opening).

Applying an instruction is now the only way to approve a direct issuance
request: the staff **Approve** action is gone, and a submitted request shows
"Awaiting a register instruction". **Reject** stays. Allotment refuses a
subscription that no applied instruction lists with its current recipient and
shares, so a scale-back or a partial payment after the instruction needs a fresh
one.

Repeated identical submissions and decisions are idempotent, and conflicting UUID
reuse is refused. The database keeps instructions immutable and undeletable,
refuses an item outside the instruction's company and share class, and refuses
customer-role or forged decisions. It also refuses an application that leaves a
listed request unapproved. `tokens/0073` also guards issuance requests: the
company's own connection can no longer approve, reject or start review of one, or
change its reviewer, review time, notes or rejection reason, and no connection
can approve one without an active staff reviewer. Retention follows openings and
corrections.

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
| Issuance | `issue` of the minted shares to the recipient's linked member | The staff member who approved the issuance request: who applied the [register instruction](#register-instructions-for-issues) listing it, allotted the subscription one lists, or approved it before `tokens/0073` | The date the entry is made (UTC) |
| Settlement | `transfer` from the seller's linked member to the buyer's | The transferor, whose signed order is the instrument | The date the entry is made (UTC) |

An entry recorded as its effect completes is made in the completion's own
transaction, so it carries the completion date. One recorded after its effect
waited carries the later date on which it is made, whatever it waited for, a
wallet link included (owner decision, 22 September 2026). Entries recorded
before this rule keep their completion dates.

The entry's operation ID is the completed issuance or settlement, so recording is
idempotent. Only an issue or transfer entry counts: a correction or opening that
reuses a completion's ID does not mark it recorded. The completion then waits,
with the register's refusal logged. An effect the opening already represents records nothing, and so does
a settlement between two wallets of the same member, since no holding changes.
An issue is recorded only once an applied register instruction covers its request
or, for an allotment, its subscription. Every issue approved since `tokens/0073`
is covered, because applying an instruction is its approval and allotment needs
one; an issue approved before it waits until an instruction lists it. The
recorder is the request's reviewer, which the company's own connection cannot
change since `tokens/0073`. A request with no recorded reviewer waits rather than
recording someone else. Entries recorded before `tokens/0073` stay as they are, and no
approval is invented for them.

Recording follows chain order: by block, then by the transaction index the
completion's finalized receipt records. A completion finalized before
`tokens/0068` has no index; within its block it follows the kind and ID.
Recording stops at the first effect it cannot record:
a wallet with no link, an issue no applied instruction covers, a completion held
for attribution, or an entry the register refuses, such as a transfer whose
seller's stored holding does not cover it after a move outside settlement. Nothing is recorded past that effect, so the
stored holdings never skip ahead of the chain. The completion itself still
commits, because a register record must not stall the workflow; the reason is
logged. Recording resumes at the next completion in that share class, the next
applied wallet link in the company or the next applied register instruction for
that share class, so an effect waits until one of those runs after its cause is
resolved. Applying a reviewed wallet link or a register instruction records
whatever was waiting for it; each takes the share class's lock first, so a
completion in progress cannot miss the new link or cover.
`register_inclusions` reports `recorded` for each effect.

The register never dates an issue or transfer before its latest entry.
Recording makes a share class's entries one at a time under its lock, so their
dates do not go backwards, and a correction cannot be dated after the day it is
submitted; only an entry made another way can carry a later date, such as an
opening whose boundary block's time runs ahead of the platform's clock. While the
latest entry is dated after today, the register refuses the next issue or
transfer, and it waits with the reason `refused` until a recording on or after
that date.

### The issuer's waiting list

The company owner can list the completed effects of a share class that are not
yet in the register, in the order recording will take them:

| Method and route | Result |
| --- | --- |
| `GET /api/v1/tokens/{uuid}/register/waiting/` | `effects`: each completed effect after the opening not yet recorded, in chain order, or `null` where `waitingEffects` is `null` |

Each effect carries its `kind` (`issue` or `transfer`), its `source` (the
issuance or settlement ID, which becomes the entry's operation ID), the `block`
that finally included it, its `wallets` (the recipient's for an issue, the
seller's then the buyer's for a transfer), its `shares`, its `reason` and
`unlinkedWallets`:

| Reason | Why it waits | What resolves it |
| --- | --- | --- |
| `attribution` | The opening's captured boundary cannot place its completion | The attribution procedure, not yet specified |
| `unlinked` | A wallet it names has no reviewed link to a member; `unlinkedWallets` lists which | A [reviewed link request](#reviewed-wallet-links-after-the-opening) |
| `unreviewed` | The issue's request records no approving reviewer, as when the reviewer's account was deleted | Nothing yet: recording does not invent a recorder |
| `uninstructed` | No applied register instruction covers the issue | A [register instruction](#register-instructions-for-issues) that lists it |
| `refused` | Nothing of its own: recording last tried it and the register refused the entry | The logged refusal's cause, such as a seller's stored holding that does not cover the transfer or a latest entry dated after today; recording tries again at its next run |
| `behind` | Nothing of its own: an earlier effect in the class waits | Resolving the earlier effect |

The list, the `waitingEffects` count and recording walk the same classification
in the same order, so the count is always the list's length and the first effect
listed is the one recording stops at. The route answers the owner of the share
class's company, and 404 for anyone else, from one database snapshot.

## Reading the register

The holders route and the CSV export serve the stored holdings with the chain
unreachable; the [register architecture](../architecture/register.md#api-and-export)
describes both. Before a share class's opening is applied, holders report
`initialized: false` and the export is refused with 409
`register_not_initialized`: submit and review an opening to start it. A positive
`waitingEffects` count, or the CSV's "Completed effects waiting to be recorded"
row, means completions are not yet in the holdings. The
[waiting list](#the-issuers-waiting-list) names each of them and why it waits.
A count of `null`, or `unknown` in the CSV, means the
completions could not be classified, or the register has no captured boundary to
classify them against, as with one loaded by the synthetic command above;
`register_inclusions` prints the refusal or a null boundary.

## Preparing an inspection copy

Anyone may ask a company for a copy of its register, and the company must give
it within 7 days after a proper request (s173(3) of the Corporations Act). The
company decides whether a request is proper. Staff prepare the copy only on the
company's written instruction, and the company hands it over (owner decision,
22 September 2026).

You need an active staff account with **Can change register outputs**
(`tokens.change_registeroutput`). Share token permissions do not include it, and
it grants nothing else. The share class needs an applied opening.

1. Keep the company's written instruction, and note its reference, the date the
   request was made and who the copy is for.
2. In **Admin → Tokens → Register outputs**, open the share class and choose
   **Prepare an inspection copy**.
3. Enter the instruction's reference, the request date and the recipient, then
   choose **Prepare and download**.

The download, `register-SYMBOL-inspection-copy.csv`, is the register CSV with a
fourth section: the request date, the instruction, the recipient, the date it
was produced, and whether that is more than 7 days after the request. Give the
file to the company unchanged. The page refuses, and records nothing, when the
share class has no applied opening, when the request date is after today in
Sydney's calendar, or when a field is blank.

Each copy is recorded once in **Admin → Tokens → Register exports** as kind
**Inspection copy**: who prepared it, the register sequence copied, the row
counts, the request details, the late flag and the file's SHA-256 digest.
Search by instruction or recipient. Ledova keeps no copy of the file. To confirm
that a file is the one prepared, compare the output of
`sha256sum register-SYMBOL-inspection-copy.csv` with the record's digest.
Preparing again makes a new copy and a new record, whose digest differs if
anything in the register or the request has changed, including the date
produced.

A copy produced more than 7 days after the request is marked late in the file
and on its record. Days are counted in Sydney's calendar, and a limit that ends
on a weekend or public holiday is not extended, so the flag errs towards late.
Tell the company when a copy is late: the obligation is theirs. The records
cannot be rewritten, are read only by staff, and follow the export records'
2,557-day floor and daily purge.

## Preparing a certificate

A company must have a certificate ready within 2 months after an issue and 1
month after a transfer is lodged (s1071H of the Corporations Act). Staff prepare
it only on the company's written instruction. Ledova hands it over unsigned, and
the company executes it and gives it to the member (owner decision,
22 September 2026).

You need the **Can change register outputs** permission that inspection copies
use. The share class needs an applied opening.

1. Keep the company's written instruction, and note its reference and the issue
   or transfer it names.
2. Find that entry's number, its sequence in the share class's register. Admin
   has no list of entries: from `backend/`, run `python manage.py shell`, which
   uses the operator connection, and list the class's entries:

   ```python
   from tokens.models import RegisterEntry
   RegisterEntry.objects.filter(register__token_id="TOKEN_UUID").values_list(
       "sequence", "kind", "effective_on", "operation_id", "corrects__sequence"
   )
   ```

   An issue's operation is its share issuance and a transfer's is its swap
   order. A correction's last value is the number of the entry it reverses.
3. In **Admin → Tokens → Register outputs**, open the share class and choose
   **Prepare a certificate**.
4. Enter the entry's number and the instruction's reference, then choose
   **Prepare and download**.

The download, `certificate-SYMBOL-N.pdf` for entry N, has a page N-1 for the
member the entry moved shares to and, for a transfer, a page N-2 certifying the
balance a transferor still holds after it. Each page shows the holding after
that entry, whatever has happened since, and the names and addresses the
register gives when you prepare it. Check the pages against the instruction and
give the file to the company unchanged to execute. The page refuses, and records
nothing, an entry that is not an issue or a transfer, an entry a correction has
reversed, a number the share class's register does not have, and a member whose
wallets resolve to different people or who has no name or residential address
on record. A refused reversed entry names the correction that reversed it. A
refused member is named too: the register must be able to name them, as
[membership and identity](../architecture/register.md#membership-and-identity)
describes, before their certificate can be prepared.

Each certificate is recorded once in **Admin → Tokens → Register exports** as
kind **Certificate**: who prepared it, the entry's number as the register
sequence, the number of pages as member rows, the instruction and the file's
SHA-256 digest. Search by instruction. Ledova keeps no copy of the file. To
confirm that a file is the one prepared, compare the output of
`sha256sum certificate-SYMBOL-N.pdf` with the record's digest. Preparing the
same entry again makes a new record, and the same file while the register, the
members' particulars and the PyMuPDF version are unchanged. The records cannot
be rewritten, are read only by staff, and follow the export records' 2,557-day
floor and daily purge.

## Importing an existing register

A company that arrives with a register keeps its members' particulars and its
pre-platform former members. Imports follow the owner decisions of
21 September 2026:
- for a class already opened from the chain, the import adds particulars and
  former members and leaves holdings to the stored register;
- for a class not yet on chain, the import will become the opening, which is
  later work;
- a staff reviewer enters the ASIC extract's figures.

The owner decided on 22 September 2026 that:
- the applied import's reviewed copy and uploaded file are evidence, kept like
  opening and correction evidence;
- a member's live verified identity wins over imported particulars.

A share class takes one applied import. Submission, review and application each
refuse another once one is applied, and a partial unique index backs them. The
import names a staff-verified `SHARE_REGISTER` document (the company's current
register, of which the import retains a private copy), a staff-verified ASIC
extract, documentary authority as for an opening, and the register date:

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-imports/` | Submit the import; return the retained request |
| `GET /api/v1/tokens/register-imports/` | Paginated imports for companies currently owned by the caller |
| `GET /api/v1/tokens/register-imports/{uuid}/` | Request, rows, figures and decision |
| `GET /api/v1/tokens/register-imports/{uuid}/file/` | Authenticated attachment of the retained register document |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000031",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "document_id": "10000000-0000-4000-8000-000000000032",
  "asic_document_id": "10000000-0000-4000-8000-000000000033",
  "as_at": "2026-09-20",
  "members": [
    {"member": "10000000-0000-4000-8000-000000000024", "name": "Synthetic Member",
     "residential_address": "1 Synthetic Street, Sydney NSW 2000", "shares": "100",
     "entered_on": "2019-05-01", "amount_paid": "250.00"}
  ],
  "former_members": [
    {"name": "Synthetic Former", "residential_address": "2 Synthetic Road, Hobart TAS 7000",
     "shares": "40", "ceased_on": "2022-03-01"}
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-IMPORT-1",
  "reason": "Import the company's existing register"
}
```

Submission refuses rows that do not fit the stored columns, with a message
naming the problem:
- every current member must already be a member of the company with a stored
  holding;
- a name has at most 255 characters and a residential address at most 1,000;
- `shares` is a whole number of at most 78 digits;
- `amount_paid` is a plain amount such as `250.00`, with at most two decimal
  places and eighteen whole digits, or `null` when not known;
- dates may not follow the register date;
- a former member must have ceased before the register's opening, because the
  stored register and the fold record later cessations, and within the
  former-member retention period (`FORMER_MEMBER_RETENTION_DAYS`, 2,557 days by
  default), because the retention job would purge an older one.

In **Admin → Tokens → Register imports** a staff reviewer with change permission
opens the review. For each member it shows the imported name beside the
member's linked wallets and current live identity, so names swapped between
equal holdings show, and the stored date entered beside the imported one. It
compares each imported holding with the stored one. The reviewer reads the ASIC
extract, enters its issued total and member count for the class, confirms and
applies. Application refuses:
- figures that differ from the import's totals;
- any holding that differs from the stored register, which includes a member
  the import leaves out;
- changed evidence or a changed ASIC extract;
- a class that already has an applied import.

It then stores each member's particulars, except where the member already has
particulars from an import with a later register date, and the imported former
members. It keeps the figures and the register sequence on the request.
Repeating an application with the same figures returns it; different figures
conflict. Rejection with a reason stays available. The database keeps imports
immutable and refuses:
- forged decisions;
- rows whose keys or types differ from what submission accepts;
- a former member who ceased on or after the opening;
- an application whose figures differ from the rows;
- an application that leaves a member without particulars from it or from a
  later-dated import;
- a second applied import for the class.

The [register reads](../architecture/register.md#membership-and-identity) then
show a member's live verified identity when it is present and unambiguous.
Recorded particulars fill in only for a member with no live identity and no
resolved allotment stamp, and an ambiguous identity stays ambiguous. The
imported date entered applies to a member the opening carried in for as long as
the holding stays continuous, and the imported amount paid only while that
holding is also unchanged since the import. A member who entered on the
platform keeps the date and amount the platform recorded. The holders API and
the CSV list imported former members beside the chain-derived ones. A folded
former member whose wallet resolves to no profile and no resolved stamp takes
the particulars of the member the wallet is linked to.

The daily retention job purges particulars once the member has held nothing in
the company for the 2,557-day floor, and imported former members that long after
their date ceased. It purges nothing else of an import. The applied import's
reviewed copy, with every name and address it carried, and its uploaded register
file are evidence, kept like opening and correction evidence: nothing expires
them automatically during the synthetic experiment, and production retention is
decided before any real data (owner decision, 22 September 2026).

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
