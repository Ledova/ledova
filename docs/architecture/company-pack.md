# Company pack

[Architecture](README.md) · [Register of members](register.md)

The company pack is the one archive in which a company's records leave Ledova:
for the company's own administration, for a provider that takes over its
register, or in answer to a lawful information request
([product §6](../product.md#6-privacy-and-portability)). The owner chose one
archive rather than a company data export, a transaction evidence export and a
portability pack that wraps them, because the three would be the same generator
run with different flags; the [decision](../decisions.md#the-company-pack)
records the choices behind it. The pack is built in slices under
[#650](https://github.com/Ledova/ledova/issues/650). This page describes what it
carries: the company, its share classes, each register, the approvals the pack
carries ([Limits](#limits)) and the history behind them, each class's chain
evidence and settlements, the company's
documents with the evidence copies behind its approvals, what the company
published to its members with each resolution's result and each dividend's
payment records, and the contract information.

Platform staff produce the pack in admin on the company's written instruction;
[#871](https://github.com/Ledova/ledova/issues/871) adds company-scoped
preparation with exact company scoping, instruction and requester provenance
and audited production, keeping the snapshot, ceilings, digests, immutable
export records and exclusions below. The same planned increment is to export
company-authorised decisions with their actual mandate and actor, keeping
historical staff reviewers' original attribution and changing no existing
file's meaning without the format change described below; today those
decisions are not carried ([Limits](#limits)). The pack's figures and chain
evidence are records with stated limits, not proof of a bank payment, current
contract ownership or a lodged ASIC filing.

## Producing and recording

Staff produce a pack in admin, on the company's written instruction naming who
it is for, or on a document that legally compels disclosure, referenced in its
place; the [runbook](../operations/register-foundation.md#producing-a-company-pack)
has the steps. The page is a row action on **Company packs**, a proxy of
`Company` that creates only permissions. It needs the proxy's change
permission, **Can change company pack** (`companies.change_companypack`), which
opens nothing else, and **Can view company document**
(`companies.view_companydocument`), because the pack carries the company's
documents. There is no API route and no company self-service.

[company_pack.py](../../backend/tokens/services/company_pack.py) builds the pack
within the request, on the operator connection. It reads every record, the
company row included, in one repeatable-read snapshot, the one the register's
outputs use, so an entry recorded while the pack is read cannot make two files
disagree. It reads no chain. Once the snapshot
closes, it adds up the stored files the pack would carry and refuses above the
ceiling, then writes the archive into a spooled temporary file that stays in
memory up to 8 MiB, streaming each stored file into it from private storage,
records it, then serves it. [Documents](#documents) describes the ceiling and
the files.

Ledova keeps a fingerprint, not the file: a pack is recorded as one
`company_pack` [export record](register.md#export-records) for each share class
it carries, each with the SHA-256 of the pack's `manifest.json`
([legal position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register)).

A refusal records nothing: a company with no share classes, a blank field, a
register entry that no longer matches its stored hash, which names the class
and the entry, a publication event that no longer matches its stored hash or a
roll that no longer matches its recorded digest, which name the publication,
stored files over the ceiling, a stored file missing from private storage, and
an evidence copy, publication document or remittance evidence that no longer
matches its recorded digest; the last three name the size and ceiling or the
file. A failure while the archive
is written records nothing either, because the records are written only once
the archive is complete.

## Format

The pack is a zip written by Python's standard `zipfile`. Entries are in path
order, with `manifest.json` last because its digests are known only once every
stored file has been streamed, deflated, with the timestamp 1980-01-01 00:00 and
mode 0644, so the same records, files, request and time give the same bytes,
just as a certificate carries no creation date.

`manifest.json` names the format, `ledova-company-pack`, and its version, `1`;
the company's id, name and ACN; the as-at time, which is when the snapshot was
read; the instruction and recipient; each share class's register sequence and
head hash; each publication's id, kind, number of events and head hash; and
every other file's path, size in bytes and SHA-256. The recorded
digest is the SHA-256 of `manifest.json`, so it fixes every file even when the
files are zipped again. The file list is open: a later slice adds files without
changing the version, and a change to what an existing file means changes it.

JSON files are UTF-8 with sorted keys and a two-space indent. Times are ISO 8601
in UTC, and share quantities and supplies are strings of whole numbers.

| File                                                             | Built from                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                                                      | [company_pack_readme.md](../../backend/tokens/templates/tokens/company_pack_readme.md), filled in for the company                                                                                                                                                                                                  |
| `manifest.json`                                                  | Generated, as above                                                                                                                                                                                                                                                                                                |
| `company.json`                                                   | The company row, the full name on the owner account's profile, and its business-register checks                                                                                                                                                                                                                    |
| `approvals.json`                                                 | The registry addresses the company's approvals and approval changes recorded; each approval's wallet, registry, status, expiry and whether it was listed at the as-at time; each approval change's action, wallet, expiry, authority kind, status, times and transaction hash                                      |
| `wallet_links.json`                                              | Every wallet link of the company, applied, pending and rejected alike, as an [authority record](#approvals-and-history)                                                                                                                                                                                            |
| `particulars_changes.json`                                       | Every change the company prepared to a member's particulars, with its evidence and decisions: see [approvals and history](#approvals-and-history)                                                                                                                                                                  |
| `documents.json`                                                 | Every company document, oldest first: see [documents](#documents)                                                                                                                                                                                                                                                  |
| `documents/<document id>.<extension>`                            | Each company document Ledova holds a file for, as uploaded                                                                                                                                                                                                                                                         |
| `documents/evidence/<record kind>/<record id>.<extension>`       | The evidence copy each authority record retained when it was submitted                                                                                                                                                                                                                                             |
| `classes/<class id>/class.json`                                  | The share class, its authorised shares, status and contract address, its register's id, sequence, head hash and issued supply, and each capital increase request with its execution and each pause change with its [chain side](#chain-evidence)                                                                   |
| `classes/<class id>/register.csv`                                | The [register CSV's](register.md#api-and-export) three sections, from the export's own code, without its record. Absent while the class's register has no opening                                                                                                                                                  |
| `classes/<class id>/entries.json`                                | Every register entry in sequence, with its fields, previous and entry hashes, and the hash preimage                                                                                                                                                                                                                |
| `classes/<class id>/authority.json`                              | The class's register openings, imports, corrections and register instructions, as authority records; an opening also carries the chain boundary it was prepared against                                                                                                                                            |
| `classes/<class id>/chain.json`                                  | The class's deployment record and every outgoing operation linked to one of its business records, with each signed attempt's hash, nonce, signer and chain id: see [chain evidence](#chain-evidence)                                                                                                               |
| `classes/<class id>/settlements.json`                            | Every settlement of the class that was admitted for execution: the signed order with its EIP-712 domain, both signatures, the transaction, its operation, the finalized receipt and the register entry                                                                                                             |
| `classes/<class id>/issues.json`                                 | `issues`: every issuance request of the class, with the issuance it executed and its transaction hash, the execution that sent it, and the subscription it allotted. `awaiting_allotment`: every subscription with a payment recorded and no issuance request. Each subscription's payment is labelled as recorded |
| `classes/<class id>/former_members.json`                         | The former-member section of `register.csv`, from the same rows, each with the date until which s169(3) keeps it                                                                                                                                                                                                   |
| `classes/<class id>/reconciliations.json`                        | Every reconciliation of the register with the chain, its discrepancies, and each acknowledgement's discrepancy, reason, acknowledger's name, time and `provided_by`: `company`, or `staff` for one recorded before acknowledgement was company-run                                                                 |
| `classes/<class id>/waiting.json`                                | `effects`: the [waiting list](register.md#api-and-export), or `null` where the API's is                                                                                                                                                                                                                            |
| `classes/<class id>/due.json`                                    | The class's rows of the [certificates and notice figures still due](register.md#outputs-due)                                                                                                                                                                                                                       |
| `contracts/contracts.json`                                       | The chain id, the compiler settings, the factory, settlement and registry addresses, each class's address, the owner it was deployed with and the settlement contract its approval targeted, each registry's owner, and both signing domains                                                                       |
| `contracts/<Name>.json`                                          | The committed interfaces of `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap`                                                                                                                                                                                                                |
| `publications/<publication id>/publication.json`                 | One publication, its terms, its document's path and digest, and its read counts: see [publications](#publications)                                                                                                                                                                                                 |
| `publications/<publication id>/roll.json`                        | Its frozen roll, without account ids                                                                                                                                                                                                                                                                               |
| `publications/<publication id>/events.json`                      | Its event chain: ballots withheld, every other event in full with its preimage                                                                                                                                                                                                                                     |
| `publications/<publication id>/document.<extension>`             | Its document's bytes as stored                                                                                                                                                                                                                                                                                     |
| `publications/<publication id>/payments/<record id>.<extension>` | Each payment record's remittance evidence as stored                                                                                                                                                                                                                                                                |

Class folders are named by the class's id, not its symbol. Symbols are unique
within a company only as written, so two could differ only in case, and admin
can set any text; the README's class table and `manifest.json` map each id to its
symbol.

The README is Markdown, and text the company or staff supplied, such as names,
symbols, the instruction and the recipient, passes through the `md` filter in
[company_pack_text.py](../../backend/tokens/templatetags/company_pack_text.py).
It turns control characters and line breaks into spaces, trims the ends, and
backslash-escapes the characters Markdown or HTML would read as structure, so a
value cannot add a heading, a table column, a link or a tag. Values Ledova
produces itself (ids, hashes, addresses, counts, times and status codes) are left
as they are. The JSON files and `register.csv` carry every value as stored.

### Hash preimages

A register entry's hash is the SHA-256 of PostgreSQL's text rendering of a JSONB
array, in the order the [event chain](register.md#event-chain) lists.
Reproducing that rendering outside PostgreSQL would be the first copy of it
anywhere, so the pack carries the text instead:
`tokens_register_entry_preimage(entry)`, installed beside
`tokens_register_entry_hash` from `backend/tokens/database_guards.sql`, returns
exactly what the hash function digests. The builder refuses a register if the SHA-256 of any
entry's preimage differs from its stored hash. A reader then needs only a JSON
parser and SHA-256 to check each entry against its fields, each link to the
entry before it, and the last hash against the manifest's head, and to replay the
entries into the current members. The number of the platform account that
recorded an entry is inside each preimage, because the chain cannot be checked
without it, and appears nowhere else in the pack.

A publication's event chain uses the same recipe under two version tags, `v1`
for ballots and the close and `v2` for payment records and their withdrawals.
`shareholders_publication_event_preimage(event)`, installed beside
`shareholders_publication_event_hash` from
`backend/shareholders/database_guards.sql`, returns the text either version
digests. The builder refuses
a publication if any event's preimage does not digest to its stored hash. A
ballot's preimage never leaves: see [publications](#publications).

### Contract information

Nothing in `contracts.json` is read from a chain. A class's address is the one
it stores, and the owner it was deployed with is the sender its deployment
record froze; a class with no deployment record shows none. `approved_on` is
the settlement contract its deployment record's swap approval targeted, and is
empty where that record has no approval terms. The company's
registry address is not stored on the company, so the pack lists every registry
address its approvals and approval changes recorded, and the README says to call
`registryOf(acn)` on the factory when there is none. A registry's `owner` is the
one sender every deployed class's record names, because the factory creates the
registry with its first class's owner and refuses a later class with another; it
is empty when no deployed class has a record, or when the records disagree. The factory and settlement
addresses are the configured ones. The share class domain is "Ledova Trading",
version 1, at the class's address; the settlement domain is whatever
`configured_domain()` returns, the domain both parties to a settlement sign
under, and is empty when no settlement contract is configured. The interfaces
are the files committed under `backend/contracts/`, never a local
`contracts/artifacts/` build; the compiler settings the pack states are those of
`contracts/hardhat.config.ts` and `contracts/package.json`.

The README explains how to hand over control of the contracts and does not
perform it (owner decision 5). Its section 5 names every class and registry
with the owner Ledova's records state, and says to confirm it with `owner()`.
Its steps, in order, are: wait until nothing Ledova admitted for the company is
unresolved, listing what was at the as-at time; call
`setShareTokenApproval(classAddress, false)` for each deployed class on the
settlement contract its approval targeted, or, where none is recorded, on the
configured one if `approvedShareTokens` says it is approved there; call
`transferOwnership(newOwner)` on each deployed class; and last on the registry,
or on the address `registryOf(acn)` returns when none is recorded. A record is
unresolved while a class is `deploying`, its swap approval `pending` or
`executing`, an issue's execution `queued` or `executing`, a capital increase
`executing`, a pause `pending` or `executing`, a settlement `executing`, or an
approval change `pending` or `executing`.

## Chain evidence

[company_pack_chain.py](../../backend/tokens/services/company_pack_chain.py)
builds each class's `chain.json` and `settlements.json`. The outgoing journal
has no company column, so every operation is reached from the business record
that owns it, through that record's own one-to-one link, and each business
query names both the company and the class: the deployment record and its swap
approval, an issue's execution, a capital increase's execution, a pause, and a
settlement's transaction. No join goes through an operation key or a wallet
address.

- **Operations.** Each carries its key, its purpose and the id of the record
  it was for, the unsigned intent (chain id, sender, target, value and
  calldata), its status, its last error category, when it was opened and
  acknowledged, the first receipt of its current attempt, the current attempt's
  hash, and every signed attempt, oldest first, with its hash, nonce, signer,
  chain id and signing time. The claim ids that fence workers stay behind.
- **Records name their operations.** An issue's `execution` in `issues.json`
  and a capital increase's in `class.json` carry the execution's intent,
  operation key, transaction hash and, for an issue, its finalized receipt; an
  issuance carries its transaction hash; a pause carries its chain, contract,
  intent, observation and operation key. User ids, the initiating actor and
  retry claim ids stay behind.
- **The deployment record** is in `chain.json`, in full apart from the
  deploying principal's user id and the approval's retry claim: its intent,
  operation, transaction, address, attribution flag and projection time, and
  its swap approval's intent, outcome, operation, transaction and observation.
- **Settlements** are every swap of the class with a transaction, which is every
  one admitted for execution. Each carries the signed order's EIP-712 typed
  data (domain, types and message), the order hash, the digest, both
  signatures, the transaction and its operation key, the finalized receipt and
  its policy, the completion time, and the transfer entry whose operation id is
  the swap, or none while it waits. The settlement context's order, account and
  wallet ids stay behind.
- **The opening's boundary** travels with the opening in `authority.json`,
  rather than in `chain.json`. It is a field of the opening record, it is what
  the opening's mapping was checked against when it was prepared, or reviewed for
  one submitted before openings were company-run, and the
  opening's entry is derived from it: the boundary's holdings summed by the
  member each wallet is mapped to, effective on the boundary block's date. Kept
  together, a reader can check that derivation offline.

**Signed bytes never leave.** A mined transaction can be fetched from any node
by its hash, but an unmined one could still be broadcast, so the pack carries
the hash, nonce, signer, chain id and unsigned intent and never the signed
payload ([outgoing signing](outgoing-signing.md)). The attempts are read with a
column list that leaves the payload out, so it is never read from the
database, and the JSON writer refuses any bytes value outright rather than
writing its text form.

What a record proves is in the README's section 3, the design note's evidence
table: an opening's boundary proves that one provider reported those holdings
at that block under the named finality policy, not independent consensus; a
pause or settlement approval observed already in place proves the contract was
read in that state at that block, not which transaction put it there.

## Approvals and history

[company_pack_history.py](../../backend/tokens/services/company_pack_history.py)
builds the files that record who approved what. Every query in it reaches the
company through a foreign key or stored id, its own or that of a share class the
pack read from the company, and names the company itself wherever the table
carries it: the pack runs on the operator connection, where no policy narrows a
read, so those joins are its only tenancy guard.

An **authority record** is a register opening, import, correction, register
instruction or wallet link. Each carries its id, when it was submitted,
its authority kind, approving director, reference and reason, the terms it was
submitted with, its status, the reviewer's name, when it was decided, and any
rejection reason. An applied opening or correction also names its register
entry. Wallet links belong to the company rather than a class, so they
have a file of their own, `wallet_links.json`, rather than a copy in each class's
`authority.json`.

A **particulars change** is the company's change to one member's name and
residential address. It too belongs to the company rather than a class, so the
company's changes are in `particulars_changes.json`, applied, pending and
rejected alike. Each carries its id, when it was submitted, the register
`member`, the new `name` and `residential_address`, `as_at`, the date the
company's register records them, the `reason`, its `evidence`, `provided_by`
(`company`), its `decisions`, its status, the decider's name, when it was decided
and any rejection reason. It names no authority kind, director or reference: a
reason and the supporting document are what the company provides for it. The
register's reads, `register.csv` among them, show a member's recorded
particulars only where neither a live identity nor a resolved allotment stamp
names the member.

- **Evidence is named and carried.** Each record names the company document it
  relies on, and the name, type, media type, size and SHA-256 of the copy Ledova
  retained, all from the snapshot taken when it was submitted, and `path`, where
  the copy's bytes are under `documents/evidence/` (see [documents](#documents)).
  A company-run opening, import, correction or wallet link names no company
  document: its
  copy is of the company's own upload, and its `document_type` is the upload's
  kind. The
  snapshot's company identity, storage path and owner id stay behind.
- **Reviewers are named, not numbered.** A reviewer is the full name on the
  staff member's profile, blank when there is none. No user id, submitter or
  staff email leaves: user ids appear only inside each entry's preimage.
- **Payment is recorded, not proved.** Under `issues`, each issuance request
  carries the subscription it allotted. Under `awaiting_allotment` is each
  subscription to the class with a payment recorded and no issuance request
  yet: `paid`, which is what allotment waits for, or `awaiting_payment` with an
  amount received, because part of the money is already held. Either way the
  company inherits an obligation to allot or refund it. Each carries the
  subscriber's name, from their profile and never their email, and the wallet
  the shares would go to; no account or profile id leaves. Every subscription's
  payment has the `basis` `recorded`: staff entered the amount, date, reference
  and any payment transaction hash. The README's evidence table says it does not
  prove that money moved.
- **Capital increases and pauses are in `class.json`**, beside the authorised
  shares and status they change, rather than in files of their own. Each capital
  increase request carries its terms, board and shareholder references, status,
  reviewer and times; each pause change carries whether it paused, its authority
  kind, status and times. Their executions, intents, observations and
  operations are described under [chain evidence](#chain-evidence).
- **Approvals.** `approvals.json` lists every approval of the company, with
  `listed` computed at the as-at time as the registry would, so an active
  approval past its expiry is not listed. Each approval change carries its
  action, wallet, expiry, authority kind, status and, once confirmed, its
  transaction hash; its requesting wallet and whitelist entry ids stay behind.
  `contracts.json` takes its registry addresses from the same file.
- **Former members** are the rows of `register.csv`'s former-member section,
  each with `retain_until`, seven years after the day it ceased, the date
  [s169(3)](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)
  keeps it until. Ledova's own purge waits at least as long.
- **Reconciliations** are every comparison of the register with the chain, with
  its discrepancies and each acknowledgement's reason, the name of the person who
  acknowledged it, the time and `provided_by`: `company`, or `staff` for an
  acknowledgement recorded before acknowledgement was company-run.
- **Waiting and due** come from the services the register already has.
  `waiting.json` is `waiting_list(token)`, `null` where the API's list is.
  `due.json` is the class's rows of `outputs_due(company=company)`: given a
  company, it reads only that company's entries, and the due page calls it
  without one to list every company's.

The README's sections on restrictions in force and on filings are filled in
from these files: each approval with its expiry and whether it is listed, the
paused classes, each class's waiting count or that it could not be established,
each former member with the date it must be kept until, each certificate and
set of notice figures still due, and each class's count of subscriptions
awaiting allotment or refund.

## Documents

[company_pack_documents.py](../../backend/tokens/services/company_pack_documents.py)
builds `documents.json` and chooses the stored files the pack carries. It reads
two sources, each through the company: the company's `CompanyDocument` rows,
and the evidence copies of the openings, imports, corrections, register
instructions, wallet links and particulars changes that `authority.json`,
`wallet_links.json` and `particulars_changes.json` list, taken from the same
record objects rather than a second query. Every one of those files is stored
under `companies/<company id>/` ([files and retention](files-and-retention.md)).

- **Company documents.** `documents.json` lists every document of the company,
  oldest first: its id, type, name, media type, validity dates, whether it was
  verified and when, when it was uploaded, its `external_url`, and `path`. A
  document with a stored file is carried at `documents/<document id>` with the
  extension of its media type (`.pdf`, `.png` or `.jpeg`, from the upload
  rules; none for another type), its bytes as uploaded. A document held only as
  an `external_url` has `path` `null`: it is listed, not fetched. Staff notes,
  the rejection reason, the verifier's account and the verification fingerprint
  stay behind; the company's own API shows none of them.
- **Evidence copies.** Each authority record's retained copy is carried at
  `documents/evidence/<record kind>/<record id>`, with the extension of the media
  type its snapshot recorded, and the record's `evidence.path` names it. The record
  kind keeps records with the same operation id from replacing each other's copy.
  A copy is carried even where its company document is also carried: the document may have
  changed or gone since the record was submitted, and the copy is what was
  reviewed. A company-run import also keeps a copy of its ASIC extract, carried at
  `documents/evidence/registerimport-asic/<record id>` and named by the record's
  `asic.path` with its `asic.sha256` and `asic.size`. An opening's, import's,
  correction's or wallet link's record carries `provided_by` (`company`, or
  `staff_verified` for one made before openings, imports, corrections or wallet
  links were company-run) and its `decisions`, each with its kind, the decider's
  name, time and any reason; a particulars change's record does the same, always
  `company`, and its copy is of the company's `supporting` upload.
- **The digest tie.** While streaming an evidence copy, the builder computes its
  size and SHA-256 and refuses the pack, naming the record, unless they are the
  size and SHA-256 its snapshot recorded when it was submitted. A publication's
  document and a payment record's remittance evidence are tied the same way, to
  the SHA-256 recorded when each was stored. A reader can check the same tie
  offline, from `evidence` and the bytes carried. A company
  document has no recorded digest to tie to; the manifest fixes its bytes, as it
  fixes every file's.
- **The ceiling.** Before writing the archive, the builder adds up the stored
  files it would carry: a company document by its recorded `file_size`, and an
  evidence copy, which records no size of its own, by the size storage reports.
  Above `COMPANY_PACK_MAX_STORED_BYTES`, 256 MiB in
  [tokens/constants.py](../../backend/tokens/constants.py), it refuses, naming
  the total, the ceiling and the next step: background production, which the
  owner decided is built the first time a real pack exceeds the ceiling. At or
  below it the pack is produced.
- **A missing file** refuses the pack, naming the document or record whose file
  is gone: an evidence copy is found missing when its size is read for the
  ceiling, and a company document when it is opened to be streamed. The same
  named refusal covers each storage backend's own failure (local file errors,
  Google Cloud Storage's API errors and S3's client errors) whether it comes
  when the size is read, when the file is opened, or part-way through reading
  it, so a missing or unreadable object never surfaces as a server error.

The README lists every document with its file or address, type, name and
whether it was verified, counts the evidence copies, and states that the
verification evidence Ledova holds for members (identity checks, investor
classification claims and their evidence, and payslips) is not in the pack:
each person gave it to be verified, it is not a record of the company, it runs
on its own retention clock, and a verification does not carry over to another
company or provider.

## Publications

[company_pack_publications.py](../../backend/tokens/services/company_pack_publications.py)
builds a folder for each [publication](shareholder-publications.md) of the
company, oldest first, reading `Publication` by the company and everything else
through the publication it read: the roll and the event chain by their
publication, and the read records by publication id. Every publication kind has
a folder; a holding statement or meeting notice has no events.

- **The publication.** `publication.json` carries its kind, title and class as
  frozen, record date, publication time, instruction, the authority document's
  id, the register sequence and head hash its roll was frozen at, the roll's row
  count and audience digest, and the document's path, media type and SHA-256. A
  resolution adds its question, kind, basis and window; a dividend its rate,
  currency, declaration and payment dates, declared total and undistributed
  remainder. The authority's verification fingerprint and the preparing staff
  member's id stay behind, as a document's verification does in
  `documents.json`.
- **The document** is carried at `document.<extension>`, streamed from private
  storage with the same digest tie as an evidence copy: the builder refuses the
  pack, naming the publication, unless its SHA-256 is the `digest` recorded when
  it was stored.
- **The roll** carries each row's id, register member, name, holder type,
  identity source, shares and entitlement, and never the account id it
  resolved to, so no platform id leaves (owner decision 4). Before carrying it,
  the builder runs the roll check `publications verify` runs, and refuses the
  pack, naming the publication and that command, if the roll no longer has the
  row count and digest it recorded. A reader cannot recompute the digest,
  because it covers the account ids.
- **The events.** A close, a payment record and a withdrawal are carried in
  full with their preimage: the close's tally payload, and a payment record's
  roll row, recorded date, reference, authority and remittance evidence's path,
  SHA-256 and media type. The company is the payer and already knows whom it
  paid, so these are its records. A ballot carries its sequence, kind,
  `previous_hash`, `entry_hash` and `withheld: true`, and nothing else: not its
  roll row, choice, shares, actor, staff flag, authority, time or preimage,
  because the preimage holds the choice (owner decision 3). Each remittance
  evidence file is carried at `payments/<record id>.<extension>` with the same
  digest tie as the document, against `evidence_digest`.
- **Read counts, not readers.** `reads` counts document reads by members, by the
  company and by staff, the distinct roll rows whose member opened it, and staff
  reads of remittance evidence, in one grouped query over `PublicationRead`. No
  reader, read time or read record id leaves.
- **The ceiling** counts each publication document and remittance evidence file
  by the size storage reports, since neither records a size of its own.

The README lists every publication, explains how to check the event chains and
a close's tally, and says what is withheld and why ([Limits](#limits)).

## What does not leave, and why

| Excluded                                                                                                       | Why                                                                                                                                                            | Source                                                                                |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Members' email, phone, date of birth, citizenship, financial profile, account numbers and platform account ids | What members gave Ledova, not the register's particulars; only name, residential address, holding, linked wallets and identity source leave (owner decision 4) | [Position 10](../legal/positions.md#10-privacy)                                       |
| Classification claims and evidence, payslips and extractions                                                   | The investor's records with Ledova, which the company never reads and which run on their own clock                                                             | [Files and retention](files-and-retention.md)                                         |
| A ballot's member and choice, and who opened which publication                                                 | The company sees resolution tallies and read counts only (owner decision 3)                                                                                    | [Shareholder publications](shareholder-publications.md)                               |
| Unmatched listings and orders                                                                                  | Investors' private orders                                                                                                                                      | [Trading](trading.md)                                                                 |
| Export records                                                                                                 | No company-facing route exposes them                                                                                                                           | [Position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register) |
| Signed transaction bytes                                                                                       | They can still be broadcast                                                                                                                                    | [Outgoing signing](outgoing-signing.md)                                               |
| The company owner's email                                                                                      | Contact details of a platform account, not company records                                                                                                     | This page                                                                             |
| A company document's staff notes, rejection reason, verifier and verification fingerprint                      | Ledova's own review of the document, which the company's API does not show                                                                                     | [Documents](#documents)                                                               |
| Ledova's source code                                                                                           | The software licence is noncommercial; the pack carries interface files and the owner's statement of what they may be used for                                 | [Position 5](../legal/positions.md#5-software-licensing-and-commercial-permission)    |

No file in the pack is built from these areas, apart from the register's own
particulars, and the only stored files the builder opens are the company's own
document and evidence files under `companies/<company id>/`.

The README ends with the owner's statement, verbatim: "The company, and a
provider it names in writing, may use the records and the contract interface
files in this pack to operate and move the company's own register and
contracts."

## The consumer test

A reader checks the pack offline with a JSON parser and SHA-256, as the README
describes; no offline consumer ships with the platform. The earlier consumer
and its tests remain in the
[10 October tree](https://github.com/Ledova/ledova/tree/5f40e3cd896afc3f3a55a14e359224156735a417/backend/tokens/tests)
as historical evidence.

## Limits

- No offline consumer ships; a reader has the README's recipe only. The recipe
  checks the current members against the entries and does not recompute the
  supply summary or the former members, which come from records the entries do
  not carry.
- The pack itself does not read a chain, and the
  [manual contract smoke](../development/testing.md#commands) does not produce
  a pack.
- An approval change's outgoing operation is not carried: `approvals.json` has
  each change's status and, once confirmed, its transaction hash, but not the
  attempts of one still `executing`. The README counts such a change as
  unresolved.
- A swap approval observed already in place, a legacy settlement with no
  transaction record and a legacy mint journal are not exercised. A pause
  observed already in place is carried with its block and no operation.
- What the README lists as unresolved, and a registry's owner, are what
  Ledova's records say at the as-at time, not chain reads.
- The owner a class was deployed with is what Ledova recorded, not a chain read.
  Ownership moved outside Ledova would not show.
- The ceiling counts a company document by its recorded size, which staff can
  edit in admin, so a wrong record is counted as recorded. Uploads are bounded
  at 10 MiB each, so the error is bounded by the number of documents.
- A company document has no digest recorded apart from the manifest's, so a
  reader can check an evidence copy against its record but a document only
  against the manifest.
- A document held as an `external_url` is not fetched, so the pack cannot show
  what that address served.
- A withheld ballot's own hash cannot be recomputed from the pack, and a close's
  tally cannot be recounted: a reader checks the ballots' links, the close's
  hash, which covers the last ballot's, and the tally against the roll and the
  number of ballots. The division of shares between for, against and abstain
  rests on the close's hash and on Ledova's own verifier.
- A roll's audience digest covers account ids that do not leave, so only the
  builder can check it; a reader can check the row count and the roll against
  the register's entries at the publication's sequence and record date.
- A tally can show how members voted. With one vote per share, the shares
  counted for, against and abstaining, set against the roll's holdings, often
  fit only one set of members. The company already sees the same tally and roll
  through Ledova, so the pack adds nothing to what it can infer, but withholding
  ballots does not make votes secret from the company in a small company.
- Production near the ceiling has not been measured; a proxy in front of the
  backend could still time out a large download.
- The company's non-paid grant, non-paid transfer, employee award, vesting
  event, external allotment, wallet-instruction, deployment, capital-increase
  and pause decision records are not carried as decisions: their effects appear
  through the entries, class and chain files, and #871's pack-provenance
  increment owns exporting the decisions and their evidence copies.

Next: [the register of members](register.md), the
[runbook](../operations/register-foundation.md#producing-a-company-pack) and
[legal positions](../legal/positions.md).
