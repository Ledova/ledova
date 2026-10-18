# Register and records engine

[Engineering](README.md) · [Documentation](../README.md)

How the register of members, its outputs, the company pack, shareholder publications and a person's
own data export are stored, protected and verified; who may do what, and why, is in the business
section each part links to. Request and response fields, filters and file sub-routes are in the
[OpenAPI schema](../../backend/schema/openapi.json), so this page keeps what the schema cannot
express, naming request fields in the serializers' snake_case and response fields in camelCase
([wire casing](backend.md#backend-rules)).

Contents:

- [Register ledger](#register-ledger)
- [Register commands](#register-commands)
- [Reads and exports](#reads-and-exports)
- [Output formats](#output-formats)
- [Company pack format](#company-pack-format)
- [Publications](#publications)
- [Account-data export](#account-data-export)

## Register ledger

### Code, tables and guards

The register services in `backend/tokens/services/` are
[register.py](../../backend/tokens/services/register.py) (stored reads, CSV and outputs),
[register_events.py](../../backend/tokens/services/register_events.py) (appending and verifying
entries), [register_inclusions.py](../../backend/tokens/services/register_inclusions.py)
(completions and the waiting list),
[register_snapshot.py](../../backend/tokens/services/register_snapshot.py) (the canonical chain
snapshot), [register_reconciliation.py](../../backend/tokens/services/register_reconciliation.py),
[former_holders.py](../../backend/tokens/services/former_holders.py) (the former-member fold and
purges), [register_decisions.py](../../backend/tokens/services/register_decisions.py) (decisions
shared by every family) and [company_pack.py](../../backend/tokens/services/company_pack.py) with
its `company_pack_*.py` modules; publications are in `backend/shareholders/services/`.

`ShareRegister` is a class's register head (`sequence`, `head_hash`, `issued_supply`),
`RegisterEntry` the append-only log and `RegisterPosition` the holdings projection (`shares`,
`entered_on`, `last_entry`). `RegisterMember` is a company-scoped member id, `RegisterMemberWallet`
a company-wide wallet link, `RegisterMemberParticulars` the recorded name and residential address
and `RegisterMemberCessation` an exit from an imported register. `FormerHolder` and
`ImportedFormerMember` hold former members, and `RegisterReconciliation`, `RegisterAcknowledgement`
and `RegisterExport` reconciliations, acknowledgements and output fingerprints.

PostgreSQL enforces the ledger, not Python.
[database_guards.py](../../backend/tokens/database_guards.py) installs
[database_guards.sql](../../backend/tokens/database_guards.sql) with the family files
`database_award_guards.sql`, `database_allotment_guards.sql` and `database_member_guards.sql`,
enables and forces RLS on the member-access, award and allotment tables, and revokes every privilege
on them from the application role. Shared migrations install `database_output_guards.sql` (member
certificate fulfilment) and `database_mirror_guards.sql` (mirror imports);
[database_mirror_guards.py](../../backend/tokens/database_mirror_guards.py) re-installs the entry
guard so it admits `mirror_correction`. Every register table's write term is `false` for the
application role, so register commands write on the operator connection inside a bounded company
operation ([tenancy](security.md#roles-and-principal)). Neither role holds `TRUNCATE`. The schema
owner remains trusted: the hash chain is no externally anchored proof against a schema owner who
rewrites the whole history and every hash.

### Entries and the hash chain

A register starts empty (sequence 0, supply 0, head 64 zeros) for its own company and class; its
first entry is the opening, which may be explicitly empty. The kinds are `opening`, `issue`,
`transfer`, `cessation`, `correction` and `mirror_correction` ([what each
means](../business/register.md#register-entries)).

`record_entry` in register_events.py runs only on the operator connection. It locks the head,
returns the existing entry when an operation UUID repeats with identical values, conflicts when any
value changed, and refuses an issue or transfer dated before the latest entry. The `BEFORE INSERT`
trigger `tokens_guard_register_entry` then:

- locks the head `FOR UPDATE` and requires the opening first and only first;
- requires `changes` to be an array of objects with exactly `member` and `shares`, members distinct,
  sorted and of the register's company, and shares nonzero integer strings;
- keeps every holding and the issued supply within 0 to 2^256 − 1, lets an opening or issue only
  add, and requires a cessation to remove the whole holding;
- requires one change for an issue or cessation and two summing to zero for a transfer;
- requires a correction's changes to be the exact inverse of the entry its `corrects` names in the
  same register; only a correction may name one, and `corrects` is one-to-one, so an entry is
  compensated at most once;
- for a class with an applied company deployment, freezes the empty register until the deployment's
  original projection and admits only the company's genuine chain opening;
- assigns the sequence, `previous_hash` and `entry_hash`.

`tokens_project_register_entry` then updates each position (resetting `entered_on` when a holding
rises from zero), its `last_entry`, and the head's sequence, hash and supply in the same
transaction. Triggers refuse entry and member rewrites and deletes, position and head writes outside
the projection (`tokens_guard_register_position`, `tokens_guard_share_register`) and moving a
registered class to another company. Entries carry member UUIDs and share changes, never names or
residential addresses.

A `mirror_correction` is written only by an applied import correction. `tokens_guard_mirror_entry`
requires its changes to equal `tokens_mirror_changes`, the signed difference between the new
snapshot and the positive holdings, its date to be the snapshot's `as_at`, a current approval and
apply decision, and `tokens_mirror_correction_ready`: the base sequence and head unchanged, no entry
other than the opening and mirror corrections, and no applied deployment, issuance request past
approval, applied register instruction, member invitation, association, particulars request or
particulars change. On an imported, non-tokenised register, `tokens_record_member_cessations` writes
a `RegisterMemberCessation` when a walletless member with recorded particulars falls to zero, and
marks its return when a later entry restores a holding.

`verify_register` replays a register on the operator connection: contiguous sequences, each
previous-hash link, each stored hash against `tokens_register_entry_hash`, and the replayed
positions, `entered_on` dates, head and supply against storage; an uninitialised head fails.
`register_foundation verify` runs it ([verifying stored
records](../operations/recovery.md#verifying-stored-records)), and `register_foundation
load-synthetic-opening` records a development opening ([demo
data](../getting-started.md#demo-data)).

### Hash preimages

An entry's hash is the lowercase hex SHA-256 of the UTF-8 text of a PostgreSQL JSONB array of, in
order:

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
returns the text it covers ([database_guards.sql](../../backend/tokens/database_guards.sql)).
Publication events use the same recipe
([shareholders/database_guards.sql](../../backend/shareholders/database_guards.sql)): `ballot` and
`close` under `ledova-publication-event-v1` with uuid, publication, company, sequence, kind, roll
row, choice, shares as text, actor, staff flag, authority, payload, previous hash and creation time;
`payment` and `payment_void` under their own tag, `ledova-publication-event-v2`, so ballots already
on a chain keep their hashes, with paid date, reference, stored evidence path, evidence digest and
evidence media type inserted after payload. `shareholders_publication_event_hash` and
`shareholders_publication_event_preimage` are the counterparts.

Reproducing PostgreSQL's JSONB text rendering elsewhere would be its first copy anywhere, so the
company pack carries the preimage text beside every entry and every publication event except a
ballot, whose preimage holds the choice. The builder refuses any entry or event whose preimage does
not digest to its stored hash, so a reader needs only a JSON parser and SHA-256.

### Holdings and identity resolution

`stored_register` reads the head, supply, positions, waiting count and former members in one
`REPEATABLE READ, READ ONLY` transaction (`_snapshot`), which every output and the company pack
reuse, so an entry recorded meanwhile cannot make them disagree. A row is a positive
`RegisterPosition`, ordered by shares then member id, with its percentage, the holding over issued
supply, rounded to two places; no chain is read. A class with no register, or at sequence 0,
reports `initialized: false` and no rows; an opened register with no holdings, `initialized: true`.

`_member_identity` resolves a member from its linked wallets' whitelist identities
(`identities_for`, company-scoped, in bounded address chunks), then the latest resolved allotment
identity stamp among its wallets, then `RegisterMemberParticulars`; a member at a labelled treasury
address takes its recorded particulars and stays `treasury` ([the
rule](../business/register.md#members-holder-types-and-identity)). `member_identities` adds the
account a member resolves to only when a live identity names one account, for the publication roll.
[Amount paid](../business/register.md#amount-paid-and-date-entered) comes from `_allotments` (a
completed issuance's subscription `money_backing_shares`, only when the subscription's allotment
quantity equals the issuance), the applied import's allotments and `_external_amounts_paid` (an
applied AUD allotment whose ISSUE entry and company-recorded receipt match its consideration); date
entered from the position, the earliest allotment and `imported_membership_dates`.

The company Dashboard's ownership summary counts distinct members from each opened class's holders
read ([summary.ts](../../dashboard/src/pages/company/shared/summary.ts)).
`ShareIssuance.objects.distinct_recipient_addresses()` only counts ambiguous and unidentified
allotment addresses for the operator worklist
([operators/services.py](../../backend/operators/services.py)): with no identity-stamp fallback,
possible former holders and no transfer-only holders, it is no substitute for the register.

### Recording completions after the opening

[register_inclusions.py](../../backend/tokens/services/register_inclusions.py) classifies each
completed issuance and settlement against the opening's captured boundary: `opening` (its
transaction is in the captured history at the same block and hash, so the opening holds it),
`after_opening` (a later block, absent from the history), `attribution` (the evidence cannot place
it, so an operator must attribute it) or `unopened` (no applied opening). An opening whose boundary
does not represent a completed effect is refused. The `register_inclusions` command prints the
classification and whether each effect is `recorded`.

Each `after_opening` completion is recorded in chain order, in its own completion transaction, with
the issuance or settlement id as the entry's operation id (so recording is idempotent), dated the
UTC day it is made; the recorder and the exceptions are in
[recording](../business/register.md#recording-completed-issues-and-transfers). Recording stops at
the first effect it cannot record ([waiting effects](#waiting-effects)); the completion still
commits, so the workflow never stalls, and the reason is logged. A pass reruns on the next
completion in the class, applied wallet link in the company or applied register instruction for the
class. Each takes the share-class lock first, a wallet link every class of its company in order, so
a completion in progress cannot miss the new link or cover; settlement and issuance completion share
that lock, so neither interleaves with an opening. While the latest entry is dated after today (an
opening whose boundary block's time runs ahead of the platform's clock), the next issue or transfer
waits as `refused`.

### Reconciliation job

`reconcile_every_register` ([schedule](../operations/jobs-and-storage.md#schedule)) reconciles each
class with an applied chain opening. It captures a fresh canonical snapshot at the finality
boundary, takes the share-class lock and the register row, and compares as
[reconciliation](../business/register.md#reconciliation-with-the-chain) describes, counting an
executing issuance or settlement only when its current signed transaction is the one on chain and
requiring each completed effect in the block its receipt names. A snapshot below the opening's
boundary block is never compared. An acknowledged `unrecognised_transfer` is ignored by its
transaction hash; an acknowledged `member`, `unlinked` or `supply` difference is added to the
expected side. The job writes only `RegisterReconciliation` rows (`matched`, `discrepant` with its
discrepancies, or `failed` with the reason) with the block and sequence compared; a trigger keeps
each status consistent with its fields and refuses rewrites. A chain failure fails the
reconciliation, never the register. The kinds `unrecognised_transfer`, `missing_transfer`, `member`,
`unlinked`, `supply` and `attribution` are in [what each discrepancy
means](../business/register.md#what-each-discrepancy-means); the on-demand command and alerting in
[reconciling on demand](../operations/recovery.md#reconciling-a-register-on-demand).

### Former-member fold

`fold_every_share_class` ([schedule](../operations/jobs-and-storage.md#schedule)) folds each
deployed or paused class with a contract. `fold_former_holders` reads the token's `Transfer` history
from its deployment block through the provider's finalized block; `cessations_in` refuses a repeated
event, an invalid quantity and a sender spending shares it never received, skips self-transfers and
the zero address, reports each address whose balance falls from positive to zero, and skips
cessations older than the retention cutoff, so a purged row is never recreated. Under the
share-class lock the fold writes each missing `FormerHolder` and stamps `former_holders_folded_at`
and `former_holders_block`. Each class is all-or-nothing: a failure keeps its last timestamp and
block, does not stop other classes, and fails the job at the end. A fold older than 24 hours, or
never completed, reads as stale; a GET never folds.

Particulars are frozen at the first recorded cessation in the order [former
members](../business/register.md#former-members) gives, counting an allotment stamp only when dated
no later than the cessation (unknown with no source), and refolding never rewrites them. A read
leaves out a cessation of a wallet linked to a member who holds the class only when it falls on or
after the member's date entered as the stored register and allotments give it (an imported date
entered does not move that line); the rows left out are kept and still count against date entered
and amount paid. `ImportedFormerMember` and `RegisterMemberCessation` rows are listed beside folded
rows, from the same snapshot, with no wallet or block; for an import-opened class the former-member
time is the head entry's creation time, never stale. `FormerHolder`'s application-role read term is
the company owner alone; appointees read former members through the register reads, and no
application role writes them. The purge is in [retention clocks](security.md#retention-clocks).

### Deletion protection

The register spine `Company -> ShareToken -> {ShareIssuance, ShareIssuanceRequest,
CapitalIncreaseRequest, Offering, TransferOrder}`, `SwapOrder.share_token` and a subscription's
links to its offering, account and wallet use `PROTECT`, which admin removal of test data still
respects. The API deletes neither a company nor a share class (405): delist a company or pause a
class instead. Deleting a wallet cascades its whitelist entry and that entry's company approvals and
leaves the approval on chain; durable [whitelist commands](chain.md#whitelist-changes) keep their
own identity. Allotment identity stamps keep the identity resolved at issue, which treasury
relabelling or a current profile guess must not replace. Company documents and registry-check
history are application evidence, not membership rows.

## Register commands

Every register command follows the prepare, preview, decide and apply protocol of the [company
workflow API](backend.md#company-workflow-api), with the shared decision routes and requirement
codes of [register decisions](backend.md#register-decisions); who may take each step is in [how a
company decision works](../business/README.md#how-a-company-decision-works). Routes are under
`/api/v1/tokens/` ([urls.py](../../backend/tokens/urls.py)). Preparation refuses a record of a
company where the caller holds no current appointment, and every command meets the
[`issuer_kyc_required`](../operations/operator-console.md#operator-configuration) identity check.

### Evidence uploads

`POST register-evidence/` (multipart) answers a receipt with the file's size, media type and
SHA-256; an identical retry under the same `idempotency_key` returns it, and the same key with a
different file conflicts. The upload is checked like every upload and kept privately at
`companies/<company>/register-evidence/<uuid>/<uuid>.bin`; `tokens_guard_register_evidence` requires
the uploader's current preparing appointment, a PDF, PNG or JPEG, and that path. Its `kind` is
`share_register` or `asic_extract` (an import's optional copies), `authority` (the director
resolution or court order behind an opening, correction, wallet link, grant, transfer, allotment or
chain family) or `supporting` (a particulars change, grant terms and acceptance, a transfer
instrument, an award agreement, a vesting event, an allotment's agreement and receipt).

Preparation accepts only the preparer's own upload for this company, of the right kind, whose stored
bytes still match their fingerprint, and keeps a private copy and a snapshot
(`tokens_register_evidence_snapshot`: `provided_by`, upload id, company, kind as `document_type`,
name, size, media type, SHA-256). A director resolution names the approving director; `court_order`
carries a court reference and an empty `approving_director`. Ledova verifies none of it. A staff-era
proposal keeps its staff-verified copy and reviewer and reports `providedBy: staff_verified`.

### Proposal routes and requirement codes

Each family prepares with `POST` under its `operation_id`, lists and details the proposals of
companies whose register the caller may read, serves each retained copy as an authenticated
attachment and takes the shared decision routes (what admin shows of them is in [who runs
what](../business/register.md#who-runs-what)); the subject of the shared `<subject>_decided` code is
`correction`, `opening`, `link`, `import`, `change`, `grant`, `transfer` or `allotment`. Beyond the
shared bindings, each preview digest binds the state named below, and each family adds its own
requirement codes:

- **Correction** (`register-corrections/`): for application, the register sequence and head hash.
  `deployment_pending` (a deployment of the class is pending), `register_changed` (the sequence or
  head moved since preparation), `entry_already_corrected`, `position_would_go_negative`.
- **Opening** (`register-openings/`): the boundary block hash and, for application, the class's
  register state. `deployment_pending`; `boundary_changed` (the boundary block is no longer
  canonical or covered by the finality policy, or the policy or chain changed);
  `register_initialized` (the register has an entry); `completions_not_represented` (a completed
  issue or settlement is not represented at the boundary); `wallet_linked_elsewhere` (a mapped
  address has since been linked to another member).
- **Wallet link** (`register-links/`): for application, the current links of the mapped addresses.
  `wallet_linked_elsewhere`.
- **Import** (`register-imports/`): for an opening correction, the current snapshot and head.
  `deployment_pending`; `class_has_applied_import`; `class_not_openable` (no opening, and an applied
  deployment source, an approved issue or an applied register instruction leaves only a chain
  opening); `holdings_differ` (the class was opened from the chain and its stored holdings differ);
  `former_member_after_opening`; `former_member_before_retention` (ceased before the retention
  cutoff). An opening correction adds `register_changed`, `mirror_snapshot_changed` (the corrected
  import is no longer the latest applied one), and `mirror_correction_activity` and
  `mirror_correction_member_activity` (class or company activity that
  `tokens_mirror_correction_ready` refuses).
- **Particulars change** (`register-particulars-changes/`): for application, the member's current
  particulars, date and source. `member_left_retention` (no shares held for the retention period),
  `newer_particulars_exist` (particulars with a later as-at date),
  `member_request_no_longer_current` (the request it came from lost its current association or
  source).
- **Grant** (`register-grants/`): the register row, the class's supply and chain fields, the
  recipient's particulars and the UTC day; for an award, the award, its vesting events and its
  applied grants. The register-state codes are `imported_non_tokenised_register_required` (no
  applied import and register, or chain fields), `authorised_headroom_required` (supply would exceed
  the authorised shares or reach 2^256), `effective_date_before_latest_entry` (the latest entry is
  dated after today), `approving_director_conflict` (the director's name matches the recipient's),
  `member_wallet_linked`, `member_reference_conflict` (a new member's id exists),
  `identified_company_member_required` (an existing member is of another company or has no recorded
  particulars) and `member_particulars_changed` (particulars differ from those captured). An award
  adds `recorded_vested_quantity_required` (more than its vested and unissued quantity),
  `award_binding_required` (the award no longer matches the grant's company, class, member, terms
  date, terms or agreement fingerprint) and `award_evidence_unavailable` (its agreement or a vesting
  event's evidence no longer matches its record).
- **Transfer** (`register-transfers/`): the register row, the class's supply and chain fields, both
  members' particulars and the UTC day. The grant's register-state codes except
  `authorised_headroom_required`, with `director_is_party` (either party) for
  `approving_director_conflict`, plus `sufficient_holding_required` and `share_limit_required` (the
  recipient's holding would reach 2^256); `member_particulars_changed` also covers new particulars
  for a recipient who now holds shares.
- **Allotment** (`register-allotments/`): the agreement and contribution, the register row, the
  class's supply and chain fields, the recipient's particulars and the UTC day. The grant's
  register-state codes and `fully_paid_company_receipt_required` (the receipt is not exactly the
  consideration in AUD).

Recording an award also refuses `imported_non_tokenised_register_required`. The chain families
(`register-issues/`, `register-paid-issues/`, `register-deployments/`,
`register-capital-increases/`, `register-pause-changes/`) are in [signing
families](chain.md#signing-families).

### Corrections API

What a correction does: [compensating
corrections](../business/register.md#compensating-corrections). Preparation derives the exact
inverse changes and captures the register's sequence and head hash; an entry is `correctable` while
it has changes and no correction reverses it. The compensating entry's operation id is the
correction's UUID, and nothing is broadcast.

### Openings API

What an opening is: [opening the register from the
chain](../business/register.md#opening-from-the-chain). `GET {uuid}/register/opening-holders/` reads
the chain for a class whose register is not opened and stores nothing: the block and each holding
address, largest first, with any member already linked to it (addresses match in any letter case).
It and preparation admit only a current appointment holding `admin` or `prepare`, answering anyone
else with the same 404 as an unknown class. A class that is not deployed or paused, or whose
register has an entry, is refused with 400 before the chain is read; an unreadable chain answers 503
and records nothing.

Preparation takes a `mapping` list of `{address, member}` (free-form in the schema) and captures a
fresh canonical snapshot, with the transfer history classification needs, before taking the company
lock. It refuses a member of another company, an address linked to another member, a mapping that
does not cover exactly the boundary's holding addresses (`opening_holdings_moved`, so clients can
offer to read the holders again) and a completed effect the boundary does not represent. Approval
and application read the chain again before the company lock and, when it is unreadable, refuse with
503 and record nothing; rejection never reads it. Application commits the members, wallet links,
opening entry, decision and projection atomically.

### Wallet links API

What a link does: [linking wallets](../business/register.md#linking-wallets-to-members). `GET
register-links/waiting-wallets/?company=` reads only the database and lists, by address, each wallet
a completed effect of the company's opened classes waits for (as `unlinkedWallets` names it), with
the number of effects naming it.

Preparation takes the same `mapping` shape, stores each address checksummed in address order, and
refuses an empty mapping, one that is not a list of addresses and member UUIDs or repeats an address
in any letter case, a member of another company and an address already linked in the company. Both
routes answer a caller with no current `admin` or `prepare` appointment as not found. For an address
with a whitelist approval for the company, the preview and the waiting-wallets read add
`walletProof` and the live identity's `holderType` and `holderName`, informational only. Application
takes the company lock, then every share class of the company in order, records the new members and
links (skipping an address since linked to the same member), records whatever waited for the link in
each class with its own recorder, and marks the link applied. One that deadlocks with a completion
recorded by the same person is aborted by PostgreSQL and can be retried.

### Imports API

What an import mirrors: [bringing in existing
records](../business/register.md#bringing-in-existing-records). `POST register-imports/` prepares a
mirror opening or, with `correction_of` naming the latest applied snapshot, an opening correction.
The schema leaves `members` and `former_members` free-form. A member row has exactly `member`,
`name`, `residential_address`, `shares`, `entered_on` and `allotments`; an allotment exactly
`allotted_on`, `shares`, `share_reference`, `certificate_reference`, `amount_paid`, `amount_unpaid`,
`fully_paid` and `beneficially_held`; a former row exactly `name`, `residential_address`, `shares`
and `ceased_on`. Shares are positive whole numbers, dates no later than `as_at`, money at most two
decimal places and names up to 255 characters; a member's 1 to 10,000 allotments sum to its holding,
and `fully_paid` agrees with a zero `amount_unpaid`. The stored row adds `amount_paid`, the sum of
its allotments, and `tokens_mirror_members_valid` rechecks the stored shape in PostgreSQL. Earlier
snapshots keep their missing fields unknown.

Application creates the members, any opening entry and the particulars in one transaction. An
opening correction keeps the previous snapshot, decisions and opening entry, adds the
`mirror_correction` entry and records the new particulars.

### Particulars changes API

What a change does: [changing a member's
particulars](../business/register.md#changing-a-members-particulars). Preparation trims the fields
and refuses an empty name, address or reason. Application records the name, address and date as the
member's particulars with the change as their source; the database writes particulars only while
applying the import or change that names them. A change prepared from a member's request carries
`member_request`, a nullable column, so earlier changes keep their digests.

### Reconciliation acknowledgements API

What an acknowledgement means: [acknowledging a
discrepancy](../business/register.md#acknowledging-a-discrepancy). `POST
register-reconciliations/{uuid}/acknowledge/` names a `discrepancy`, counted from zero through the
record's `discrepancies` in API order. A row is `acknowledgeable` while its reconciliation is the
class's `latest`, its kind can be acknowledged and nothing acknowledges it yet. `providedBy` is
`company`, or `staff`, with no appointment or name, for one recorded before acknowledgement was
company-run. A new acknowledgement answers 201; an identical retry under the same `idempotency_key`
answers 200, even after a later reconciliation; the same key with any change answers 409. The
request records nothing and refuses a reconciliation the caller cannot read or an appointment that
is not the caller's current one holding `admin` or `approve` (both as not found), a position outside
the discrepancies, a blank reason, and a row the rules exclude.

### Grants and transfers API

What the company does: [non-paid grants](../business/issuing-shares.md#grants-to-walletless-members)
and [non-paid transfers](../business/register.md#non-paid-transfers-between-members). Application
rechecks every requirement and, in one transaction, records one ISSUE or TRANSFER with the company
applier as recorder, updates holdings and creates any new member and its particulars.
Direct transfers report `class_transfers_restricted` while `ShareToken.is_transferable` is false.
The flag is bound into decision previews and rechecked by the PostgreSQL readiness and deferred
decision guards, so changing it after preview or before commit cannot authorise a transfer.
`tokens_employee_award_grant_allocation` refuses at commit applied grants beyond an award's recorded
vested quantity. A transfer that empties a holding writes a `RegisterMemberCessation`. `GET
{uuid}/register/members/` lists a class's company members for these forms.

### Employee awards API

What an award is: [employee awards](../business/issuing-shares.md#employee-awards-and-vesting).
`register-awards/` and `register-award-vestings/` record under a retry key with no decision;
`register-grants/` with an `award` is an award's only issue path, and an award records no member,
entry, position or supply. Awards and vesting events are append-only and keep their actor,
appointment, operation id and creation time; identity triggers require exact current company
authority, recipient, class and agreement, or exact award, quantity, date and evidence, and
constraint triggers recheck the recording authority at commit. Concurrent events and linked grant
applications serialise the allocation check, and a failed effect rolls back whole. The tables are
operator-only.

### External allotments API

What an allotment records: [external
allotments](../business/issuing-shares.md#external-investor-allotments). The detail nests the
agreement (`RegisterAgreement`) and receipt attestation (`RegisterContribution`), immutable retained
sources: the receipt must be an exact positive AUD amount allocated to the agreement, and both
recheck their exact allotment and recording authority at commit. Allotment decisions are append-only
and recheck authority and approval at commit. `tokens_guard_allotment_register_entry` admits an
allotment's ISSUE, and a new member or particulars, only under its exact current company
application. The guards preserve supply and headroom and one applied effect. The tables are
operator-only.

### Member access API

What member access gives: [member access](../business/member-records.md#member-access). `POST
member-invitations/` answers 201 with a one-time `code` (43 URL-safe characters) and a retry 200
without it; only the code's SHA-256 is stored, and `member-invitations/accept/` takes the code.
Invitations and associations are listed to current personal `admin` appointees; `member-records/`
returns only the caller's own associations, with a `ceasedOn` only within retention, and their entry
deltas. Certificate fulfilment is under [output routes](#output-routes).

Fresh migrations install the association and the append-only invitation, revocation, request and
withdrawal records with RLS forced and no application-role grants. Their guards require current
company administration and one exact recorded member and recipient for an invitation; the exact
invited recipient, current source and an owned account for acceptance; exact current company
revocation to end an association; a confirmed own association and the exact retained current
particulars for a particulars request; and a genuine uncorrected receiving ISSUE or TRANSFER of the
associated member for a certificate request. Constraint triggers recheck identity and authority at
commit. A particulars change prepared from a request must keep the attributable request and current
association through approval and application.

### Retained register instructions API

The workflow is in [retained issue
instructions](../business/register.md#retained-issue-instructions) and [settled-transfer
instructions](../business/register.md#settled-transfer-instructions). `POST register-instructions/`
submits the company owner's instruction; reads list those of companies whose register the caller may
read, and `{uuid}/file/` serves the retained authority file. The schema leaves `items` free-form: an
`issue` item is `{"request": "<uuid>", "recipient": "0x…", "amount": "100"}` and a `transfer` item
`{"settlement": "<uuid>", "seller": "0x…", "buyer": "0x…", "amount": "25"}`, from the waiting list
(a waiting transfer's `source` is the settlement, its `wallets` the seller's then the buyer's, its
`shares` the amount). Staff review in admin rechecks a reviewer-bound, expiring confirmation, the
retained evidence and every item under the company and share-class locks, then records whatever
waited for the instruction in one transaction. Instructions are immutable and undeletable; identical
submissions and decisions are idempotent, and conflicting UUID reuse is refused.

### Operator transaction boundary

The operator connection is trusted to execute bounded register commands. Grants, transfers,
allotments and member access keep their authority constraints deferred and recheck current decision
and approval authority at commit. A direct operator SQL caller can force them early with `SET
CONSTRAINTS ... IMMEDIATE`, so a valid effect checked before an appointment expires can commit after
it. Statement-time checks still require genuine current appointments, approval and an exact effect,
and no HTTP route exposes SQL or constraint-mode control: the commit-time guarantee covers the
bounded command, not arbitrary operator transaction control.

Director-party comparison in the API and services uses Python's Unicode casefold and whitespace
normalisation; the PostgreSQL 16 guard uses lowercase and whitespace normalisation, which is
narrower: `Straße Example` and `STRASSE EXAMPLE` compare equal in the service and unequal in SQL.
The customer command refuses that conflict; arbitrary operator SQL does not get the full Unicode
comparison.

## Reads and exports

### Register read routes

The reads under `/api/v1/tokens/` are `register/` (classes whose register the caller may read),
`{uuid}/holders/` (the stored register with `waitingEffects` and former members, with their as-at
time, block and staleness), `{uuid}/register/entries/` (newest first; repeat `entry` to read chosen
entries), `{uuid}/register/waiting/`, `{uuid}/register/members/` and `{uuid}/register/export/` (the
[register CSV](#register-csv)). They admit `ShareToken.objects.register_readable_by`: the company
owner or a current appointment holding `admin`, `read_register`, `prepare`, `approve` or `apply`; no
other capability, delegation-only scope, staff or superuser status admits ([who runs
what](../business/register.md#who-runs-what)).

They run on the operator connection, because a members' register carries each holder's name and
residential address, which no policy admits to the principal reading it; without it the register
would print `unidentified` and blank addresses. The current-member API omits residential addresses;
former-member rows include them. Exporting a register with no opening is refused with 409
`register_not_initialized`, and the export route refuses `HEAD`, which would record a sheet it never
sends.

### Waiting effects

The list, `waitingEffects` and recording walk the same classification in the same order, so the
count is the list's length and the first effect listed is where recording stops. An effect's
`source` is the issuance or settlement id, which becomes the entry's operation id, and its `wallets`
are the recipient's, or the seller's then the buyer's. Its `reason` is `attribution`, `unlinked`
(`unlinkedWallets` lists which), `unreviewed` (the issue's request records no approving reviewer,
and recording invents none), `uninstructed`, `refused` (the register refused the entry when
recording last tried; the logged refusal names the cause) or `behind` ([what each
means](../business/register.md#why-a-completed-effect-waits)). A count that cannot be computed is
`null` in the API and `unknown` in the CSV, with a `null` list, as for a register with no captured
boundary. An import-opened register has no boundary: its count is 0 and its list empty while nothing
has completed on chain for the class, and both are `null` once something has.

### Output routes

Inspection copies (`{uuid}/register/inspection-copy/`) and certificates
(`{uuid}/register/certificate/`, by `?sequence=N`) are previewed with `GET`, which answers the
source digest and a certificate's page count, and produced with `POST`, which answers the CSV or
`certificate-<symbol>-<sequence>.pdf` with `Cache-Control: private, no-store`. Both run inside a
locked company operation binding the exact current register-reading appointment before and after the
output is built; ownership and staff permission supply no output authority. The inspection source
digest is the SHA-256 of `<class id>/<register sequence>\n` followed by the base CSV bytes; the
certificate's, of `<class id>/<entry id>/<register sequence>\n` followed by the PDF bytes. A changed
source refuses with a conflict.

A member's certificate (`member-certificate-requests/{uuid}/fulfilment-preview/`, `fulfil/`,
`file/`) is filtered to the requesting member before anyone else's particulars are read, uses the
member's retained company-recorded particulars, and must be one page of at most 1 MiB. Fulfilment
retains `MemberCertificateFulfilment`: the request, producer, appointment, instruction,
`certificate` export record, source snapshot and digest (`tokens_member_certificate_source_digest`),
file digest and size, and the bytes privately. Its guard requires exact current company authority,
the member's own receiving effect, the captured source and the audited bytes, and refuses rewrites.
The file route serves `member-certificate-<uuid>.pdf` only when the bytes match the retained size
and digest, to a current own association or company reader. Notice figures have no API route; staff
prepare them in admin. The pack route is in [building the pack](#building-and-recording-the-pack).

### Export records

Ledova keeps a fingerprint, not the file. Each output is recorded in `RegisterExport` once its bytes
are built, with the requester's id, the class, the kind, the register sequence, the current- and
former-member row counts and the time; a refused or failed output records nothing. Check constraints
require each kind's fields and refuse another kind's:

- `register_csv`: the head's sequence and the member rows exported.
- `inspection_copy`: as the CSV, with the SHA-256 of the bytes served, the instruction, request
  date, recipient and late flag.
- `certificate`: the certified entry's sequence and one or two pages, with the SHA-256 and the
  instruction.
- `notice_figures`: the head's sequence and the members the period's entries changed, with the
  SHA-256, the instruction and the period's first day.
- `company_pack`: one row per class at its head, with the SHA-256 of `manifest.json`, the
  instruction and the recipient.

A trigger refuses every update. The table is operator-only: no company or customer route reads it,
and staff query it in admin. Its purge is in [retention clocks](security.md#retention-clocks).

## Output formats

Every output reads one snapshot of the stored register through the export's own code. Days are
counted in Sydney's calendar (`STATUTORY_CALENDAR`;
[why](../business/member-records.md#inspection-copies)). Every CSV cell goes through `csv_cell`,
which prefixes an apostrophe to a value opening with a formula character, except the notice figures'
counts, entry numbers and changes, plain numbers so a negative change reads as one. Each output's
deadline is in its own business section
([inspection copies](../business/member-records.md#inspection-copies),
[certificates](../business/member-records.md#certificates),
[notice figures](../business/member-records.md#notice-figures)), and
[the due list](../business/member-records.md#the-due-list) gives the computed due dates.

### Register CSV

The CSV has three sections of different widths; read them by their headers, not by column position:

1. Current members, under a header row starting "Member ID": Member ID, Name, Residential address,
   Wallet addresses, Holder type, Class, Shares held, Percentage of issued supply (as `N%`), Balance
   source (`Stored register`), Identity source, Date entered, Whitelist status and Amount paid
   (blank where not established). Wallets are joined with `; `, and Whitelist status lists each as
   `<address>: <status>`, joined the same way: its approval for the class's company (Active, Expired
   once a recorded expiry has passed, Pending, Removed or Failed), "Not approved for this company"
   when the wallet has an entry and no approval there, or "No whitelist entry".
2. Supply summary, after an empty row: Issued supply, Held by listed members, Completed effects
   waiting to be recorded (when there are any, or `unknown`), and Reconciled with the chain: the
   latest result (its status or discrepancy count) with its block and time, `never`, or
   `not on chain` for an import-opened class.
3. Former members, after an empty row and the heading "Former members (retained under s169(3) of the
   Corporations Act)": Name, Residential address, Wallet address, Shares held on ceasing, Date
   ceased, Identity source and Identity recorded at. A final As at row gives the fold's time, block
   and `stale` when stale; `never read` and `stale` before a chain class's first fold; or
   `not on chain` for an import-opened class the fold has never read.

### Inspection copy format

`prepare_inspection_copy` builds the register CSV with its header row and adds a fourth section
headed "Inspection copy under s173(3) of the Corporations Act": Requested on, Company's written
instruction, Recipient, Produced on, and "Produced more than 7 days after the request" (`yes` or
`no`).

### Certificate format

`prepare_certificate` reads one entry of the class's own register by its number, from one snapshot,
and replays holdings from the entries up to and including it ([what a certificate
shows](../business/member-records.md#what-a-certificate-shows)). PyMuPDF renders each page from
[share_certificate.html](../../backend/tokens/templates/tokens/share_certificate.html), escaping
every value and embedding the glyphs non-Latin names need; it is imported only when a certificate is
rendered ([legal position 12](../legal/positions.md#12-pymupdf-an-agpl-runtime-dependency)). Fonts
are subset, metadata is cleared and the file carries no creation date or random identifier, so the
same entry gives the same bytes while the register, the particulars and the PyMuPDF version stay the
same.

### Notice figures format

`prepare_notice_figures` reads the stored register and every issue, transfer and correction entry
effective on or after the period's first day, up to the head; the opening is never listed. The CSV
has four sections, each after a heading row:

1. "Figures for the company's notices of share issues and of changes to members and share
   structure": Share class, Period from, To register entry (the head's sequence), Company's written
   instruction and Produced on.
2. "Entries in the period": Entry, Kind, Effective date, Corrects entry, Member ID, Name, Shares
   (the signed change) and Amount paid, a row for each member an entry changed, in entry order.
3. "Class at the register head": Issued supply, Members holding shares and Total amount paid.
4. "Members changed in the period, at the register head": Member ID, Name, Residential address,
   Shares held (0 for a member who no longer holds any) and Amount paid, in member-id order.

An issue's amount paid is the money backing of the issuance it recorded and a member's the
register's own; either reads the literal `not recorded` where not established exactly ([what the
figures contain](../business/member-records.md#what-the-figures-contain)).

### Outputs due computation

`outputs_due` reads, in one snapshot, the issue and transfer entries no correction has reversed. An
entry is `certified` when a `certificate` export of its class has the entry's sequence as its
`register_sequence`, and `noticed` when a `notice_figures` export of its class has `period_from` on
or before the entry's `effective_on` and `register_sequence` at or after the entry's. A
company-recorded transfer is dated from the applied `RegisterTransfer.lodged_on` and a settled one
from its `SwapOrder`'s `created_at` in `STATUTORY_CALENDAR`, both through `months_after`. It sorts
by due date, company name, class symbol and sequence, compares due dates with today in
`STATUTORY_CALENDAR`, and stores and records nothing. Given a company it reads only that company's
entries; the admin due page calls it without one ([the due
list](../business/member-records.md#the-due-list)).

## Company pack format

What the pack is for, who produces it, what it carries and what never leaves, and why: [the company
pack](../business/member-records.md#the-company-pack) and its
[decision](../decisions.md#the-company-pack). What each file holds, and how a reader checks it, is
written for the recipient in the pack's README, rendered from
[company_pack_readme.md](../../backend/tokens/templates/tokens/company_pack_readme.md); this part
covers how the builder produces and guards it.

### Building and recording the pack

One builder, `_build_company_pack` in
[company_pack.py](../../backend/tokens/services/company_pack.py), serves the company's `POST
/api/v1/companies/{uuid}/pack/` (`prepare_company_pack` in
[company_pack_outputs.py](../../backend/tokens/services/company_pack_outputs.py), core packs only)
and the staff row action on **Company packs**, a `Company` proxy that only creates permissions
(`produce_company_pack`, from [companies/admin/pack.py](../../backend/companies/admin/pack.py), the
broader retained scope, needing `companies.change_companypack` and
`companies.view_companydocument`).

The company route must run outside an existing transaction. It binds the exact current `admin`
appointment in one durable transaction, builds the pack, then in a second rechecks the appointment,
locks every captured class row, records the export and rechecks the appointment again.
`_require_core_contents` refuses the whole pack, rather than omitting records, when the snapshot
holds anything outside the [core
scope](../business/member-records.md#producing-a-core-pack-in-the-register): each class must be a
draft with an applied import and no chain fields, deployment, operations, issuance requests,
subscriptions awaiting allotment, settlements, capital increases or pauses.

The builder reads every record, the company row included, in the register outputs' one
repeatable-read snapshot on the operator connection, and reads no chain. Once the snapshot closes it
checks the [ceiling](#documents-and-evidence-copies), then writes the archive into a
`SpooledTemporaryFile` held in memory up to 8 MiB (`COMPANY_PACK_SPOOL_BYTES`), streaming each
stored file from private storage. It records one `company_pack` export per class, each with the
SHA-256 of `manifest.json`, only once the archive is complete. A refusal records nothing
([refusals](../business/member-records.md#recording-and-refusals)); the builder also refuses a
company decision record whose company, evidence, appointment, approval or entry binding is
inconsistent.

### Archive and manifest

The pack is a zip written by Python's `zipfile`, in path order with `manifest.json` last, because
its digests are known only once every stored file has been streamed. Each entry is deflated, dated
1980-01-01 00:00 and mode 0644, so the same records, files, request and time give the same bytes.
`manifest.json` names the format `ledova-company-pack` and version `1`, the company, the snapshot's
as-at time, the instruction and recipient, each class's and publication's head, and every other
file's path, size and SHA-256, so the recorded digest of `manifest.json` fixes every file even when
they are zipped again. The file list is open: adding a file keeps the version, and changing what an
existing file means changes it.

JSON files are UTF-8 with sorted keys, a two-space indent and non-ASCII text as written; times are
ISO 8601 in UTC, and share quantities and supplies whole-number strings. The JSON writer refuses any
value it does not know how to write, bytes included. Class folders are named by class id, as symbols
are unique within a company only as written. Text the company or staff supplied (names, symbols, the
instruction, the recipient) reaches the README through the `md` filter in
[company_pack_text.py](../../backend/tokens/templatetags/company_pack_text.py), which turns control
and line-breaking characters into spaces, trims the ends, backslash-escapes characters Markdown or
HTML would read as structure and escapes a leading list marker, so a value cannot add a heading,
table column, link or tag. Values Ledova produces are left as they are, and the JSON files and
`register.csv` carry every value as stored.

### Pack files

- `README.md`, `manifest.json`, `company.json`, `approvals.json`, `wallet_links.json`,
  `particulars_changes.json`, `documents.json` and `company_mandates.json` ([decision
  records](#company-decision-records)).
- `documents/<document id>.<extension>`: each company document Ledova holds a file for, as uploaded.
- `documents/evidence/<record kind>/<record id>.<extension>`: the retained copy behind each
  authority or core record; `documents/evidence/<record kind>-<source>/<record id>.<extension>` a
  record's second source (an import's `asic` extract, a grant's `terms` and `acceptance`, a
  transfer's `instrument`).
- `classes/<class id>/`: `class.json`, `register.csv` (from the export's own code, with no export
  record, absent while the register has no opening), `entries.json` (with each entry's `preimage`),
  `authority.json` (register instructions include chain grants and paid issues), `chain.json`,
  `settlements.json`, `issues.json`, `former_members.json`, `reconciliations.json`, `waiting.json`
  (`waiting_list(token)`, or `null` where the API's is) and `due.json` (the class's rows of
  `outputs_due(company=company)`).
- In the generated pack’s `contracts/` folder: `contracts.json` ([contract information](#contract-information)) and
  `<Name>.json`, the interfaces of `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory`
  and `AtomicSwap` committed under [backend/contracts/](../../backend/contracts/ShareToken.json),
  never a local `artifacts/` build from `contracts/`.
- `publications/<publication id>/`: `publication.json`, `roll.json`, `events.json`,
  `document.<extension>` and `payments/<record id>.<extension>` ([publications in the
  pack](#publications-in-the-pack)).

The record kind in an evidence path is the lowercase model name (`registeropening`,
`registerimport`, `registercorrection`, `registerinstruction`, `registerwalletlink`,
`registerparticularschange`, `registeraward`, `registerawardvesting`, `registeragreement`,
`registercontribution`, `registerallotment`, `registergrant`, `registertransfer`), so records
sharing an operation id cannot replace each other's copy. The extension is that of the media type
the snapshot recorded (`.pdf`, `.png` or `.jpeg`; none for another type). Internal ids (user,
profile, order, account, wallet and whitelist entry ids, worker and retry claim ids, the initiating
actor), verification fingerprints and a snapshot's company identity, storage path and owner id stay
behind, except the platform account numbers decision records carry.

### Company decision records

`company_mandates.json`, built by
[company_pack_mandates.py](../../backend/tokens/services/company_pack_mandates.py), carries
`openings`, `imports`, `corrections`, `wallet_links`, `particulars_changes`, `grants`, `transfers`,
`instructions` (register instructions, chain grants and paid issues), `deployments`,
`capital_increases`, `pause_changes`, `wallet_instructions` and `allotments`; the company-recorded
facts `awards`, `vestings`, `agreements` and `contributions`; the `wallet_nominations`; and the
`appointments` any of them used. A decision record carries its company and class, preparer and
`prepared_at`, `status`, `approval_decision`, reviewer, `reviewed_at` and `rejection_reason`;
`decisions` (each with kind, appointment, decider, time, digest and reason); `sources` (each with
the upload id as `evidence`, `company_document`, fingerprint, `sha256`, name, `mime_type`, size and
evidence `path`); `command` (authority, approving director, authority reference, reason and the
family's own terms); and `result` (the register entry, request or executions it produced). Its
`provided_by` is `company`, or `legacy_staff_workflow` when no preparing appointment exists. An
appointment carries its appointee's name, capabilities, delegable capabilities, creation, expiry,
source (request, invitation, legacy owner, declaration version and text) and any revocation. A fact
carries `recorded_at`, `recorded_by_name`, its preparing appointment, `sources` and `data`, with
`provided_by: company`; an award states `is_entitlement: true`, and a contribution
`company_recorded: true` and `verified_by_ledova: false`. People are named
with their platform account numbers (`prepared_by_id`, `decided_by_id`, `recorded_by`,
`appointee_id`).

Evidence copies are carried for openings, imports (with the ASIC extract), corrections, register
instructions' authority, wallet links, particulars changes, awards, vesting events, agreements,
contributions, allotments, grants (with terms and acceptance) and transfers (with the instrument).

### Authority records and history

[company_pack_history.py](../../backend/tokens/services/company_pack_history.py) builds the files
that record who approved what. Every query reaches the company through a foreign key or stored id,
its own or that of a class the pack read from the company, and names the company wherever the table
carries it: on the operator connection no policy narrows a read, so those joins are the pack's only
tenancy guard. An opening, import, correction or wallet link carries `provided_by` (`company`, or
`staff_verified` for one made before the family was company-run). A company-run record's `evidence`
names no company document: its copy is of the company's own upload, and its `document_type` is the
upload's kind. `approvals.json`'s `listed` is computed at the as-at time as the registry would, so
an active approval past its expiry is not listed, and `contracts.json` takes its registry addresses
from it. `retain_until` is `FORMER_MEMBER_RETENTION_MONTHS` (84) after the member ceased
([s169(3)](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)).

### Chain evidence

[company_pack_chain.py](../../backend/tokens/services/company_pack_chain.py) builds `chain.json` and
`settlements.json`. The outgoing journal has no company column, so every operation is reached from
the business record that owns it (the deployment record and its swap approval, an issuance, a
capital increase, a pause, a settlement's transaction) through that record's own one-to-one link,
and each business query names both company and class; no join goes through an operation key or a
wallet address. Settlements are every swap of the class with a transaction, which is every one
admitted for execution. Signed bytes never leave ([outgoing
signing](chain.md#outgoing-signing-foundation)): attempts are read with a column list that excludes
the payload, and the JSON writer refuses any bytes value.

### Contract information

Nothing in `contracts.json` is read from a chain. Its compiler settings (Solidity 0.8.24, EVM
`paris`, 200 optimizer runs, `via_ir`, OpenZeppelin 5.4.0) match
[hardhat.config.ts](../../contracts/hardhat.config.ts) and
[package.json](../../contracts/package.json). Each class's `owner_at_deployment` is the sender its
deployment record froze, `approved_on` the settlement contract its swap approval targeted (empty
without approval terms), and its signing domain "Ledova Trading", version 1, the chain id and the
class address; the settlement domain is `configured_domain()`, empty with no settlement contract
configured. The company's registry address is not stored on the company, so the README says to call
`registryOf(acn)` on the factory when none is recorded. A registry's `owner` is the one sender every
deployed class's record names, because the factory creates the registry with its first class's owner
and refuses a later class with another; it is empty when no record exists or the records disagree.
README section 5 lists as unresolved a class `deploying`, its swap approval `pending` or
`executing`, an issue's execution `queued` or `executing`, a capital increase `executing`, a pause
`pending` or `executing`, a settlement `executing`, or an approval change `pending` or `executing`.

### Documents and evidence copies

[company_pack_documents.py](../../backend/tokens/services/company_pack_documents.py) builds
`documents.json` and chooses the stored files, all under `companies/<company id>/` ([private
files](security.md#private-files)).

- Evidence copies come from the same objects the history files list, not a second query.
- While streaming an evidence copy the builder computes its size and SHA-256 and refuses the pack,
  naming the record, unless they are those its snapshot recorded. A publication document and
  remittance evidence are tied the same way to the SHA-256 recorded when each was stored. A company
  document has no recorded digest, so only the manifest fixes its bytes.
- Before writing, the builder sums the stored files, a company document by its recorded `file_size`
  and everything else by the size storage reports. Above `COMPANY_PACK_MAX_STORED_BYTES`, 256 MiB in
  [constants.py](../../backend/tokens/constants.py), it refuses, naming the total, the ceiling and
  the next step: background production, built the first time a real pack exceeds it.
- A missing or unreadable file refuses the pack, naming the record, whether it fails when its size
  is read, when opened or part-way through reading, for local files, Google Cloud Storage and S3
  alike, so it never surfaces as a server error.

### Publications in the pack

[company_pack_publications.py](../../backend/tokens/services/company_pack_publications.py) builds a
folder for each publication of the company, oldest first, reading `Publication` by the company and
everything else through the publication. Before carrying a roll, without its account ids, the
builder runs `verify_roll` and refuses, naming the publication and `publications verify`, if the row
count or digest no longer match. A ballot is withheld to its sequence, kind, hashes and `withheld:
true`; every other event is carried with its preimage. `reads` is counted in one grouped query over
`PublicationRead`.

### Technical limits of the pack

Limits a reader sees are in [limits of the pack](../business/member-records.md#limits-of-the-pack);
these are the builder's own. No offline consumer ships; the earlier one remains in the [10 October
tree](https://github.com/Ledova/ledova/tree/5f40e3cd896afc3f3a55a14e359224156735a417/backend/tokens/tests)
as history.

- A swap approval observed already in place, a legacy settlement with no transaction record and a
  legacy mint journal are not exercised; a pause observed already in place is carried with its block
  and no operation.
- The ceiling counts a company document by its recorded size, which staff can edit; uploads are
  bounded at 10 MiB each (`UPLOAD_MAX_BYTES` by default), so the error is bounded by the number of
  documents.
- `company_mandates.json` names an evidence `path` for capital-increase and pause-change authority
  copies and for chain-grant terms and acceptance copies, but the archive carries only the copies
  listed under [company decision records](#company-decision-records), so those paths have no file.
- The README predates the decision records: its file table omits `company_mandates.json`, and its
  opening and preimage notes say no platform account ids leave, although that file carries them.
- Production near the ceiling has not been measured; a proxy in front of the backend could time out
  a large download.

## Publications

What a company publishes, who may read it and how ballots and dividends work: [shareholder
publications](../business/publications.md); why they work this way:
[decisions](../decisions.md#shareholder-publications). The services are
[publications.py](../../backend/shareholders/services/publications.py),
[roll.py](../../backend/shareholders/services/roll.py), `resolutions.py`, `distributions.py` and
`summary.py`; the guards are in
[shareholders/database_guards.sql](../../backend/shareholders/database_guards.sql).

### Publication storage

One `Publication` table holds every kind (`holding_statement`, `meeting_notice`, `resolution`,
`distribution`). The columns every kind needs (company, class, record date, instruction, authority,
snapshot head) sit on the row, and per-kind check constraints add the rest: the document kinds carry
stored bytes and a digest, a resolution its question, kind, basis and window, a distribution its
rate, currency, dates and totals. A new kind joins the same table and names itself in the
constraints it needs. Unlike a register output, the document is stored, through the ordinary upload
pipeline at `companies/<company>/publications/<uuid>/<uuid>.bin` with the SHA-256 and media type of
what was stored, so it serves the same bytes after the register moves on.

The insert guard `shareholders_guard_publication` requires a class on chain (deployed or paused,
with a contract address), the class's opened register at the publication's sequence and head hash,
an authority that is a verified document of the same company whose `verified_fingerprint` equals the
one the publication copied, and the storage path. `publish_to_members` refuses any other class with
that reason before storing anything. The guard refuses every update, and the application role cannot
delete: only the retention purge does.

### Frozen roll and frozen names

When a publication is made, one transaction locks the class's register, replays every entry
effective on or before the record date (`holdings_at`) and writes one `PublicationRecipient` row for
each member holding shares then: register member, resolved account, name, holder type, identity
source and shares, ordered by shares then member. `member_rows` and `audience_digest` are recorded
on the publication; the digest is the SHA-256 of `json.dumps(rows, sort_keys=True, separators=(",",
":"))`, the rows sorted by member id and each `{"member", "user", "name", "holder_type",
"identity_source", "shares"}` with shares as a string. A row's account comes from
`member_identities`, never from joining a wallet address ([why](security.md#policy-catalogue)); the
policy reads the stored account column alone.

The publication also stores the company name and the class's name and symbol as they were: a pause
moves the class out of the member's read terms on companies and classes, so a serializer reaching
the names through `select_related` would INNER JOIN the non-nullable foreign key and drop the
publication from the listing. Storing them avoids widening a policy, and a company term reading the
roll back would be a recursion PostgreSQL refuses. The roll guard refuses changes, a row whose
company differs from its publication's, a row naming a nonexistent account, and an entitlement that
is wrong or on a non-distribution row.

### Publication policies and read audit

Both tables are read-only to the application role. The publication's read term is the company that
made it or a roll row naming this principal; the roll row's term is the principal it names or the
publishing company, on the row's own copied company column, so the two policies do not read each
other in a circle. On the event chain, a member reads their own ballots and payment records through
the roll row each names, and the close of a resolution they are on the roll of; the company reads
the close and its payment records on the event's copied company, and no ballot. Staff read in admin
on the operator connection; there is no staff API route.

Each delivery writes an append-only `PublicationRead` on the operator connection, naming the reader,
publication, roll row where there is one, `event_uuid` for remittance evidence, and whether the
reader was the member, the company or staff; it carries no name, holding or file content and has no
admin mutation path. The stored file is opened first and the read recorded second, so a record
always names a file that could be served: a file that cannot be opened answers 503
`publication_unopened` and records nothing, and a read that cannot be recorded answers 503
`publication_read_unrecorded` and serves nothing, as [document reads](security.md#read-audit) do.
Staff open a document or remittance evidence through `admin_file_path` routes in the publication
admin.

### The publications route

[`PublicationViewSet`](../../backend/shareholders/views/publication.py) at `/api/v1/publications/`
has a list, `summary/`, `{uuid}/file/` and `{uuid}/ballot/`, and no retrieve route: the listing
carries everything a member is shown. The list and file actions run on the operator connection:
`for_reader` admits the company's owner or a reader a roll row names, then `seen_by` adds the
per-caller fields, so a paused class keeps its publications readable. The summary and ballot run on
the application role under the policies. The file route calls `read_publication`, which resolves the
reader as member, company or staff and audits the delivery as one act; a foreign or nonexistent uuid
answers the same 404.

`kind` must be one of the four kinds, `addressed=me` keeps publications whose roll names the caller,
and `issuer` must be a company the caller owns (`Company.objects.owned_by`); any other value is a
400 naming the parameter, and `issuer` with `addressed=me` takes the intersection. Filters apply to
the list action only: DRF would otherwise apply them in `get_object`, which the ballot route reaches
after recording the ballot, so a cast with `?kind=distribution` would record an irrevocable ballot
and answer 404.

The per-caller fields are correlated subqueries naming the caller's account, so a company owner not
on the roll gets them null rather than losing the publication, and the query count does not grow
with the page. `ballotOutstanding` is true while any of the caller's roll rows has no ballot; one
account can be on a roll through two register members, so clients offer a ballot on it, not on an
empty `myBallot`. `myEntitlement` sums the caller's rows, `myRecordedEntitlement` those with a
standing payment record (0.00 when none), and `myPaymentRecord` is the latest standing record. The
declared total and remainder are not in the listing, and no field name says a payment was made.

Both clients read it through `@ledova/shared` (`getPublications`, `openPublication`,
`downloadPublication`, and `publicationFilename`, which names the `.bin` stored object from the type
served). `useResolutionStatus` keeps one timer for the next opening or close, capped at the longest
delay a timer holds and re-armed, so an open page offers or withdraws the ballot without reloading.
The member's notices read the listing with `addressed=me`, [the Wallet shares
page](../business/member-records.md#the-wallet-shares-page) counts what waits through
`usePublicationSummary`, and the company's [Published
page](../business/publications.md#the-published-page) reads an owned company's publications with
`issuer`.

### The summary

`summarise_for` answers `openResolutions`, `nextClosesAt` and `dividendsWithoutRecord` ([what
waits](../business/publications.md#the-notices-page)) in one aggregate query over the publications
the policies admit, counting only the caller's own roll rows by account. Under the row policies,
those policies are a second wall under the account filter for a member; for an owner on its own roll
they admit every row, so the filter is the only wall. The listing runs on the operator connection,
so its per-caller fields rely on the account filter in `seen_by` alone.

### Announcements

When the roll commits, `tell_the_members` is deferred once. It reads the roll on the operator
connection and defers one `general` push notification for each distinct account on it ([how members
are told](../business/publications.md#how-members-are-told)). Its data is `type: "publication"`,
`event: "published"`, the publication id and kind, and its title and body name the company and
class. Both clients turn it into a jump to the publications page, where the member's read goes
through the route above.

### Event chain

Ballots, the close and payment records are `PublicationEvent` rows, one chain per publication, each
copying its publication's company. The `BEFORE INSERT` trigger
`shareholders_guard_publication_event`:

- locks the publication `FOR UPDATE`, serialising its inserts, allocates the next `sequence` and
  takes the previous event's hash (64 zeros for the first);
- admits `ballot` and `close` only on a resolution and `payment` and `payment_void` only on a
  distribution, each under its own company;
- admits a ballot only while the window is open and before any close, for a row on this roll, with
  `shares` copied from the row whatever the caller sent and no payload; a ballot not entered by
  staff must name as actor the account the row names, so a row with no account cannot cast one, and
  a staff-entered ballot needs an active staff actor and a non-blank authority;
- admits a close once, only after the window has passed, writing its `payload` from the ballots:
  shares and members for, against and abstaining, shares and members eligible, the basis, the
  resolution kind and `carried` (ordinary: for > against; special: votes cast > 0 and 4 × for ≥ 3 ×
  (for + against));
- admits a `payment` only from an active staff actor, for a row owed at least a cent whose latest
  record is not a standing payment, with evidence stored at
  `companies/<company>/publications/<publication>/payments/<event>/<uuid>.bin` with its SHA-256 and
  the type the upload validator found, and a `payment_void` only for a row whose latest record is a
  payment;
- sets `entry_hash` with `shareholders_publication_event_hash` ([hash preimages](#hash-preimages)).

The trigger refuses every update and refuses deletion by the application role. Unique indexes hold
one event per sequence, one ballot per roll row and one close per resolution, so a second ballot is
refused even by a writer who disabled the trigger.

### Ballots and closing

`cast_ballot` resolves the resolution and the caller's own roll row on the calling connection under
the policies, so a caller with no roll row, a company owner included, gets the same 404 as a
resolution that does not exist and nothing is written. Only the insert runs on the operator
connection, and the trigger's actor check keeps the guarantee in the database. A resolution not open
yet, a closed one, a second ballot and an unknown choice are 400s that say which. The route has its
own `ballot` throttle scope, 10 a minute per user ([casting a
ballot](../business/publications.md#casting-a-ballot)).

`close_resolutions_past_their_window` ([schedule](../operations/jobs-and-storage.md#schedule))
closes each resolution whose window has passed and has no close. Two runs at once close it once: the
second waits on the publication lock, finds the close and returns it ([closing a
resolution](../business/publications.md#closing-a-resolution)).

### Distribution arithmetic and payment records

Each roll row stores its `entitlement` and the publication its `undistributed` remainder; there is
no entitlement table ([the
arithmetic](../business/publications.md#entitlements-and-the-undistributed-remainder)). The roll
guard refuses a row whose entitlement is not its shares times the rate rounded down, and any other
kind's row that carries one. Because the publication row is inserted before its roll, the deferred
constraint trigger `shareholders_distribution_adds_up` runs at commit and refuses a distribution
whose declared total is not the roll's shares times the rate rounded down, or whose entitlements and
remainder do not add up to it. A payment record is a `payment` event and its withdrawal a
`payment_void` with a reason ([payment records](../business/publications.md#payment-records)).

### Publication retention

The [publication purge](security.md#retention-clocks) deletes the event chain before the roll it
points at. Removing a publication or payment row deletes its stored bytes through the ordinary
private-file lifecycle receiver, under the swept `companies/` prefix.

### Verifying publications

`verify_publication` replays a chain on the operator connection and raises
`PublicationIntegrityError` on a sequence gap, a broken previous-hash link, a stored hash that
differs from the one recomputed in SQL ([hash preimages](#hash-preimages)), an event under another
company, or an event of a kind the publication does not take. For a resolution it also refuses a
ballot whose member or shares differ from the roll, a ballot not entered by staff whose actor is not
the row's account, two ballots for one member, an event after the close, and a close whose tally
differs from the tally recomputed in Python. For a distribution it also refuses a payment record for
a row it does not owe, a second standing record for one row, a withdrawal with nothing to withdraw,
an entitlement that is not shares times rate rounded down, and a declared total or remainder that
disagrees with the roll. The cross-checks catch a forger who rewrote a row and recomputed its hash.
`verify_roll` checks the roll's row count and digest. The `publications verify` command runs both
([verifying stored records](../operations/recovery.md#verifying-stored-records)).

## Account-data export

### Route and clients

`GET /api/user-profiles/export-data/` returns the signed-in person's own data as one JSON document
and takes no identifier. It runs on the application connection under the caller's own row-level
policies ([tenancy](security.md#tenancy-model)), and `export_account_data` in
[lifecycle.py](../../backend/users/services/lifecycle.py) selects only the caller's rows. Both
clients call `exportAccountData` in `@ledova/shared` and name the file `ledova-data-export-<UTC
date>.json`; the dashboard saves it from Settings, and the mobile app writes one private cache copy
bound to the session current when the export was requested and hands it to the share sheet
([document copies](mobile.md#document-view-copies)).

### Export contents

The document is `AccountExportData` in the schema: `exportedAt`, `user`, `profile`,
`financialProfile`, `account`, `wallets`, `transactions` (every transaction of the account's
wallets) and `portfolios`; a section with no row is `null`, or an empty list. Not in it:
classification claims and their evidence, uploaded documents, per-asset holdings, orders,
subscriptions, notifications, the transaction-alerts switch and register particulars.

### Transaction evidence fields

Every transaction row is exported, newest block first, with no limit
([decision](../decisions.md#the-account-data-export)), read through a database cursor with its
latest chain observation in the same query. With the hash, block number, block hash and nonce anyone
can ask a node of the named network for the transaction and its block; signed bytes are never
exported.

- `status` is Ledova's recorded outcome (`pending`, `confirmed`, `failed`, `reorged` or `replaced`),
  not evidence of it.
- Amounts and fees are plain decimal strings with every stored digit, no exponent and no trailing
  zeros, such as `"1.5"` or `"0.000000000000000001"`. `transactionFee` is the actual native fee,
  from the receipt or the imported history, never the estimate; `null` only when unknown, `"0"` for
  zero.
- `blockTimestamp`, `blockNumber` and `blockHash`, where recorded, are one provider's receipt
  checked against the block header it named, not independent chain truth ([receipt
  attribution](wallet-protocols.md#receipt-attribution)). `nonce`, for an EVM transaction submitted
  through Ledova, and `blockNumber` are decimal strings, because a JSON number loses digits past
  2^53.
- `importedFromHistory` is `true` for a row from the provider's transfer history, which is never
  observed.
- `chainObservation` is the latest [observation](wallet-protocols.md#wallet-chain-observations) or
  `null`, with `network`, `result` (`included`, `unknown` or `orphaned`), `finality` (`unknown`,
  `waiting` or `satisfied`) and `policy`; only the latest is exported, so a transaction once
  `included` can show `unknown`.

### Why the export is not recorded

The export writes no export record and no audit row: it carries only the requester's own data and
goes only to them ([decision](../decisions.md#the-account-data-export)), whereas register outputs
carry other people's particulars and are recorded ([export records](#export-records)).

### Export limits

- The document is built in memory within one request and grows with the number of transactions;
  there is no ceiling.
- Each section is read by its own query, not in one snapshot, so a row written during an export can
  appear in one section and be missing from another.
- `policy` is the normalised policy recorded with the observation, not re-checked against the one
  configured now.

Next: [the register of members](../business/register.md), [member
records](../business/member-records.md), [shareholder publications](../business/publications.md) and
[verifying stored records](../operations/recovery.md#verifying-stored-records).
