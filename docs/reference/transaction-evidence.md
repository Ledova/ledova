# Transaction evidence

[Reference](README.md) · [Documentation](../README.md)

What observations establish, how they are retained, and which outcomes still remain unresolved.

## Wallet chain observations

The five-minute `observe_wallet_chains` task continues reading durable EVM and
Bitcoin wallet journals after confirmation or failure. Each run checks at most
25 journals, preferring those never checked and then the least recently started;
a start within two minutes is deferred. It records a durable generation before
RPC, then appends normalized evidence only if the entire wallet/transaction
target and generation still match. A later reader supersedes an abandoned claim,
and a delayed result cannot overwrite that reader's evidence.

`WalletChainObservation` records inclusion, unknown evidence or an orphaned block
separately from whether an explicit finality policy is satisfied. A missing
receipt alone cannot establish a reorg. The observer compares canonical blocks
at captured heights, retains prior inclusion when later data is unknown, and
keeps both old and new contexts when a transaction moves to another block.
Tip and network checks before and after the read detect inconsistent provider
responses; they do not independently establish chain consensus. These records
do not change transaction status, holdings, refunds, notifications or broadcasts.

`WALLET_CHAIN_FINALITY_POLICIES` is an empty Django settings mapping by default.
No public-testnet finality policy is selected. An explicitly configured policy
is keyed by the recorded identity (`evm:<chain_id>` or `bitcoin:<genesis_hash>`)
and uses `{"mode": "finalized"}` for EVM or
`{"mode": "depth", "depth": <positive integer>}`. Each observation retains its
normalized policy version. EVM finalized blocks must match the canonical block
at their height; depth is derived inclusively from a stable tip. Missing or
invalid policies retain unknown finality. Local fixture depth settings are not
public-testnet acceptance decisions.

Apply `wallets/0019_chain_observations` before starting the new worker. Existing
journals and financial rows remain unchanged; legacy rows without authoritative
journals are not adopted. Only the operator role writes watches and observations;
an account's owner can read their own evidence under RLS. PostgreSQL binds every
watch to its journal, protects claim generations and observation links, and
refuses evidence rewrites, deletion or migration rollback with retained watches.
Preserve this history when investigating reorgs or recovering a stopped worker.

## Receipt attribution

Both EVM receipt consumers require the adapter's normalized integer `status`:
`1` confirms and `0` records a revert. Web3 converts raw JSON-RPC hexadecimal
statuses before these consumers run. A missing status, boolean, float, string
or other unsupported value leaves the transaction and outstanding deductions
unchanged. Wallet confirmation retries the unresolved observation; the platform
monitor checks it again on the next sweep. Bitcoin's adapter reports success
with `confirmed: true` and a positive integer confirmation count. Missing,
unconfirmed or malformed Bitcoin evidence stays unresolved; that adapter does
not report an explicit failure receipt.

Wallet receipt tasks capture the pending transaction's stored fields and the
wallet's account, chain and address before querying the provider. Both the local
submission writer and the history-only writer then lock the wallet and
transaction and compare that captured state with the current rows. A changed
row, a recreated transaction at the same hash or a changed wallet identity
returns `observation_changed` without applying the stale receipt, notifying
users or starting balance repair. The value describes the job result and is not
a persisted transaction status. A pending row can be observed afresh on the
next sweep; a newer terminal decision remains intact. Provider and balance RPC
stay outside these locks. This check establishes which local record a receipt
may affect; it does not establish chain canonicality or finality.

Successful and reverted wallet receipts retain available observed block hash,
height, timestamp and actual native fee. Imported-history receipts use the same
metadata rules without balance or notification effects. An unavailable block
timestamp remains unknown; confirmation never substitutes the current time.
EVM timestamps come from a lookup by the receipt's block hash, and the returned
header must match both that hash and the receipt height. Bitcoin header heights
and times must identify the requested block, and the timestamp lookup must also
return the receipt's captured height. Its transaction receipt requests
`getrawtransaction` verbosity2 and converts the optional BTC-denominated fee to
exact integral satoshis. Missing undo data or an invalid fee leaves the actual
fee unknown; the estimate is retained separately. Transaction-level `height`
fields cannot substitute for a matching block header. These checks follow the
[Ethereum block contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbyhash)
and [Bitcoin Core header contract](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/).
They validate provider metadata consistency, not independent chain truth.

