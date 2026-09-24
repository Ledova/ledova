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
history behind them, and the contract information. Chain evidence, documents
and publications follow in later slices, and the format takes them without a
change.

## Producing and recording

Staff produce a pack in admin, on the company's written instruction naming who
it is for, or on a document that legally compels disclosure, referenced in its
place; the [runbook](../operations/register-foundation.md#producing-a-company-pack)
has the steps. The page is a row action on **Company packs**, a proxy of
`Company` that creates only permissions. It needs the proxy's change
permission, **Can change company pack** (`companies.change_companypack`), which
opens nothing else, and **Can view company document**
(`companies.view_companydocument`), because the pack will carry the company's
documents. There is no API route and no company self-service.

[company_pack.py](../../backend/tokens/services/company_pack.py) builds the pack
within the request, on the operator connection. It reads every record, the
company row included, in one repeatable-read snapshot, the one the register's
outputs use, so an entry recorded while the pack is read cannot make two files
disagree: a test commits an entry from another connection partway through a
read and finds it in no file of that pack. It reads no chain. It writes the archive into a spooled temporary file that stays in memory
up to 8 MiB, records it, then serves it.

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

A refusal records nothing: a company with no share classes, a blank field, and
a register entry that no longer matches its stored hash, which names the class
and the entry. A failure while the archive is written records nothing either,
because the records are written only once the archive is complete.

## Format

The pack is a zip written by Python's standard `zipfile`. Entries are in path
order, deflated, with the timestamp 1980-01-01 00:00 and mode 0644, so the same
records, request and time give the same bytes, just as a certificate carries no
creation date.

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
| `classes/<class id>/class.json` | The share class, its authorised shares, status and contract address, its register's id, sequence, head hash and issued supply, and each capital increase request and pause change |
| `classes/<class id>/register.csv` | The [register CSV's](register.md#api-and-export) three sections, from the export's own code, without its record. Absent while the class's register has no opening |
| `classes/<class id>/entries.json` | Every register entry in sequence, with its fields, previous and entry hashes, and the hash preimage |
| `classes/<class id>/authority.json` | The class's register openings, imports, corrections and register instructions, as authority records |
| `classes/<class id>/issues.json` | Every issuance request of the class, with the issuance it executed and the subscription it allotted, and that subscription's payment labelled as recorded |
| `classes/<class id>/former_members.json` | The former-member section of `register.csv`, from the same rows, each with the date until which s169(3) keeps it |
| `classes/<class id>/reconciliations.json` | Every reconciliation of the register with the chain, its discrepancies, and each acknowledgement's discrepancy, reason and time |
| `classes/<class id>/waiting.json` | `effects`: the [waiting list](register.md#api-and-export), or `null` where the API's is |
| `classes/<class id>/due.json` | The class's rows of the [certificates and notice figures still due](register.md#outputs-due) |
| `contracts/contracts.json` | The chain id, the compiler settings, the factory, settlement and registry addresses, each class's address and the owner it was deployed with, and both signing domains |
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
record froze; a class with no deployment record shows none. The company's
registry address is not stored on the company, so the pack lists every registry
address its approvals and approval changes recorded, and the README says to call
`registryOf(acn)` on the factory when there is none. The factory and settlement
addresses are the configured ones. The share class domain is "Ledova Trading",
version 1, at the class's address; the settlement domain is whatever
`configured_domain()` returns, the domain both parties to a settlement sign
under, and is empty when no settlement contract is configured. The interfaces
are the files committed under `backend/contracts/`, never a local
`contracts/artifacts/` build, and a test holds the compiler settings the pack
states to `contracts/hardhat.config.ts` and `contracts/package.json`.

The README explains how to hand over control of the contracts, calling
`setShareTokenApproval(shareToken, false)` on the settlement contract and
`transferOwnership(newOwner)` on each class and the registry, and does not
perform it (owner decision 5).

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

- **Evidence is listed, not carried.** Each record names the company document it
  relies on, and the name, type, media type, size and SHA-256 of the copy Ledova
  retained, all from the snapshot taken when it was submitted. The bytes arrive
  with the documents slice; the snapshot's company identity, storage path and
  owner id stay behind.
- **Reviewers are named, not numbered.** A reviewer is the full name on the
  staff member's profile, blank when there is none. No user id, submitter or
  staff email leaves: user ids appear only inside each entry's preimage.
- **Payment is recorded, not proved.** Each issuance request carries the
  subscription it allotted, and that subscription's payment has the `basis`
  `recorded`: staff entered the amount, date, reference and any payment
  transaction hash. The README's evidence table says it does not prove that
  money moved. A subscription that has no issuance request yet is not in the
  pack.
- **Capital increases and pauses are in `class.json`**, beside the authorised
  shares and status they change, rather than in files of their own. Each capital
  increase request carries its terms, board and shareholder references, status,
  reviewer and times; each pause change carries whether it paused, its authority
  kind, status and times. Their outgoing operations, receipts and observations
  arrive with the chain-evidence slice.
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
each former member with the date it must be kept until, and each certificate
and set of notice figures still due.

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
| Ledova's source code | The software licence is noncommercial; the pack carries interface files and the owner's statement of what they may be used for | [Position 5](../legal/positions.md#5-software-licensing-and-commercial-permission) |

No file in the pack is built from these areas, apart from the register's own
particulars. Four tests produce a pack and search every file in it for the
fixture's values in one area: each member's email, phone, date of birth,
citizenship, occupation, source of funds, account number and account, profile,
wallet and whitelist entry ids; a member's and the owner's classification
claims, their bases and evidence, and payslips; an unmatched listing and order;
and an inspection copy's export record. Each then plants those values in a
member's residential address, which the pack does carry, sees the same search
find every one, and removes them again. Another test fails if the company's API
key, its owner's email or the owner's account number appears in the pack, with
the positive control that the company's name does. Ballots, publication reads
and signed bytes have no absence test yet, because nothing the pack reads today
comes near them.

The README ends with the owner's statement, verbatim: "The company, and a
provider it names in writing, may use the records and the contract interface
files in this pack to operate and move the company's own register and
contracts."

## The consumer test

[test_company_pack.py](../../backend/tokens/tests/test_company_pack.py) builds a
synthetic company with two share classes: an opening; an issue of a paid
subscription under an applied register instruction; a transfer whose operation
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
5. replays each class's entries and compares the holdings with the current
   members in `register.csv`, read by header;
6. prints each class's result and the manifest's SHA-256, which the test compares
   with the recorded rows.

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

## Limits

- The consumer is ours, written from our own README. It proves the recipe works
  without the platform, not that a stranger would understand the README. It
  lives in the tests, not in the pack, because the pack carries no Ledova source
  code.
- The consumer checks the current members against the entries. It does not
  recompute the supply summary or the former members, which come from records
  the entries do not carry.
- The transfer in the fixture is recorded against a settlement order that never
  settled on a chain: settlement evidence arrives with the chain-evidence slice.
- The fixture's issue, pause and approval change have no chain behind them: the
  issuance request is a legacy one with no execution record, the pause was
  observed already in place, and the approval change needed no transaction. A
  confirmed approval change's transaction hash is therefore not exercised.
- An authority record's evidence is listed by digest; until the documents slice,
  a reader cannot check that digest against anything in the pack.
- The owner a class was deployed with is what Ledova recorded, not a chain read.
  Ownership moved outside Ledova would not show.
- The pack carries no stored files yet, so the 256 MiB ceiling on stored files
  the owner chose arrives with documents. A proxy in front of the backend could
  still time out a large download; that has not been measured.

Next: [the register of members](register.md), the
[runbook](../operations/register-foundation.md#producing-a-company-pack) and
[legal positions](../legal/positions.md).
