# Register and records engine

[Engineering](README.md) · [Documentation](../README.md)

How the register of members, its outputs, the company pack, shareholder publications and a
person's own data export are stored, protected, exported and verified. It is for engineers. Who
may do what, and why, is in the business documents each section links to; what Ledova mirrors
and what stays with the company is stated once in [business processes](../business/README.md).

Contents:

- [Register ledger](#register-ledger): code and guards, entries and
  the hash chain, hash preimages, holdings and identity, recording completions, the
  reconciliation job, the former-member fold and deletion protection.
- [Register commands](#register-commands): evidence uploads, the
  proposal routes and every register family's API, member access, retained instructions and the
  operator transaction boundary.
- [Reads and exports](#reads-and-exports): read routes, waiting
  effects, output routes and export records.
- [Output formats](#output-formats): the register CSV, inspection
  copy, certificate, notice figures and the outputs-due computation.
- [Company pack format](#company-pack-format): building, manifest,
  files, decision records, chain evidence, contracts, documents and technical limits.
- [Publications](#publications): storage, the frozen roll, read
  audit, routes, the event chain, distributions, retention and verification.
- [Account-data export](#account-data-export): route, contents,
  evidence fields and why it is not recorded.

## Register ledger

### Code, tables and guards

| Concern | Code |
| --- | --- |
| Stored register reads, CSV and outputs | [register.py](../../backend/tokens/services/register.py) |
| Appending and verifying entries | [register_events.py](../../backend/tokens/services/register_events.py) |
| Classifying completions, the waiting list | [register_inclusions.py](../../backend/tokens/services/register_inclusions.py) |
| Canonical chain snapshot | [register_snapshot.py](../../backend/tokens/services/register_snapshot.py) |
| Reconciliation | [register_reconciliation.py](../../backend/tokens/services/register_reconciliation.py) |
| Former-member fold and retention purges | [former_holders.py](../../backend/tokens/services/former_holders.py) |
| Company decisions, shared by every family | [register_decisions.py](../../backend/tokens/services/register_decisions.py) |
| Company pack | [company_pack.py](../../backend/tokens/services/company_pack.py) and its `company_pack_*.py` modules |
| Publications | `backend/shareholders/services/`, described under [publications](#publications) |

`ShareRegister` is the head of one share class's register (`sequence`, `head_hash`,
`issued_supply`). `RegisterEntry` is the append-only log and `RegisterPosition` the holdings
projection (`shares`, `entered_on`, `last_entry`). `RegisterMember` is a company-scoped member id,
`RegisterMemberWallet` a company-wide wallet link, `RegisterMemberParticulars` the recorded name
and residential address, and `RegisterMemberCessation` an exit from an imported register.
`FormerHolder` and `ImportedFormerMember` hold former members; `RegisterReconciliation`,
`RegisterAcknowledgement` and `RegisterExport` hold reconciliations, acknowledgements and output
fingerprints.

PostgreSQL enforces the ledger, not Python.
[database_guards.py](../../backend/tokens/database_guards.py) installs
[database_guards.sql](../../backend/tokens/database_guards.sql) with the family files
`database_award_guards.sql`, `database_allotment_guards.sql` and `database_member_guards.sql`,
enables and forces RLS on the member-access, award and allotment tables, and revokes every
privilege on them from the application role. Shared migrations install
`database_output_guards.sql` (member certificate fulfilment) and `database_mirror_guards.sql`
(mirror imports); [database_mirror_guards.py](../../backend/tokens/database_mirror_guards.py) also
re-installs the entry guard so it admits `mirror_correction`. Every register table's write term
is `false` for the application role, so register commands write on the operator connection
inside a bounded company operation ([tenancy](security.md#roles-and-principal)).
Neither role holds `TRUNCATE`. The schema owner remains trusted: the hash chain is not an
externally anchored proof against a schema owner who rewrites the entire history and every hash.

### Entries and the hash chain

A register starts empty (sequence 0, supply 0, head 64 zeros) for its own company and class, and
its first entry is the opening, which may be explicitly empty. The entry kinds are `opening`,
`issue`, `transfer`, `cessation`, `correction` and `mirror_correction`; what each means to the
company is in [entry kinds](../business/register.md#register-entries).

`record_entry` in register_events.py runs only on the operator connection. It locks the head,
returns the existing entry when an operation UUID repeats with identical values, conflicts when
any value changed, and refuses an issue or transfer dated before the latest entry. The
`BEFORE INSERT` trigger `tokens_guard_register_entry` then:

- locks the head `FOR UPDATE` and requires the opening first and only first;
- requires `changes` to be an array of objects with exactly `member` and `shares`, members
  distinct, sorted and of the register's company, and shares nonzero integer strings;
- keeps every holding and the issued supply within 0 to 2^256 − 1, lets an opening or issue only
  add, and requires a cessation to remove the whole holding;
- requires one change for an issue or cessation and two summing to zero for a transfer;
- requires a correction's changes to be the exact inverse of the entry its `corrects` names in
  the same register; only a correction may name one, and `corrects` is one-to-one, so an entry
  is compensated at most once;
- for a class with an applied company deployment, freezes the empty register until the
  deployment's original projection and admits only the company's genuine chain opening;
- assigns the sequence, `previous_hash` and `entry_hash`.

`tokens_project_register_entry` then updates each position (resetting `entered_on` when a holding
rises from zero), its `last_entry`, and the head's sequence, hash and supply in the same
transaction. Triggers refuse entry and member rewrites and deletes, position writes outside the
projection (`tokens_guard_register_position`), head writes outside it
(`tokens_guard_share_register`) and moving a registered class to another company. Entry payloads
carry member UUIDs and share changes, never names or residential addresses.

A `mirror_correction` is written only by an applied import correction. `tokens_guard_mirror_entry`
requires its changes to equal `tokens_mirror_changes`, the signed difference between the new
snapshot and the positive holdings, its date to be the snapshot's `as_at`, a current approval and
apply decision, and `tokens_mirror_correction_ready`: the base sequence and head unchanged, no
entry other than the opening and mirror corrections, and no applied deployment, issuance request
past approval, applied register instruction, member invitation, association, particulars
request or particulars change. On an imported, non-tokenised register,
`tokens_record_member_cessations` writes a `RegisterMemberCessation` when a walletless member with
recorded particulars falls to zero, and marks its return when a later entry restores a holding.

`verify_register` replays a register on the operator connection: contiguous sequences, each
previous-hash link, each stored hash against `tokens_register_entry_hash`, and the replayed
positions, `entered_on` dates, head and supply against storage. An uninitialised head fails.
`register_foundation verify` runs it
([verifying stored records](../operations/recovery.md#verifying-stored-records));
it proves storage integrity, not chain reconciliation or director approval.

For a development database only, `register_foundation load-synthetic-opening` records an opening
from a JSON file with synthetic member UUIDs and whole-share amounts, attributed to an active
staff user, then verifies the register. Loading the same file twice records one opening; invalid
input rolls back the opening and the member references it created. A loaded opening initialises
the register the HTTP routes serve for that class.

```json
{
  "operation_id": "78e39ef6-4c7c-4b38-8311-268ac67086b5",
  "effective_on": "2026-09-20",
  "holdings": [{ "member": "b0169d39-35b2-4f97-aa0a-fb027c1b167f", "shares": "100" }]
}
```

```bash
python manage.py register_foundation load-synthetic-opening --token TOKEN_UUID --actor STAFF_USER_ID --input opening.json
```

### Hash preimages

A register entry's hash is the lowercase hex SHA-256 of the UTF-8 text of a PostgreSQL JSONB
array, in this order:

1. the format marker `ledova-register-v1`;
2. the entry `uuid`, `register_id` and `operation_id`;
3. the `sequence` and `kind`;
4. `effective_on` as `YYYY-MM-DD`;
5. `changes`, sorted by member;
6. `corrects_id`;
7. `recorded_by_id`, the number of the platform account that recorded it;
8. `previous_hash`, 64 zeros for the first entry;
9. `created_at` in UTC as `YYYY-MM-DDTHH:MI:SS.ffffffZ`.

`tokens_register_entry_hash(entry)` computes the digest and `tokens_register_entry_preimage(entry)`
returns the exact text it covers, both from
[database_guards.sql](../../backend/tokens/database_guards.sql).

A publication's events use the same recipe under two version tags, from
[shareholders/database_guards.sql](../../backend/shareholders/database_guards.sql):

| Tag | Events | Array after the tag |
| --- | --- | --- |
| `ledova-publication-event-v1` | `ballot`, `close` | uuid, publication, company, sequence, kind, roll row, choice, shares as text, actor, staff flag, authority, payload, previous hash, creation time |
| `ledova-publication-event-v2` | `payment`, `payment_void` | the v1 fields through payload, then paid date, reference, stored evidence path, evidence digest, evidence media type, previous hash, creation time |

`shareholders_publication_event_hash` and `shareholders_publication_event_preimage` are the
counterparts. A payment record's own tag lets the ballots already on a chain keep their hashes.

Reproducing PostgreSQL's JSONB text rendering outside PostgreSQL would be the first copy of it
anywhere, so the company pack carries the preimage text beside every register entry and every
publication event except a ballot, whose preimage holds the choice. The pack builder refuses any
entry or event whose preimage does not digest to its stored hash; a reader then needs only a JSON
parser and SHA-256.

### Holdings and identity resolution

`stored_register` reads the head, supply, positions, waiting count and former members in one
`REPEATABLE READ, READ ONLY` transaction (`_snapshot`), the one every output and the company pack
reuse, so an entry recorded during a read cannot make them disagree. A row is a positive
`RegisterPosition`, ordered by shares then member id; its balance is the stored holding and its
percentage the holding over issued supply, rounded to two places. A read needs the database and
no chain. A class with no register, or one at sequence 0, reports `initialized: false` and no
rows; an opened register with no holdings reports `initialized: true` and no rows.

`_member_identity` resolves a member from its linked wallets' whitelist identities
(`identities_for`, company-scoped, in bounded address chunks), then the latest resolved allotment
identity stamp among its wallets, then `RegisterMemberParticulars`; a member at a labelled
treasury address takes its recorded particulars and stays `treasury`. `member_identities` adds the
account a member resolves to only when a live identity names one account; the publication roll
uses that. What each source means, the four holder types, amount paid and date entered are rules:
[membership and identity](../business/register.md#members-holder-types-and-identity). Amount paid
comes from `_allotments` (a completed issuance's subscription `money_backing_shares`, only when
the subscription's allotment quantity equals the issuance), the applied import's allotments, and
`_external_amounts_paid` (an applied AUD allotment whose ISSUE entry and company-recorded receipt
match its consideration). Date entered comes from the position, the earliest allotment and
`imported_membership_dates`.

The company Dashboard's ownership summary counts distinct register members from the holders read
of each opened class and does no chain read
([summary.ts](../../dashboard/src/pages/company/dashboard/summary.ts)).
`ShareIssuance.objects.distinct_recipient_addresses()` is used only by the operator worklist
([operators/services.py](../../backend/operators/services.py)) to count ambiguous and unidentified
allotment addresses; it applies no identity-stamp fallback, can include former holders and misses
transfer-only holders, so it is not a substitute for the register.

### Recording completions after the opening

[register_inclusions.py](../../backend/tokens/services/register_inclusions.py) classifies each
completed issuance and settlement against the opening's captured boundary: `opening` (its
transaction is in the captured history at the same block and hash, so the opening holds it),
`after_opening` (a later block, absent from the history), `attribution` (the evidence cannot
place it, so an operator must attribute it) or `unopened` (no applied opening). An opening whose
captured boundary does not represent a completed effect is refused. The `register_inclusions`
command prints the classification and whether each effect is `recorded`.

Each `after_opening` completion is recorded in chain order, in its own completion transaction,
with the issuance or settlement id as the entry's operation id, so recording is idempotent, and
dated the UTC day it is made. Who is recorded as recorder, which effects record nothing, and why
recording stops and resumes:
[recording](../business/register.md#recording-completed-issues-and-transfers).

Recording stops at the first effect it cannot record ([waiting effects](#waiting-effects)). The
completion itself still commits, because a register record must not stall the workflow; the
reason is logged. A recording pass runs again on the next completion in that class, the next
applied wallet link in the company or the next applied register instruction for the class. Each
takes the share-class lock first, a wallet link every class of its company in order, so a
completion in progress cannot miss the new link or cover. Settlement completion takes the same
share-class lock as issuance completion, so neither interleaves with an opening. Because no issue
or transfer may be dated before the latest entry, while the latest entry is dated after today (as
with an opening whose boundary block's time runs ahead of the platform's clock) the next one waits
as `refused`.

### Reconciliation job

`reconcile_every_register` runs every six hours at :50 UTC
([schedule](../operations/jobs-and-storage.md#schedule)) for each class with an applied chain
opening; a class an import opened has none and is not reconciled. It captures a fresh canonical snapshot at
the finality boundary, then takes the share-class lock that completions take and the register
row. It compares the stored register with the chain as
[reconciliation](../business/register.md#reconciliation-with-the-chain) describes, counting an
executing issuance or settlement only when its current signed transaction is the one on chain,
and requiring each completed effect in the block its receipt names.

An acknowledged `unrecognised_transfer` is ignored by its transaction hash, and an acknowledged
`member`, `unlinked` or `supply` row's difference is added to the expected side. A snapshot below
the opening's boundary block is never compared. The job writes only `RegisterReconciliation` rows
(`matched`, `discrepant` with its discrepancies, or `failed` with the reason), with the block and
register sequence compared; a trigger keeps each status consistent with its fields and refuses
rewrites. A chain failure fails the reconciliation, never the register. The discrepancy kinds
(`unrecognised_transfer`, `missing_transfer`, `member`, `unlinked`, `supply`, `attribution`) and
what each asks of the company are in
[what each discrepancy means](../business/register.md#what-each-discrepancy-means); the on-demand
`register_reconcile` command and the alerting are in
[reconciling a register on demand](../operations/recovery.md#reconciling-a-register-on-demand).

### Former-member fold

`fold_every_share_class` runs every six hours at :20 for each deployed or paused class with a
contract. `fold_former_holders` reads the token's `Transfer` history from its deployment block
through the provider's finalized block. `cessations_in` refuses a repeated event, an invalid
quantity and a sender spending shares it never received, skips self-transfers and the zero
address, and reports each address whose balance falls from positive to zero. Cessations older
than the retention cutoff are skipped, so a purged row is never recreated by a later full-history
fold. Under the share-class lock it writes each missing `FormerHolder` and stamps
`former_holders_folded_at` and `former_holders_block`. Each class is all-or-nothing: a failure
leaves its last timestamp and block unchanged, does not stop other classes, and fails the job at
the end. The register marks a fold older than 24 hours, or never completed, stale; a GET never
folds.

Particulars are frozen when a cessation is first recorded and refolding never rewrites them:
a live identity at recording, otherwise a resolved allotment stamp dated no later than the
cessation, otherwise the particulars recorded for the member the wallet is linked to, otherwise a
name recorded at allotment, otherwise unknown. A labelled treasury address takes recorded
particulars before its label.

The fold sees wallets, not members. A read leaves out a cessation of a wallet linked to a member
who currently holds the class only when it falls on or after that member's date entered as the
stored register and allotments give it (an imported date entered does not move that line); the
rows left out are kept and still count against the member's date entered and amount paid. Why:
[former members](../business/register.md#former-members). `ImportedFormerMember` rows (from
an import, ceased before a chain opening or by the import's register date) and
`RegisterMemberCessation` rows are listed beside the folded rows, from the same snapshot, with no
wallet address or block. For a class an import opened, the holders read's former-member time is
the head entry's creation time, with no block, and never stale.

`FormerHolder`'s application-role read term is the company owner alone; register appointees read
former members through the register reads on the operator connection, and no application role
writes them. `purge_former_members_past_the_clock` runs daily at 03:40 and applies the
former-member clock ([retention clocks](security.md#retention-clocks)).

### Deletion protection

The register spine is `Company -> ShareToken -> {ShareIssuance, ShareIssuanceRequest,
CapitalIncreaseRequest, Offering, TransferOrder}`. Those relations and `SwapOrder.share_token`
use `PROTECT`, as do a subscription's links to its offering, account and wallet. The API deletes
neither a company nor a share class: both routes answer 405, so a register is never removed
through it. Delist a company that should close; pause a class to stop transfers. Admin removal of
test data still respects protected relations.

Company documents and registry-check history are application evidence, not register membership
rows. Deleting a wallet cascades its whitelist entry and that entry's company approvals and
leaves the approval on chain; durable
[whitelist commands](chain.md#whitelist-changes) keep their own
identity. Allotment identity stamps preserve the identity resolved when shares were issued;
treasury relabelling or a current profile guess must not replace that historical source. A
publication freezes a roll from the register and never writes to it, and the company pack carries
every class's register, the decisions behind its entries and their evidence copies.

## Register commands

Every register command follows the shared prepare, preview, decide and apply protocol in the
[company workflow API](backend.md#company-workflow-api): preview digest, retry
key, `confirmation: true`, the company-lock recheck and the shared requirement codes. Who may
take each step is in
[how a company decision works](../business/README.md#how-a-company-decision-works),
and the steps a company takes are in [the register of members](../business/register.md). This
part lists the register routes, payloads and family-specific rules. Routes are under
`/api/v1/tokens/` ([urls.py](../../backend/tokens/urls.py)); every command also meets the
[`issuer_kyc_required`](../operations/operator-console.md#operator-configuration) identity
check for the appointee. Request fields here are the serializers' snake_case names, as the import
example uses; responses are camelCase ([wire casing](backend.md#backend-rules)). Request bodies
are in the [OpenAPI schema](../../backend/schema/openapi.json).

### Evidence uploads

`POST /api/v1/tokens/register-evidence/` (multipart: `company_id`, `appointment`, `kind`,
`idempotency_key`, `file`) answers a receipt with the file's size, media type and SHA-256. The
upload is checked like every upload and kept privately at
`companies/<company>/register-evidence/<uuid>/<uuid>.bin`; `tokens_guard_register_evidence`
requires the uploader's current preparing appointment, a PDF, PNG or JPEG, and that path. An
identical retry returns the first receipt; the same key with a different file conflicts.

| Kind | Used by |
| --- | --- |
| `share_register` | An import's optional copy of the company's register |
| `asic_extract` | An import's optional ASIC extract |
| `authority` | The director resolution or court order behind an opening, correction, wallet link, grant, transfer, allotment or chain family |
| `supporting` | A particulars change, grant terms and acceptance, a transfer instrument, an award agreement, a vesting event, and an allotment's agreement and receipt |

Preparation accepts only the preparer's own upload for this company, of the right kind, whose
stored bytes still match their fingerprint. The proposal keeps its own private copy and a
snapshot (`tokens_register_evidence_snapshot`: `provided_by`, upload id, company, kind as
`document_type`, name, size, media type, SHA-256). A director resolution names the approving
director; `court_order` carries a court reference and an empty `approving_director`. Ledova
verifies none of it.

### Proposal routes and requirement codes

| Method and route | Result |
| --- | --- |
| `POST register-<family>/` | Prepare and return the retained proposal; an identical retry returns it, the same `operation_id` with any change conflicts |
| `GET register-<family>/` | Page the proposals of companies whose register the caller may read, with the family's filters |
| `GET register-<family>/{uuid}/` | The proposal with its evidence, stage and decisions |
| `GET register-<family>/{uuid}/file/` | The proposal's private copy of its document, as an authenticated attachment |

Each family also has the shared `decision-preview/` and `decide/` routes and requirement codes in
[register decisions](backend.md#register-decisions).

| Family | Route | Filters | Extra files | Digest also binds | Own requirement codes |
| --- | --- | --- | --- | --- | --- |
| Correction | `register-corrections/` | `company`, `register`, `token`, `status` | | For application, the register sequence and head hash | `register_changed`, `entry_already_corrected`, `position_would_go_negative`, `deployment_pending` |
| Opening | `register-openings/` | `company`, `token`, `status` | | The boundary block hash; for application, the class's register state | `boundary_changed`, `register_initialized`, `completions_not_represented`, `wallet_linked_elsewhere`, `deployment_pending` |
| Wallet link | `register-links/` | `company`, `status` | | For application, the current links of the mapped addresses | `wallet_linked_elsewhere` |
| Import | `register-imports/` | `company`, `token`, `status` | `asic-file/` | For an opening correction, the current snapshot and head | `class_has_applied_import`, `class_not_openable`, `holdings_differ`, `former_member_after_opening`, `former_member_before_retention`, `deployment_pending`, `mirror_snapshot_changed`, `register_changed`, `mirror_correction_activity`, `mirror_correction_member_activity` |
| Particulars change | `register-particulars-changes/` | `company`, `member`, `status` | | For application, the member's current particulars, date and source | `member_left_retention`, `newer_particulars_exist`, `member_request_no_longer_current` |
| Grant | `register-grants/` | `company`, `token`, `member`, `status` | `terms-file/`, `acceptance-file/` | The register row, the class's supply and chain fields, the recipient's particulars and the UTC day; for an award, the award, its vesting events and its applied grants | `imported_non_tokenised_register_required`, `authorised_headroom_required`, `effective_date_before_latest_entry`, `approving_director_conflict`, `member_wallet_linked`, `member_reference_conflict`, `identified_company_member_required`, `member_particulars_changed`, `recorded_vested_quantity_required`, `award_binding_required`, `award_evidence_unavailable` |
| Transfer | `register-transfers/` | `company`, `token`, `from_member`, `to_member`, `status` | `instrument-file/` | The register row, the class's supply and chain fields, both members' particulars and the UTC day | `imported_non_tokenised_register_required`, `sufficient_holding_required`, `share_limit_required`, `effective_date_before_latest_entry`, `identified_company_member_required`, `member_particulars_changed`, `member_reference_conflict`, `member_wallet_linked`, `director_is_party` |
| Allotment | `register-allotments/` | `company`, `token`, `member`, `status` | `agreement-file/`, `receipt-file/` | The agreement and contribution, the register row, the class's supply and chain fields, the recipient's particulars and the UTC day | The grant's register-state codes, `fully_paid_company_receipt_required` |

An award-linked grant reports `award_binding_required` when the award no longer matches the
grant's company, class, member, terms date, terms or agreement fingerprint. The subject of the
shared `<subject>_decided` code is `correction`, `opening`, `link`, `import`, `change`, `grant`,
`transfer` or `allotment`. A staff-era proposal keeps its staff-verified copy and reviewer and
reports `providedBy: staff_verified`. Admin shows corrections, openings, wallet links and imports
as read-only history; particulars changes have no admin page. Application commits the effect, the
decision and, where holdings change, the projection atomically. The chain families
(`register-issues/`, `register-paid-issues/`, `register-deployments/`,
`register-capital-increases/`, `register-pause-changes/`) are in [chain](chain.md).

### Corrections API

What a correction does:
[compensating corrections](../business/register.md#compensating-corrections).
The evidence is an `authority` upload.

An entry is `correctable` while it has changes and no correction reverses it. Preparation refuses
an entry of a company where the caller holds no current appointment, derives the exact inverse
changes and captures the register's sequence and head hash, which the application digest binds.
Application records the compensating entry, whose operation id is the correction's UUID; it
broadcasts nothing.

### Openings API

What an opening is:
[opening the register from the chain](../business/register.md#opening-from-the-chain).

| Method and route | Result |
| --- | --- |
| `GET {uuid}/register/opening-holders/` | For a class whose register is not opened: the block read (`number`, `hash`, `date`) and each holding address with its `shares`, the company `member` already linked to it and that member's `memberName`, or null, and `memberExists`. Holdings largest first; linked addresses match regardless of letter case. Stores nothing |
| `POST register-openings/` | Prepare, capturing the boundary; the detail adds the captured boundary and its `boundarySummary` and the mapping |

The holders read and preparation admit only a current appointment holding `admin` or `prepare`;
anyone else gets the same 404 as an unknown class. A class that is not deployed or paused, or
whose register has an entry, is refused with 400 before the chain is read; an unreadable chain
answers 503 and records nothing.

An opening, like a wallet link, takes a `mapping` list of `{address, member}`. Preparation
captures a fresh canonical snapshot, with the transfer history later classification needs, before
it takes the company lock. It refuses a mapped member of another company or an address linked to
another member, a mapping that does not cover exactly the boundary's holding addresses
(`opening_holdings_moved`, so clients can offer to read the holders again), a completed effect the
boundary does not represent, and an unreadable chain (503). Approval and application read the
chain again before the company lock, and an unreadable chain refuses them with 503 and records
nothing; rejection never reads it. `boundary_changed` means the boundary block is no longer
canonical or covered by the finality policy, or the policy or chain changed. Application commits
the members, the wallet links, the opening entry, the decision and the projection atomically.

### Wallet links API

What a link does:
[linking wallets](../business/register.md#linking-wallets-to-members).

| Method and route | Result |
| --- | --- |
| `GET register-links/waiting-wallets/?company=` | `wallets`: each wallet a completed effect of the company's opened classes waits for, as the waiting list names it in `unlinkedWallets`, with `waiting`, the number of effects naming it, ordered by address. Reads only the database; only for a current appointment holding `admin` or `prepare`, anyone else gets 404 |
| `POST register-links/` | Prepare the link; the detail adds the mapping and `mappingSummary` |

Preparation stores each address checksummed, in address order, and refuses an empty mapping, one
that is not a list of addresses and member UUIDs or repeats an address in any letter case, a
member of another company and an address already linked in the company. A company where the
caller holds no `admin` or `prepare` appointment is answered as not found. `mappingSummary` gives
each address with its member and `memberExists`. For an address with a whitelist approval for the
company, the preview and the waiting-wallets read also show `walletProof` and the live identity's
`holderType` and `holderName`, which are informational and never choose a member. Application
takes the company lock and then every share class of the company in order, records the new
members and links (skipping an address since linked to the same member), records whatever was
waiting for the link in each class with its own recorder, and marks the link applied. An
application that deadlocks with a completion recorded by the same person is aborted by PostgreSQL
and can be retried.

### Imports API

What an import mirrors and the setup screens:
[importing an existing register](../business/register.md#bringing-in-existing-records).

| Method and route | Result |
| --- | --- |
| `POST register-imports/` | Prepare a mirror opening or an opening correction; `{uuid}/file/` and `{uuid}/asic-file/` download an uploaded copy when present |

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

Optional fields are `correction_of` (the latest applied snapshot, for an opening correction),
`register_evidence`, `asic_evidence`, `asic_issued_total` and `asic_member_count`. A member row has
exactly the fields shown; `shares` is a positive whole number, dates are no later than `as_at`,
money has at most two decimal places, the allotments (1 to 10,000) must sum to the holding, and
`fully_paid` must agree with a zero `amount_unpaid`. The stored row adds `amount_paid`, the sum of
its allotments. A former row has exactly `name`, `residential_address`, `shares` and `ceased_on`.
Up to 10,000 members and 10,000 former rows; names up to 255 characters. Earlier retained
snapshots keep their missing fields unknown. `tokens_mirror_members_valid` checks the stored
shape again in PostgreSQL.

Application creates the members, any opening entry and the particulars in one transaction. An
opening correction's preview binds the current snapshot and head; application keeps the previous
snapshot, decisions and opening entry, adds the `mirror_correction` entry and records the new
particulars. An unchanged retry returns the same result; a changed retry or stale snapshot
conflicts.

### Particulars changes API

What a change does:
[changing a member's particulars](../business/register.md#changing-a-members-particulars).
The evidence is one `supporting` upload.

Preparation trims the fields and refuses a member of a company where the caller holds no current
appointment and an empty name, address or reason. Application records the name, address and date
as the member's particulars, naming the change as their source; the database writes particulars
only while applying the import or change that names them. A change prepared from a member's
request carries `member_request`; that column is nullable, so earlier changes keep their digests.

### Reconciliation acknowledgements API

What an acknowledgement means:
[acknowledging a discrepancy](../business/register.md#acknowledging-a-discrepancy).

| Method and route | Result |
| --- | --- |
| `GET register-reconciliations/` | Reconciliations, newest first, of classes whose register the caller may read; filters `company` and `token` |
| `GET register-reconciliations/{uuid}/` | Status, block, register sequence, any failure, whether it is the class's `latest`, and each discrepancy as stored with `acknowledgeable` and its `acknowledgement` |
| `POST register-reconciliations/{uuid}/acknowledge/` | Acknowledge one discrepancy; return the reconciliation |

`discrepancy` counts from zero through the record's `discrepancies` in API order. A row is
`acknowledgeable` while its reconciliation is the class's latest, its kind can be acknowledged
and nothing acknowledges it yet. Its `acknowledgement` is `null`, or `reason`, `appointment`,
`acknowledgedByName`, `acknowledgedAt` and `providedBy` (`company`, or `staff` for one recorded
before acknowledgement was company-run, with no appointment or name). A new
acknowledgement answers 201; an identical retry with the same `idempotency_key` answers 200, even
after a later reconciliation; the same key with any change answers 409. The request records
nothing and refuses: a reconciliation the caller cannot read, or an appointment that is not the
caller's current one holding `admin` or `approve` (as not found); a caller who does not meet
`issuer_kyc_required`; a position outside the discrepancies; a blank reason; and a row the
[acknowledgement rules](../business/register.md#acknowledging-a-discrepancy) exclude. Each
acknowledgement is retained with the reconciliation, row, reason, person, appointment and time.

### Grants and transfers API

What the company does: [non-paid grants](../business/issuing-shares.md#grants-to-walletless-members)
and [non-paid transfers](../business/register.md#non-paid-transfers-between-members). Both work
only on an opened, imported, non-tokenised register and between walletless members.

In both requests, shares are positive whole-number strings of up to 78 digits; names and
references are up to 255 characters, addresses, terms and reasons up to 1,000.

Application rechecks every requirement and, in one transaction, records one ISSUE or TRANSFER
with the company applier as recorder, updates holdings and creates any new member and its
particulars. A grant linked to an award must fit within the award's recorded vested quantity:
`tokens_employee_award_grant_allocation` refuses applied grants beyond it at commit. A transfer
that empties a holding writes a `RegisterMemberCessation`. Identical retries return the original
receipt; changed retries conflict.

`GET {uuid}/register/members/` lists a class's company members for these forms: each member's
recorded `name` and `residentialAddress` (or null), `currentShares` in the class, `enteredOn`,
`lastCeasedOn`, `walletless` and `particularsRetained`.

### Employee awards API

What an award is: [employee awards](../business/issuing-shares.md#employee-awards-and-vesting).

| Method and route | Result |
| --- | --- |
| `POST register-awards/` | Record an award |
| `GET register-awards/`, `{uuid}/`, `{uuid}/file/` | Awards (filters `company`, `token`, `member`) with `vestedShares`, `issuedShares` and `availableShares`, and the retained agreement |
| `POST register-award-vestings/` | Record a vesting event |
| `GET register-award-vestings/`, `{uuid}/`, `{uuid}/file/` | Vesting events (filters `company`, `award`) and their retained evidence |

`register-grants/` with an `award` is the only issue path for an award. An award records no
member, entry, position or supply. In PostgreSQL, awards and vesting events are append-only and
keep their actor, appointment, operation id and creation time; their identity triggers require
exact current company authority, recipient, class and agreement, or exact award, quantity, date
and evidence, and constraint triggers recheck the recording authority at commit. Concurrent events
and linked grant applications serialise the allocation check, and a failed effect rolls back
whole. The tables are operator-only.

### External allotments API

What an allotment records:
[external allotments](../business/issuing-shares.md#external-investor-allotments).

In `POST register-allotments/`, `consideration` and `received_amount` take up to 18 integer
digits and two decimals, in `AUD` only. The detail nests the read-only agreement and contribution, the
contribution naming its company provenance; the files are `file/` (authority), `agreement-file/`
and `receipt-file/`.

The agreement (`RegisterAgreement`) and receipt attestation (`RegisterContribution`) are immutable
retained sources: the receipt must be an exact positive AUD amount allocated to the agreement,
and both recheck their exact allotment and recording authority at commit. Allotment decisions are
append-only and recheck authority and approval at commit. `tokens_guard_allotment_register_entry`
admits an allotment's ISSUE only under its exact current company application, and a new member
or particulars only from that application. The guards preserve supply and headroom and one applied
effect. The tables are operator-only. Amount paid follows from the allotment as described under
[holdings and identity](#holdings-and-identity-resolution).

### Member access API

What member access gives: [member access](../business/member-records.md#member-access).

| Route | Methods |
| --- | --- |
| `member-invitations/` | `GET` (filters `company`, `member`) for current personal `admin` appointees. `POST` (optional `acceptance_deadline`, default 7 days, at most 30) answers 201 with a one-time `code`; a retry answers 200 without it |
| `member-invitations/accept/` | `POST` with the `code` (43 URL-safe characters) |
| `member-associations/` | `GET` (filters `company`, `member`) for `admin` appointees; `{uuid}/revoke/` with a `reason` of up to 1,000 characters |
| `member-records/` | `GET` the caller's own associations: company, recorded identity, each class's `shares`, `enteredOn`, `ceasedOn` (within retention) and `amountPaid`, and awards with vesting and quantities; `{uuid}/entries/?token=` the caller's own entry deltas |
| `member-particulars-requests/` | `GET` (filters `company`, `member`, `association`) and `POST`; `{uuid}/prepare/` prepares the linked particulars change |
| `member-certificate-requests/` | `GET` (filters as above) and `POST`; `{uuid}/withdraw/`; `{uuid}/fulfilment-preview/`, `{uuid}/fulfil/` and `{uuid}/file/` as in [output routes](#output-routes) |

Only the code's SHA-256 is stored. Fresh migrations install the association and the append-only
invitation, revocation, request and withdrawal records with RLS forced and no application-role
grants. Their guards require current company administration and one exact recorded member and
recipient for an invitation; the exact invited recipient, current source and an owned account for
acceptance; exact current company revocation to end an association; a confirmed own association
and the exact retained current particulars for a particulars request; and a genuine uncorrected
receiving ISSUE or TRANSFER of the associated member for a certificate request. Constraint
triggers recheck identity and authority at commit. A particulars change prepared from a request
must keep the attributable request and current association through approval and application.

### Retained register instructions API

The retained instruction workflow and its rules are in
[register instructions for issues](../business/issuing-shares.md#retained-issue-instructions)
and [for transfers](../business/register.md#settled-transfer-instructions).

| Method and route | Result |
| --- | --- |
| `POST register-instructions/` | Submit the owner's instruction; return the retained instruction |
| `GET register-instructions/` | Retained instructions of companies whose register the caller may read |
| `GET register-instructions/{uuid}/` | Instruction, items and decision |
| `GET register-instructions/{uuid}/file/` | The retained authority file, as an authenticated attachment |

An `issue` instruction's `items` are `{"request": "<uuid>", "recipient": "0x…", "amount": "100"}`.
A `transfer` instruction lists settlements instead, each item
`{"settlement": "<uuid>", "seller": "0x…", "buyer": "0x…", "amount": "25"}`, taken from the
waiting list (a waiting transfer's `source` is the settlement, its `wallets` the seller's then the
buyer's, and its `shares` the amount). Staff review in admin rechecks a reviewer-bound, expiring
confirmation, the retained evidence and every item under the company and share-class locks, then
records whatever waited for the instruction in one transaction. Instructions are immutable and
undeletable; repeated identical submissions and decisions are idempotent and conflicting UUID
reuse is refused.

### Operator transaction boundary

The operator connection is trusted to execute bounded register commands. Grants, transfers,
allotments and member access keep their authority constraints deferred and recheck current
decision and approval authority at commit. A direct operator SQL caller can force deferred
constraints early with `SET CONSTRAINTS ... IMMEDIATE`, so a valid effect checked before an
appointment expires can commit after it. Statement-time checks still require genuine current
appointments, approval and an exact effect, and no HTTP route exposes SQL or constraint-mode
control. The commit-time guarantee covers the normal bounded command, not arbitrary operator
transaction control.

Director-party comparison in the API and services uses Python's Unicode casefold and whitespace
normalisation. The PostgreSQL 16 guard uses lowercase and whitespace normalisation, which is
narrower: `Straße Example` and `STRASSE EXAMPLE` compare equal in the service and unequal in SQL.
The customer command refuses that conflict; arbitrary operator SQL does not get the full Unicode
comparison.

## Reads and exports

### Register read routes

| Method and route | Result |
| --- | --- |
| `GET /api/v1/tokens/register/` | Share classes whose register the caller may read, filterable by `company_uuid` |
| `GET /api/v1/tokens/{uuid}/holders/` | The `ShareRegister` response: `initialized`, the holders and totals, `waitingEffects` and the former members with their as-at time, block and staleness |
| `GET /api/v1/tokens/{uuid}/register/entries/` | Recorded entries, newest first, each change naming its member as the register does, with `corrects`, `correctedBy` and `correctable`; repeat `entry` with UUIDs to read just those |
| `GET /api/v1/tokens/{uuid}/register/waiting/` | `effects`, the [waiting effects](#waiting-effects) |
| `GET /api/v1/tokens/{uuid}/register/members/` | The class's company members, for preparation forms |
| `GET /api/v1/tokens/{uuid}/register/export/` | The [register CSV](#register-csv) |

These routes admit `ShareToken.objects.register_readable_by`: the company owner or a current
appointment holding `admin`, `read_register`, `prepare`, `approve` or `apply`. Other
capabilities, delegation-only scope and staff or superuser status grant none of them; why is in
[who runs what](../business/register.md#who-runs-what). They run on the operator
connection, because a members' register carries each holder's name and residential address,
which no policy admits to the principal reading it; without it the register would print
`unidentified` and blank addresses. The current-member API omits residential addresses;
former-member rows include them. The export of a register with no opening is refused with 409
`register_not_initialized`, and the export route refuses `HEAD`, which would record a sheet it
never sends.

### Waiting effects

A completed issue or transfer after the opening waits rather than entering a holding, so a
register with waiting effects is behind the chain until they are recorded. The list,
`waitingEffects` and recording walk the same classification in the same order, so the count is
the list's length and the first effect listed is the one recording stops at. Each effect carries
`kind` (`issue` or `transfer`), `source` (the issuance or settlement id, which becomes the entry's
operation id), `block`, `wallets` (the recipient's, or the seller's then the buyer's), `shares`,
`reason` and `unlinkedWallets`.

| Reason | Mechanism |
| --- | --- |
| `attribution` | The opening's captured boundary cannot place the completion |
| `unlinked` | A wallet it names has no member link; `unlinkedWallets` lists which |
| `unreviewed` | The issue's request records no approving reviewer; recording does not invent a recorder |
| `uninstructed` | No applied register instruction covers it |
| `refused` | Recording last tried it and the register refused the entry; the logged refusal names the cause |
| `behind` | An earlier effect in the class waits |

A count that cannot be computed is `null` in the API and `unknown` in the CSV, and the list is
`null` with it, as for a register with no captured boundary. A register an import opened has no
boundary: its count is 0 and its list empty while nothing has completed on chain for the class,
and both are `null` once something has. What resolves each reason is in
[the issuer's waiting list](../business/register.md#why-a-completed-effect-waits).

### Output routes

| Method and route | Result |
| --- | --- |
| `GET /api/v1/tokens/{uuid}/register/inspection-copy/` | Preview with the source digest |
| `POST /api/v1/tokens/{uuid}/register/inspection-copy/` | Answers `register-<symbol>-inspection-copy.csv` |
| `GET /api/v1/tokens/{uuid}/register/certificate/?sequence=N` | Preview with the page count and source digest |
| `POST /api/v1/tokens/{uuid}/register/certificate/` | Answers `certificate-<symbol>-<sequence>.pdf`, `Cache-Control: private, no-store` |
| `GET /api/v1/tokens/member-certificate-requests/{uuid}/fulfilment-preview/` | The certificate preview for one member request |
| `POST /api/v1/tokens/member-certificate-requests/{uuid}/fulfil/` | Retains the file |
| `GET /api/v1/tokens/member-certificate-requests/{uuid}/file/` | The retained PDF, `member-certificate-<uuid>.pdf` |
| `POST /api/v1/companies/{uuid}/pack/` | Answers the [company pack](#company-pack-format) zip |

Inspection copies and certificates run inside a locked company operation that binds the exact
current register-reading appointment, before and after the output is built; ownership and staff
permission supply no output authority. The inspection source digest is the SHA-256 of
`<class id>/<register sequence>\n` followed by the base CSV bytes. The certificate source digest
is the SHA-256 of `<class id>/<entry id>/<register sequence>\n` followed by the PDF bytes. A
changed source refuses with a conflict.

A member certificate is filtered to the requesting member before anyone else's particulars are
read, uses the member's retained company-recorded particulars, and must be one page of at most
1 MiB. Fulfilment retains `MemberCertificateFulfilment`: the request, producer, appointment,
instruction, `certificate` export record, source snapshot and digest (from
`tokens_member_certificate_source_digest`), file digest and size, and the bytes privately. Its
guard requires exact current company authority, the member's own receiving effect, the captured
source and the audited bytes, and refuses rewrites. The file route serves the bytes only when they
match the retained size and digest, to a current own association or a current company reader. An
exact retry returns the retained result; a changed one conflicts. Notice figures have no API
route; staff prepare them in admin (`notice-figures-<symbol>-<period start>-to-<N>.csv`).

### Export records

Ledova keeps a fingerprint, not the file. Each output is recorded in `RegisterExport` once its
bytes are built, with the requester's id, the share class, the kind, the register sequence, the
current- and former-member row counts and the time. A refused or failed output records nothing.
Check constraints require each kind's fields and refuse another kind's:

| Kind | Sequence and rows | Also records |
| --- | --- | --- |
| `register_csv` | The head; member rows as exported | Nothing more |
| `inspection_copy` | The head; member rows as exported | SHA-256 of the bytes served, instruction, request date, recipient and late flag |
| `certificate` | The certified entry's; one or two pages | SHA-256 of the bytes served and the instruction |
| `notice_figures` | The head's; the members the period's entries changed | SHA-256 of the bytes served, instruction and the period's first day |
| `company_pack` | Each class's head, one row per class | SHA-256 of `manifest.json`, instruction and recipient |

A trigger refuses every update. The table is operator-only: no company or customer route reads it,
and staff query it in admin. The daily former-member purge removes records on the
[former-member clock](security.md#retention-clocks).

## Output formats

Every output reads one snapshot of the stored register through the export's own code. Days are
counted in Sydney's calendar (`STATUTORY_CALENDAR`), so for a company elsewhere a late flag or due
date can only err towards late
([inspection copies](../business/member-records.md#inspection-copies)). Text the company or staff
entered goes through `csv_cell`, which puts a leading apostrophe before a value that opens with a
formula character. The statutory deadlines behind each output are in
[outputs at a glance](../business/member-records.md#outputs-at-a-glance).

### Register CSV

The CSV has three sections of different widths; read them by their headers, not by column
position:

1. Current members, under a header row starting "Member ID": Member ID, Name, Residential
   address, Wallet addresses, Holder type, Class, Shares held, Percentage of issued supply (as
   `N%`), Balance source (`Stored register`), Identity source, Date entered, Whitelist status and
   Amount paid (blank where not established). Wallets are joined with `; `; Whitelist status lists
   each wallet as `<address>: <status>`, joined the same way. A wallet's status is its approval for
   the class's company: Active, Expired once a recorded expiry has passed, Pending, Removed or
   Failed, "Not approved for this company" when the wallet has an entry and no approval there, or
   "No whitelist entry".
2. Supply summary, after an empty row: Issued supply, Held by listed members, Completed effects
   waiting to be recorded (when there are any, or `unknown`), and Reconciled with the chain: the
   latest result (its status or discrepancy count) with its block and time, `never`, or
   `not on chain` for a class an import opened.
3. Former members, after an empty row and the heading "Former members (retained under s169(3) of
   the Corporations Act)": Name, Residential address, Wallet address, Shares held on ceasing,
   Date ceased, Identity source and Identity recorded at. A final As at row gives the fold's time,
   block and `stale` when stale; `never read` and `stale` before a chain class's first fold; or
   `not on chain` for an import-opened class the fold has never read.

Every cell goes through `csv_cell`.

### Inspection copy format

`prepare_inspection_copy` builds the register CSV above, with its header row, and adds a fourth
section headed "Inspection copy under s173(3) of the Corporations Act": Requested on, Company's
written instruction, Recipient, Produced on, and "Produced more than 7 days after the request"
(`yes` or `no`).

### Certificate format

`prepare_certificate` reads one entry of the class's own register by its number, from one
snapshot. Holdings are replayed from the entries up to and including the certified one. Page
content, numbering and refusals are in
[what a certificate shows](../business/member-records.md#what-a-certificate-shows).

PyMuPDF renders each page from
[share_certificate.html](../../backend/tokens/templates/tokens/share_certificate.html),
in which every value is escaped, and embeds the glyphs non-Latin names need. It is imported only
when a certificate is rendered
([legal position 12](../legal/positions.md#12-pymupdf-an-agpl-runtime-dependency)).
Fonts are subset, metadata is cleared and the file carries no creation date or random identifier,
so preparing the same entry again gives the same bytes while the register, the particulars and
the PyMuPDF version stay the same.

### Notice figures format

`prepare_notice_figures` reads the class's stored register and every issue, transfer and
correction entry whose effective date is on or after the period's first day, up to the head. The
opening is never listed. The CSV has four sections, each after a heading row:

1. "Figures for the company's notices of share issues and of changes to members and share
   structure": Share class, Period from, To register entry (the head's sequence), Company's
   written instruction and Produced on.
2. "Entries in the period": Entry, Kind, Effective date, Corrects entry, Member ID, Name, Shares
   (the signed change) and Amount paid, a row for each member an entry changed, in entry order.
3. "Class at the register head": Issued supply, Members holding shares and Total amount paid.
4. "Members changed in the period, at the register head": Member ID, Name, Residential address,
   Shares held (0 for a member who no longer holds any) and Amount paid, in member-id order.

An issue's amount paid is the money backing of the issuance it recorded; a member's is the
register's own. Either reads the literal `not recorded` where it is not established exactly.
Counts, entry numbers and changes are plain numbers, so a negative change reads as one. The
content rules are in
[what the figures contain](../business/member-records.md#what-the-figures-contain) and the
refusals in [preparing notice figures](../business/member-records.md#preparing-notice-figures).

### Outputs due computation

`outputs_due` reads, in one snapshot, the issue and transfer entries no correction has reversed.
It annotates each entry `certified` when a `certificate` export of its class has the entry's
sequence as its `register_sequence`, and `noticed` when a `notice_figures` export of its class has
`period_from` on or before the entry's `effective_on` and `register_sequence` at or after the
entry's. A company-recorded transfer is dated from the applied `RegisterTransfer.lodged_on`, and a
settled one from its `SwapOrder`'s `created_at` in `STATUTORY_CALENDAR`, both through
`months_after`. It sorts by due date, company name, class symbol and sequence, compares due dates
against today in `STATUTORY_CALENDAR`, and stores and records nothing. Given a company it reads
only that company's entries; the admin due page calls it without one. The due rules are in
[the due list](../business/member-records.md#the-due-list).

## Company pack format

What the pack is for, who produces it, what never leaves and why:
[the company pack](../business/member-records.md#the-company-pack); the owner's choices are in the
[decision](../decisions.md#the-company-pack).

### Building and recording the pack

One builder, `_build_company_pack` in [company_pack.py](../../backend/tokens/services/company_pack.py),
serves two entry points:

| Entry point | Code | Scope |
| --- | --- | --- |
| `POST /api/v1/companies/{uuid}/pack/` (company) | `prepare_company_pack` in [company_pack_outputs.py](../../backend/tokens/services/company_pack_outputs.py) | Complete opened, imported, non-tokenised core packs only |
| **Company packs** admin row action (staff) | `produce_company_pack`, from [companies/admin/pack.py](../../backend/companies/admin/pack.py) | The broader retained scope |

The company route must run outside an existing transaction. It binds the exact current `admin`
appointment in one durable transaction, builds the pack, then in a second durable transaction
rechecks the appointment, locks every captured class row and records the export, and rechecks the
appointment again. `_require_core_contents` refuses the whole pack, rather than omitting records,
when the snapshot holds any approval or approval change, any publication, any wallet nomination,
wallet instruction, wallet link, register instruction, deployment, capital increase or pause
change, or a class that is not a draft with an applied import and no chain fields, deployment,
operations, issuance requests, subscriptions awaiting allotment, settlements, capital increases or
pauses. The staff page is a row action on **Company packs**, a `Company` proxy that only creates
permissions; it needs `companies.change_companypack` and `companies.view_companydocument`.

The builder reads every record, the company row included, in the register outputs' one
repeatable-read snapshot on the operator connection, so an entry recorded meanwhile cannot make
two files disagree. It reads no chain. Once the snapshot closes it sums the stored files and
refuses above the ceiling, then writes the archive into a `SpooledTemporaryFile` that stays in
memory up to 8 MiB (`COMPANY_PACK_SPOOL_BYTES`), streaming each stored file from private storage.
A pack is recorded as one `company_pack` export per class, each with the SHA-256 of
`manifest.json`, only once the archive is complete, so a failure while writing records nothing.
The download is `company-pack-<ACN>-<YYYYMMDDTHHMMSSZ>.zip`, named for the as-at time in UTC.

A refusal records nothing; the refusals are listed in
[recording and refusals](../business/member-records.md#recording-and-refusals). The builder also
refuses a company decision record whose company, evidence, appointment, approval or entry binding
is inconsistent.

### Archive and manifest

The pack is a zip written by Python's `zipfile`. Entries are in path order with `manifest.json`
last, because its digests are known only once every stored file has been streamed; each is
deflated, dated 1980-01-01 00:00 and mode 0644, so the same records, files, request and time give
the same bytes.

`manifest.json` names the format `ledova-company-pack` and version `1`; the company's id, name and
ACN; the as-at time, when the snapshot was read; the instruction and recipient; each class's id,
symbol, register sequence and head hash (64 zeros when unopened); each publication's id, kind,
number of events and head hash; and every other file's path, size in bytes and SHA-256. The
recorded digest is the SHA-256 of `manifest.json`, so it fixes every file even when the files are
zipped again. The file list is open: adding a file keeps the version, and changing what an existing
file means changes it.

JSON files are UTF-8 with sorted keys, a two-space indent and non-ASCII text as written. Times are
ISO 8601 in UTC, and share quantities and supplies are strings of whole numbers. The JSON writer
refuses any value it does not know how to write, bytes included. Class folders are named by class
id, not symbol, because symbols are unique within a company only as written; the README's class
table and the manifest map each id to its symbol.

The README is Markdown from
[company_pack_readme.md](../../backend/tokens/templates/tokens/company_pack_readme.md).
Text the company or staff supplied (names, symbols, the instruction, the recipient) passes through
the `md` filter in [company_pack_text.py](../../backend/tokens/templatetags/company_pack_text.py): it
turns control and line-breaking characters into spaces, trims the ends, backslash-escapes the
characters Markdown or HTML would read as structure and escapes a leading list marker, so a value
cannot add a heading, a table column, a link or a tag. Values Ledova produces (ids, hashes,
addresses, counts, times, status codes) are left as they are. The JSON files and `register.csv`
carry every value as stored.

### Pack files

| File | Built from |
| --- | --- |
| `README.md` | The template, filled in for the company |
| `manifest.json` | Generated, as above |
| `company.json` | The company row and address, the full name on the owner account's profile, and its business-register checks |
| `company_mandates.json` | The company's decision records with their actors, appointments and sources: see [company decision records](#company-decision-records) |
| `approvals.json` | The registry addresses the company's approvals and approval changes recorded; each approval's wallet, registry, status, expiry and whether it was `listed` at the as-at time; each approval change's id, action, wallet, registry, expiry, authority, status, times and transaction hash |
| `wallet_links.json` | Every wallet link of the company, applied, pending and rejected, as an authority record |
| `particulars_changes.json` | Every particulars change the company prepared, as described under [authority records](#authority-records-and-history) |
| `documents.json` | Every company document, oldest first: see [documents](#documents-and-evidence-copies) |
| `documents/<document id>.<extension>` | Each company document Ledova holds a file for, as uploaded |
| `documents/evidence/<record kind>/<record id>.<extension>` | The retained copy behind each authority or core record |
| `documents/evidence/<record kind>-<source>/<record id>.<extension>` | A record's second source: an import's `asic` extract, a grant's `terms` and `acceptance`, a transfer's `instrument` |
| `classes/<class id>/class.json` | The class (name, symbol, type, authorised shares, status, transferability, chain, contract address, deployment transaction and time), its register's id, sequence, head hash and issued supply, each capital increase with its execution and each pause change with its chain side |
| `classes/<class id>/register.csv` | The register CSV's three sections with its header row, from the export's own code, without an export record. Absent while the register has no opening |
| `classes/<class id>/entries.json` | Every entry in sequence: sequence, uuid, register, operation id, kind, effective date, changes, `corrects`, previous hash, creation time, entry hash and `preimage` |
| `classes/<class id>/authority.json` | The class's openings (with the boundary each was prepared against), imports, corrections and register instructions (retained instructions, chain grants and paid issues), as authority records |
| `classes/<class id>/chain.json` | The deployment record and every outgoing operation linked to one of the class's business records: see [chain evidence](#chain-evidence) |
| `classes/<class id>/settlements.json` | Every settlement of the class with a transaction |
| `classes/<class id>/issues.json` | `issues`: each issuance request with the issuance it executed, its transaction, the execution that sent it and the subscription it allotted. `awaiting_allotment`: each subscription with a payment recorded and no issuance request |
| `classes/<class id>/former_members.json` | The CSV's former members, each with `retain_until`, seven years after it ceased |
| `classes/<class id>/reconciliations.json` | Every reconciliation, its discrepancies, and each acknowledgement's discrepancy, reason, acknowledger's name, time and `provided_by` |
| `classes/<class id>/waiting.json` | `effects`: `waiting_list(token)`, or `null` where the API's is |
| `classes/<class id>/due.json` | The class's rows of `outputs_due(company=company)` |
| `contracts/contracts.json` | See [contract information](#contract-information) |
| `contracts/<Name>.json` | The committed interfaces of `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` from [backend/contracts/](../../backend/contracts/ShareToken.json) |
| `publications/<publication id>/publication.json` | See [publications in the pack](#publications-in-the-pack) |
| `publications/<publication id>/roll.json` | Its frozen roll, without account ids |
| `publications/<publication id>/events.json` | Its event chain: ballots withheld, every other event in full with its preimage |
| `publications/<publication id>/document.<extension>` | Its document's bytes as stored |
| `publications/<publication id>/payments/<record id>.<extension>` | Each payment record's remittance evidence as stored |

The record kind in an evidence path is the lowercase model name (`registeropening`,
`registerimport`, `registercorrection`, `registerinstruction`, `registerwalletlink`,
`registerparticularschange`, `registeraward`, `registerawardvesting`, `registeragreement`,
`registercontribution`, `registerallotment`, `registergrant`, `registertransfer`), which keeps
records sharing an operation id from replacing each other's copy. The extension is that of the
media type the snapshot recorded (`.pdf`, `.png` or `.jpeg`; none for another type).

### Company decision records

`company_mandates.json`, built by
[company_pack_mandates.py](../../backend/tokens/services/company_pack_mandates.py), carries the
company's decision records: `openings`, `imports`, `corrections`, `wallet_links`,
`particulars_changes`, `grants`, `transfers`, `instructions` (register instructions, chain grants
and paid issues), `deployments`, `capital_increases`, `pause_changes`, `wallet_instructions` and
`allotments`, plus the company-recorded facts `awards`, `vestings`, `agreements` and
`contributions`, the `wallet_nominations` and the `appointments` any of them used.

- A decision record carries its id, company and class, `provided_by` (`company`, or
  `legacy_staff_workflow` when no preparing appointment exists), the `preparing_appointment`,
  `prepared_by` (name) and `prepared_by_id`, the time, status, approval decision, reviewer and
  rejection reason; its `decisions`, each with kind, appointment, `decided_by` and
  `decided_by_id`, time, digest and reason; its `sources` (each with the upload id, company
  document, fingerprint, SHA-256, name, media type, size and evidence `path`); its `command`
  (authority, approving director, reference, reason and family terms); and its `result` (the
  register entry, request or executions it produced).
- A fact carries `recorded_at`, `recorded_by` (the account number) and `recorded_by_name`,
  `provided_by: company`, its preparing appointment, sources and data. An award states
  `is_entitlement: true`; a contribution states `company_recorded: true` and
  `verified_by_ledova: false`.
- An appointment carries its appointee's name and `appointee_id`, capabilities, delegable
  capabilities, creation and expiry, its source (request, invitation, legacy owner, declaration
  version and text) and any revocation.

These records carry platform account numbers (`prepared_by_id`,
`decided_by_id`, `recorded_by`, `appointee_id`) as well as names. Evidence copies are carried for
openings, imports (with the ASIC extract), corrections, register instructions' authority, wallet
links, particulars changes, awards, vesting events, agreements, contributions, allotments, grants
(with terms and acceptance) and transfers (with the instrument).

### Authority records and history

[company_pack_history.py](../../backend/tokens/services/company_pack_history.py) builds the files that
record who approved what. Every query reaches the company through a foreign key or stored id, its
own or that of a class the pack read from the company, and names the company wherever the table
carries it: the pack runs on the operator connection, where no policy narrows a read, so those
joins are its only tenancy guard.

- An authority record (opening, import, correction, register instruction or wallet link) carries
  its id, submission time, authority kind, approving director, reference and reason, the terms it
  was submitted with, `evidence`, status, reviewer's name, decision time and rejection reason. An
  opening, import, correction or wallet link also carries `provided_by` (`company`, or
  `staff_verified` for one made before the family was company-run) and its `decisions` with kind,
  decider's name, time and reason. An applied opening or correction names its register entry; an
  import carries its snapshot, members, former members and `asic` (document, issued total, member
  count, `sha256`, `size`, `path`).
- `evidence` names the company document relied on, if any, and the `document_type`, name, media
  type, size and SHA-256 of the retained copy from the submission snapshot, with its `path`. A
  company-run record names no company document: its copy is of the company's own upload and its
  `document_type` is the upload's kind. The snapshot's company identity, storage path and owner id
  stay behind.
- A particulars change carries its id, submission time, `member`, new `name` and
  `residential_address`, `as_at`, `reason`, `evidence`, `provided_by`, `decisions`, status,
  decider's name, decision time and rejection reason.
- `issues.json` labels every subscription's payment with `basis: recorded` (amount received,
  date, reference seen, any payment transaction hash, refund fields). An awaiting subscription is
  `paid`, or `awaiting_payment` with an amount received, and carries the subscriber's profile name
  and the wallet the shares would go to; no account or profile id.
- Capital increases and pauses are in `class.json` beside the authorised shares and status they
  change: a capital increase's terms, board and shareholder references, status, reviewer and
  times; a pause's direction, authority kind, status, times, chain id, contract, intent,
  observation and operation key.
- `approvals.json`'s `listed` is computed at the as-at time as the registry would, so an active
  approval past its expiry is not listed; a change's requesting wallet and whitelist entry ids stay
  behind. `contracts.json` takes its registry addresses from the same file.
- Former members carry `retain_until` from `FORMER_MEMBER_RETENTION_MONTHS` (84);
  [s169(3)](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)
  keeps them that long and Ledova's own purge waits at least as long.
- Reconciliation acknowledgements carry `provided_by` `company`, or `staff` for one recorded
  before acknowledgement was company-run.

The README's restrictions and filings sections are filled from these files (see the
[template](../../backend/tokens/templates/tokens/company_pack_readme.md)).

### Chain evidence

[company_pack_chain.py](../../backend/tokens/services/company_pack_chain.py) builds `chain.json` and
`settlements.json`. The outgoing journal has no company column, so every operation is reached from
the business record that owns it, through that record's own one-to-one link, and each business
query names both the company and the class: the deployment record and its swap approval, an
issuance, a capital increase, a pause and a settlement's transaction. No join goes through an
operation key or a wallet address.

- Operations carry their key, purpose and record id, the unsigned intent (chain id, sender,
  target, value, calldata), status, last error, when opened and acknowledged, the receipt (block
  number, block hash, gas used) of the current attempt, the current attempt's hash, and every
  signed attempt, oldest first, with hash, nonce, signer, chain id and signing time. Worker claim
  ids stay behind.
- An issue's `execution` in `issues.json` and a capital increase's in `class.json` carry the
  execution's intent, operation key, transaction hash and, for an issue, its finalized receipt; an
  issuance its transaction hash; a pause its chain, contract, intent, observation and operation
  key. User ids, the initiating actor and retry claim ids stay behind.
- The deployment record is carried in full apart from the deploying principal's user id and the
  approval's retry claim: intent, operation, transaction, address, attribution flag, projection
  time, and its swap approval's intent, outcome, operation, transaction and observation.
- Settlements are every swap of the class with a transaction, which is every one admitted for
  execution: status, protocol version, the signed order's EIP-712 typed data (domain, types,
  message), order hash, digest, both signatures, transaction and operation key, finalized receipt
  and its policy, completion time, and the transfer entry whose operation id is the swap (none
  while it waits). The order, account and wallet ids stay behind.
- An opening's boundary travels with the opening in `authority.json`, because the opening's
  mapping was checked against it and its entry is derived from it (the boundary's holdings summed
  by mapped member, effective on the boundary block's date), so a reader can check that offline.

Signed bytes never leave. A mined transaction can be fetched from any node by its hash, but an
unmined one could still be broadcast, so the pack carries the hash, nonce, signer, chain id and
unsigned intent, never the signed payload ([outgoing signing](chain.md#outgoing-signing-foundation)).
Attempts are read with a column list that excludes the payload, and the JSON writer refuses any
bytes value. The README's section 3 states what each record proves: an opening's boundary proves
one provider reported those holdings at that block under the named finality policy, not
independent consensus; an approval observed already in place proves the contract was read in that
state, not which transaction put it there.

### Contract information

Nothing in `contracts.json` is read from a chain. It carries the chain id; the compiler settings
(Solidity 0.8.24, EVM `paris`, 200 optimizer runs, `via_ir`, OpenZeppelin 5.4.0, matching
[hardhat.config.ts](../../contracts/hardhat.config.ts) and [package.json](../../contracts/package.json));
the configured factory and settlement addresses with their interface files; each registry address
the approvals recorded with its `owner`; and each class's address, `owner_at_deployment` (the
sender its deployment record froze), `approved_on` (the settlement contract its swap approval
targeted, empty without approval terms) and signing domain ("Ledova Trading", version 1, the chain
id and the class address). The settlement domain is whatever `configured_domain()` returns, empty
when no settlement contract is configured. The company's registry address is not stored on the
company, so the README says to call `registryOf(acn)` on the factory when none is recorded. A
registry's `owner` is the one sender every deployed class's record names, because the factory
creates the registry with its first class's owner and refuses a later class with another; it is
empty when no record exists or the records disagree. Interfaces are the files committed under
`backend/contracts/`, never a local `contracts/artifacts/` build.

The README's section 5 explains how to hand over control on chain and does not perform it (see the
[template](../../backend/tokens/templates/tokens/company_pack_readme.md)). A record is unresolved
while a class is `deploying`, its swap approval `pending` or `executing`, an issue's execution
`queued` or `executing`, a capital increase `executing`, a pause `pending` or `executing`, a
settlement `executing`, or an approval change `pending` or `executing`.

### Documents and evidence copies

[company_pack_documents.py](../../backend/tokens/services/company_pack_documents.py) builds
`documents.json` and chooses the stored files, all under `companies/<company id>/`
([files and retention](security.md#private-files)).

- Company documents: `documents.json` lists every document oldest first with its id, type, name,
  media type, validity dates, whether and when it was verified, upload time, `external_url` and
  `path`. A document with a stored file is carried with its bytes as uploaded; one held only as an
  `external_url` has `path` `null` and is not fetched. Staff notes, the rejection reason, the
  verifier's account and the verification fingerprint stay behind.
- Evidence copies: each record's retained copy is carried at its evidence path even when its
  company document is also carried, because the document may have changed since and the copy is
  what was reviewed. The records are taken from the same objects the history files list, not a
  second query.
- The digest tie: while streaming an evidence copy the builder computes its size and SHA-256 and
  refuses the pack, naming the record, unless they are those its snapshot recorded. A publication
  document and remittance evidence are tied the same way to the SHA-256 recorded when each was
  stored. A company document has no recorded digest, so only the manifest fixes its bytes.
- The ceiling: before writing, the builder sums the stored files, a company document by its
  recorded `file_size` and everything else by the size storage reports. Above
  `COMPANY_PACK_MAX_STORED_BYTES`, 256 MiB in [constants.py](../../backend/tokens/constants.py), it
  refuses, naming the total, the ceiling and the next step: background production, built the
  first time a real pack exceeds it.
- A missing or unreadable file refuses the pack, naming the record, whether it fails when its
  size is read, when it is opened or part-way through reading, for local files, Google Cloud
  Storage and S3 alike, so it never surfaces as a server error.

### Publications in the pack

[company_pack_publications.py](../../backend/tokens/services/company_pack_publications.py) builds a
folder for each publication of the company, oldest first, reading `Publication` by the company and
everything else through the publication. Every kind has a folder; a holding statement or meeting
notice has no events.

- `publication.json` carries its id, kind, title, frozen company and class names and symbol, class
  id, record date, publication time, instruction, authority document id, the register sequence and
  head hash its roll was frozen at, `member_rows`, `audience_digest`, the document's path, media
  type and SHA-256, the resolution or distribution terms, and `reads`. The authority's
  verification fingerprint and the preparing staff member's id stay behind.
- `roll.json` carries each row's id, register member, name, holder type, identity source, shares
  and entitlement, never the account id. Before carrying it the builder runs `verify_roll` and
  refuses, naming the publication and `publications verify`, if the row count or digest no longer
  match.
- `events.json` carries a close, a payment record and a withdrawal in full with their preimage
  (sequence, kind, hashes, uuid, roll row, staff flag, authority, payload, paid date, reference,
  evidence path, SHA-256 and media type, creation time). A ballot carries only its sequence, kind,
  `previous_hash`, `entry_hash` and `withheld: true`.
- `reads` counts document reads by members, the company and staff, the distinct roll rows whose
  member opened it, and staff reads of remittance evidence, in one grouped query over
  `PublicationRead`; no reader, time or record id leaves.

### Technical limits of the pack

Limits a reader sees are in [limits of the pack](../business/member-records.md#limits-of-the-pack);
these are the builder's own. No offline consumer ships; the earlier one remains in the
[10 October tree](https://github.com/Ledova/ledova/tree/5f40e3cd896afc3f3a55a14e359224156735a417/backend/tokens/tests)
as history.

- A swap approval observed already in place, a legacy settlement with no transaction record and a
  legacy mint journal are not exercised; a pause observed already in place is carried with its
  block and no operation.
- The ceiling counts a company document by its recorded size, which staff can edit; uploads are
  bounded at 10 MiB each (`UPLOAD_MAX_BYTES` by default), so the error is bounded by the number
  of documents.
- `company_mandates.json` names an evidence `path` for capital-increase and pause-change
  authority copies and for chain-grant terms and acceptance copies, but the archive carries only
  the copies listed under [company decision records](#company-decision-records),
  so those paths have no file.
- The README predates the decision records: its file table omits `company_mandates.json`, and
  its opening and preimage notes say no platform account ids leave, although that file carries
  them.
- The close's hash covers the last ballot's, so a reader can check the withheld ballots' links.
  A roll's audience digest covers account ids that do not leave, so only the builder can check it.
- Production near the ceiling has not been measured; a proxy in front of the backend could time
  out a large download.

## Publications

What a company publishes, who may read it and how ballots and dividends work for the company and
members: [shareholder publications](../business/publications.md). The services are
[publications.py](../../backend/shareholders/services/publications.py),
[roll.py](../../backend/shareholders/services/roll.py), `resolutions.py`, `distributions.py` and
`summary.py`; guards are in
[shareholders/database_guards.sql](../../backend/shareholders/database_guards.sql).

### Publication storage

One `Publication` table holds every kind (`holding_statement`, `meeting_notice`, `resolution`,
`distribution`). The columns every kind needs (company, class, record date, instruction,
authority, snapshot head) sit on the row, and per-kind check constraints add the rest: the
document kinds carry stored bytes and a digest, a resolution its question, kind, basis and window,
a distribution its rate, currency, dates and totals. A new kind joins the same table and names
itself in the constraints it needs.

Register outputs keep a fingerprint and regenerate their bytes from the replayable event chain. A
publication cannot, because a member reopening in June what they read in March must get the same
bytes after the register has moved on. So the document is stored through the ordinary upload
pipeline at `companies/<company>/publications/<uuid>/<uuid>.bin`, with the SHA-256 and media type
of what was stored.

The insert guard `shareholders_guard_publication` requires a class on chain (deployed or paused,
with a contract address), the class's opened register at the publication's sequence and head
hash, an authority that is a verified document of the same company whose `verified_fingerprint`
equals the one the publication copied, and the storage path. Changing the document clears its
verification, so the authority cannot drift from what was reviewed. `publish_to_members` refuses
any other class with that reason before storing anything, so a class an import opened before it
was deployed cannot be published to. The guard refuses every update, and the application role
cannot delete: only the retention purge does.

### Frozen roll and frozen names

When a publication is made, one transaction locks the class's register, replays every entry
effective on or before the record date (`holdings_at`) and writes one `PublicationRecipient` row
for each member holding shares then: register member, resolved account, name, holder type,
identity source and shares, ordered by shares then member. `member_rows` and `audience_digest`
are recorded on the publication. The digest is the SHA-256 of
`json.dumps(rows, sort_keys=True, separators=(",", ":"))`, where the rows are sorted by member id
and each is `{"member", "user", "name", "holder_type", "identity_source", "shares"}` with shares
as a string. A roll row's account comes from `member_identities` and is set only for a member a
live identity resolves to one account; identity is never resolved by joining a wallet address to
an account, because `Wallet` is unique per account, chain and address, so two accounts can hold a
row for one address. The policy reads the stored account column alone.

The publication also stores the company name and the class's name and symbol as they were. The
member's read terms on companies and classes admit the issuer's own companies or a class on the
market, and a pause moves a class out of both; a serializer reaching the names through
`select_related` would INNER JOIN the non-nullable foreign key and drop the publication from the
listing. Storing the names avoids the join instead of widening a policy, and a company term that
read the roll back would be a recursion PostgreSQL refuses. The roll guard refuses changes, a row
whose company differs from its publication's, a row naming a nonexistent account, and an
entitlement that is wrong or on a non-distribution row.

### Publication policies and read audit

Both tables are read-only to the application role. The publication's read term is the company
that made it or a roll row naming this principal; the roll row's term is the principal it names or
the publishing company, on the row's own copied company column, so the two policies do not read
each other in a circle. On the event chain, a member reads their own ballots and payment records
through the roll row each names, and the close of a resolution they are on the roll of; the
company reads the close and its payment records on the event's copied company, and no ballot. The
roll's policy reads nothing back. Staff read in admin on the operator connection; there is no
staff API route.

Each delivery writes an append-only `PublicationRead` on the operator connection, naming the
reader, publication, roll row where there is one, `event_uuid` for remittance evidence, and
whether the reader was the member, the company or staff. It carries no name, holding or file
content and has no admin mutation path. The stored file is opened first and the read recorded
second, so a record always names a file that could be served: a file that cannot be opened
answers 503 `publication_unopened` and records nothing, and a read that cannot be recorded
answers 503 `publication_read_unrecorded` and serves nothing, as
[document reads](security.md#read-audit) do. Staff open
a document or remittance evidence through `admin_file_path` routes in the publication admin;
remittance evidence needs view permission on publications and on their events.

### The publications route

[`PublicationViewSet`](../../backend/shareholders/views/publication.py) is mounted at
`/api/v1/publications/`:

| Route | Answers |
| --- | --- |
| `GET /api/v1/publications/` | Publications for the caller, newest first, with the caller's own holding, ballot, entitlement and recorded payment; `?kind=`, `?addressed=me` and `?issuer=<company UUID>` narrow it |
| `GET /api/v1/publications/summary/` | [What waits on the caller](#the-summary) as a member |
| `GET /api/v1/publications/{uuid}/file/` | The stored document, as an attachment |
| `POST /api/v1/publications/{uuid}/ballot/` | `{"choice": "for" \| "against" \| "abstain"}`; answers the caller's updated row |

There is no retrieve route; the listing carries everything a member is shown. The list and file
actions run on the operator connection: `for_reader` admits the company's owner or a reader a roll
row names, then `seen_by` adds the per-caller fields, so a paused class keeps its publications
readable. The summary and ballot run on the application role under the policies. The file route
calls `read_publication`, which resolves the reader as member, company or staff and audits the
delivery as one act; a foreign or nonexistent uuid answers the same 404.

`kind` is one of the four kinds; any other value is a 400 naming the parameter. `addressed=me`
keeps publications whose roll names the caller. `issuer` must be a company the caller owns
(`Company.objects.owned_by`); a blank, malformed, non-owned or nonexistent value is a 400 naming
`issuer`, and with `addressed=me` it takes the intersection. Filters apply to the list action
only: otherwise DRF would apply them in `get_object`, which the ballot route reaches after the
ballot is recorded, so a cast with `?kind=distribution` would record an irrevocable ballot and
answer 404.

The per-caller fields are correlated subqueries naming the caller's account, so a company owner
who is not on the roll reads its publications with those fields null rather than losing them, and
the number of queries does not grow with the page:

- `shares`: the caller's holding on the roll.
- For a resolution: its question, kind and window; `myBallot`, the caller's ballot with when it was
  cast and whether staff entered it; `result`, the close's tally; and `ballotOutstanding`, true
  while any of the caller's roll rows has no ballot (one account can be on a roll through two
  register members, so clients offer a ballot on this, not on an empty `myBallot`).
- For a distribution: its rate, currency, declaration and payment dates; `myEntitlement`, the
  sum over the caller's rows; `myRecordedEntitlement`, the sum over rows with a standing payment
  record (0.00 when none); and `myPaymentRecord`, the latest standing record as `recordedPaidOn`,
  `reference` and `recordedAt`, or null. The declared total and remainder are not in the listing,
  and no field name says a payment was made.

Both clients read it through `@ledova/shared` (`getPublications`, `openPublication`,
`downloadPublication`, `publicationFilename`, which names the `.bin` stored object from the type
served); `useResolutionStatus` keeps one timer for the next opening or close, capped at the
longest delay a timer holds and re-armed, so an open page offers or withdraws the ballot without
reloading. The member's notices read the listing with `addressed=me`, the
[Wallet shares page](../business/member-records.md#the-wallet-shares-page) counts what waits
through `usePublicationSummary`, and the company's
[Published page](../business/publications.md#the-published-page) reads an owned company's
publications with `issuer` and offers no ballot or publishing controls.

### The summary

`summarise_for` answers in one aggregate query over the publications the policies admit, counting
only the caller's own roll rows by account:

| Count | What it counts |
| --- | --- |
| `openResolutions` | Resolutions whose window is open and on which at least one of the caller's holdings has no ballot |
| `nextClosesAt` | The soonest close among those, or null |
| `dividendsWithoutRecord` | Distributions on which at least one of the caller's holdings is owed a cent or more and has no standing payment record |

What waits on a member is in [the Notices page](../business/publications.md#the-notices-page).
In the summary, which runs under the row policies, those policies are a second wall under the
account filter for a member, and for an owner on its own roll they admit every row, so the filter
is the only wall. The listing runs on the operator connection, so its per-caller fields rely on
the account filter in `seen_by` alone for every reader.

### Announcements

When the roll commits, `tell_the_members` is deferred once. It reads the roll on the operator
connection and defers one `general` push notification for each distinct account on it, so there is
no new preference to honour. A member the register cannot name has no account and is told nothing.
The notice's title and body name the company and class; its data is `type: "publication"`,
`event: "published"`, the publication id and kind, with no holding or document. Both clients turn
it into a jump to the publications page, and the member's read then goes through the route above.

### Event chain

Ballots, the close and payment records are `PublicationEvent` rows, one chain per publication,
each copying its publication's company. The `BEFORE INSERT` trigger
`shareholders_guard_publication_event` does everything that makes the chain trustworthy:

- it locks the publication `FOR UPDATE`, so inserts on one publication are serialised, allocates
  the next `sequence` and takes the previous event's hash (64 zeros for the first);
- it admits `ballot` and `close` only on a resolution and `payment` and `payment_void` only on a
  distribution, each under its own company;
- a ballot only while the window is open and before any close, for a row on this roll, with
  `shares` copied from the row whatever the caller sent and no payload; a ballot not entered by
  staff must name as actor the account the row names, so a row with no account cannot cast one;
  a staff-entered ballot needs an active staff actor and a non-blank authority;
- a close once, only after the window has passed, with the trigger writing its `payload` from the
  ballots: shares and members for, against and abstaining, shares and members eligible, the
  basis, the resolution kind and `carried` (ordinary: for > against; special: votes cast > 0 and
  4 × for ≥ 3 × (for + against));
- a `payment` only from an active staff actor, for a row owed at least a cent whose latest record
  is not a standing payment, with evidence stored at
  `companies/<company>/publications/<publication>/payments/<event>/<uuid>.bin`; a `payment_void`
  only for a row whose latest record is a payment;
- it sets `entry_hash` with `shareholders_publication_event_hash`
  ([hash preimages](#hash-preimages)).

The trigger refuses every update and refuses deletion by the application role. Unique indexes hold
one event per sequence, one ballot per roll row and one close per resolution, so a second ballot
is refused even by a writer who disabled the trigger.

### Ballots and closing

`cast_ballot` resolves the resolution and the caller's own roll row on the calling connection
under the policies, so a caller with no roll row, a company owner included, gets the same 404 as
a resolution that does not exist and nothing is written. Only the insert runs on the operator
connection, because the application role may write nothing to the chain; the trigger's actor check
keeps the guarantee in the database. A resolution not open yet, a closed one, a second ballot and
an unknown choice are 400s that say which. The route has its own `ballot` throttle scope, 10 a
minute per user. Who may cast and when staff enter a ballot instead:
[casting a ballot](../business/publications.md#casting-a-ballot).

`close_resolutions_past_their_window` runs every five minutes and closes each resolution whose
window has passed and has no close. Two runs at once close it once: the second waits on the
publication lock, finds the close and returns it. A late close changes only when the tally
appears, because the trigger refuses every ballot after the window. The tally rule's rationale is
in [the tally](../business/publications.md#the-tally).

### Distribution arithmetic and payment records

The rate, at most six decimal places, is the input. Each roll row stores its `entitlement` and the
publication its `undistributed` remainder; there is no entitlement table. The arithmetic and
rounding rules are in
[the rate and the declared total](../business/publications.md#the-rate-and-the-declared-total) and
[entitlements](../business/publications.md#entitlements-and-the-undistributed-remainder). The roll
guard refuses a row whose entitlement is not its shares times the rate rounded down, and any other
kind's row that carries one. Because the publication row is inserted before its roll, the deferred
constraint trigger `shareholders_distribution_adds_up` runs at commit and refuses a distribution
whose declared total is not the roll's shares times the rate rounded down, or whose entitlements
and remainder do not add up to it. Why the rate, rounding and records work this way:
[decisions](../decisions.md#shareholder-publications).

A payment record is a `payment` event naming the roll row, the date the company says it paid, its
reference, the remittance evidence (stored privately with its SHA-256 and the type the upload
validator found), the staff actor and authority; `payment_void` withdraws the standing record
with a reason. How a record is corrected and what it claims:
[payment records](../business/publications.md#payment-records) and
[what is recorded and what is claimed](../business/publications.md#what-is-recorded-and-what-is-claimed).

### Publication retention

`purge_publications_past_the_clock` runs daily at 03:50
([schedule](../operations/jobs-and-storage.md#schedule)) and, on the
[publication clock](security.md#retention-clocks), purges a publication, its roll, its read
records and its event chain together, deleting the chain before the roll it points at. Removing a
publication or payment row deletes its stored bytes through the ordinary private-file lifecycle
receiver, under the swept `companies/` prefix.

### Verifying publications

`verify_publication` replays a chain on the operator connection and raises
`PublicationIntegrityError` on a sequence gap, a broken previous-hash link, a stored hash that
differs from the one recomputed in SQL ([hash preimages](#hash-preimages)), an event under another
company, or an event of a kind the publication does not take. For a resolution it also refuses a ballot whose member or shares differ
from the roll, a ballot not entered by staff whose actor is not the row's account, two ballots for
one member, an event after the close, and a close whose tally differs from the tally recomputed in
Python. For a distribution it also refuses a payment record for a row it does not owe, a second
standing record for one row, a withdrawal with nothing to withdraw, an entitlement that is not
shares times rate rounded down, and a declared total or remainder that does not agree with the
roll. The cross-checks are what catch a forger who rewrote a row and recomputed its hash.
`verify_roll` checks the roll's row count and digest. The `publications verify` command runs both
([verifying stored records](../operations/recovery.md#verifying-stored-records)).

## Account-data export

### Route and clients

`GET /api/user-profiles/export-data/` returns the signed-in person's own data as one JSON document.
It takes no identifier. It runs on the application connection under the caller's own row-level
policies ([tenancy](security.md#tenancy-model)), and `export_account_data` in
[lifecycle.py](../../backend/users/services/lifecycle.py) selects only the caller's rows. Both clients
call `exportAccountData` in `@ledova/shared`. The dashboard saves the JSON from Settings; the
mobile app writes one private cache copy bound to the session current when the export was
requested and hands it to the share sheet, the path a viewed document takes
([document copies](mobile.md#document-upload-copies)). Both name the
file `ledova-data-export-<UTC date>.json`.

### Export contents

| Section | Content |
| --- | --- |
| `exportedAt` | When the export was built |
| `user` | Email, when the account was created, whether the email is verified |
| `profile` | Name, date of birth, phone country code and number, residential address, citizenship, whether identity is verified, creation time |
| `financialProfile` | Occupation, source of funds and intended use, with their free-text alternatives |
| `account` | Id, account number, type, activation date, creation time |
| `wallets` | Each wallet's id, name, chain, address, native balance, market value, verification and creation time |
| `transactions` | Every transaction of the account's wallets, described below |
| `portfolios` | Each portfolio's id, name, whether it is active, creation time |

A section with no row is `null`, or an empty list. The export is the account's profile, wallets,
transactions and portfolios, not everything Ledova holds about the person: classification claims
and their evidence, uploaded documents, per-asset holdings, orders, subscriptions, notifications,
the transaction-alerts switch and register particulars are not in it.

### Transaction evidence fields

Every transaction row of the account's wallets is exported, newest block first, with no limit
([decision](../decisions.md#the-account-data-export)). Rows are read through a database cursor,
each with its latest chain observation in the same query.

| Field | Meaning |
| --- | --- |
| `txHash`, `chain` | The transaction's hash and Ledova's chain name |
| `status` | Ledova's recorded outcome: `pending`, `confirmed`, `failed`, `reorged` or `replaced` |
| `asset`, `amount` | The asset symbol and amount moved. Amounts and fees are plain decimal strings with every stored digit, no exponent and no trailing zeros, such as `"1.5"` or `"0.000000000000000001"` |
| `transactionFee` | The actual native fee, from the receipt or the imported history, never the estimate; `null` only when unknown, `"0"` for zero |
| `blockTimestamp`, `blockNumber`, `blockHash` | The block the receipt placed it in, where recorded |
| `nonce` | The sender's nonce, for an EVM transaction submitted through Ledova. The nonce and block number are decimal strings, because a JSON number loses digits past 2^53 |
| `importedFromHistory` | `true` when the row came from the provider's transfer history rather than a submission through Ledova |
| `chainObservation` | The latest chain observation, or `null` |
| `createdAt` | When Ledova recorded the row |

`chainObservation` has `network` (the recorded network identity, `evm:<chain id>` or
`bitcoin:<genesis hash>`, that keys the finality policy), `result` (`included`, `unknown` or
`orphaned`), `finality` (`unknown`, `waiting` or `satisfied`) and `policy` (the normalised policy
the observation was judged under).

With the hash, block number, block hash and nonce anyone can ask a node of the named network for
the transaction and its block. Block, time and fee are one provider's receipt checked against the
block header it named: consistent provider metadata, not independent chain truth
([receipt attribution](wallet-protocols.md#receipt-attribution)). The chain
observation is the latest thing Ledova's observer read, recorded apart from whether the finality
policy was satisfied; it is one provider's evidence, not a consensus proof, and never changes a
transaction's status or holdings
([wallet chain observations](wallet-protocols.md#wallet-chain-observations)).
Only the latest observation is exported, so a transaction once `included` can show `unknown`.
Only transactions submitted through Ledova with a durable journal are observed; imported history
never is. `status` is Ledova's record of the outcome, not evidence of it. Signed transaction bytes
are never exported.

### Why the export is not recorded

The export writes nothing: no export record and no audit row. A copy is recorded when it carries
personal information of someone other than the person asking, or goes to anyone but that person.
This export carries only the requester's own data and goes only to them, so recording it would log
a person looking at their own records. Register outputs meet that rule and are recorded
([export records](#export-records)).

### Export limits

- The document is built in memory within one request and grows with the number of transactions;
  there is no ceiling.
- Each section is read by its own query, not in one snapshot, so a row written during an export
  can appear in one section and be missing from another.
- `policy` is the policy recorded with the observation, not re-checked against the one configured
  now.

Next: [the register of members](../business/register.md),
[member records](../business/member-records.md),
[shareholder publications](../business/publications.md),
[verifying stored records](../operations/recovery.md#verifying-stored-records) and
[legal positions](../legal/positions.md).
