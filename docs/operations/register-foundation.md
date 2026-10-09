# Stored register foundation

[Operations](README.md) · [Register architecture](../architecture/register.md)

[#647](https://github.com/Ledova/ledova/issues/647), closed on 22 September
2026, built the authoritative stored register: company-scoped members with
durable wallet links, an append-only hash-chained event log and the holdings
projection the holders route and CSV serve. Companies run openings, imports,
corrections, wallet links, particulars changes and discrepancy acknowledgements
through current appointments with company-provided evidence
([company register decisions](#company-register-decisions)), and issue shares
through the [chain grant](../plans/company-managed-registers/company-register-issues.md),
[paid-issue](../plans/company-managed-registers/company-paid-issues.md) and
[walletless grant](../plans/company-managed-registers/register-grants.md)
families. Platform staff still review settled-transfer instructions and prepare
certificates, notice figures and the company pack on written instruction. The
operator commands here run on synthetic data only: production retention and the
undoing of a mistaken opening import are decided before real data is admitted.

## Identity and events

[Register architecture](../architecture/register.md#membership-and-identity)
describes members, wallet links and identity resolution; what follows is how
the event chain is written and checked. A register belongs to one share class.
Its first entry records the opening state, including an explicitly empty state,
and later entries are:

| Kind       | Effect                                                        |
| ---------- | ------------------------------------------------------------- |
| Issue      | Add a positive whole-share quantity to one member             |
| Transfer   | Subtract from one member and add the same quantity to another |
| Cessation  | Remove a member's entire holding in this class                |
| Correction | Compensate every quantity in one earlier entry exactly        |

A transfer that empties a holding leaves a zero position; a cessation describes
the class holding, not membership across the company's other classes. A
correction can itself be compensated, but each original entry can be
compensated only once and no change can make a position negative. Recording a
cessation or correction burns, seizes or transfers nothing on chain. Partial
corrections and replacement transactions are not built.

PostgreSQL locks the register head, validates the event and member company,
assigns the next sequence and hashes the event with its predecessor. It updates
the holdings and issued supply in the same transaction. Quantities are exact
integers bounded by the unsigned 256-bit range. A repeated operation UUID with
the same instructions returns its original entry; changed instructions conflict.
Entry payloads admit only member UUIDs and share changes, never names or
residential addresses. Database triggers refuse entry and member rewrites and
deletes, and holdings or head writes outside event projection; the operator role
has no TRUNCATE privilege. The schema owner remains trusted and can alter
database protections: the hash chain is not an externally anchored proof against
a schema owner who rewrites the entire history and every hash.

The hash input is a PostgreSQL JSONB array in this order: format marker
`ledova-register-v1`, entry UUID, register UUID, operation UUID, sequence, kind,
effective date, sorted changes, corrected-entry UUID, actor ID, previous hash and
creation time in UTC with microseconds. SHA-256 covers its UTF-8 JSONB text. The
first predecessor is 64 zeroes. Verification checks each digest and link,
replays positions and entry dates, and compares the resulting head and supply
with storage. An uninitialised head fails verification. `tokens_register_entry_preimage`
returns the exact text the hash function digests, which the
[company pack](../architecture/company-pack.md#hash-preimages) carries beside
each entry.

## Synthetic operator exercise

Use an isolated PostgreSQL16 development database with configured app, operator
and migration roles, an existing synthetic company/share class, and an active
staff actor. Apply schema migrations only to that development database. Commands
select the operator connection explicitly; application connections can only read
their company's rows through RLS.

Create `opening.json` with synthetic UUIDs and whole-share amounts:

```json
{
  "operation_id": "78e39ef6-4c7c-4b38-8311-268ac67086b5",
  "effective_on": "2026-09-20",
  "holdings": [{ "member": "b0169d39-35b2-4f97-aa0a-fb027c1b167f", "shares": "100" }]
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
block number/hash/date, finality policy, issued/authorised supply, positive
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

Next: [backend verification](../development/testing.md#backend-verification);
#647 closed on 22 September 2026 with this command as delivered.

## Reviewing documentary evidence

The register approval model uses documentary director authority submitted by
the company owner and verified by authorised staff. An owner account alone is
not proof of director authority. The company-document admin provides its
content-verification prerequisite; the retained
[register instructions](#register-instructions-for-issues) below and
[publications](publications.md) consume it. Openings, imports, corrections,
wallet links and particulars changes use company-provided evidence instead.

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
write. Its consumers therefore recheck the current file
against the recorded fingerprint, the company and the proposed change, and the
validity dates; the historical `is_verified` flag alone is insufficient. No
background storage monitoring or deletion/retention change is introduced here.
Documentary authority and an exact proposed register change remain separate
requirements of each approval workflow.

## Company register decisions

Since 5 October 2026 the company runs its register itself, under the owner's
[company-run register decisions](../decisions.md#company-run-register-authority-and-evidence).
The rules below apply to every register command: corrections, openings, wallet
links, imports and particulars changes here, and the
[walletless grants](../plans/company-managed-registers/register-grants.md),
[direct transfers](../plans/company-managed-registers/register-transfers.md),
[chain grants](../plans/company-managed-registers/company-register-issues.md),
[paid issues](../plans/company-managed-registers/company-paid-issues.md),
[capital increases](../plans/company-managed-registers/company-capital-increases.md),
[pause changes](../plans/company-managed-registers/company-pause-changes.md),
[wallet approvals](../plans/company-managed-registers/company-wallet-approvals.md)
and [empty deployments](../plans/company-managed-registers/company-deployments.md)
in their own guides. The subsections that follow hold only what is specific to
each command. The Register screen in both clients runs every step through the
API.

**Who may act.** A current appointment holding `admin` or `prepare` uploads
evidence and prepares; `admin` or `approve` approves or rejects; `admin` or
`apply` applies. One person may take every step and no second person is
required. Application needs an approval whose approver still holds a current
appointment; if that appointment was revoked or has expired, a current approver
approves again. Staff permissions, company ownership alone and shareholding
grant none of these steps. Listing and reading proposals, their decisions and
their evidence copies takes the register-read scope: the company owner, or a
current appointment holding `admin`, `read_register`, `prepare`, `approve` or
`apply`. Every command also meets the identity requirement
[`issuer_kyc_required`](operator-console.md#operator-configuration) imposes on
the appointee.

**Evidence.** The company uploads its evidence with
`POST /api/v1/tokens/register-evidence/` (multipart: `company_id`,
`appointment`, `kind`, `idempotency_key`, `file`), which answers a receipt with
the file's size, type and SHA-256. The kinds are `share_register` and
`asic_extract` for an import, `authority` for the director resolution or court
order behind an opening, a correction or a wallet link, and `supporting` for a
particulars change. An upload is checked like every other upload, then kept
privately with its SHA-256; an identical retry returns the first receipt, and
the same key with a different file conflicts. Preparation accepts only the
preparer's own upload for this company, of the right kind, whose stored bytes
still match its fingerprint, and the proposal keeps its own private copy with a
snapshot naming the upload, its size, type and SHA-256, marked as provided by
the company. Ledova staff verify nothing. A director resolution names the
approving director; `court_order` instead carries a court reference and an
empty `approving_director`. An owner account is not proof of director authority.

**Routes.** Each command has the same family under `/api/v1/tokens/`:
`POST register-<command>/` prepares and returns the retained proposal;
`GET register-<command>/` pages the proposals of companies whose register the
caller may read, filterable by `company` and `status` and, where the command
concerns a class or a member, `token` or `member`; `GET register-<command>/{uuid}/`
returns the proposal with its evidence, stage and decisions;
`GET .../{uuid}/file/` streams the proposal's copy of its document as an
authenticated attachment; `POST .../{uuid}/decision-preview/` and
`POST .../{uuid}/decide/` are the decision steps below. An identical preparation
retry returns the proposal; the same `operation_id` with any change conflicts.

**Preview, digest and retry.** Every decision starts with a preview for the
caller's appointment, which lists what the decision still lacks and answers a
digest binding the proposal, the decision kind, the person, the appointment, the
reason and, for application, the state the effect depends on (each subsection
says which). The decision carries that digest, a retry key and
`confirmation: true`; any change in between conflicts. An identical decision
retry with the same key returns the proposal, and the same key with any change
conflicts. Every step rechecks the appointment after taking the company lock, so
a revocation that commits first refuses the decision and records nothing.
Rejection needs a reason and stays available until a decision applies or
rejects the proposal, including when the retained copy is unavailable. The
requirements every command reports are:

| Requirement                             | Meaning                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `appointment_capability_required`       | The appointment holds neither `admin` nor the capability the decision needs                                                                                  |
| `<command>_decided`                     | The proposal is already applied or rejected: `correction_decided`, `opening_decided`, `link_decided`, `import_decided` or `change_decided`                   |
| `company_provided_evidence_required`    | A retained staff-era proposal, which can only be rejected                                                                                                    |
| `already_approved`                      | A current approval exists                                                                                                                                    |
| `approval_required`, `approval_lapsed`  | Application needs a current approval; an earlier approver's appointment ended                                                                                |
| `evidence_unavailable`                  | A retained copy no longer matches its size or SHA-256                                                                                                        |
| `reason_required`, `reason_not_allowed` | Rejection needs a reason; approval and application take none                                                                                                 |

**Staff-era proposals.** A proposal submitted for the retired staff review and
still waiting can only be rejected; the company then prepares a new one. Such a
proposal keeps its copy of the staff-verified company document and its
reviewer, readable through the API, the admin and the
[company pack](../architecture/company-pack.md), shown as `staff_verified`;
deleting that document deletes neither the copy nor the decision.
**Admin → Tokens → Register corrections**, **Register openings**,
**Register wallet links** and **Register imports** show proposals and their
copies as read-only history; the review pages are gone, and particulars changes
have no admin page.

**What the database guarantees.** Proposals, uploads, decisions and the records
they create are immutable, and PostgreSQL refuses:

- an upload or preparation not made through the company command by a person
  whose current appointment holds `admin` or `prepare`;
- a preparation whose evidence, fingerprint, snapshot or copy path differ from
  the preparer's own upload of the required kind for the company;
- a decision whose digest the database does not recompute, whose appointment is
  not the decider's current one with the capability the decision needs, a
  second current approval, an approval or application of a staff-era proposal,
  or an application without a current approval;
- an applied or rejected proposal without its matching decision, and a decision
  whose proposal does not carry its effect when the transaction commits;
- an application whose effect is not exactly the one the proposal describes,
  recorded by the person applying it.

Application commits the effect, the decision and, where holdings change, the
holdings projection atomically; a failure rolls them all back. Use the
[foundation verifier](#synthetic-operator-exercise) to check the resulting
event chain and projection; that is not a claim of chain reconciliation.

**Retention.** Proposals, their copies of the company's uploads, their captured
boundaries or figures and their decisions are evidence with no automatic expiry
during the synthetic-only experiment, and ordinary deletion is blocked.
Committed copies are protected by their retained row; copies left by a
rolled-back or interrupted preparation fall under the 24-hour orphan sweep.
[Data retention](uploads.md#data-retention) is the single statement of what the
daily purge removes and what it leaves. Production retention needs its own
decision before real data is admitted.

### Compensating corrections

A correction reverses one identified entry exactly. It is a compensation, not an
editable replacement: the original entry and its hash remain, the new entry
names the original, and an already compensated entry cannot be compensated a
second time. Applying it changes the stored holdings the register routes serve
and broadcasts no chain change; the next [reconciliation](#reconciling-with-the-chain)
reports the difference as `member` and `supply` rows, which the company
acknowledges. Replacement transactions and partial corrections are not built.
The evidence is an `authority` upload.

| Method and route                              | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/{uuid}/register/entries/` | Paginated entries of the share class's register, newest first, for its register readers: each change names its member as the register does, with the entry it `corrects`, the correction entry that reverses it (`correctedBy`) and whether it is `correctable`. Repeat `entry` with UUIDs to read just those entries; another class's entry is not returned and a malformed UUID is refused |
| `POST /api/v1/tokens/register-corrections/`   | Prepare the correction. `GET` lists, filterable by `company`, `register`, `token` (the share class) and `status`; `{uuid}/` returns the request, bound revision, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                                                                                                     |

For a synthetic exercise, use the register foundation command to create an
opening and identify the entry to compensate, and upload a synthetic signed
resolution as an `authority` upload. Then prepare, replacing UUIDs with those
from the exercise:

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000001",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "corrects_id": "10000000-0000-4000-8000-000000000002",
  "authority_evidence": "10000000-0000-4000-8000-000000000003",
  "effective_on": "2026-09-20",
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-1",
  "reason": "Reverse the identified erroneous synthetic entry"
}
```

An entry is `correctable` while it has changes and no correction reverses it.
Preparation derives the exact inverse share changes and captures the register's
current sequence and head hash. The effective date may be today (UTC) or
earlier, since a rectification can be backdated; a later one is refused, because
it would hold back [later issues and transfers](#recording-issues-and-transfers-after-the-opening)
until that date. Preparation also refuses an entry of a company in which the
caller holds no current appointment, an entry already corrected or with no
changes, and an inverse that would take a stored holding below zero.

The preview shows the original entry's changes beside their inverse, and its
digest binds, for application, the register's sequence and head hash. The
correction's own requirements are `register_changed` (the register has a newer
entry than the revision preparation captured), `entry_already_corrected`
(another correction of the same entry was applied) and
`position_would_go_negative`. A correction the register has moved past cannot
be applied: reject it with a reason and prepare a new one against the current
register.

Application records the compensating entry, whose operation ID is the
correction's UUID, directly after the revision preparation captured. The
database also refuses a preparation whose changes are not the exact inverse,
whose register revision is not current, whose entry is already corrected, whose
authority fields are incomplete or whose effective date is after today, and an
application whose entry is not the exact compensating entry. Export records
follow the 2,557-day floor, purged by the daily retention job.

### Opening the register from the chain

The stored register of a deployed share class is initialised from one verified
canonical chain boundary, captured when the company prepares the opening. An
opening maps each wallet address holding shares at the boundary to a company
member ID; there are no free-typed quantities or dates. Its effective date is
the boundary block's date and its share changes are the boundary's holdings
grouped by the mapped members. Walletless members and several wallets per
member are supported. One address resolves to one member per company, an
existing wallet link for a mapped address must agree with the mapping, and a
mapping may not repeat an address. An opening stores no personal particulars: a
later [import](#importing-an-existing-register) records names and residential
addresses. The evidence is an `authority` upload. A staff-era opening can only
be rejected, whether or not a reviewer captured its boundary.

| Method and route                                      | Result                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/{uuid}/register/opening-holders/` | Read the chain for a class whose register is not opened: the block read (`number`, `hash`, `date`) and each holding address with its `shares`, the company `member` already linked to it and that member's `memberName`, or null, and `memberExists`, true exactly when the address is linked. Only for a current appointment holding `admin` or `prepare` |
| `POST /api/v1/tokens/register-openings/`              | Prepare the opening, capturing its boundary. `GET` lists, filterable by `company`, `token` and `status`; `{uuid}/` returns the request, captured boundary and its summary, mapping, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                                               |

The opening holders read shows a preparer which addresses to map. It captures a
canonical snapshot as preparation does, takes no lock and stores nothing, lists
holdings largest first then by address, and matches linked addresses regardless
of letter case. Because it reads the chain, only a current appointment holding
`admin` or `prepare` in the class's company may read it, under the same
identity requirement as register reads; the owner alone, other capabilities,
platform staff and other companies get the same 404 as an unknown class. A
class that is not deployed or paused, or whose register already has an entry,
is refused with 400 before the chain is read, and a chain that cannot be read
answers 503 without the provider's detail.

Preparation accepts this JSON, replacing UUIDs with those from the exercise:

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000011",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "token_id": "10000000-0000-4000-8000-000000000012",
  "authority_evidence": "10000000-0000-4000-8000-000000000013",
  "mapping": [
    { "address": "0x1111111111111111111111111111111111111111", "member": "10000000-0000-4000-8000-000000000014" }
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-OPENING-1",
  "reason": "Establish the register from the attributed deployment boundary"
}
```

Preparation checks the appointment, then captures a fresh canonical snapshot
(see [inspecting a snapshot](#inspecting-a-canonical-chain-snapshot)), including
the canonical transfer history that later classification needs. It reads the
chain before it takes the company lock and checks everything else against that
boundary under the lock. Its `boundarySummary` gives the boundary's block
number, hash and date and each holding address with its shares, mapped `member`,
`memberName` and `memberExists`, so a member the opening will create can be told
apart from an existing member the register cannot name. Preparation refuses:

- a class that is not deployed or paused, or whose register already has an entry;
- a mapped member of another company, or a mapped address already linked to
  another member of the company;
- a mapping that does not cover exactly the boundary's holding addresses, with
  none missing and none unknown, answered with the code `opening_holdings_moved`
  so that clients can offer to read the holders again;
- a completed issue or transfer that the boundary does not
  [represent](#classifying-completed-inclusions);
- a chain that cannot be read, with 503 and nothing recorded.

An identical preparation retry returns the opening without reading the chain
again. Approval and application read the chain again before they take the
company lock, only for a caller whose appointment is current and holds the
step's capability or `admin`; a chain that cannot be read refuses them with 503
rather than an unmet requirement, and rejection never reads the chain. The
preview shows the share changes and effective date the opening entry would
record, and its digest binds the boundary block's hash and, for application,
the class's register state: either that no register exists or its sequence and
head hash. The opening's own requirements are `boundary_changed` (reading the
chain again found the boundary block no longer canonical or no longer covered
by the approved finality policy, or the policy or chain changed),
`register_initialized`, `completions_not_represented` and
`wallet_linked_elsewhere` (a mapped address was linked to another member after
preparation). An identical decision retry returns the opening without reading
the chain.

Application commits the members, the wallet links, the opening entry, the
decision and the holdings projection atomically. The opening entry is the
register's first entry, dated on the boundary block's date; an explicitly empty
boundary produces an explicit empty opening, distinct from an uninitialised
register. Issuance and settlement completion take the same share-class lock, so
neither can interleave with an application. The database also refuses a
preparation for a class that is not deployed or paused or whose register
already has an entry, one without a boundary or whose boundary is not complete,
typed snapshot provenance for this class with its canonical transfer history, a
mapping that does not pair exactly with the boundary's holders, repeats an
address, names another company's member, contradicts an existing wallet link or
holds a value that is not a JSON string, any later change to an opening's
boundary or terms, and an application whose entry is not the exact opening
entry with every mapped wallet linked. The captured boundary is retained with
the opening. Until an opening is applied, the holders and CSV routes report the
register as not initialised.

### Linking wallets after the opening

After a class is opened, an issue or transfer that completes to a wallet no
member owns waits with the reason `unlinked` rather than creating a member, and
members are never merged by matching names (owner decision, 21 September 2026).
A wallet link records which member of the company owns each such wallet: a new
subscriber's, a first-time buyer's or another wallet of an existing member, and
a [chain grant](../plans/company-managed-registers/company-register-issues.md)
links its selected nominated wallet to a new member the same way before any
mint. Links are company-wide: one link serves every share class, and a company
needs no opened register to link, so a link applied before an opening shows its
member in the [opening holders read](#opening-the-register-from-the-chain). A
member ID may be new, and application creates it, or may already belong to the
company, and several addresses may map to one member. One address resolves to
one member per company, matched regardless of letter case, and an address
linked once is never linked again. The authority is documentary, as decided on
21 September 2026, uploaded as an `authority` upload. Company-run links reached
links once [#863](https://github.com/Ledova/ledova/issues/863) closed.

| Method and route                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/register-links/waiting-wallets/?company=` | `wallets`: each wallet that a completed issue or transfer of the company's opened classes waits for, as the [waiting list](#the-issuers-waiting-list) names it in `unlinkedWallets`, with `waiting`, the number of waiting effects naming it, and its statuses below, ordered by address. It reads only the database and takes no lock. Only for a current appointment holding `admin` or `prepare`: anyone else, platform staff and the owner alone included, gets the same 404 as an unknown company, and a `company` that is not a UUID is refused with 400 |
| `POST /api/v1/tokens/register-links/`                         | Prepare the link. `GET` lists, filterable by `company` and `status`; `{uuid}/` returns the link, its mapping and `mappingSummary`, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                                                                                                                                                                                                                                                             |

Preparation accepts this JSON, replacing UUIDs with those from the exercise:

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000021",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "company_id": "10000000-0000-4000-8000-000000000022",
  "authority_evidence": "10000000-0000-4000-8000-000000000023",
  "mapping": [
    { "address": "0x3333333333333333333333333333333333333333", "member": "10000000-0000-4000-8000-000000000024" }
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-LINK-1",
  "reason": "Link the new subscriber's wallet to their member record"
}
```

Preparation stores each address checksummed, in address order, and refuses an
empty mapping, one that is not a list of addresses and member UUIDs or that
repeats an address in any letter case, a mapped member of another company, and
an address already linked in the company, whether an opening or another link
linked it. A company in which the caller holds no current appointment holding
`admin` or `prepare` is answered as not found. The response's `mappingSummary`
gives each address with its member and `memberExists`, true when the member
already belongs to the company.

The preview and the waiting-wallets read show two statuses of each address, but
only for an address with a whitelist approval for the company, whatever its
status: `walletProof`, `proven` when the holder proved control of a Base wallet
at that address on Ledova with their own signature, otherwise `not_proven`, and
the `holderType` and `holderName` of the address's live identity, as the register
reads it. Any other address, such as one typed into a mapping, gets `null` for
all three, so the statuses reveal nothing about who holds an arbitrary address.
They are live and informational: no step requires them, they are not stored or
bound into the digest, and they never choose a member.

The preview digest binds, for application, the current links of the mapped
addresses, so a link made between the preview and the decision conflicts: the
new preview passes when the address was linked to the same member, and reports
`wallet_linked_elsewhere` otherwise. Application takes the company lock and
then every share class of the company, in order, and records in one
transaction:

- the new members and the links, skipping an address an opening or another link
  has since linked to the same member;
- then, for each share class in order, whatever issue or transfer was
  [waiting for the link](#recording-issues-and-transfers-after-the-opening).
  Each entry keeps its own recorder, the approving reviewer of an issue or the
  transferor, and is dated the day it is recorded. Recording in a class stops at
  the first effect it still cannot record, and an entry the register refuses is
  left waiting without undoing the link;
- the link as applied, with the decision.

A link makes no register entry of its own, changes no whitelist approval and
creates no proof of possession: deleting a wallet or losing its proof later does
not unlink it. Application can deadlock with an issue or transfer completing at
the same moment whose recorder, its approving reviewer or transferor, is the
person applying the link: the application holds that person's user row while it
waits for the share-class lock, and the completion needs the row to commit.
PostgreSQL aborts one of them, which can be retried. Corrections share this
pattern.

Openings follow the same rules. An opening's own mapping links its addresses
when it is applied, and its preparation refuses an address already linked to
another member. An applied link makes a pending opening that maps the address to
another member report `wallet_linked_elsewhere`, as an applied opening does for a
pending link. Once linked, the member's
[register name](../architecture/register.md#membership-and-identity) resolves
from all of its wallets: a live identity wins over recorded particulars, and
wallets that resolve to different people make the member ambiguous. Linking an
address that an acknowledged `unlinked` reconciliation discrepancy names can
also surface new discrepancies at the next reconciliation. The database also
refuses a mapping that is empty, repeats an address, holds a value that is not
a JSON string, names another company's member or names an address already
linked in the company, and an application that leaves a mapped wallet unlinked
to its member.

## Register instructions for issues

Fresh issues are company-run: [non-paid chain grants](../plans/company-managed-registers/company-register-issues.md)
use `/api/v1/tokens/register-issues/`, [paid issues](../plans/company-managed-registers/company-paid-issues.md)
over a recorded PAID subscription use `/api/v1/tokens/register-paid-issues/`,
delivered by [#951](https://github.com/Ledova/ledova/pull/951), and an imported
class uses the walletless [register grant](../plans/company-managed-registers/register-grants.md)
and cannot use the chain path merely because a contract has been deployed. The
direct owner issue POST, fresh staff approval and admission of non-paid
requests, and fresh staff paid ISSUE approval and allotment are retired; staff
**Reject** remains for retained review requests, and financial receipt/refund
producers remain separate pending #868. [Register architecture](../architecture/register.md)
describes how each family's finalised outcome supplies the member's once-only
ISSUE entry.

The retained instruction workflow below exists for already-approved direct
issues still awaiting register cover. Staff verify a named director's approval
(owner decision 2, 22 September 2026): the company owner submits an instruction
of kind `issue` listing each retained direct issue by its issuance request,
recipient wallet and whole number of shares, naming the approving director and
carrying a verified company document, of which it retains a private copy. A
[transfer instruction](#register-instructions-for-transfers) has its own kind.

| Method and route                                        | Result                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/tokens/register-instructions/`            | Submit the owner's instruction; return the retained instruction                                                                                                                           |
| `GET /api/v1/tokens/register-instructions/`             | Paginated instructions for companies whose register the caller may read: as the owner, or through a current appointment holding `admin`, `read_register`, `prepare`, `approve` or `apply` |
| `GET /api/v1/tokens/register-instructions/{uuid}/`      | Instruction, items and decision                                                                                                                                                           |
| `GET /api/v1/tokens/register-instructions/{uuid}/file/` | Authenticated attachment of the retained authority file                                                                                                                                   |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000041",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "document_id": "10000000-0000-4000-8000-000000000013",
  "kind": "issue",
  "items": [
    {
      "request": "10000000-0000-4000-8000-000000000042",
      "recipient": "0x3333333333333333333333333333333333333333",
      "amount": "100"
    }
  ],
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-ISSUE-1",
  "reason": "Record the retained non-paid issue the board approved"
}
```

Each item must belong to the share class and match the retained non-paid
request's recipient and shares as they stand; the request must already be
approved and await that cover, so submitted and under-review requests are
refused. Listing a retained approval adds the cover its entry waits for, without
approving it again. Historical paid instructions keep their subscription
references, financial terms and staff decisions as history and supply no fresh
paid admission route; new subscription items and requests linked to a paid
subscription require the company paid family.

In **Admin → Tokens → Register instructions**, open the instruction's review
link. An active staff user with change permission inspects the retained file,
the named director, the authority reference and the company identity, checks
each item's exact terms, shown with the recipient wallet, the names it
identifies, the shares and the class, and that the director is not a recipient,
then explicitly confirms and chooses **Approve and apply**. Submission, review
and application all refuse:

- an item whose recipient or shares differ from its request's current terms, as
  when they change after submission;
- an item that does not name a retained non-paid approval awaiting cover, or
  an item another applied instruction already covers;
- a director who is the recipient an item identifies, by the request's
  recipient name or the profile name of the account holding the recipient
  wallet;
- any instruction for a share class an [import opened](#importing-an-existing-register),
  which records no chain issue until it is on chain.

Rejection with a reason stays available. Application rechecks the
reviewer-bound, expiring confirmation, the retained evidence and every item
under the company and share-class locks, then records in one transaction any
listed retained issue that completed and was
[waiting for cover](#recording-issues-and-transfers-after-the-opening).
Repeated identical submissions and decisions are idempotent, and conflicting
UUID reuse is refused. The database keeps instructions immutable and
undeletable, refuses an item outside the instruction's company and share class,
customer-role or forged legacy decisions, an application that leaves a listed
request unapproved and, since `tokens/0077`, any application for a class an
import opened. Retention follows the company register decisions.

## Register instructions for transfers

Directors decide whether to register a transfer, and they decide on a settlement
after it completes, while its entry waits (owner decision 2, 22 September 2026).
The signed order both parties signed, which the settlement retains, is the
instrument of transfer; whether it is a proper instrument under s1071B is left
open. The company owner submits the directors' approval through the same route as
an [issue instruction](#register-instructions-for-issues), with kind `transfer`,
listing the exact completed settlements a named director approved, each with its
seller and buyer wallets and whole number of shares. The instruction's share class
is the class of every settlement it lists.

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000051",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "document_id": "10000000-0000-4000-8000-000000000013",
  "kind": "transfer",
  "items": [
    {
      "settlement": "10000000-0000-4000-8000-000000000052",
      "seller": "0x3333333333333333333333333333333333333333",
      "buyer": "0x4444444444444444444444444444444444444444",
      "amount": "25"
    }
  ],
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-TRANSFER-1",
  "reason": "Register the transfer the board approved"
}
```

A settlement is visible only to its two parties, so the owner takes each item
from the [waiting list](#the-issuers-waiting-list): a waiting `transfer`'s
`source` is the settlement, its `wallets` are the seller's then the buyer's, and
its `shares` are the amount. Submission reads the settlement on the operator
connection. Each item must be a completed settlement of the share class, on
exactly its seller, buyer and shares, that no applied instruction covers and the
register has not entered. A settlement between two wallets of one member records
nothing and needs no instruction.

Staff review it on the same admin page. For each settlement it shows the seller's
and buyer's wallets, the member each wallet is linked to and the name it
identifies, the shares, the class and the completion time. Submission, review and
application refuse a director who is either party, by the profile name of the
account holding that wallet. Application rechecks every settlement under the
company and share-class locks, then records whatever waited for the instruction,
in chain order, each transfer still recorded by the transferor. Rejection with a
reason stays available, and idempotency, conflicts, immutability and retention
are as for issue instructions.

The database checks each item's shape when an instruction is inserted, and
refuses one that mixes issue and transfer items. It cannot check the settlement
then, because the company's own connection cannot read a settlement it is not a
party to. At application it refuses a listed settlement that is not completed in
the instruction's share class on its listed terms, or that another applied
instruction already covers.

A transfer the directors decline is not modelled yet. The owner submits no
instruction for it, and its settlement keeps waiting as `uninstructed`, stays on
the waiting list and holds later issues and transfers in its class behind it.
Later transfer decisions and market settlement are deferred
[#869](https://github.com/Ledova/ledova/issues/869) work.

## Classifying completed inclusions

[Register architecture](../architecture/register.md) states the
rule: each completed issuance and settlement carries the finalized receipt
recorded when it completed, the captured boundary carries the canonical
transfer history it folded, and classification asks whether the completion's
transaction is in that history. `unopened` means the class has no applied
opening; `opening` that the transaction is in the history at the same block and
hash, so the opening's holdings already contain it; `after_opening` that it is
in a later block and absent from the history; and `attribution` that the
evidence cannot place it, which covers a completion at an earlier height whose
transaction is missing from the history, one recorded after the boundary yet
present in it, and every completion against a missing or malformed history,
whatever its height. These are the effects the platform itself completes; a
holder's own on-chain transfer outside settlement is a reconciliation question,
not a classified completion.

Preparation refuses an opening whose captured boundary leaves any completed
effect unrepresented, naming the effect, its block and the reason, and refuses a
boundary without a valid history outright; PostgreSQL refuses to record one too.
Approval and application recheck it and report `completions_not_represented`.
The boundary is captured once, at preparation, and then frozen, so the remedy
for a pending opening is a fresh opening whose new boundary covers the effect,
with the mapping that boundary requires; reject the superseded opening with a
reason. Both completions take the share-class lock the application holds, so a
completion cannot land in the gap between capture and application unobserved.
A completed effect with no recorded finalized receipt, and a settlement
completed before settlement evidence was retained, is refused outright rather
than classified and needs operator attribution before any boundary can
represent or exclude it; the database requires every new completion to record
its finalized receipt, bound to its original confirmed mint journal, and never
rewrites, removes or drops recorded evidence on a downgrade.

The read-only operator command below reports the boundary and each
classification. It performs no provider read and writes nothing:

```bash
python manage.py register_inclusions --token TOKEN_UUID
```

### Openings captured before the history was retained

`tokens/0066` introduced the retained history and rewrites no existing opening,
so a boundary captured before it has none. What that means depends on whether
the opening was applied:

| Opening | Behaviour                                                                                      | Remedy                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Pending | It was submitted for the retired staff review, so it can only be rejected                      | Reject it with a reason, then prepare a fresh opening, whose preparation captures a boundary with history |
| Applied | It remains the register's opening, and every completion classifies as `attribution` against it | None implemented                                                                                          |

An applied opening cannot be recaptured. The register is initialised, so a fresh
opening is refused at preparation and at application, and the applied opening's
boundary and OPENING entry are immutable. Holding every completion for
attribution keeps a later workflow from recording an effect the opening may
already contain. Resolving such a register needs a separately specified recovery
procedure, and none exists yet.

## Recording issues and transfers after the opening

[Register architecture](../architecture/register.md) states the
rules: once a share class has an applied opening, each completion that
classifies `after_opening` is recorded as a register event in chain order, by
block and then by the transaction index its finalized receipt records (a
completion finalized before `tokens/0068` has no index and follows the kind and
ID within its block), dated the day the entry is made (UTC), with the completed
issuance or settlement as its operation ID so that recording is idempotent. An
issue is recorded by the company appointee who applied the grant or paid issue,
or by the original staff reviewer or allotter under a retained
[register instruction](#register-instructions-for-issues); a settlement's
transfer is recorded by the transferor, whose signed order is the instrument,
once an applied [transfer instruction](#register-instructions-for-transfers)
lists it, because directors decide on it after it completes. An effect the
opening already represents records nothing, and so does a settlement between
two wallets of the same member. Only an issue or transfer entry counts: a
correction or opening that reuses a completion's ID does not mark it recorded.
Paid issues approved since `tokens/0073` are covered by their applied
instruction; entries recorded before `tokens/0073`, transfer entries recorded
before `tokens/0076` and entries recorded before late-entry dating stay as they
are, and no approval is invented for them. A request with no recorded reviewer
waits rather than recording someone else.

Recording stops at the first effect it cannot record: a wallet with no link, an
issue or transfer no applied instruction covers, a completion held for
attribution, or an entry the register refuses, such as a transfer whose
seller's stored holding does not cover it after a move outside settlement.
Nothing is recorded past that effect, so the stored holdings never skip ahead
of the chain. The completion itself still commits, because a register record
must not stall the workflow; the reason is logged. Recording resumes at the
next completion in that share class, the next applied wallet link in the
company or the next applied register instruction for that share class, each of
which takes the share-class lock first, a wallet link every class of its
company, so a completion in progress cannot miss the new link or cover.
`register_inclusions` reports `recorded` for each effect. The register never
dates an issue or transfer before its latest entry: while the latest entry is
dated after today, as with an opening whose boundary block's time runs ahead of
the platform's clock, the next issue or transfer waits as `refused` until a
recording on or after that date.

### The issuer's waiting list

Anyone who may read the register (the company owner, or a current appointment
holding `admin`, `read_register`, `prepare`, `approve` or `apply`) can list the
completed effects of a share class that are not yet in the register, in the
order recording will take them:

| Method and route                              | Result                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/{uuid}/register/waiting/` | `effects`: each completed effect after the opening not yet recorded, in chain order, or `null` where `waitingEffects` is `null` |

Each effect carries its `kind` (`issue` or `transfer`), its `source` (the
issuance or settlement ID, which becomes the entry's operation ID), the `block`
that finally included it, its `wallets` (the recipient's for an issue, the
seller's then the buyer's for a transfer), its `shares`, its `reason` and
`unlinkedWallets`:

| Reason         | Why it waits                                                                                  | What resolves it                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attribution`  | The opening's captured boundary cannot place its completion                                   | The attribution procedure, not yet specified                                                                                                                              |
| `unlinked`     | A wallet it names is linked to no member; `unlinkedWallets` lists which                       | A [wallet link](#linking-wallets-after-the-opening)                                                                                                                       |
| `unreviewed`   | The issue's request records no approving reviewer, as when the reviewer's account was deleted | Nothing yet: recording does not invent a recorder                                                                                                                         |
| `uninstructed` | No applied register instruction covers the issue or transfer                                  | A register instruction that lists it: [for an issue](#register-instructions-for-issues) or [for a transfer](#register-instructions-for-transfers)                         |
| `refused`      | Nothing of its own: recording last tried it and the register refused the entry                | The logged refusal's cause, such as a seller's stored holding that does not cover the transfer or a latest entry dated after today; recording tries again at its next run |
| `behind`       | Nothing of its own: an earlier effect in the class waits                                      | Resolving the earlier effect                                                                                                                                              |

A waiting transfer's row carries what a transfer instruction names: its `source`,
its two `wallets` and its `shares`. The list, the `waitingEffects` count and
recording walk the same classification in the same order, so the count is
always the list's length and the first effect listed is the one recording stops
at. The route answers 404 for anyone outside the register-read scope, from one
database snapshot.

## Reading the register

[Register architecture](../architecture/register.md#api-and-export) describes
the holders route and the CSV export, which serve the stored holdings with the
chain unreachable. Before a share class's opening is applied, holders report
`initialized: false` and the export is refused with 409
`register_not_initialized`: prepare, approve and apply an opening to start it. A
positive `waitingEffects` count, or the CSV's "Completed effects waiting to be
recorded" row, means completions are not yet in the holdings; the
[waiting list](#the-issuers-waiting-list) names each of them and why it waits.
A count of `null`, or `unknown` in the CSV, means the completions could not be
classified, or the register has no captured boundary to classify them against,
as with one loaded by the synthetic command above; `register_inclusions` prints
the refusal or a null boundary. A register an
[import opened](#importing-an-existing-register) has no boundary either: its
count is 0 while nothing has completed on chain for the class, and its CSV says
`not on chain` where another would say `never` for the reconciliation or
`never read, stale` for the fold.

## Preparing an inspection copy

Anyone may ask a company for a copy of its register, and the company must give
it within 7 days after a proper request (s173(3) of the Corporations Act). The
company decides whether a request is proper and provides the copy to its
recipient. The [company workflow](../plans/company-managed-registers/company-inspection-copies.md)
replaces the earlier staff preparation step.

You need a current personal appointment for the exact company with administration
or a register capability. Ownership and staff permissions grant no inspection-copy
authority. The share class needs an applied opening.

1. Keep the company's written instruction, and note its reference, the date the
   request was made and who the copy is for.
2. In the **Register**, select the company and open the share class. Enter the
   instruction reference, request date and recipient in **Inspection copy**
   (or choose **Prepare inspection copy** in mobile).
3. Choose **Preview inspection copy**, review the request and register sequence,
   then **Confirm and download inspection copy** in web or **Confirm and share
   inspection copy** in mobile.

The API/browser download, `register-SYMBOL-inspection-copy.csv` (mobile shares
`inspection-CLASS-UUID.csv`), is the register CSV with a
fourth section: the request date, the instruction, the recipient, the date it
was produced, and whether that is more than 7 days after the request. Preserve the
file unchanged when providing it to the recipient. The workflow refuses, and records nothing, when the
share class has no applied opening, when the request date is after today in
Sydney's calendar, or when a field is blank. A changed register source or lost
appointment also refuses; expiry during generation rolls back the record. Editing,
refreshing, closing or changing accounts/classes retires the prepared client request.

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

You need the **Can change register outputs** permission. The share class needs
an applied opening.

1. Keep the company's written instruction, and note its reference and the issue
   or transfer it names.
2. Find that entry's number, its sequence in the share class's register. An
   entry still without a certificate is on the [due list](#working-the-due-list)
   with its number. Admin has no list of every entry: from `backend/`, run
   `python manage.py shell`, which uses the operator connection, and list the
   class's entries:

   ```python
   from tokens.models import RegisterEntry
   RegisterEntry.objects.filter(register__token_id="TOKEN_UUID").values_list(
       "sequence", "kind", "effective_on", "operation_id", "corrects__sequence"
   )
   ```

   A chain issue's operation is its share issuance and a chain transfer's is its
   swap order. A direct ledger issue or transfer instead names its retained grant
   or transfer command. A correction's last value is the number of the entry it reverses.

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

## Preparing notice figures

A company notifies ASIC of each share issue within 28 days (s254X of the
Corporations Act), and a proprietary company also notifies changes to its
members and share structure (s178A, s178C and s178D). Staff prepare the figures
for those notices only on the company's written instruction. The company, or the
accountant who lodges its notices, decides which notices they support and lodges
them (owner decision, 22 September 2026).

You need the **Can change register outputs** permission the other outputs use.
The share class needs an applied opening.

1. Keep the company's written instruction, and note its reference and the first
   day of the period it asks for. An entry is dated the UTC day it was made,
   which on a Sydney morning is the day before, so start the period no later
   than the date of the first entry the company has not yet notified. The
   [due list](#working-the-due-list) shows every entry no figures cover yet.
2. In **Admin → Tokens → Register outputs**, open the share class and choose
   **Prepare notice figures**.
3. Enter the first day of the period and the instruction's reference, then
   choose **Prepare and download**.

The download, `notice-figures-SYMBOL-DATE-to-N.csv` for the figures from DATE
to register entry N, has four sections, each after a heading row:

- the share class, the first day of the period, the register entry the figures
  run to, the instruction and the day they were produced;
- **Entries in the period**: a row for each member changed by each issue,
  transfer or correction dated on or after that day, in entry order, with the
  change in shares, negative for shares the member gave up, and an issue's amount
  paid. A correction names the entry it reverses. The opening is never listed.
- **Class at the register head**: the issued supply, the number of members
  holding shares and the total amount paid;
- **Members changed in the period, at the register head**: each changed
  member's name, residential address, shares held, 0 for one who holds none,
  and amount paid.

`not recorded` means Ledova cannot establish the amount paid exactly, as for
shares received by transfer; the company supplies it from its own records. Names
and addresses are the ones the register gives when you prepare the figures, and
a member the register cannot name is printed as the register prints them rather
than refused. A negative change prints as a plain negative number; a name,
address or instruction that begins with a formula character carries a leading
apostrophe so that a spreadsheet does not read it as a formula. Check the
figures against the instruction and give the file to the company unchanged. The
page refuses, and records nothing, when the share class has no applied opening,
when the first day is after today in Sydney's calendar, or when a field is
blank. A period with no entries is not refused: its sections list none.

Each preparation is recorded once in **Admin → Tokens → Register exports** as
kind **Notice figures**: who prepared it, the register entry the figures run to
as the register sequence, the number of changed members as member rows, the
first day of the period, the instruction and the file's SHA-256 digest. Search
by instruction. Ledova keeps no copy of the file. To confirm that a file is the
one prepared, compare the output of `sha256sum notice-figures-SYMBOL-DATE-to-N.csv`
with the record's digest. Preparing the same period on the same instruction
again makes a new record, and the same file while the register, the members'
particulars and the day produced are unchanged. The records cannot be rewritten,
are read only by staff, and follow the export records' 2,557-day floor and daily
purge.

## Working the due list

The **Register outputs due** page lists every certificate and set of notice
figures still due across all companies and share classes, earliest due first. A
certificate is due two months after an issue and one month after a transfer's
settlement order was created; notice figures are due 28 days after an issue, or
after a proprietary company's transfer.
[Outputs due](../architecture/register.md#outputs-due) has the exact rules. You
need the **Can change register outputs** permission the outputs use. The page
records nothing.

1. In **Admin → Tokens → Register outputs**, choose **Register outputs due**.
2. Read each row: the company, share class, entry number, kind and effective
   date, what is due, the due date, and whether it is overdue, meaning the due
   date is before today in Sydney's calendar.
3. Tell the company what is due and when. The obligations are the company's, and
   the company lodges its notices and delivers its certificates.
4. On the company's written instruction, follow the row's link to the page that
   prepares the output, then [prepare the certificate](#preparing-a-certificate)
   for the row's entry number or [prepare the notice figures](#preparing-notice-figures).

A certificate row leaves the list once a certificate is prepared for its entry.
A notice figures row leaves it once figures are prepared whose period starts on
or before the entry's date and runs to its number or later. Issue and transfer
entries are dated the day they are made, so a later one never carries an earlier
date, and figures starting on the date of the earliest notice figures row still
listed cover every such row. The page knows only what Ledova prepared: a row
stays when the company produced the output elsewhere or needs none.

## Producing a company pack

A company pack is one zip of a company's records: every share class with its
register of members and the history of entries behind it, the approvals behind
those entries, the issues and the subscriptions still to be allotted or
refunded, with their payments as recorded, the wallet approvals, what is still
waiting to be entered or owed, the transactions Ledova sent for each class and
the settlements it executed, the company, its documents with the evidence copy
behind each approval, what the company published to its members with each
resolution's result and each dividend's payment records, and the contract
information a successor needs, with a README that explains each file and how to
check it. Staff produce it only on the company's written instruction
naming who it is for, or on a document that legally compels disclosure, such as
a lawful information request, referenced in its place (owner decision,
23 September 2026). [The company pack](../architecture/company-pack.md) describes
what it carries and what it leaves out.

You need an active staff account with **Can change company pack**
(`companies.change_companypack`) and **Can view company document**
(`companies.view_companydocument`). Company permissions do not include the
first, and it grants nothing else. The company needs at least one share class.

1. Keep the instruction or the compelling document, and note its reference and
   who the pack is for.
2. In **Admin → Companies → Company packs**, find the company and choose
   **Produce a company pack**.
3. Enter the reference and the recipient, then choose **Produce and download**.

The download, `company-pack-ACN-YYYYMMDDTHHMMSSZ.zip`, is named for the moment
the records were read, in UTC, and carries every current and former member's
name and residential address, the names of the staff who reviewed the
company's register changes, the company's documents, and each publication's
roll of names and holdings. Give it unchanged to the recipient the instruction names. The page
refuses, and records nothing, when the company has no share classes, when a
field is blank, or when an entry in a share class's register no longer matches
its stored hash. That refusal names the class and the entry: run
`python manage.py register_foundation verify --token TOKEN_UUID` from
`backend/` for that class, and do not produce a pack until the register
verifies. It also refuses, and records nothing:

- when the stored files it would carry come to more than 256 MiB. The refusal
  names the total. A pack that size needs background production, which is not
  built: ask engineering, because the owner decided it is built the first time
  a real pack goes over the ceiling.
- when a company document's or an evidence copy's file is missing from private
  storage. The refusal names the document or record: restore the file to
  private storage, then produce the pack again.
- when an evidence copy's stored bytes no longer match the SHA-256 recorded
  when its record was submitted. The refusal names the record. Restore the copy
  that was submitted, and find out how it changed, before producing a pack. A
  publication's document or a payment record's remittance evidence is refused
  the same way, naming the publication or the payment record.
- when an event in a publication's record no longer matches its stored hash, or
  a publication's roll no longer has the rows and digest it recorded. The
  refusal names the publication. Run
  `python manage.py publications verify --publication PUBLICATION_UUID` from
  `backend/` ([verifying a resolution](publications.md#verifying-a-resolution)),
  and do not produce a pack until it verifies.

Each pack is recorded in **Admin → Tokens → Register exports** as kind
**Company pack**, once for each share class it carries: who produced it, the
class's register sequence and row counts, the instruction, the recipient, and
the SHA-256 of the pack's `manifest.json`, the same on every row. Search by
instruction or recipient. Ledova keeps no copy of the file. To confirm that a
pack is the one produced, unzip it and compare the output of
`sha256sum manifest.json` with the records' digest; the manifest lists the
SHA-256 of every other file. Producing again makes new records, and a digest
that differs if anything in the records or the request has changed, including
the time. The records cannot be rewritten, are read only by staff, and follow the
export records' 2,557-day floor and daily purge.

The pack explains how control of the share class contracts and the company's
registry would be handed to another provider, and does not hand it over: its
README names each contract with the owner Ledova's records state, lists what
was still unresolved when it was produced, and gives the exact
`setShareTokenApproval` and `transferOwnership` calls in the order to make
them. That handover is a separate operation, not built, for when a real
company first leaves. The pack never carries a signed transaction's bytes,
only each attempt's hash, nonce, signer and chain id.

## Importing an existing register

A company that arrives with a register keeps its members' particulars and its
pre-platform former members. Under the owner decisions of 21 and 22 September
2026, an import for a class already opened from the chain adds particulars and
former members and leaves holdings to the stored register; for a class not yet
on chain, the import is the opening, and that class then records
[walletless grants](../plans/company-managed-registers/register-grants.md) and
[direct transfers](../plans/company-managed-registers/register-transfers.md)
as ledger entries, with genuine cessation and return history, but no chain
issue or transfer until it is anchored on chain, which remains later work. The
applied import's copies of its evidence are kept like opening and correction
evidence; a member's live verified identity wins over imported particulars; and
a mistaken opening import strands its class until partial corrections exist,
because a correction can reverse only its whole opening entry and the class
takes no second import, which is accepted during the synthetic experiment and
settled before any real data.

The [company register decisions](#company-register-decisions) apply, with two
uploads, the company's current share register as `share_register` and its ASIC
extract as `asic_extract`, and the company's own statement of the extract's
issued total and member count for the class; Ledova staff verify neither. A
share class takes one applied import: preparation and application each refuse
another once one is applied, and a partial unique index backs them. The
[import screens](../architecture/clients.md) on
Register in both clients are delivered.

| Method and route                        | Result                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/tokens/register-imports/` | Prepare the import. `GET` lists, filterable by `company`, `token` and `status`; `{uuid}/` returns the request, rows, stated figures, stage and decisions; `{uuid}/file/` and `{uuid}/asic-file/` stream the import's copies of the register document and the ASIC extract; `{uuid}/decision-preview/` and `{uuid}/decide/` as above |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000031",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "register_evidence": "10000000-0000-4000-8000-000000000032",
  "asic_evidence": "10000000-0000-4000-8000-000000000033",
  "asic_issued_total": "100",
  "asic_member_count": 1,
  "as_at": "2026-09-20",
  "members": [
    {
      "member": "10000000-0000-4000-8000-000000000024",
      "name": "Synthetic Member",
      "residential_address": "1 Synthetic Street, Sydney NSW 2000",
      "shares": "100",
      "entered_on": "2019-05-01",
      "amount_paid": "250.00"
    }
  ],
  "former_members": [
    {
      "name": "Synthetic Former",
      "residential_address": "2 Synthetic Road, Hobart TAS 7000",
      "shares": "40",
      "ceased_on": "2022-03-01"
    }
  ],
  "authority": "director_resolution",
  "approving_director": "Synthetic Director",
  "authority_reference": "SYNTHETIC-RESOLUTION-IMPORT-1",
  "reason": "Import the company's existing register"
}
```

A class is not yet on chain while its register has no entries, no issuance
request for it has ever been approved and no register instruction for it has
been applied: an undeployed class, or a deployed one never minted. Its import
names each current member by a new member ID the company chooses or by an
existing member of the company, and a former member may have ceased on the
register date itself. Preparation and application refuse such a class once an
issue has been approved or an instruction applied for it: open it from the chain
instead, then import its particulars. Preparation also refuses, with a message
naming the problem:

- stated figures that differ from the rows' total shares and member count;
- for an opened class, a current member who is not already a member of the
  company with a stored holding, and for any class a member of another company;
- a name of more than 255 characters or a residential address of more than 1,000;
- `shares` that is not a whole number of at most 78 digits;
- an `amount_paid` that is not a plain amount such as `250.00`, with at most two
  decimal places and eighteen whole digits, or `null` when not known;
- dates that follow the register date;
- for an opened class, a former member who ceased on or after the register's
  opening, because the stored register and the fold record later cessations;
- a former member who ceased before the former-member retention period
  (`FORMER_MEMBER_RETENTION_DAYS`, 2,557 days by default), because the retention
  job would purge them.

The preview shows, for each member, the imported name beside the member's linked
wallets and current live identity, so names swapped between equal holdings
show, and the stored date entered beside the imported one, and compares each
imported holding with the stored one. A class not yet on chain has nothing
stored or on chain to compare, so the stated figures and the names beside the
holdings are the only check. The digest binds, for application, the register's
sequence and head hash. The import's own requirements are
`class_has_applied_import`, `class_not_openable` (a class not yet on chain had
an issue approved or an instruction applied), `holdings_differ` (an opened
class's holdings differ from the rows, including a member the import leaves
out), `former_member_after_opening` and `former_member_before_retention`.

For a class not yet on chain, application first opens the register in the same
transaction. It creates the new members and records the opening entry: its
operation ID is the import's UUID, it is dated the register date, it holds each
member's shares, and the person applying it records it, so the register's
sequence is 1. It links no wallets: a
[wallet link](#linking-wallets-after-the-opening) links them. A class opened
another way after preparation takes the import by the opened class's rules.
Application then stores each member's particulars, dated the register date,
except where the member already has particulars dated later, from an import or
a [particulars change](#changing-a-members-particulars), and the imported
former members. It keeps the register sequence on the request. The database
also refuses a preparation whose stated figures differ from the rows, rows
whose keys or types differ from what preparation accepts, a member of another
company or, for an opened class, anyone not already a member of this company,
a former member who ceased on or after an opening the import did not record,
an import for a class not yet on chain that has an approved issue or an applied
instruction, an application that opens a register unless the register's only
entry is exactly that opening, with sequence 1, the import's UUID, members and
shares, register date and the person applying it, and still nothing approved,
an application whose figures differ from the rows or that leaves a member
without particulars from it, from a later-dated applied import or from a
later-dated change, particulars naming an import as their source unless they
are written during that import's application, through the company command, by
the person applying it, for a member the import lists, with exactly that
member's name and address and the register date, and a second applied import
for the class.

[Membership and identity](../architecture/register.md#membership-and-identity)
says how recorded particulars fill in, how a treasury label is read and how the
imported date entered and amount paid apply to a member the opening carried
in. The holders API and the CSV list imported former members beside the
chain-derived ones, and a folded former member whose wallet resolves to no
profile and no resolved stamp, or only to a treasury label, takes the
particulars of the member the wallet is linked to. A class an import opened
reads as not on chain, as [reading the register](#reading-the-register)
describes, and takes no [register instruction](#register-instructions-for-issues)
until it is. The daily retention job purges particulars once the member has
held nothing in the company for the 2,557-day floor, and imported former
members that long after their date ceased; it purges nothing else of an import
([data retention](uploads.md#data-retention)).

## Changing a member's particulars

A company keeps its members' names and residential addresses up to date itself.
The [company register decisions](#company-register-decisions) apply, with one
`supporting` upload the company provides, such as a deed poll or a member's
notice of a new address, and a reason. The latest "as at" date wins across
imports and changes, with the one applied later winning a shared date, and a
member's live verified identity still wins over both. Members editing their own
particulars is the separate [Profile increment](../plans/company-managed-registers/member-profile.md)
of [#866](https://github.com/Ledova/ledova/issues/866). The Register screen in
both clients lists the company's particulars changes and prepares a change
from a current member's row.

| Method and route                                    | Result                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/tokens/register-particulars-changes/` | Prepare the change. `GET` lists, filterable by `company`, `member` and `status`; `{uuid}/` returns the request, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` (the change beside the member's current particulars) and `{uuid}/decide/` as above |

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000041",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "member": "10000000-0000-4000-8000-000000000024",
  "supporting_evidence": "10000000-0000-4000-8000-000000000042",
  "name": "Synthetic Member Renamed",
  "residential_address": "8 Synthetic Street, Melbourne VIC 3000",
  "as_at": "2026-09-20",
  "reason": "The member changed their name by deed poll and moved"
}
```

`as_at` is the date the company's register records the change: today (UTC) or
earlier. A change dated on or after the date of the member's current particulars
replaces them when it is applied. Preparation trims the name, address and
reason, and refuses a member of a company in which the caller holds no current
appointment, an empty name, residential address or reason, a name of more than
255 characters, an address or reason of more than 1,000, a date after today or
before the date of the member's current particulars, and a member who has held
no shares in the company since the retention cutoff
(`FORMER_MEMBER_RETENTION_DAYS`, 2,557 days by default), whose particulars the
register no longer keeps.

The preview shows the change beside the member's current particulars, their date
and the import or change that recorded them, and its digest binds, for
application, the member's current particulars: their name, address, date and
source, so particulars recorded in between conflict. The change's own
requirements are `member_left_retention` (the member has held no shares since
the retention cutoff, so the register no longer keeps their particulars) and
`newer_particulars_exist` (the member's particulars are now dated after the
change, from a later import or change).

Application records the change's name, residential address and date as the
member's particulars, naming the change as their source. The database also
refuses a preparation for a member of another company, with a blank name,
address or reason, or dated after today, an application that does not record
the change's particulars for its member, particulars naming a change as their
source unless that change's application writes them with exactly its member,
name, address and date, particulars naming an import as their source unless
that import's application writes them, moving particulars to another member or
to an earlier date, whichever recorded them, removing particulars during any
company command (outside one, the retention purge removes them, and the
database does not tell it apart from other operator code), and any write to
particulars from the app role. The daily retention job purges a member's
particulars, whichever recorded them, once the member has held nothing in the
company for the 2,557-day floor, and nothing else of a change
([data retention](uploads.md#data-retention)).

## Reconciling with the chain

Every six hours, at :50 UTC, `reconcile_every_register` reconciles each share
class that has an applied opening; a class an import opened has none and is not
reconciled. It reads the chain; it writes only
reconciliation records, never a register entry. It captures a fresh canonical
snapshot at the finality boundary, as an opening's preparation does, and
compares it with the stored register under the share-class lock that completions
take:

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

A transfer of zero shares is ignored, and an
[acknowledged](#acknowledging-a-discrepancy) discrepancy is treated as explained.

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

| Discrepancy                    | Meaning and next step                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unrecognised_transfer`        | A chain transfer after the opening that no recorded, waiting or executing platform operation accounts for, such as a direct token transfer between whitelisted wallets. A transfer of zero shares is never reported. Investigate it; if it is accepted, [acknowledge](#acknowledging-a-discrepancy) it and the rows it causes, otherwise dispute it with the parties |
| `missing_transfer`             | A completed effect whose transaction is not on chain in its block. Treat it as a reorganisation: stop, and attribute it before relying on the register. It cannot be acknowledged                                                                                                                                                                                    |
| `member`, `unlinked`, `supply` | Holdings or supply that differ from the stored register plus pending movements and earlier acknowledgements. They accompany one of the others, or follow an applied correction, which changes the stored register and not the chain. Acknowledge them once their cause is understood                                                                                 |
| `attribution`                  | A completion the evidence cannot place, as in [classification](#classifying-completed-inclusions). It cannot be acknowledged                                                                                                                                                                                                                                         |

To reconcile one share class on demand, from `backend/`:

```bash
python manage.py register_reconcile --token TOKEN_UUID
```

It prints the retained record. The database refuses to rewrite or delete a
reconciliation, or to record one inconsistent with its status. Only the
operator records them. The company reads its own, and register readers read them
through the [reconciliation API](#acknowledging-a-discrepancy). Downgrading
`tokens/0070` refuses while any exist.

### Acknowledging a discrepancy

The register itself cannot follow a divergence it did not cause: no entry
records an outside transfer, and a correction only compensates an existing
entry. Once the company has investigated a divergence and accepted it, it
acknowledges it, one row at a time, from the share class's latest
reconciliation. Since 5 October 2026 this is one company step, under the owner's
[company-run register decisions](../decisions.md#company-run-register-authority-and-evidence):
a current appointment holding `admin` or `approve` acknowledges one specific
discrepancy with a written reason. There is no Ledova staff step and no second
person. Staff permissions, company ownership alone and shareholding grant no
acknowledgement. The company cannot start a reconciliation; the six-hourly job
and the operator's `register_reconcile` run them. The Register screen in both
clients shows each class's latest reconciliation and takes acknowledgements,
through the API below.

| Method and route                                                   | Result                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/register-reconciliations/`                     | Paginated reconciliations, newest first, of share classes whose register the caller may read: as the owner, or through a current appointment holding `admin`, `read_register`, `prepare`, `approve` or `apply`. Filter by `company` and `token` |
| `GET /api/v1/tokens/register-reconciliations/{uuid}/`              | The record: status, block, register sequence, any failure, whether it is the class's `latest`, and each discrepancy as stored with `acknowledgeable` and its `acknowledgement`                                                                  |
| `POST /api/v1/tokens/register-reconciliations/{uuid}/acknowledge/` | Acknowledge one discrepancy; return the reconciliation                                                                                                                                                                                          |

```json
{
  "appointment": "10000000-0000-4000-8000-000000000030",
  "discrepancy": 0,
  "reason": "The directors accept the transfer the two holders made outside the platform",
  "idempotency_key": "10000000-0000-4000-8000-000000000051"
}
```

`discrepancy` counts from zero through the record's `discrepancies`, in the
order the API lists them. A row is `acknowledgeable` while its reconciliation is
the class's latest, its kind can be acknowledged and nothing acknowledges it yet.
Its `acknowledgement` is `null`, or the reason, the acknowledging `appointment`,
the acknowledger's name, the time and `provided_by`: `company`, or `staff` for an
acknowledgement recorded before acknowledgement was company-run, which shows no
appointment or name.

A new acknowledgement answers `201`. An identical retry with the same
`idempotency_key` answers `200` with the same acknowledgement, even after a later
reconciliation; the same key with any change answers `409`. The request records
nothing and refuses:

- a reconciliation of a class whose register the caller cannot read, as not
  found;
- an appointment that is not the caller's current appointment holding `admin` or
  `approve`, as not found;
- a caller who does not meet the identity requirement `issuer_kyc_required` imposes;
- a reconciliation that is not the class's latest: for a row of an older record,
  wait for the next run and use it;
- a position outside the record's discrepancies;
- an `attribution` or `missing_transfer` row;
- a row already acknowledged;
- a blank reason, or one of more than 1,000 characters.

Later runs treat the row as explained:

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
need the attribution procedure, which is not built; #647 closed on
22 September 2026 without it.

Each acknowledgement is retained with the reconciliation, the exact row, the
reason, the person, their appointment and the time. The company register
command rechecks the appointment after taking the company lock, and takes the
share-class lock a run holds, so a revocation that commits first refuses it and
no divergence is counted twice. The database keeps acknowledgements immutable and refuses:

- an acknowledgement not made through the company command for the class's
  company, by the person it names;
- an appointment that is not that person's current appointment holding `admin`
  or `approve`, and a missing retry key;
- a row of any reconciliation but the class's latest, a row that is not verbatim
  in it, an `attribution` or `missing_transfer` row and a blank reason;
- a second acknowledgement of the same row, and a second use of a person's retry
  key;
- any insert from the app role.

Only the operator connection reads them. Register readers see them through the
reconciliation API, and the
[company pack](../architecture/company-pack.md#approvals-and-history) lists each
one with who acknowledged it and whether the company or staff did. Staff
acknowledged discrepancies through an operator command, `register_acknowledge`,
until 5 October 2026. That command is retired; the acknowledgements it recorded
are kept unchanged and still explain their rows.

Next: [register architecture](../architecture/register.md) and the
[job schedule](jobs.md#schedule).
