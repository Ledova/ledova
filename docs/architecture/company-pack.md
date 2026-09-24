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
carries today: the company, its share classes, each register and the contract
information. Approvals and history, chain evidence, documents and publications
follow in later slices, and the format takes them without a change.

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
within the request, on the operator connection. It reads every record in one
repeatable-read snapshot, the one the register's outputs use, so an entry
recorded while the pack is read cannot make two files disagree, and it reads no
chain. It writes the archive into a spooled temporary file that stays in memory
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
| `classes/<class id>/class.json` | The share class, its authorised shares, status and contract address, and its register's id, sequence, head hash and issued supply |
| `classes/<class id>/register.csv` | The [register CSV's](register.md#api-and-export) three sections, from the export's own code, without its record. Absent while the class's register has no opening |
| `classes/<class id>/entries.json` | Every register entry in sequence, with its fields, previous and entry hashes, and the hash preimage |
| `contracts/contracts.json` | The chain id, the compiler settings, the factory, settlement and registry addresses, each class's address and the owner it was deployed with, and both signing domains |
| `contracts/<Name>.json` | The committed interfaces of `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` |

Class folders are named by the class's id, not its symbol. Symbols are unique
within a company only as written, so two could differ only in case, and admin
can set any text; the README's class table and `manifest.json` map each id to its
symbol.

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

Today no file in the pack is built from the first six areas, apart from the
register's own particulars. A test fails if the
company's API key, its owner's email or the owner's account number appears in
the pack, with the positive control that the company's name does.

The README ends with the owner's statement, verbatim: "The company, and a
provider it names in writing, may use the records and the contract interface
files in this pack to operate and move the company's own register and
contracts."

## The consumer test

[test_company_pack.py](../../backend/tokens/tests/test_company_pack.py) builds a
synthetic company with two share classes: an opening, an issue, a transfer
whose operation is a settlement order, a correction reversing the issue, a
former member, a wallet approval and a registry check. It produces the pack
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
4. replays each class's entries and compares the holdings with the current
   members in `register.csv`, read by header;
5. prints each class's result and the manifest's SHA-256, which the test compares
   with the recorded rows.

A second test parses the consumer and holds its imports to `zipfile`, `json`,
`csv`, `hashlib`, `io` and `sys`, with one dynamic import, of `django`, for the
refusal. Red proofs flip one byte in a file, remove a file, add one, change one
entry's shares, break one `previous_hash` consistently, drop the last entry and
change one holding in the CSV; each fails the consumer, which names the file and
the entry. Another test produces packs for two companies and finds none of one
company's ids, addresses or names in the other's pack, with the positive control
that its own pack contains every one of them.

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
- The owner a class was deployed with is what Ledova recorded, not a chain read.
  Ownership moved outside Ledova would not show.
- The pack carries no stored files yet, so the 256 MiB ceiling on stored files
  the owner chose arrives with documents. A proxy in front of the backend could
  still time out a large download; that has not been measured.

Next: [the register of members](register.md), the
[runbook](../operations/register-foundation.md#producing-a-company-pack) and
[legal positions](../legal/positions.md).
