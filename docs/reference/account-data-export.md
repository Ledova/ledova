# Account-data export

[Reference](README.md) · [Documentation](../README.md)

What a person's own data export contains, what its transaction evidence
establishes, and why the export is not recorded.

## The route and its clients

`GET /api/user-profiles/export-data/` returns the signed-in person's own data as
one JSON document. It takes no identifier. It runs on the app connection under
the caller's own row-level policies ([tenancy](../architecture/tenancy.md)), and
`export_account_data` in `backend/users/services/lifecycle.py` selects only the
caller's rows.

Both clients reach it through `exportAccountData` in `@ledova/shared`. The
dashboard saves the JSON as a file from Settings. The mobile app writes it to one
private cache copy and hands that file to the system share sheet, bound to the
session current when the export was requested, the same path a viewed document
takes ([document copies](../architecture/mobile-lifecycles.md#document-upload-copies)).
Both name the file `ledova-data-export-<UTC date>.json`.

## What it contains

| Section | Content |
| --- | --- |
| `user` | Email, when the account was created, whether the email is verified |
| `profile` | Name, date of birth, phone, residential address, citizenship, whether identity is verified |
| `preferences` | The selected portfolio |
| `financialProfile` | Occupation, source of funds and intended use |
| `account` | Account number, type, activation date |
| `wallets` | Each wallet's name, chain, address, native balance, market value and verification |
| `transactions` | Every transaction of the account's wallets, described below |
| `portfolios` | Each portfolio's name and whether it is active |

A section the person has no row for is `null`, or an empty list. The export is
the account's profile, wallets, transactions and portfolios. It is not
everything Ledova holds about the person: classification claims and their
evidence, uploaded documents, per-asset holdings, orders, subscriptions,
notifications and register particulars are not in it.

## Transactions

Every transaction row of the account's wallets is exported, newest block first,
with no limit. Until [#650](https://github.com/Ledova/ledova/issues/650) the
export kept only the newest 1,000 and said nothing about the rest; the
[decision](../decisions.md#the-account-data-export) records why that was
removed. The rows are read through a database cursor rather than loaded as
models all at once, and each row's latest chain observation arrives in the same
query.

| Field | Meaning |
| --- | --- |
| `txHash`, `chain` | The transaction's hash and Ledova's chain name |
| `status` | Ledova's recorded outcome: `pending`, `confirmed`, `failed`, `reorged` or `replaced` |
| `asset`, `amount` | The asset symbol and amount moved |
| `transactionFee` | The actual native fee, as recorded from the receipt or the imported history, never the estimate. `null` only when it is unknown; a fee of zero is exported as zero |
| `fromAddress`, `toAddress` | The two parties' addresses |
| `blockTimestamp`, `blockNumber`, `blockHash` | The block the receipt placed it in, where recorded |
| `nonce` | The sender's nonce, for an EVM transaction submitted through Ledova |
| `importedFromHistory` | `true` when the row came from the provider's transfer history rather than a submission through Ledova |
| `chainObservation` | The latest chain observation, or `null` when there is none |
| `createdAt` | When Ledova recorded the row |

`chainObservation` has four fields: `network`, the recorded network identity
(`evm:<chain id>` or `bitcoin:<genesis hash>`) the finality policy is keyed by;
`result`, one of `included`, `unknown` or `orphaned`; `finality`, one of
`unknown`, `waiting` or `satisfied`; and `policy`, the normalised finality
policy the observation was judged under.

## What the evidence proves, and what it does not

With the hash, block number, block hash and nonce, anyone can ask any node of
the named network for the transaction and its block, and compare. What each
field establishes:

- **Block, time and fee** are what one provider's receipt reported, checked
  against the block header it named. They are consistent provider metadata, not
  independent chain truth ([receipt attribution](transaction-evidence.md#receipt-attribution)).
- **The chain observation** is the latest thing Ledova's observer read for the
  transaction: inclusion, unknown or an orphaned block, recorded apart from
  whether the named finality policy was satisfied. It is one provider's
  internally consistent evidence, not a consensus proof, and it never changes a
  transaction's status or holdings
  ([wallet chain observations](transaction-evidence.md#wallet-chain-observations)).
  Only the latest observation is exported, so a transaction once `included` can
  show `unknown` if a later read found nothing. Only transactions submitted
  through Ledova with a durable journal are observed; imported history never
  is, so its `chainObservation` is always `null`.
- **`status`** is Ledova's record of the outcome, not evidence of it.
- **Signed transaction bytes are never exported.** A mined transaction's bytes
  can be fetched from any node by its hash, and an unmined transaction's bytes
  could still be broadcast.

## Not recorded

The export writes nothing: no export record and no audit row. A copy is recorded
when it carries personal information of someone other than the person asking,
or when it goes to anyone but that person. This export carries only the
requester's own data and goes only to them, so recording it would log a person
looking at their own records. Register exports meet that rule and are recorded
([register exports](../architecture/register.md#api-and-export)). A test holds
the export request to issuing no `INSERT`, `UPDATE` or `DELETE`.

## Limits

- The document is built in memory within one request, and its size grows with
  the number of transactions. There is no ceiling.
- Each section is read by its own query, not in one snapshot, so a row written
  during an export can appear in one section and be missing from another.
- `policy` is the policy recorded with the observation. It is not re-checked
  against the policy configured now.
