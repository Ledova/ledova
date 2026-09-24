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
carries today: the company, its share classes, each register, the approvals and
history behind them, each class's chain evidence and settlements, the company's
documents with the evidence copies behind its approvals, and the contract
information. Publications follow in a later slice, and the format takes them
without a change.

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
disagree: a test commits an entry from another connection partway through a
read and finds it in no file of that pack. It reads no chain. Once the snapshot
closes, it adds up the stored files the pack would carry and refuses above the
ceiling, then writes the archive into a spooled temporary file that stays in
memory up to 8 MiB, streaming each stored file into it from private storage,
records it, then serves it. [Documents](#documents) describes the ceiling and
the files.

Ledova keeps a fingerprint, not the file. A pack is recorded in
`RegisterExport` as one `company_pack` row for each share class it carries, with
that class's register sequence and current- and former-member row counts, the
instruction's reference, the recipient, and the SHA-256 of the pack's
`manifest.json`, the same on every row. A database check constraint requires the
digest, a non-blank instruction and a non-blank recipient, and allows no request
date or late flag; the notice-figures constraint already allows a period on no
other kind. The records share the export records' update guard, operator-only
table and daily purge after the 2,557-day floor, as
[legal position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register)
describes.

A refusal records nothing: a company with no share classes, a blank field, a
register entry that no longer matches its stored hash, which names the class
and the entry, stored files over the ceiling, a stored file missing from private
storage, and an evidence copy that no longer matches its recorded digest; the
last three name the size and ceiling or the file. A failure while the archive
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
head hash; and every other file's path, size in bytes and SHA-256. The recorded
digest is the SHA-256 of `manifest.json`, so it fixes every file even when the
files are zipped again. The file list is open: a later slice adds files without
changing the version, and a change to what an existing file means changes it.

JSON files are UTF-8 with sorted keys and a two-space indent. Times are ISO 8601
in UTC, and share quantities and supplies are strings of whole numbers.

| File | Built from |
| --- | --- |
| `README.md` | [company_pack_readme.md](../../backend/tokens/templates/tokens/company_pack_readme.md), filled in for the company |
| `manifest.json` | Generated, as above |
| `company.json` | The company row, the full name on the owner account's profile, and its business-register checks |
| `approvals.json` | The registry addresses the company's approvals and approval changes recorded; each approval's wallet, registry, status, expiry and whether it was listed at the as-at time; each approval change's action, wallet, expiry, authority kind, status, times and transaction hash |
| `wallet_links.json` | Every reviewed wallet link request of the company, as an [authority record](#approvals-and-history) |
| `documents.json` | Every company document, oldest first: see [documents](#documents) |
| `documents/<document id>.<extension>` | Each company document Ledova holds a file for, as uploaded |
| `documents/evidence/<record id>.<extension>` | The evidence copy each authority record retained when it was submitted |
| `classes/<class id>/class.json` | The share class, its authorised shares, status and contract address, its register's id, sequence, head hash and issued supply, and each capital increase request with its execution and each pause change with its [chain side](#chain-evidence) |
| `classes/<class id>/register.csv` | The [register CSV's](register.md#api-and-export) three sections, from the export's own code, without its record. Absent while the class's register has no opening |
| `classes/<class id>/entries.json` | Every register entry in sequence, with its fields, previous and entry hashes, and the hash preimage |
| `classes/<class id>/authority.json` | The class's register openings, imports, corrections and register instructions, as authority records; an opening also carries the chain boundary it was reviewed against |
| `classes/<class id>/chain.json` | The class's deployment record and every outgoing operation linked to one of its business records, with each signed attempt's hash, nonce, signer and chain id: see [chain evidence](#chain-evidence) |
| `classes/<class id>/settlements.json` | Every settlement of the class that was admitted for execution: the signed order with its EIP-712 domain, both signatures, the transaction, its operation, the finalized receipt and the register entry |
| `classes/<class id>/issues.json` | `issues`: every issuance request of the class, with the issuance it executed and its transaction hash, the execution that sent it, and the subscription it allotted. `awaiting_allotment`: every subscription with a payment recorded and no issuance request. Each subscription's payment is labelled as recorded |
| `classes/<class id>/former_members.json` | The former-member section of `register.csv`, from the same rows, each with the date until which s169(3) keeps it |
| `classes/<class id>/reconciliations.json` | Every reconciliation of the register with the chain, its discrepancies, and each acknowledgement's discrepancy, reason and time |
| `classes/<class id>/waiting.json` | `effects`: the [waiting list](register.md#api-and-export), or `null` where the API's is |
| `classes/<class id>/due.json` | The class's rows of the [certificates and notice figures still due](register.md#outputs-due) |
| `contracts/contracts.json` | The chain id, the compiler settings, the factory, settlement and registry addresses, each class's address, the owner it was deployed with and the settlement contract its approval targeted, each registry's owner, and both signing domains |
| `contracts/<Name>.json` | The committed interfaces of `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` |

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
as they are. [test_company_pack_readme.py](../../backend/tokens/tests/test_company_pack_readme.py)
parses the template and fails on any interpolation that is neither filtered nor
on its list of Ledova's own values. The JSON files and `register.csv` carry every
value as stored.

### Hash preimages

A register entry's hash is the SHA-256 of PostgreSQL's text rendering of a JSONB
array, in the order the [register foundation](../operations/register-foundation.md#identity-and-events)
lists. Reproducing that rendering outside PostgreSQL would be the first copy of
it anywhere, so the pack carries the text instead:
`tokens_register_entry_preimage(entry)`, installed beside
`tokens_register_entry_hash` by `tokens/0080_company_pack`, returns exactly what
the hash function digests. The builder refuses a register if the SHA-256 of any
entry's preimage differs from its stored hash. A reader then needs only a JSON
parser and SHA-256 to check each entry against its fields, each link to the
entry before it, and the last hash against the manifest's head, and to replay the
entries into the current members. The number of the platform account that
recorded an entry is inside each preimage, because the chain cannot be checked
without it, and appears nowhere else in the pack.

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
`contracts/artifacts/` build, and a test holds the compiler settings the pack
states to `contracts/hardhat.config.ts` and `contracts/package.json`.

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
  wallet ids stay behind: a test finds the swap's own id in the pack and none of
  them.
- **The opening's boundary** travels with the opening in `authority.json`,
  rather than in `chain.json`. It is a field of the opening record, it is what
  the opening's mapping was checked against when it was reviewed, and the
  opening's entry is derived from it: the boundary's holdings summed by the
  member each wallet is mapped to, effective on the boundary block's date. Kept
  together, a reader can check that derivation offline, and the consumer does.

**Signed bytes never leave.** A mined transaction can be fetched from any node
by its hash, but an unmined one could still be broadcast, so the pack carries
the hash, nonce, signer, chain id and unsigned intent and never the signed
payload ([outgoing signing](outgoing-signing.md)). The attempts are read with a
column list that leaves the payload out, so it is never read from the
database, and the JSON writer refuses any bytes value outright rather than
writing its text form. A test gathers every stored signed transaction, from
every model with a `raw_transaction` field (the outgoing journal, the history
inventory, participant approval submissions, and EVM and Bitcoin wallet
submissions) and every legacy mint journal, and searches the whole archive and
every file in it for each one, raw, in hexadecimal of either case and in both
base64 alphabets. It finds none. As its positive control it writes one
attempt's payload, in hexadecimal, into the company's trading name, which the
pack carries, sees the same search name that attempt, and restores the name. A
second test holds the search itself to finding each of those forms in a stored
or deflated zip, and the set of models it reads to the five that exist today, so
a new one fails it until it is added.

What a record proves is in the README's section 3: the design note's evidence
table, word for word for the rows it has, with two rows added for records it did
not cover. An opening's boundary proves that one provider reported those
holdings at that block under the named finality policy, not independent
consensus; a pause or settlement approval observed already in place proves the
contract was read in that state at that block, not which transaction put it
there.

## Approvals and history

[company_pack_history.py](../../backend/tokens/services/company_pack_history.py)
builds the files that record who approved what. Every query in it reaches the
company through a foreign key or stored id, its own or that of a share class the
pack read from the company, and names the company itself wherever the table
carries it: the pack runs on the operator connection, where no policy narrows a
read, so those joins are its only tenancy guard.

An **authority record** is a register opening, import, correction, register
instruction or wallet link request. Each carries its id, when it was submitted,
its authority kind, approving director, reference and reason, the terms it was
submitted with, its status, the reviewer's name, when it was decided, and any
rejection reason. An applied opening or correction also names its register
entry. Wallet link requests belong to the company rather than a class, so they
have a file of their own, `wallet_links.json`, rather than a copy in each class's
`authority.json`.

- **Evidence is named and carried.** Each record names the company document it
  relies on, and the name, type, media type, size and SHA-256 of the copy Ledova
  retained, all from the snapshot taken when it was submitted, and `path`, where
  the copy's bytes are under `documents/evidence/` (see [documents](#documents)).
  The snapshot's company identity, storage path and owner id stay behind.
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
  its discrepancies and each acknowledgement's reason and time.
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
instructions and wallet links that `authority.json` and `wallet_links.json`
list, taken from the same record objects rather than a second query. Every one
of those files is stored under `companies/<company id>/`
([files and retention](files-and-retention.md)).

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
  `documents/evidence/<record id>`, with the extension of the media type its
  snapshot recorded, and the record's `evidence.path` names it. A copy is
  carried even where its company document is also carried: the document may have
  changed or gone since the record was submitted, and the copy is what was
  reviewed.
- **The digest tie.** While streaming an evidence copy, the builder computes its
  size and SHA-256 and refuses the pack, naming the record, unless they are the
  size and SHA-256 its snapshot recorded when it was submitted. The consumer
  checks the same tie offline, from `evidence` and the bytes carried. A company
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
  ceiling, and a company document when it is opened to be streamed.

The README lists every document with its file or address, type, name and
whether it was verified, counts the evidence copies, and states that the
verification evidence Ledova holds for members (identity checks, investor
classification claims and their evidence, and payslips) is not in the pack:
each person gave it to be verified, it is not a record of the company, it runs
on its own retention clock, and a verification does not carry over to another
company or provider.

## What does not leave, and why

| Excluded | Why | Source |
| --- | --- | --- |
| Members' email, phone, date of birth, citizenship, financial profile, account numbers and platform account ids | What members gave Ledova, not the register's particulars; only name, residential address, holding, linked wallets and identity source leave (owner decision 4) | [Position 10](../legal/positions.md#10-privacy) |
| Classification claims and evidence, payslips and extractions | The investor's records with Ledova, which the company never reads and which run on their own clock | [Files and retention](files-and-retention.md) |
| A ballot's member and choice, and who opened which publication | The company sees resolution tallies and read counts only (owner decision 3) | [Shareholder publications](shareholder-publications.md) |
| Unmatched listings and orders | Investors' private orders | [Trading](trading.md) |
| Export records | No company-facing route exposes them | [Position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register) |
| Signed transaction bytes | They can still be broadcast | [Outgoing signing](outgoing-signing.md) |
| The company's API key and its owner's email | Credentials and contact details of a platform account, not company records | This page |
| A company document's staff notes, rejection reason, verifier and verification fingerprint | Ledova's own review of the document, which the company's API does not show | [Documents](#documents) |
| Ledova's source code | The software licence is noncommercial; the pack carries interface files and the owner's statement of what they may be used for | [Position 5](../legal/positions.md#5-software-licensing-and-commercial-permission) |

No file in the pack is built from these areas, apart from the register's own
particulars. Four tests produce a pack and search every file in it for the
fixture's values in one area: each member's email, phone, date of birth,
citizenship, occupation, source of funds, account number and account, profile,
wallet and whitelist entry ids; a member's and the owner's classification
claims, their bases and evidence, and payslips; an unmatched listing and order;
and an inspection copy's export record. The members' test first finds the
subscriptions awaiting allotment in the pack, so the details stay out while
those members' subscriptions are carried. Each then plants those values in a
member's residential address, which the pack does carry, sees the same search
find every one, and removes them again. Another test fails if the company's API
key, its owner's email or the owner's account number appears in the pack, with
the positive control that the company's name does. Signed transaction bytes
have their own test, described under [chain evidence](#chain-evidence). Ballots
and publication reads have no absence test yet, because nothing the pack reads
today comes near them.

Stored files have a test of their own in
[test_company_pack_documents.py](../../backend/tokens/tests/test_company_pack_documents.py).
It adds classification evidence and payslips, unattached and attached, so that
files are stored under both `users/` and `documents/`, and records every name
private storage is asked to open or size while the pack is produced. Those
names are exactly the company's own document and evidence files, all under
`companies/<company id>/`, and none of the bytes stored outside the company is
in the archive or any file in it. As its positive control it copies one
member's classification evidence into a new company document, sees the search
name that file, deletes the document and sees it gone again.

The README ends with the owner's statement, verbatim: "The company, and a
provider it names in writing, may use the records and the contract interface
files in this pack to operate and move the company's own register and
contracts."

## The consumer test

[test_company_pack.py](../../backend/tokens/tests/test_company_pack.py) builds a
synthetic company with two share classes: an opening; an issue of a paid
subscription under an applied register instruction; one subscription paid and
one part-paid, neither allotted, beside a draft that must stay out; a transfer whose operation
is a settlement order; a correction reversing the issue, reviewed and applied
through the correction service; a reviewed wallet link; a former member; an
approved capital increase; a pause; one listed and one lapsed wallet approval and
an approval change; a discrepant reconciliation with its acknowledgement; and a
registry check. Every authority record rests on a verified company document with
bytes of its own. It produces the pack
through the admin page and gives it to
[company_pack_consumer.py](../../backend/tokens/tests/company_pack_consumer.py),
run as `python -I -S company_pack_consumer.py pack.zip` in a subprocess with an
empty environment and a temporary working directory. `-S` leaves out
site-packages, so Django, psycopg and web3 cannot be imported, and `-I` ignores
`PYTHON*` variables and the user's own site-packages.

The consumer:

1. refuses to run if `django` can be imported, and the test runs it once without
   `-S` to see that refusal, which proves the isolation is real;
2. checks every file the manifest lists for its size and SHA-256, and refuses a
   file it does not list;
3. checks each register's chain as the README describes, and that it ends at the
   manifest's head;
4. checks that each applied opening and correction in `authority.json` names
   the entry whose operation is that record, of the matching kind, and for a
   correction the same corrected entry, and that no other record names one;
5. checks that an applied opening carries its boundary, and that its entry is
   the boundary's holdings summed by the member each wallet is mapped to,
   effective on the boundary block's date;
6. checks, in `chain.json`, that every attempt has a well-formed hash and
   signer, a whole nonce and a positive chain id, that an operation has a
   current attempt exactly when its status is not `preparing` or `failed` and
   that it is one of its attempts, and that a receipt's block hash is
   well-formed;
7. checks that every operation key a record names (a pause, an issue's or
   capital increase's execution, the deployment and its swap approval, or a
   settlement) is listed in `chain.json` for that purpose and record, and that
   every operation listed is named by a record;
8. checks that each settlement's transaction hash is well-formed and that a
   settlement naming an entry names the transfer whose operation is that
   settlement;
9. replays each class's entries and compares the holdings with the current
   members in `register.csv`, read by header;
10. checks that every document `documents.json` gives a `path` is carried, that
    every authority record's evidence copy is carried at its `path` with the
    size and SHA-256 its `evidence` records, and that every file under
    `documents/` is named by a document or a record;
11. prints each class's result, a count of the documents and evidence copies,
    and the manifest's SHA-256, which the test compares with the recorded rows.

None of these is an on-chain fact. The consumer cannot check a signature or a
receipt, because `hashlib`'s SHA3 is not Ethereum's Keccak and it has no
secp256k1: it checks that the pack is internally consistent and well-formed.

[test_company_pack_documents.py](../../backend/tokens/tests/test_company_pack_documents.py)
adds an opening, submitted on a third, unopened class, and an import, each
through its submit service with a verified document, so that every kind of
authority record retains a copy. Its tests find every document and evidence
copy carried with the bytes storage holds and listed in the manifest, each
record naming its copy, and the documents and the members' evidence statement
in the README. The builder refuses an evidence copy whose stored bytes changed
by one byte, and a company document or evidence copy missing from storage, and
records nothing; restored, the pack is produced. With the ceiling patched down
to the fixture's own total less one byte it refuses and records nothing, and at
the total and one byte above it it produces the pack. The tenant fixture's ASIC
extract records a size of one byte, smaller than its file, so the same test
shows that a document is counted by its recorded size. The consumer names a byte
flipped in a document, a byte flipped in an evidence copy with the manifest
rewritten to match, a document or copy removed with its listing, and a listed
file no record names. A second company's pack carries none of the first's
document files, ids or bytes, with the positive control that the first's own
pack carries all of them.

A second test parses the consumer and holds its imports to `zipfile`, `json`,
`csv`, `hashlib`, `io` and `sys`, with one dynamic import, of `django`, for the
refusal. Red proofs flip one byte in a file, remove a file, add one, change one
entry's shares, break one `previous_hash` consistently, drop the last entry,
change one holding in the CSV, point a correction's authority at another entry
or another corrected entry, and remove an applied correction's entry; each
fails the consumer, which names the file and the entry or record. Another test
produces packs for two companies and finds none of one company's ids,
addresses, names, references, reviewers, directors or evidence digests in the
other's pack, with the positive control that its own pack contains every one of
them. The consumer checks nothing else in the approvals and history files: the
rest carries no link it could check without the platform.

A separate test settles a transfer after the register's opening against a fake
node, leaves it uninstructed, and finds it in `waiting.json` with its reason and
counted in the README; the synthetic company above has no opening boundary, so
its lists are `null`.

[test_company_pack_chain.py](../../backend/tokens/tests/test_company_pack_chain.py)
builds the chain evidence through the real services against the fake nodes the
services' own tests use: a settlement executed and finalized, an issue executed
and finalized, a capital increase whose first attempt reverted and whose retry
confirmed, a second class deployed with its swap approval still pending, a
confirmed pause, and an unpause signed with no receipt. Its tests hold each
section to the journal's own rows, the README's evidence table and handover
steps to their exact text, and the consumer to naming a current attempt left
out, a malformed attempt hash, an operation left out, a record's link dropped, a
settlement pointed at the wrong entry and a malformed settlement hash. A second
company with a pause and a capital increase of its own shares none of its
operation keys, attempt hashes or record ids with the first, with the positive
control that each pack carries all of its own. An opening applied against a
captured boundary is carried with it, and the consumer refuses a changed
holding, a changed date, an unmapped holder and a missing boundary.

## Limits

- The consumer is ours, written from our own README. It proves the recipe works
  without the platform, not that a stranger would understand the README. It
  lives in the tests, not in the pack, because the pack carries no Ledova source
  code.
- The consumer checks the current members against the entries. It does not
  recompute the supply summary or the former members, which come from records
  the entries do not carry.
- The chain evidence is built against fake nodes, not a real chain. Nothing in
  the pack could be populated only from a real chain, because the pack reads
  none, but no test here shows a pack produced after a real deployment,
  settlement or pause; the [real-chain suite](../development/testing.md#commands)
  does not produce one.
- An approval change's outgoing operation is not carried: `approvals.json` has
  each change's status and, once confirmed, its transaction hash, but not the
  attempts of one still `executing`. The README counts such a change as
  unresolved.
- A swap approval observed already in place, a legacy settlement with no
  transaction record and a legacy mint journal are not exercised. A pause
  observed already in place is, by the first fixture above, carried with its
  block and no operation.
- What the README lists as unresolved, and a registry's owner, are what
  Ledova's records say at the as-at time, not chain reads.
- The owner a class was deployed with is what Ledova recorded, not a chain read.
  Ownership moved outside Ledova would not show.
- The ceiling counts a company document by its recorded size, which staff can
  edit in admin, so a wrong record is counted as recorded. Uploads are bounded
  at 10 MiB each, so the error is bounded by the number of documents.
- A company document has no digest recorded apart from the manifest's, so the
  consumer can check an evidence copy against its record but a document only
  against the manifest.
- A document held as an `external_url` is not fetched, so the pack cannot show
  what that address served.
- No test produces a pack near the ceiling: the ceiling tests patch the constant
  down to the fixture's size. A proxy in front of the backend could still time
  out a large download; that has not been measured.

Next: [the register of members](register.md), the
[runbook](../operations/register-foundation.md#producing-a-company-pack) and
[legal positions](../legal/positions.md).
