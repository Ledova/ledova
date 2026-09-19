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
its hash first require operator attribution under #624. The transaction table still holds
one row per wallet and hash, so it does not represent multiple transfer events
within a transaction. Imported history reports receipt outcomes; it does not
assert the local-transfer finality policy described below.

The wallet receipt task requires the response to identify the requested
transaction before it changes status or accounting. EVM `transactionHash` values
may be 32-byte Web3 values or their hexadecimal text representation. Bitcoin
receipts preserve the RPC response's `txid`; they never substitute the requested
hash or the distinct witness transaction hash. Missing, malformed or conflicting
identities leave the transaction pending for retry, including history imports.
This follows the [Ethereum receipt contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)
and [Bitcoin Core transaction contract](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/).
Matching identity alone does not establish deeper finality or canonicality.

Local submitted transfers settle from the existing immutable chain observations.
The observation must match the journal's network and transaction hash, a canonical
receipt block, and the approved policy: Base Sepolia and Ethereum Sepolia use the
`finalized` head; Bitcoin testnet requires six canonical confirmations. Synthetic
local-chain tests configure their policy explicitly. Production policies and
legacy attribution remain owner work under #624.

The principal-bearing confirmation task first resolves its scoped wallet and
transaction. A bounded operator step records chain evidence outside financial
writes; the consumer returns to the captured principal. Under the wallet then
transaction locks, it rechecks the observation generation, full target
fingerprint and current policy. Starting a newer observation invalidates an older
consumer even before the newer RPC returns. Missing, orphaned, malformed or
unavailable evidence retains `pending` and every deduction. A different outcome
for the same hash is held for attribution against its first included observation.
Same-outcome reinclusion can settle after its earlier block is proven orphaned
and the new inclusion satisfies policy. Nonce consumption alone cannot refund
funds; replacement admission and synthetic reorg refunds are not supported.

Ordinary holding refreshes enforce the owner's conservative availability policy.
An affected holding may decrease but cannot increase while any relevant local
transfer remains unresolved. Token amounts and native fee holdings are affected
independently; unrelated holdings can still refresh. Imported history creates no
hold. A capped refresh records its actual held quantity and advances the balance
version, but does not advance the complete-sync generation or report successful
repair. General wallet sync therefore reports a partial refresh while a cap is
active. Incoming funds and unused fee headroom in that holding can remain
unavailable indefinitely while an earlier transfer awaits attribution.

Balance RPCs run outside row locks. Wallet identity and holding balance-version
checks discard reads that overlap a newer debit or wallet change. For journaled
wallets, balance reads must still identify the recorded network before and after
RPC; a changed token contract or decimal scale cannot repair the old transfer.
The existing holding and deduction representation is retained; this is not a
ledger or a separate observed/available balance model.

Final outcomes persist `finality_observation` and a balance-reconciliation token
with the status and notification job. No estimated amount or fee is refunded
arithmetically. Successful balance repair releases availability, clears recorded
deductions and removes the repair token after rechecking the transaction target
and every returned holding version. A capped or failed read cannot clear that
token. Token and native balances can repair independently; the transaction's
repair remains pending until both have succeeded without a concurrent change.
If the approved policy changes while repair is unfinished, the task obtains fresh
canonical evidence under the new policy. Only an already attributable terminal
outcome can renew its repair authority, and only for the same outcome after the
new policy is satisfied. This replaces the observation link without repeating
the notification; earlier immutable observations remain in the watch's history.
Unknown evidence continues to hold availability and legacy rows gain no authority.

A worker interruption, provider outage or snapshot failure leaves durable repair
work for the existing five-minute sweep, including terminal transactions. A retry
cannot enqueue a second lifecycle notification. Unattributed legacy rows receive
no new finality authority: migration `wallets.0021_transaction_finality_observation`
adds a nullable link without backfilling it or changing balances. Legacy pending,
reorged/replaced holds and terminal repair tokens without attributable finality
remain conservative until operator attribution; current configuration cannot
supply missing historical provenance.
