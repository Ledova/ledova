# Wallet history and balance reconciliation

[Reference](README.md) · [Wallets](../architecture/wallets-and-valuations.md)

History imports, optimistic deductions and authoritative chain refreshes have
different effects. This page records those boundaries and their recovery behavior.

Manual wallet sync returns `success: false` with an actionable `syncResult.error`
when verification is missing, the provider fails, history cannot be read or a
known holding cannot be refreshed. Both clients display that reason. A partial
refresh keeps any balances it did read, and leaves the wallet's last successful
sync time unchanged.

Wallet import previews use `POST /api/wallets/batch-check-balances/` with a
`chain` (`ethereum`, `base`, or `bitcoin`) and 1–20 addresses. The account is
the signed-in user's own and is not named in the request; staff status does not
widen it. Addresses need not be registered yet. The response
repeats the account and network and returns `balances[address]` as a decimal
string or `null` when the provider cannot supply a valid balance. A confirmed
zero remains `"0"`. Preview reads do not create or update wallets or holdings.
Both clients display failed reads as **Unavailable** and discard pending
responses when the network changes. Hardware and software
import screens let the user choose Ethereum or Base for their EVM addresses.

Alchemy transfer history follows each direction's `pageKey` through the final
page, with an explicit newest-first order. Pagination finishes before receipt
lookups, because Alchemy cursors expire after ten minutes. A repeated cursor,
unreadable response or continuation beyond 100 pages per direction fails the
sync rather than presenting a truncated history as complete. See the
[Alchemy pagination contract](https://www.alchemy.com/docs/reference/transfers-api-quickstart).

Wallet history imports create rows only for previously unseen `(wallet, hash)`
pairs. Repeated or conflicting observations cannot overwrite an existing row's
intent, status, receipt fields or accounting. The import takes the wallet lock
used by pending creation and confirmation before checking or inserting rows.
New history rows start `pending`, regardless of the provider's history status,
and the existing five-minute confirmation sweep obtains a receipt before
completing them. Migration `wallets.0015_transaction_imported_from_history`
adds an internal marker for new imports without inferring the origin of existing
rows. Receipt verification for marked imports preserves block metadata when the
provider cannot supply it and updates available receipt fields under the wallet
and transaction locks. It sends no lifecycle notifications and changes no
holdings or snapshots, including for quarantined assets. The wallet sync still
refreshes current balances for verified holdings. History imports do not record
an optimistic deduction.
A confirmation job whose initial lookup finds no stored transaction returns
`not_found` without contacting the provider or entering a settlement writer.
History imported after that lookup remains pending for a later confirmation
job; the earlier job cannot treat it as a locally submitted transfer.
Existing historical rows, including legacy `success` statuses, are preserved;
repairing them and adopting a locally submitted transfer after history imported
its hash first remain separate work under #7. The transaction table still holds
one row per wallet and hash, so it does not represent multiple transfer events
within a transaction. This change does not add deeper finality or reorg policy.

The wallet receipt task requires the response to identify the requested
transaction before it changes status or accounting. EVM `transactionHash` values
may be 32-byte Web3 values or their hexadecimal text representation. Bitcoin
receipts preserve the RPC response's `txid`; they never substitute the requested
hash or the distinct witness transaction hash. Missing, malformed or conflicting
identities leave the transaction pending for retry, including history imports.
This follows the [Ethereum receipt contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)
and [Bitcoin Core transaction contract](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/).
Matching identity alone does not establish deeper finality or canonicality.

Pending-transfer deductions record the holding generation they changed. A failure
returns each recorded deduction once, and only while that generation is still
current. An authoritative chain refresh supersedes that deduction; a later
provider outage cannot turn its reversal into an extra balance. Token and native
fee deductions are checked independently. Balance reads run outside row locks,
and observations made across a concurrent holding change are discarded for retry.

Migration `wallets.0012_balance_versions` preserves existing quantities and
recorded deductions. Existing transactions have no provable generation: if such
a transfer fails during a provider outage, its cached balance stays unchanged
until a successful chain refresh. The migration never guesses a refund from an
old declared amount or fee estimate. Optimistic changes do not advance the last
successful chain-sync timestamp.

Local-transfer confirmation, failure and reorg transitions persist a balance-reconciliation
token before committing. If a worker stops or a balance/snapshot operation fails,
the five-minute sweep requeues that work even after transaction status changes.
Retries complete the balance and snapshot work without repeating notifications
or refunds. A reorg after a successful confirmation sync retains superseded
deductions until an authoritative refresh succeeds. Unavailable providers leave
the repair pending; a later transition prevents an older repair from completing
over it.
