# Register runbook

[Operations](README.md) · [Register architecture](../architecture/register.md)

The stored register supplies Ledova's ownership mirror: company-scoped members
with durable wallet links, an append-only hash-chained event log and the holdings
projection the holders route and CSV serve. The company's legal register,
historical records and lawful access arrangements stay with the company under
the [mirror decision](../decisions.md#existing-register-mirror-and-simple-setup).
How the chain is written and checked is in
[register architecture](../architecture/register.md#event-chain). Companies run
openings, imports, corrections, wallet links, particulars changes and
discrepancy acknowledgements through current appointments with company-provided
evidence ([company register commands](#company-register-commands)); issue shares
through the [chain grant](../plans/company-managed-registers/company-register-issues.md),
[paid-issue](../plans/company-managed-registers/company-paid-issues.md) and
[walletless grant](../plans/company-managed-registers/register-grants.md)
families; and record [employee awards and vesting](../plans/company-managed-registers/employee-awards.md)
and [externally arranged capital and allotments](../plans/company-managed-registers/external-allotments.md).
Platform staff review retained transfer instructions and prepare certificates,
notice figures and the company pack on written instruction. Everything here runs
on synthetic data only: production retention and the undoing of a mistaken
opening import are decided before real data is admitted.

## Operator commands

Run the commands from `backend/` against an isolated development database with
configured app, operator and migration roles. They select the operator
connection explicitly; application connections read only their company's rows
through RLS. None signs a transaction; only `register_snapshot` reads the
configured chain provider.

### Verifying the stored register

Create `opening.json` with synthetic UUIDs and whole-share amounts:

```json
{
  "operation_id": "78e39ef6-4c7c-4b38-8311-268ac67086b5",
  "effective_on": "2026-09-20",
  "holdings": [{ "member": "b0169d39-35b2-4f97-aa0a-fb027c1b167f", "shares": "100" }]
}
```

Substitute an existing synthetic token UUID and staff user ID:

```bash
python manage.py register_foundation load-synthetic-opening --token TOKEN_UUID --actor STAFF_USER_ID --input opening.json
python manage.py register_foundation verify --token TOKEN_UUID
```

Both print register and token IDs, event count, positive-holding member count,
issued supply and head hash. Loading the same file twice records one opening;
invalid input rolls back the opening and the member references it created. A
loaded opening initialises the register the HTTP routes serve for that class,
so load one only into a development database. A successful verification proves
storage integrity with the chain unavailable; it proves neither chain
reconciliation nor director approval.

### Inspecting a canonical chain snapshot

```bash
python manage.py register_snapshot --token TOKEN_UUID > snapshot.json
```

The read-only command inspects an attributed deployment on the configured local
or testnet provider and writes the reconciled state at one finality boundary:
company, class, deployment transaction, network, contract, block number, hash
and date, finality policy, issued and authorised supply, positive holdings and
the canonical transfer history it folded, as exact integer strings with no names
or addresses. Rather than substituting current balances, it refuses an
unattributed legacy contract, a network without an approved finality policy, a
provider that cannot serve historical calls and logs at a block hash, duplicate
or noncanonical logs, inconsistent quantities, a reorg and unavailable finality.
Matching balances cannot prove that every historical log was returned, so it
exports no event history, entry dates or evidence of complete membership.

### Classifying completed inclusions

```bash
python manage.py register_inclusions --token TOKEN_UUID
```

The read-only command prints a share class's captured boundary and classifies
each completed issuance and settlement against it by the rule
[register architecture](../architecture/register.md) states: `unopened` (no
applied opening), `opening` (its transaction is in the captured history at the
same block and hash, so the opening already holds it), `after_opening` (a later
block, absent from the history) or `attribution` (the evidence cannot place it,
so an operator must attribute it), and flags whether each is already `recorded`
in the register. Where completions cannot be classified it prints the refusal
or a null boundary.

## Company register commands

Since 5 October 2026 the company runs its register itself, under the owner's
[company-run register decisions](../decisions.md#company-run-register-authority-and-evidence):
a current appointment holding `admin` or `prepare` uploads evidence and
prepares, `admin` or `approve` approves or rejects, `admin` or `apply` applies,
and one person may take every step. Application needs an approval whose
approver still holds a current appointment. Staff permissions, company
ownership alone and shareholding grant none of these steps. Reading proposals,
decisions and evidence copies takes the register-read scope: the company owner,
or a current appointment holding `admin`, `read_register`, `prepare`, `approve`
or `apply`. Every command also meets the identity requirement
[`issuer_kyc_required`](operator-console.md#operator-configuration) imposes on
the appointee. The rules below apply to every register command, including the
families in their own [implementation guides](../plans/company-managed-registers/README.md);
the subsections hold only what is specific to each. The Register screen in both
clients runs every step through the API.

**Evidence.** The company uploads its evidence with
`POST /api/v1/tokens/register-evidence/` (multipart: `company_id`,
`appointment`, `kind`, `idempotency_key`, `file`), which answers a receipt with
the file's size, type and SHA-256. The kinds are `share_register` and
`asic_extract` for an import, `authority` for the director resolution or court
order behind an opening, a correction or a wallet link, and `supporting` for a
particulars change. An upload is checked like every other upload and kept
privately with its SHA-256; an identical retry returns the first receipt, and
the same key with a different file conflicts. Preparation accepts only the
preparer's own upload for this company, of the right kind, whose stored bytes
still match its fingerprint, and the proposal keeps its own private copy with a
snapshot of the upload's size, type and SHA-256. Ledova staff verify nothing. A
director resolution names the approving director; `court_order` carries a court
reference and an empty `approving_director`. An owner account is not proof of
director authority.

**Routes.** Each command has the same family under `/api/v1/tokens/`:
`POST register-<command>/` prepares and returns the retained proposal;
`GET register-<command>/` pages the proposals of companies whose register the
caller may read, filterable by `company` and `status` and, where the command
concerns a class or a member, `token` or `member`; `GET register-<command>/{uuid}/`
returns the proposal with its evidence, stage and decisions;
`GET .../{uuid}/file/` streams the proposal's copy of its document as an
authenticated attachment; `POST .../{uuid}/decision-preview/` and
`POST .../{uuid}/decide/` are the decision steps. An identical preparation
retry returns the proposal; the same `operation_id` with any change conflicts.

**Preview, digest and retry.** Every decision starts with a preview for the
caller's appointment, which lists what the decision still lacks and answers a
digest binding the proposal, the decision kind, the person, the appointment, the
reason and, for application, the state the effect depends on (each subsection
says which). The decision carries that digest, a retry key and
`confirmation: true`; any change in between conflicts, and an identical retry
with the same key returns the proposal. Every step rechecks the appointment
after taking the company lock, so a revocation that commits first refuses the
decision and records nothing. Rejection needs a reason and stays available
until a decision applies or rejects the proposal. The requirements every
command reports are:

| Requirement                             | Meaning                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `appointment_capability_required`       | The appointment holds neither `admin` nor the capability the decision needs                                                                |
| `<command>_decided`                     | The proposal is already applied or rejected: `correction_decided`, `opening_decided`, `link_decided`, `import_decided` or `change_decided` |
| `company_provided_evidence_required`    | A retained staff-era proposal, which can only be rejected                                                                                  |
| `already_approved`                      | A current approval exists                                                                                                                  |
| `approval_required`, `approval_lapsed`  | Application needs a current approval; an earlier approver's appointment ended                                                              |
| `evidence_unavailable`                  | A retained copy no longer matches its size or SHA-256                                                                                      |
| `reason_required`, `reason_not_allowed` | Rejection needs a reason; approval and application take none                                                                               |

A proposal submitted for the retired staff review and still waiting can only be
rejected; it keeps its copy of the staff-verified document and its reviewer as
`staff_verified`, readable through the API, the admin and the
[company pack](../architecture/company-pack.md). **Admin → Tokens** shows
corrections, openings, wallet links and imports as read-only history;
particulars changes have no admin page. Application commits the effect, the
decision and, where holdings change, the holdings projection atomically. Use
[`register_foundation verify`](#verifying-the-stored-register) to check the
result; that is not a claim of chain reconciliation. Proposals, copies and
decisions follow [data retention](uploads.md#data-retention).

### Compensating corrections

A correction reverses one identified entry exactly: the original entry and its
hash remain, the new entry names the original, and an already compensated entry
cannot be compensated again. Applying it changes the stored holdings and
broadcasts no chain change; the next [reconciliation](#reconciling-with-the-chain)
reports the difference as `member` and `supply` rows, which the company
acknowledges. Replacement transactions and partial corrections are not built.
The evidence is an `authority` upload.

| Method and route                              | Result                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/{uuid}/register/entries/` | Paginated entries of the share class's register, newest first, for its register readers: each change names its member as the register does, with the entry it `corrects`, the correction that reverses it (`correctedBy`) and whether it is `correctable`. Repeat `entry` with UUIDs to read just those entries |
| `POST /api/v1/tokens/register-corrections/`   | Prepare the correction. `GET` lists, filterable by `company`, `register`, `token` (the share class) and `status`; `{uuid}/` returns the request, bound revision, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                        |

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
earlier; a later one is refused because it would hold back
[later issues and transfers](#recording-issues-and-transfers-after-the-opening).
Preparation also refuses an entry of a company in which the caller holds no
current appointment, an entry already corrected or with no changes, and an
inverse that would take a stored holding below zero. The preview shows the
original changes beside their inverse, and its digest binds, for application,
the register's sequence and head hash. The correction's own requirements are
`register_changed`, `entry_already_corrected` and `position_would_go_negative`;
a correction the register has moved past cannot be applied, so reject it with a
reason and prepare a new one. Application records the compensating entry, whose
operation ID is the correction's UUID.

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
later [import](#importing-an-existing-register) records them. The evidence is
an `authority` upload. A staff-era opening can only be rejected.

| Method and route                                      | Result                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/{uuid}/register/opening-holders/` | Read the chain for a class whose register is not opened: the block read (`number`, `hash`, `date`) and each holding address with its `shares`, the company `member` already linked to it and that member's `memberName`, or null, and `memberExists`, true exactly when the address is linked. Only for a current appointment holding `admin` or `prepare` |
| `POST /api/v1/tokens/register-openings/`              | Prepare the opening, capturing its boundary. `GET` lists, filterable by `company`, `token` and `status`; `{uuid}/` returns the request, captured boundary and its summary, mapping, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                                                |

The holders read shows a preparer which addresses to map: it captures a
snapshot as preparation does, stores nothing, lists holdings largest first and
matches linked addresses regardless of letter case. Anyone outside the
preparing scope gets the same 404 as an unknown class; a class that is not
deployed or paused, or whose register already has an entry, is refused with 400
before the chain is read, and an unreadable chain answers 503.

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

Preparation captures a fresh canonical snapshot (as
[inspecting a snapshot](#inspecting-a-canonical-chain-snapshot) does), with the
transfer history that later classification needs, before it takes the company
lock; its `boundarySummary` gives the block and each holding address with its
shares, mapped `member`, `memberName` and `memberExists`. It refuses a class
that is not deployed or paused or whose register already has an entry; a mapped
member of another company, or an address already linked to another member; a
mapping that does not cover exactly the boundary's holding addresses, answered
with `opening_holdings_moved` so that clients can offer to read the holders
again; a completed issue or transfer the boundary does not
[represent](#classifying-completed-inclusions); and an unreadable chain, with
503 and nothing recorded.

Approval and application read the chain again before taking the company lock;
an unreadable chain refuses them with 503, and rejection never reads the chain.
The preview shows the share changes and effective date the opening entry would
record, and its digest binds the boundary block's hash and, for application,
the class's register state. The opening's own requirements are
`boundary_changed` (the boundary block is no longer canonical or covered by the
finality policy, or the policy or chain changed), `register_initialized`,
`completions_not_represented` and `wallet_linked_elsewhere`. The boundary is
captured once and frozen, so the remedy for a pending opening that no longer
represents a completion is a fresh opening; reject the superseded one with a
reason. Application commits the members, the wallet links, the opening entry,
the decision and the holdings projection atomically; the opening entry is the
register's first, dated on the boundary block's date, and an explicitly empty
boundary produces an explicit empty opening. Until an opening is applied, the
holders and CSV routes report the register as not initialised.

### Linking wallets after the opening

After a class is opened, an issue or transfer that completes to a wallet no
member owns waits as `unlinked` rather than creating a member, and members are
never merged by matching names (owner decision, 21 September 2026). A wallet
link records which member owns each such wallet: a new subscriber's, a
first-time buyer's or another wallet of an existing member; a
[chain grant](../plans/company-managed-registers/company-register-issues.md)
links its nominated wallet the same way before any mint. Links are
company-wide: one link serves every share class, a company needs no opened
register to link, and a link applied before an opening shows its member in the
[opening holders read](#opening-the-register-from-the-chain). A member ID may
be new, and application creates it, or may already belong to the company, and
several addresses may map to one member. An address linked once is never linked
again. The evidence is an `authority` upload.

| Method and route                                              | Result                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tokens/register-links/waiting-wallets/?company=` | `wallets`: each wallet that a completed issue or transfer of the company's opened classes waits for, as the [waiting list](#the-issuers-waiting-list) names it in `unlinkedWallets`, with `waiting`, the number of waiting effects naming it, ordered by address. Reads only the database. Only for a current appointment holding `admin` or `prepare`; anyone else gets 404 |
| `POST /api/v1/tokens/register-links/`                         | Prepare the link. `GET` lists, filterable by `company` and `status`; `{uuid}/` returns the link, its mapping and `mappingSummary`, evidence, stage and decisions; `{uuid}/file/`, `{uuid}/decision-preview/` and `{uuid}/decide/` as above                                                                                                                                   |

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
empty mapping, one that is not a list of addresses and member UUIDs or repeats
an address in any letter case, a mapped member of another company, and an
address already linked in the company. A company in which the caller holds no
current appointment holding `admin` or `prepare` is answered as not found. The
response's `mappingSummary` gives each address with its member and
`memberExists`. For an address with a whitelist approval for the company, the
preview and the waiting-wallets read also show `walletProof` and the
`holderType` and `holderName` of its live identity; these are informational and
never choose a member.

The preview digest binds, for application, the current links of the mapped
addresses, so a link made in between conflicts unless it linked the same
member; otherwise the new preview reports `wallet_linked_elsewhere`.
Application takes the company lock and then every share class of the company,
in order, and records in one transaction the new members and links, skipping an
address since linked to the same member; then, for each share class in order,
whatever issue or transfer was
[waiting for the link](#recording-issues-and-transfers-after-the-opening), each
entry keeping its own recorder and dated the day it is recorded, stopping in a
class at the first effect it still cannot record; then the link as applied. A
link makes no register entry of its own, changes no whitelist approval and
creates no proof of possession: deleting a wallet or losing its proof later does
not unlink it. An application that deadlocks with a completion recorded by the
same person is aborted by PostgreSQL and can be retried.

### Importing an existing register

The company mirrors its existing legal records in Ledova. Its legal register,
complete historical records, lawful access arrangements and ASIC filings stay
with the company. An import neither establishes legal ownership nor issues
shares again. Shareholders need no account or wallet for a mirror opening.

On the web, **Set up your share register** opens `/company/register/setup`.
Start with **Share details**, then **Shareholders**, **Review** and **Confirm**.
The company owner can select a common class—Ordinary (ORD), Preference (PRF) or
Redeemable (RED)—or use **Another class** to copy its name, code and type.
Already configured draft classes are selectable. The selection must match the
company's existing records. Class codes use one to five
letters, including A, B and ORD, and are unique within the company. This
creates no shares or legal company registration. New mirror classes use the
technical integer ceiling internally, rather than asking for legal authorised
capital or showing it as ownership. Repeat setup for each class.

There is no manual source-reference field. New drafts use the neutral
"Company-provided share records" attribution; the retained snapshot identifies
the company, record date and actor. Existing nonblank source labels are kept.

Add shareholders individually and edit one draft record at a time from the
compact list. Each editor keeps the holding's underlying allotment particulars.
The shareholder step also accepts the existing CSV template. CSV input is UTF-8,
at most 1 MB and 500 allotment rows, and is parsed locally. A repeated holder
reference groups allotments; identity, original entry
date and current holding must agree across its rows. Blank money amounts remain
missing rather than becoming zero. The review lists all copied particulars and
checks holdings against allotments before any confirmation. Unsaved shareholder
edits remain local; editing a saved preparation first retires it through **Edit
records**, as described below. **Import** beside **Continue** is an inactive
future extraction option, explained by its **Coming soon** tooltip; it uploads nothing. Future
extraction will populate the same editable forms. Optional supporting copies
retain source evidence without extracting or verifying their contents.

Shareholders keep one company member identity across classes. Choose an existing
company shareholder by its member UUID, or explicitly choose a new shareholder;
names alone never link records. A known UUID in a new-class CSV reuses that member.
Other source references remain unresolved until that choice when company members
already exist. Existing names and addresses are kept; missing particulars can be
supplied from the source. Membership dates and quantities always come from the
new class's source records, rather than another class's holding.

For an opened mirror, use its current template and keep each holder reference:
these identify the existing Ledova member. An original source reference such as
`H001` cannot silently allocate a replacement member during correction. Add new
shareholders manually. Templates include a `value_encoding` column so
spreadsheet-safe text round-trips exactly; keep that column. Raw source CSVs
without it retain their literal text, including any leading apostrophes.

Confirm records approval and application through the existing exact decisions.
A failed or uncertain response retains its original retry receipt; return to
setup to resume a prepared or approved snapshot. Current authority and fresh
previews remain required. A separate appointee can resume review or confirmation
without preparation access. Editing first retires the saved draft and needs
preparation and rejection authority. Completion returns to the ownership dashboard;
member invitations are optional later work. Native clients retain their
separate preparation and decision screens.

New snapshots use `source_reference` and `source_confirmed: true` to attribute
copied records to the company. This is a confirmation of the company's records,
not a new director resolution or a Ledova verification. Copies of the source
register and ASIC extract are optional checked uploads. Any stated ASIC totals
are a company-provided cross-check, not a claim that an extract lists every
shareholder. Existing retained imports keep their original evidence and authority.

| Method and route | Result |
| --- | --- |
| `POST /api/v1/tokens/register-imports/` | Prepare a new mirror or opening correction. `GET` lists the snapshots; `{uuid}/` reads one. `{uuid}/decision-preview/` and `{uuid}/decide/` retain exact review, approval and application. `{uuid}/file/` and `{uuid}/asic-file/` download an uploaded copy when present. |

Each current member has a durable ID internal to Ledova, the registered holder's
name and address, original membership date, whole-share holding and an
`allotments` list. Each allotment records its original date, whole quantity,
share/certificate references where present, total paid and unpaid amounts,
fully-paid status and whether the registered holder holds beneficially. The
allotment quantities must sum to the member's holding, and fully-paid status
must agree with zero unpaid amount. Missing fields on earlier retained snapshots
stay unknown; Ledova must not invent them. Optional former rows describe copied
records, not a replacement for the company's historical register.

```json
{
  "operation_id": "10000000-0000-4000-8000-000000000031",
  "appointment": "10000000-0000-4000-8000-000000000030",
  "token_id": "10000000-0000-4000-8000-000000000011",
  "source_reference": "Synthetic company register, revision 1",
  "source_confirmed": true,
  "reason": "Mirror the company's current records",
  "as_at": "2026-10-14",
  "members": [{
    "member": "10000000-0000-4000-8000-000000000024",
    "name": "Synthetic Member",
    "residential_address": "1 Example Street, Sydney NSW 2000",
    "shares": "100",
    "entered_on": "2019-05-01",
    "allotments": [{
      "allotted_on": "2019-05-01",
      "shares": "100",
      "share_reference": null,
      "certificate_reference": "SYNTHETIC-1",
      "amount_paid": "250.00",
      "amount_unpaid": "0.00",
      "fully_paid": true,
      "beneficially_held": true
    }]
  }],
  "former_members": []
}
```

On a class without a chain opening, application creates the members, one opening
entry and their particulars atomically. On a chain-opened class, an import
records particulars only and must match its stored holdings. Current authority,
identity configuration, company/class/member boundaries, checked-file receipts,
whole-share arithmetic, locks and retry protection remain enforced.

A mistaken mirror opening can be corrected with `correction_of`, naming the
latest applied snapshot. The correction includes the complete replacement rows,
a current source reference and a reason. Its preview binds the current snapshot
and register head. Application retains the previous snapshot, decisions and
opening entry, adds the exact balance adjustment and records the new copied
particulars. An unchanged retry returns the same result; a changed retry or
stale snapshot conflicts. Corrections do not transfer, burn or mint on chain and
do not change the company's legal records.

Opening corrections refuse later share activity, deployment or member-access
activity rather than replacing their effects. The preview reports why a
correction is unavailable;
the company must resolve the source records and use the appropriate supported
workflow instead. Existing compensating corrections remain separate from this
bounded opening correction. Platform history and private evidence safeguards
remain in force; the mirror is not the company's statutory historical archive.

### Changing a member's particulars

A company keeps its members' names and residential addresses up to date itself,
with one `supporting` upload, such as a deed poll or a member's notice of a new
address, and a reason. The latest "as at" date wins across imports and changes,
with the one applied later winning a shared date, and a member's live verified
identity still wins over both. Members editing their own particulars is the
separate [Profile increment](../plans/company-managed-registers/member-profile.md)
of [#866](https://github.com/Ledova/ledova/issues/866). The Register screen in
both clients lists the company's particulars changes and prepares a change from
a current member's row.

| Method and route                                    | Result                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
earlier. A change dated on or after the member's current particulars replaces
them when applied. Preparation trims the fields and refuses a member of a
company in which the caller holds no current appointment, an empty name,
address or reason, a name of more than 255 characters, an address or reason of
more than 1,000, a date after today or before the member's current particulars,
and a member who has held no shares in the company since the retention cutoff
(`FORMER_MEMBER_RETENTION_DAYS`, 2,557 days by default), whose particulars the
register no longer keeps. The preview shows the change beside the member's
current particulars, their date and source, and its digest binds those for
application, so particulars recorded in between conflict. The change's own
requirements are `member_left_retention` and `newer_particulars_exist` (a later
import or change). Application records the change's name, address and date as
the member's particulars, naming the change as their source. The daily
retention job purges a member's particulars once the member has held nothing in
the company for the 2,557-day floor, and nothing else of a change
([data retention](uploads.md#data-retention)).

### Acknowledging a discrepancy

The register cannot follow a divergence it did not cause: no entry records an
outside transfer, and a correction only compensates an existing entry. Once the
company has investigated a divergence that
[reconciliation](#reconciling-with-the-chain) reports and accepted it, a current
appointment holding `admin` or `approve` acknowledges one specific discrepancy
of the class's latest reconciliation with a written reason; there is no Ledova
staff step and no second person. The company cannot start a reconciliation. The
Register screen in both clients shows each class's latest reconciliation and
takes acknowledgements through the API below.

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
the acknowledger's name, the time and `provided_by`: `company`, or `staff` for
an acknowledgement recorded before 5 October 2026, which shows no appointment or
name and still explains its row. A new acknowledgement answers `201`; an
identical retry with the same `idempotency_key` answers `200`, even after a
later reconciliation, and the same key with any change answers `409`. The
request records nothing and refuses: a reconciliation of a class whose register
the caller cannot read, or an appointment that is not the caller's current one
holding `admin` or `approve`, as not found; a caller who does not meet
`issuer_kyc_required`; a reconciliation that is not the class's latest (wait
for the next run and use it); a position outside the record's discrepancies; an
`attribution` or `missing_transfer` row; a row already acknowledged; and a
blank reason, or one of more than 1,000 characters.

Later runs treat the row as explained: an acknowledged `unrecognised_transfer`
is not reported again for that transaction hash, and an acknowledged `member`,
`unlinked` or `supply` row keeps its difference, which later runs add to the
expected side; a further change for the same key is a new difference. Accepting
an outside transfer therefore takes its `unrecognised_transfer` row and the
`member` or `unlinked` rows it caused, and an applied correction's effect is
acknowledged through the `member` and `supply` rows it leaves. Once every row is
acknowledged, the next run is `matched`. An acknowledgement records nothing in
the register. `attribution` and `missing_transfer` cannot be acknowledged: they
need the attribution procedure, which is not built. Each acknowledgement is
retained with the reconciliation, the exact row, the reason, the person, their
appointment and the time, and the
[company pack](../architecture/company-pack.md#approvals-and-history) lists it.

## Waiting effects and reconciliation

### Recording issues and transfers after the opening

Once a share class has an applied opening, each completion that classifies
`after_opening` is recorded as a register event in chain order, dated the day
the entry is made (UTC), with the completed issuance or settlement as its
operation ID so that recording is idempotent. An issue is recorded by the
company appointee who applied the grant or paid issue, or by the original staff
reviewer under a retained [register instruction](#register-instructions-for-issues);
a settlement's transfer is recorded by the transferor once an applied
[transfer instruction](#register-instructions-for-transfers) lists it. An
effect the opening already represents records nothing, nor does a settlement
between two wallets of the same member. Where recording stops, and what resumes
it, is in [register architecture](../architecture/register.md#event-chain);
`register_inclusions` reports `recorded` for each recorded effect.

### The issuer's waiting list

Anyone in the register-read scope can list the completed effects of a share
class that are not yet in the register, in the order recording will take them:

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

The list, the `waitingEffects` count and recording walk the same classification
in the same order, so the count is the list's length and the first effect listed
is the one recording stops at. The route answers 404 outside the register-read
scope. A count of `null`, or `unknown` in the CSV, means the completions could
not be classified or the register has no captured boundary, as with one the
synthetic command loaded; a register an import opened has no boundary either,
and its CSV says `not on chain`.

### Reconciling with the chain

Every six hours, at :50 UTC, `reconcile_every_register` reconciles each share
class that has an applied opening; a class an import opened has none and is not
reconciled. It reads the chain and writes only reconciliation records, never a
register entry: it captures a fresh canonical snapshot at the finality boundary
and compares it with the stored register under the share-class lock that
completions take. Every chain transfer after the opening boundary must be a
recorded effect, a completed effect still waiting, or an executing issuance or
settlement whose current signed transaction is the one on chain; every
completed effect must be on chain in the block its receipt names; and each
member's linked wallets must hold its stored shares plus pending movements, with
the issued supply equal to the stored supply plus pending issues. A transfer of
zero shares is ignored, an [acknowledged](#acknowledging-a-discrepancy)
discrepancy is treated as explained, and a snapshot below the opening's
boundary block is never compared.

Each run is retained in `RegisterReconciliation`: `matched`, `discrepant` with
its discrepancies, or `failed` with the reason (the chain could not be read, or
its snapshot is below the opening boundary), with the block and register
sequence compared. Discrepancies are logged at error level, which is the alert,
and the CSV summary states the latest result. The job tries every share class,
then fails if any could not be reconciled; a class whose run raised keeps its
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

It prints the retained record. Only the operator records reconciliations; the
company reads its own through the
[reconciliation API](#acknowledging-a-discrepancy).

## Outputs on written instruction

### Reviewing documentary evidence

Staff verify a company document's content in the company document admin: choose
**Review and verify document**, open the private file, review its company,
document type and validity details, then confirm. The action needs an active
staff user with `companies.change_companydocument` and the admin's object
permission; the confirmation is bound to that reviewer and document and expires
after 15 minutes. Confirmation locks the company and document rows, re-reads
the file and records a SHA-256 fingerprint covering the file's bytes and the
document's and company's identifying details; a changed preview, missing or
empty file, wrong size, rejection or non-current validity is refused, and an
external URL alone cannot establish content. PostgreSQL clears the verification
when the bound company identity, document details or rejection reason change;
the customer role may revoke it but cannot grant it. Consumers recheck the
current file against the fingerprint, the company and the validity dates. The
retained [register instructions](#register-instructions-for-issues) and
[publications](publications.md) consume this verification; company register
commands use company-provided evidence instead.

### Preparing a certificate

Use the company Register's unsigned certificate preview and confirmation, or
fulfil a member's request with a recipient-only PDF. Current company appointments
replace the routine staff certificate form. The [output guide](../plans/company-managed-registers/register-outputs.md)
owns the steps, source binding, retained file access and unsigned-document boundary.

### Preparing notice figures

A company notifies ASIC of each share issue within 28 days (s254X of the
Corporations Act), and a proprietary company also notifies changes to its
members and share structure (s178A, s178C and s178D). Staff prepare the figures
only on the company's written instruction; the company, or the accountant who
lodges its notices, decides which notices they support and lodges them (owner
decision, 22 September 2026). You need **Can change register outputs**, and the
share class needs an applied opening.

1. Keep the company's written instruction, and note its reference and the first
   day of the period it asks for. An entry is dated the UTC day it was made,
   which on a Sydney morning is the day before, so start the period no later
   than the date of the first entry the company has not yet notified; the
   [due list](#working-the-due-list) shows every entry no figures cover yet.
2. In **Admin → Tokens → Register outputs**, open the share class and choose
   **Prepare notice figures**.
3. Enter the first day of the period and the instruction's reference, then
   choose **Prepare and download**.

The download, `notice-figures-SYMBOL-DATE-to-N.csv` for the figures from DATE to
register entry N, lists the entries in the period with each member's change in
shares and an issue's amount paid, the class at the register head, and the
members changed in the period with their name, address, shares held and amount
paid; the opening is never listed, and `not recorded` means Ledova cannot
establish the amount paid, as for shares received by transfer. Check the figures
against the instruction and give the file to the company unchanged. The page
refuses, and records nothing, when the class has no applied opening, the first
day is after today in Sydney's calendar or a field is blank; a period with no
entries is not refused. Each preparation is recorded once in
**Admin → Tokens → Register exports** as kind **Notice figures** with the
period, the instruction and the file's SHA-256 digest, confirmed with
`sha256sum notice-figures-SYMBOL-DATE-to-N.csv`; the records follow the export
records' 2,557-day floor and daily purge.

### Working the due list

The **Register outputs due** page lists every certificate and set of notice
figures still due across all companies and share classes, earliest due first. A
certificate is due two months after an issue and one month after a transfer's
settlement order was created; notice figures are due 28 days after an issue, or
after a proprietary company's transfer
([outputs due](../architecture/register.md#outputs-due) has the exact rules).
You need **Can change register outputs**. The page records nothing.

1. In **Admin → Tokens → Register outputs**, choose **Register outputs due**.
2. Read each row: the company, share class, entry number, kind and effective
   date, what is due, the due date, and whether it is overdue in Sydney's
   calendar.
3. Tell the company what is due and when. The obligations are the company's,
   and the company lodges its notices and delivers its certificates.
4. On the company's written instruction, follow the row's link and
   [prepare the certificate](#preparing-a-certificate) for the row's entry or
   [prepare the notice figures](#preparing-notice-figures).

A certificate row leaves the list once a certificate is prepared for its entry;
a notice figures row once figures are prepared whose period starts on or before
the entry's date and runs to its number or later. The page knows only what
Ledova prepared: a row stays when the company produced the output elsewhere or
needs none.

### Producing a company pack

A current company administrator downloads or shares a supported core pack from
the Register in both clients; the [output guide](../plans/company-managed-registers/register-outputs.md#core-company-pack)
records the scope and complete refusal rules. The following retained staff
workflow covers the broader restricted archive.

A company pack is one zip of a company's records: every share class with its
register, the entries and the approvals behind them, the issues and
subscriptions still to be allotted or refunded with their payments as recorded,
the wallet approvals, what is still waiting or owed, the transactions Ledova
sent and the settlements it executed, the company and its documents with the
evidence copy behind each approval, what it published to its members with each
resolution's result and each dividend's payment records, and the contract
information a successor needs, with a README that explains each file and how to
check it. Staff produce it only on the company's written instruction naming who
it is for, or on a document that legally compels disclosure, referenced in its
place (owner decision, 23 September 2026). [The company pack](../architecture/company-pack.md)
describes what it carries and what it leaves out.

You need an active staff account with **Can change company pack**
(`companies.change_companypack`) and **Can view company document**
(`companies.view_companydocument`); company permissions do not include the
first. The company needs at least one share class.

1. Keep the instruction or the compelling document, and note its reference and
   who the pack is for.
2. In **Admin → Companies → Company packs**, find the company and choose
   **Produce a company pack**.
3. Enter the reference and the recipient, then choose **Produce and download**.

The download, `company-pack-ACN-YYYYMMDDTHHMMSSZ.zip`, is named for the moment
the records were read, in UTC, and carries every current and former member's
name and residential address, the names of the staff who reviewed the company's
register changes, the company's documents and each publication's roll. Give it
unchanged to the recipient the instruction names. The page refuses, and records
nothing, when the company has no share classes or a field is blank; when a
register entry no longer matches its stored hash, naming the class and entry
(run `python manage.py register_foundation verify --token TOKEN_UUID` and do not
produce a pack until the register verifies); when the stored files it would
carry exceed 256 MiB, naming the total (background production is built the
first time a real pack goes over the ceiling); when a document's or evidence
copy's file is missing from private storage or its bytes no longer match the
recorded SHA-256, naming the record (restore the file, and find out how it
changed, first); and when a publication's events or roll no longer verify,
naming the publication (run
`python manage.py publications verify --publication PUBLICATION_UUID`,
[verifying a resolution](publications.md#verifying-a-resolution)).

Each pack is recorded in **Admin → Tokens → Register exports** as kind
**Company pack**, once for each share class it carries, with who produced it,
the instruction, the recipient and the SHA-256 of the pack's `manifest.json`.
Ledova keeps no copy of the file: unzip it and compare `sha256sum manifest.json`
with the records' digest, and the manifest lists the SHA-256 of every other
file. The records cannot be rewritten, are read only by staff, and follow the
export records' 2,557-day floor and daily purge. The pack's README names each
contract's owner and the exact `setShareTokenApproval` and `transferOwnership`
calls a handover would make; the handover itself is a separate operation, not
built.

## Retained register instructions

### Register instructions for issues

Fresh issues are company-run: [chain grants](../plans/company-managed-registers/company-register-issues.md)
use `/api/v1/tokens/register-issues/`, [paid issues](../plans/company-managed-registers/company-paid-issues.md)
over a recorded PAID subscription use `/api/v1/tokens/register-paid-issues/`,
and an imported class uses the walletless
[register grant](../plans/company-managed-registers/register-grants.md). The
direct owner issue POST and fresh staff approval, admission and allotment are
retired; staff **Reject** remains for retained review requests. The retained
instruction workflow below covers already-approved direct issues still awaiting
register cover: the company owner submits an instruction of kind `issue` listing
each retained direct issue by its issuance request, recipient wallet and whole
number of shares, naming the approving director and carrying a verified company
document, of which it retains a private copy (owner decision 2, 22 September
2026).

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
approved and await that cover. Listing a retained approval adds the cover its
entry waits for, without approving it again. Historical paid instructions keep
their references, terms and staff decisions as history and supply no fresh paid
admission route. In **Admin → Tokens → Register instructions**, an active staff
user with change permission opens the review link, inspects the retained file,
the named director, the authority reference and the company identity, checks
each item's exact terms and that the director is not a recipient, then
explicitly confirms and chooses **Approve and apply**. Submission, review and
application refuse an item whose recipient or shares differ from its request's
current terms, an item that does not name a retained non-paid approval awaiting
cover or that another applied instruction already covers, a director who is the
recipient an item identifies, and any instruction for a share class an
[import opened](#importing-an-existing-register). Rejection with a reason stays
available. Application rechecks the reviewer-bound, expiring confirmation, the
retained evidence and every item under the company and share-class locks, then
records in one transaction any listed retained issue that completed and was
[waiting for cover](#recording-issues-and-transfers-after-the-opening).
Repeated identical submissions and decisions are idempotent, and conflicting
UUID reuse is refused. Instructions are immutable and undeletable, and their
retention follows [data retention](uploads.md#data-retention).

### Register instructions for transfers

Directors decide whether to register a transfer, and they decide on a settlement
after it completes, while its entry waits (owner decision 2, 22 September 2026).
The signed order both parties signed, which the settlement retains, is the
instrument of transfer; whether it is a proper instrument under s1071B is left
open. The company owner submits the directors' approval through the same route as
an [issue instruction](#register-instructions-for-issues), with kind `transfer`,
listing the exact completed settlements a named director approved, each with its
seller and buyer wallets and whole number of shares. The instruction's share
class is the class of every settlement it lists.

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
its `shares` are the amount. Each item must be a completed settlement of the
share class, on exactly its seller, buyer and shares, that no applied
instruction covers and the register has not entered; a settlement between two
wallets of one member needs no instruction. Staff review it on the same admin
page, which shows each settlement's wallets, the member each is linked to and
the name it identifies, the shares, the class and the completion time.
Submission, review and application refuse a director who is either party, by
the profile name of the account holding that wallet. Application rechecks every
settlement under the company and share-class locks, then records whatever
waited for the instruction, in chain order, each transfer still recorded by the
transferor. Rejection, idempotency, conflicts, immutability and retention are as
for issue instructions.

A transfer the directors decline is not modelled yet: the owner submits no
instruction for it, and its settlement keeps waiting as `uninstructed`, holding
later issues and transfers in its class behind it. Later transfer decisions and
market settlement are deferred [#869](https://github.com/Ledova/ledova/issues/869)
work.