Boolean, negative, fractional and oversized numeric values do not become heights
or fees. Zero is valid. Unavailable or malformed fields preserve existing
evidence for the same block context. If a new observed hash or height differs
from the stored context, including a previously unknown identity, unavailable
fields are cleared so an older block's time
or fee cannot be carried into the new observation. Receipt metadata does not
change signed intent or estimated fees. Missing metadata does not itself change
the existing outcome admission policy; finality depth, canonicality, replacement
discovery and subsequent enrichment of terminal records remain separate work.

The platform monitor fetches each receipt before locking the current transaction
row. It applies an outcome only while the UUID, hash, pending/submitted status,
recorded call and business reference, nonce, gas terms and submission time still
match the captured row. A newer terminal decision or changed submission is
retained; duplicate observations do not rewrite its metadata. When a receipt
supplies `transactionHash`, its bytes or hexadecimal value must match the hash
requested. If that field is absent, the monitor retains the existing assumption
that the configured Base provider answered that requested hash. This is not
proof of canonical inclusion or finality; the record has no chain ID. These
guards cover the generic monitor, not every specialized transaction writer.
Swap transaction types, swap business references and reverse swap associations
are excluded both from selection and from the fresh receipt-write check. Their
[dedicated recovery and legacy hold](swap-settlement.md#legacy-history-hold)
retain outcomes that cannot be attributed to the original settlement context.

`blockchain.tasks.cleanup_failed_transactions` and
`wallets.tasks.confirmation.cleanup_stale_pending_transactions` retain their
names and `timestamp` argument for jobs already queued by older workers. They
only report overdue unresolved row counts; their legacy `cleaned` or `failed`
counts are zero. The callable `blockchain.services.transaction.cleanup_stale_transactions`
also retains its `hours` argument and adds an `overdue` count. None of these
compatibility handlers changes transaction state, balances or reservations,
and neither task has a recurring schedule. Workers must load the updated code
for the schedule and behavior changes to take effect; an old process still
contains the former cleanup implementation.

Operator transactions without a hash remain unresolved. Recovering their
identity, reviewing rows already failed by historical cleanup, and per-chain
finality or reorg policy remain separate work. This change does not reopen
terminal history or infer a compensating balance movement from an old timeout.

## EVM nonce-spend evidence

When a journalled EVM transfer has no usable inclusion evidence, the wallet
observer looks for the transaction that consumed its sender nonce, anchored on
the journal's signed bytes and, where available, its canonical admission block.
A bounded binary search over mined account nonces finds the consuming block; the
reader rebuilds supported legacy, type-1 and type-2 envelopes, checks hash and
recovered signer, and requires a matching canonical block and receipt. The
closing network and head checks and the fresh wallet and transaction claim
checks still apply.

The evidence identifies the original transaction, a matching payload with raised
fee caps, another payload, or a zero-value self-call - whose shape proves neither
cancellation intent nor the absence of contract execution. Revert status is
recorded separately. A nonce can also advance through a delegated-account
authorization, so an increase with no attributable sender transaction stays
unknown. The reader collects evidence only: it admits no replacement, releases
no reservation and settles no wallet.

Each read permits at most 66 distinct nonce queries, 10,000 transactions in the
returned block, 128 KiB of input and 4,096 combined access-list entries and
storage keys. Stored candidate evidence keeps the input's hash and length, not a
second copy of large calldata. Pruned historical state, unsupported envelopes and
inconsistent provider responses stay unknown. This is one provider's internally
consistent evidence, not an independent consensus proof, and the receipt's
execution charge is recorded apart from complete fee accounting - rollup fees
still need the ledger reconciliation in #7. Bitcoin replacement discovery is not
part of this reader.
