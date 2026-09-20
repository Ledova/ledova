# Stored register foundation

[Operations](README.md) · [Register architecture](../architecture/register.md)

The first [#647](https://github.com/Ledova/ledova/issues/647) slice provides
company-scoped member references, an append-only share-event chain and stored
holdings. It is a foundation for the authoritative register. Current HTTP and CSV
register routes still use the existing chain reader; issuance and settlement do
not yet populate these new tables. Do not use the foundation as an activated
company register.

## Identity and events

A member has a UUID belonging to one company, independent of a wallet or platform
account. The owner chose this so imports can include walletless members and one
member can later have multiple wallet links. This slice stores the reference
only: wallet mappings, retained personal particulars, allotment consideration and
the API/client changes belong to the integration work. It never merges members
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
no change can make a position negative. Partial corrections and the reviewed
evidence workflow remain later work. Recording a cessation or correction does
not burn, seize or transfer tokens on chain.

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
provider, signs a transaction or activates the API reader.

The migration refuses rollback once member/register records exist. New scoped
tables are explicitly associated with their creating migration in the grant
installer, so historical grant installation can run before those tables exist.
The creating migration installs their policies and grants; a missing table after
that migration is recorded remains an error.

## Inspecting a canonical chain snapshot

Before an opening can be activated, its chain quantities need one recorded
boundary. The read-only operator command below inspects an attributed deployment
on the configured local/testnet provider. It does not load an opening, record
member identities, switch HTTP reads or change issuance completion timing.

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
block number/hash/date, finality policy, issued/authorized supply and positive
holdings. All share quantities are exact integer strings; names and residential
addresses are absent. The observed transfer fold must agree with each observed
participant's balance, including zero balances, and total supply at that same
hash. Duplicate or noncanonical logs, inconsistent quantities, a reorg, a changed
deployment/network/policy or unavailable finality refuse the result.

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

The register approval model will use documentary director authority submitted by
the company owner and verified by authorised staff. An owner account alone is
not proof of director authority. The proposal/approval workflow is still pending;
the company-document admin now provides its content-verification prerequisite.

In the company document admin, choose **Review and verify document**, open the
private file, review its company, document type and validity details, then confirm.
The action requires an active staff user with `companies.change_companydocument`
and the admin's object permission. The confirmation is bound to that reviewer and
document and expires after 15 minutes. Bulk verification and manually editable
verification flags have been removed.

Confirmation re-reads the file and locks the document row. It records a SHA-256
fingerprint covering the file's bytes and its document/company IDs, type, name,
storage key, size, MIME type, external URL and validity dates. A changed preview,
missing or empty file, wrong size, rejection or non-current validity is refused.
An external URL alone cannot establish file content and must be replaced by an
uploaded document before this review can be used.

PostgreSQL clears verification when the bound document details or rejection
reason change, and refuses customer-role writes to verification fields. Notes
alone do not revoke verification. Older verified records keep their historical
flag without gaining a fabricated fingerprint; they need a fresh review before
they can supply content-bound evidence. Downgrade refuses to discard any recorded
fingerprints.

This is a record of what was verified at a time. Storage can become unavailable
or be changed outside the application, and validity can expire without a database
write. A later register approval consumer must recheck the current file against
the recorded fingerprint, the company and operation, and the validity dates;
the historical `is_verified` flag alone is insufficient. No background storage
monitoring, register approval, retained file copy or deletion/retention change is
introduced here. Documentary authority and an exact proposed register change
remain separate requirements of the upcoming approval workflow.
