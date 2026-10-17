# Wallet protocols

[Engineering](README.md) · [Documentation](../README.md)

The durable contracts behind user-signed wallet transfers, the chain evidence the platform keeps
about them, receipt attribution, wallet history imports and balance repair. For engineers changing
wallet code; the operator response to an unresolved transfer is in
[recovery](../operations/recovery.md#wallet-transfers-and-trading), and what a member can send
from the app is in [wallets and wallet sends](../business/trading.md#wallets-and-wallet-sends).

Contents:

- [Transfer lifecycle](#transfer-lifecycle)
- [EVM transfers](#evm-transfers), including the
  [stablecoin approval check](#stablecoin-approval-check)
- [Bitcoin transfers](#bitcoin-transfers)
- [Wallet chain observations](#wallet-chain-observations)
- [Settling submitted transfers](#settling-submitted-transfers)
- [Receipt attribution](#receipt-attribution)
- [EVM nonce-spend evidence](#evm-nonce-spend-evidence)
- [Balance repair](#balance-repair)
- [History imports and previews](#history-imports-and-previews)

## Transfer lifecycle

Wallet transfer preparation and broadcast support selected native and crypto asset transfers on
allowed test networks. Share classes are refused by these routes; share movement has its own
issuance and trading mechanisms ([why](../business/trading.md#wallets-and-wallet-sends)). The refusal
resolves the destination through the caller's view of the class and then through the global asset
catalogue, so it holds while a class is paused and hidden from non-issuers. A class marked deployed
whose address the factory never attested has no catalogue entry yet; until recovery re-projects the
deployment, only its issuer's view refuses a value-only transaction to it.

EVM clients sign locally or through a hardware-wallet QR exchange. Bitcoin sends are signed with
external tooling; the application does not build or sign Bitcoin transactions. Both backend
submission paths decode the signed bytes and verify their supported intent before recording a
durable journal, and caller-declared recipient, amount and fee do not override signed terms. Base
transfers use ETH for native quantities and gas fees, and Base's chain id for signing.

1. Check the caller's account, wallet identity and verification, network and asset and deployment
   configuration.
2. Decode and validate signed intent. Bitcoin also resolves owned, confirmed previous outputs and
   requires node mempool admission.
3. Commit immutable submission identity, signed bytes, the pending transaction and applicable
   deductions before the first send.
4. Broadcast the stored bytes. A timeout or mismatched acknowledgement leaves the transaction
   unresolved; it does not authorise a fresh nonce or payload.
5. Recovery and confirmation sweeps revisit the journal. Outcome writers verify the requested hash
   and captured local row before applying changes.
6. Balance repair stays independently retryable. Chain observations keep inclusion and finality
   evidence without changing accounting.

Wallet submission journals do not activate the operator's
[outgoing signing foundation](chain.md#outgoing-signing-foundation) and admit no
operator signer. Replacement transactions and a full accounting ledger are not built.

## EVM transfers

User-signed EVM wallet transfers commit a `WalletSubmission` before the first send RPC. Its exact
signed bytes, locally computed hash, signer, chain id, nonce, asset and deployment identity,
recipient, amount, decimals and signed gas cap are frozen with the pending transaction and its
optimistic deduction. The request's declared amount and fee cannot override those signed terms.
Retrying the same bytes reuses the transaction and deduction. Different bytes at a recorded nonce,
and hashes represented only by history or legacy transaction rows, are refused before broadcast. The
submission entry point requires the requesting user's ownership of the wallet and an outermost
transaction boundary, so no caller can roll back the record after sending. The journal covers native
and ERC-20 transfers.

`POST /api/wallets/{uuid}/prepare-transfer/` refuses with 400 a recipient that is not an address on
the wallet's network. It answers an EVM transaction's `value` as a JSON-RPC hex quantity of wei, for
example `"0x8ac7230235dc1c00"` for 9.99999999 ETH and `"0x0"` for a token transfer, so a client never
reads an amount above 2^53 as an approximate JavaScript number; a native amount with more than 18
decimal places is refused with 400 instead of being rounded.

### Stablecoin approval check

Wallets > Send refuses a share class outright. A stablecoin has no company registry to ask, so
`require_stablecoin_approvals` (`backend/wallets/services/transaction_confirmation.py`) checks instead
that the sending wallet and the recipient each hold a live stored company approval for at least one
company: when the transfer is prepared, and again when the signed transfer is submitted, before the
submission is recorded or broadcast. A transfer to the operator's receiving wallet, on the chain it
is configured for, is exempt on both sides, because the stablecoin payment instruction names it and
nothing approves it; an unset receiving wallet, or one on another chain, exempts nothing. The refusal
is 403 `stablecoin_approval_required` and says which side lacks an approval. The recipient's wallet
belongs to another account, so the lookup runs on the operator connection and answers only yes or
no. A submission already recorded is not checked again: a repeated request and the recovery sweep
re-send the bytes the check admitted. Approvals themselves are described under
[whitelist changes](chain.md#whitelist-changes).

### Gas admission

Before reserving a transfer, the wallet validates the signed gas limit against the intrinsic gas
charge for its supported native or ERC-20 payload, including every access-list entry and storage
key, even repeated entries ([EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)). The admission
minimum also includes the calldata floor from [EIP-7623](https://eips.ethereum.org/EIPS/eip-7623),
required even when an older local test node would accept a lower limit. A limit below the minimum is
refused before a journal, deduction or send RPC. Passing this check does not establish that contract
execution will succeed. The signed maximum fee must be positive and the gas limit must fit its
unsigned 64-bit envelope field; a zero priority fee is allowed with a positive fee cap. The decoder
also rejects high-s transaction signatures, as [EIP-2](https://eips.ethereum.org/EIPS/eip-2)
requires, even when ordinary signer recovery would return the wallet address.

### Spend identity and recovery

EVM wallet submissions reserve both `(chain_id, tx_hash)` and `(chain_id, sender_address, nonce)`
across account wallets. Another wallet cannot adopt the recorded spend or create a second deduction
by submitting different terms at that nonce. The requesting account receives a generic conflict
without another account's identity or payload. The original wallet can retry the exact bytes, and
distinct nonces or networks remain separate spends. These constraints cover wallet submissions; the
operator key's nonce allocation belongs to the
[outgoing foundation](chain.md#preparing-signing-and-broadcasting).

A successful response means durable acceptance, not proof of mining. A timeout, provider error or
mismatched acknowledgement leaves the locally derived hash pending. The five-minute
`recover_wallet_submissions` sweep attempts at most 100 pending submissions across EVM and Bitcoin,
least recently attempted first. For EVM it checks the original chain id and exact signed identity
before looking for a receipt. A matching receipt is left to the confirmation sweep; an unresolved
receipt or chain identity does not authorise another send. With no receipt, it resends only the
recorded bytes. Queue failure and a process exit before or after the send do not require
reconstructing intent from client metadata. A terminal transaction is not sent again, and the sweep
neither allocates another nonce nor signs a replacement. Legacy rows are not adopted as submissions.

## Bitcoin transfers

Bitcoin wallet transfers commit a separate `BitcoinSubmission` and every `BitcoinSubmissionInput`
reservation before broadcasting. The local decoder computes the transaction id from the
serialisation without witness data and keeps the full signed serialisation and witness hash. The
endpoint must match both the configured `test` or `regtest` network and its pinned genesis hash.
Every previous output must be available from the confirmed UTXO set, have the wallet's script, and
carry an exact integer number of satoshis. The transfer amount comes from the signed outputs; its fee
is the difference between the verified input values and all signed outputs. Caller amounts and fee
estimates cannot override either value. The node must independently admit the signed transaction
through `testmempoolaccept`, returning the same identities and fee, before the backend records
acceptance.

The supported shape is one external recipient, with optional change back to the same wallet; several
outputs to that recipient are aggregated. Testnet and regtest P2PKH, P2SH and native witness-v0
addresses are supported. Taproot, arbitrary output scripts, several recipients,
self-consolidations, unconfirmed input outputs and inputs belonging to another wallet are refused, as
is Bitcoin token-contract metadata. An existing history row cannot be adopted as a submission, and
different witness bytes at a recorded transaction id cannot replace its stored payload. Network-wide
transaction and outpoint uniqueness prevents a second wallet or account from recording another
deduction for the same spend.

An unknown broadcast result remains a pending local transaction. Recovery checks the recorded
network, signed terms, previous outputs and node admission again, and sends only the stored bytes. A
matching raw transaction and witness hash in the node's mempool resolve a lost acknowledgement
without another send; a mined receipt belongs to the confirmation writer. Unavailable evidence leaves
recovery unresolved. Input reservations are kept after terminal states; there is no replacement or
release policy.

Fresh migrations install the journal and input-reservation guards and the unique transaction and
signer identity constraints. Journal backups contain signed bytes that can be broadcast and need
restricted access; preserve those records and their original evidence through a
[database rebuild](../operations/README.md#rebuild-a-database).

## Wallet chain observations

The five-minute `observe_wallet_chains` task keeps reading durable EVM and Bitcoin wallet journals
after confirmation or failure. Each run checks at most 25 journals, preferring those never checked
and then the least recently started; a start within two minutes is deferred. It records a durable
generation before RPC, then appends normalised evidence only if the entire wallet and transaction
target and the generation still match. A later reader supersedes an abandoned claim, and a delayed
result cannot overwrite that reader's evidence.

`WalletChainObservation` records inclusion, unknown evidence or an orphaned block separately from
whether an explicit finality policy is satisfied. A missing receipt alone cannot establish a reorg.
The observer compares canonical blocks at captured heights, keeps prior inclusion when later data is
unknown, and keeps both old and new contexts when a transaction moves to another block. Tip and
network checks before and after the read detect inconsistent provider responses; they do not
independently establish chain consensus. Recording an observation changes no transaction status,
holding, refund, notification or broadcast; the
[settlement consumer](#settling-submitted-transfers) reads it.

`WALLET_CHAIN_FINALITY_POLICIES` defaults to the approved policies in
`backend/ledova_backend/chain_safety.py`: the finalized head for Base Sepolia and Ethereum Sepolia,
six inclusive confirmations on the Bitcoin test network, and nothing for a local chain or regtest. A
policy is keyed by the recorded identity (`evm:<chain_id>` or `bitcoin:<genesis_hash>`) and is
`{"mode": "finalized"}` for EVM or `{"mode": "depth", "depth": <positive integer>}`.
`LOCAL_CHAIN_FINALITY_DEPTH` adds a depth policy for the configured local chain id only and is refused
for any other chain ([configuration](../operations/configuration.md#chain)). Each observation keeps
its normalised policy version. EVM finalized blocks must match the canonical block at their height;
depth is derived inclusively from a stable tip. Missing or invalid policies keep unknown finality.
Local fixture depth settings are not public-testnet acceptance decisions. Share issuances and swap
settlement use the same evidence collector and policies without a persisted observation
([swap finality](trading-protocols.md#the-finality-consumer)).

Existing journals and financial rows stay unchanged; legacy rows without authoritative journals are
not adopted. Only the operator role writes watches and observations; an account's owner can read
their own evidence under RLS. PostgreSQL binds every watch to its journal, protects claim generations
and observation links, and refuses evidence rewrites, deletion or migration rollback with retained
watches. Preserve this history when investigating reorgs or recovering a stopped worker. Each
transaction's latest observation also travels in its owner's
[account-data export](records.md#account-data-export).

## Settling submitted transfers

Local submitted transfers settle from the immutable chain observations. The observation must match
the journal's network and transaction hash, a canonical receipt block, and the
[approved finality policy](#wallet-chain-observations) for
that network. Legacy attribution remains operator work.

The principal-bearing confirmation task first resolves its scoped wallet and transaction. A bounded
operator step records chain evidence outside financial writes; the consumer then returns to the
captured principal. Under the wallet then transaction locks, it rechecks the observation generation,
full target fingerprint and current policy. Starting a newer observation invalidates an older
consumer even before the newer RPC returns. Missing, orphaned, malformed or unavailable evidence
keeps `pending` and every deduction. A different outcome for the same hash is held for attribution
against its first included observation. Same-outcome reinclusion can settle after its earlier block
is proven orphaned and the new inclusion satisfies policy. Nonce consumption alone cannot refund
funds; replacement admission and synthetic reorg refunds are not supported.

## Receipt attribution

A receipt changes a transaction's status or accounting only when it identifies the requested
transaction. EVM `transactionHash` values may be 32-byte Web3 values or their hexadecimal text.
Bitcoin receipts keep the RPC response's `txid`; they never substitute the requested hash or the
distinct witness transaction hash. Missing, malformed or conflicting identities leave the transaction
pending for retry, including history imports. This follows the
[Ethereum receipt contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)
and [Bitcoin Core transaction contract](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/).
Matching identity alone does not establish finality or canonicality.

Both EVM receipt consumers need the adapter's normalised integer `status`: `1` confirms and `0`
records a revert. Web3 converts raw JSON-RPC hexadecimal statuses before these consumers run. A
missing status, boolean, float, string or other unsupported value leaves the transaction and
outstanding deductions unchanged; wallet confirmation retries the unresolved observation and the
platform monitor checks it again on the next sweep. Bitcoin's adapter reports success with
`confirmed: true` and a positive integer confirmation count. Missing, unconfirmed or malformed
Bitcoin evidence stays unresolved; that adapter reports no explicit failure receipt.

Wallet receipt tasks capture the pending transaction's stored fields and the wallet's account, chain
and address before querying the provider. Both the local submission writer and the history-only
writer then lock the wallet and transaction and compare that captured state with the current rows. A
changed row, a recreated transaction at the same hash or a changed wallet identity returns
`observation_changed` without applying the stale receipt, notifying users or starting balance
repair. The value describes the job result, not a persisted transaction status. A pending row can be
observed afresh on the next sweep; a newer terminal decision stays intact. Provider and balance RPC
stay outside these locks. This check establishes which local record a receipt may affect, not chain
canonicality or finality.

Successful and reverted wallet receipts keep the available observed block hash, height, timestamp
and actual native fee; imported-history receipts use the same metadata rules without balance or
notification effects. An unavailable block timestamp stays unknown; confirmation never substitutes
the current time. EVM timestamps come from a lookup by the receipt's block hash, and the returned
header must match both that hash and the receipt height. Bitcoin header heights and times must
identify the requested block, and the timestamp lookup must also return the receipt's captured
height. Its transaction receipt requests `getrawtransaction` verbosity 2 and converts the optional
BTC-denominated fee to exact integral satoshis; missing undo data or an invalid fee leaves the actual
fee unknown, and the estimate is kept separately. Transaction-level `height` fields cannot substitute
for a matching block header. These checks follow the
[Ethereum block contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbyhash)
and [Bitcoin Core header contract](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/);
they validate provider metadata consistency, not independent chain truth.

Boolean, negative, fractional and oversized numeric values do not become heights or fees; zero is
valid. Unavailable or malformed fields preserve existing evidence for the same block context. If a
new observed hash or height differs from the stored context, including a previously unknown
identity, unavailable fields are cleared so an older block's time or fee cannot be carried into the
new observation. Receipt metadata does not change signed intent or estimated fees, and missing
metadata does not itself change outcome admission.

The platform monitor (`check_pending_transactions`) fetches each receipt before locking the current
transaction row. It applies an outcome only while the UUID, hash, pending or submitted status,
recorded call and business reference, nonce, gas terms and submission time still match the captured
row. A newer terminal decision or changed submission is kept; duplicate observations do not rewrite
its metadata. When a receipt supplies `transactionHash`, its bytes or hexadecimal value must match the
hash requested. If that field is absent, the monitor keeps the assumption that the configured Base
provider answered that requested hash; this is not proof of canonical inclusion or finality, and the
record has no chain id. These guards cover the generic monitor, not every specialised writer: swap
transaction types, swap business references and reverse swap associations are excluded both from
selection and from the fresh receipt-write check, and their
[dedicated recovery](trading-protocols.md#durable-execution) keeps outcomes that
cannot be attributed to the original settlement. No scheduled task marks an old pending transaction
as failed.

Operator transactions without a hash stay unresolved. Recovering their identity, reviewing rows
already failed by historical cleanup, and a per-chain reorg policy for the generic monitor are not
built. Receipt recovery does not reopen terminal history or infer a compensating balance movement
from an old timeout.

## EVM nonce-spend evidence

When a journalled EVM transfer has no usable inclusion evidence, the wallet observer looks for the
transaction that consumed its sender nonce, anchored on the journal's signed bytes and, where
available, its canonical admission block. A bounded binary search over mined account nonces finds the
consuming block; the reader rebuilds supported legacy, type-1 and type-2 envelopes, checks hash and
recovered signer, and requires a matching canonical block and receipt. The closing network and head
checks and the fresh wallet and transaction claim checks still apply.

The evidence identifies the original transaction, a matching payload with raised fee caps, another
payload, or a zero-value self-call, whose shape proves neither cancellation intent nor the absence of
contract execution. Revert status is recorded separately. A nonce can also advance through a
delegated-account authorisation, so an increase with no attributable sender transaction stays
unknown. The reader collects evidence only: it admits no replacement, releases no reservation and
settles no wallet. Swap execution recovery runs the same reader on the relayer's attempt once the
mined nonce has passed it
([durable execution](trading-protocols.md#durable-execution)).

Each read permits at most 66 distinct nonce queries, 10,000 transactions in the returned block, 128
KiB of input and 4,096 combined access-list entries and storage keys
(`backend/wallets/services/nonce_evidence.py`). Stored candidate evidence keeps the input's hash and
length, not a second copy of large calldata. Pruned historical state, unsupported envelopes and
inconsistent provider responses stay unknown. This is one provider's internally consistent evidence,
not an independent consensus proof, and the receipt's execution charge is recorded apart from
complete fee accounting. Bitcoin replacement discovery is not part of this reader.

## Balance repair

Ordinary holding refreshes enforce the owner's conservative availability policy. An affected holding
may decrease but cannot increase while any relevant local transfer remains unresolved. Token amounts
and native fee holdings are affected independently; unrelated holdings can still refresh. Imported
history creates no hold. A capped refresh records its actual held quantity and advances the balance
version, but does not advance the complete-sync generation or report successful repair, so general
wallet sync reports a partial refresh while a cap is active. Incoming funds and unused fee headroom in
that holding can stay unavailable indefinitely while an earlier transfer awaits attribution.

Balance RPCs run outside row locks. Wallet identity and holding balance-version checks discard reads
that overlap a newer debit or wallet change. For journaled wallets, balance reads must still identify
the recorded network before and after RPC; a changed token contract or decimal scale cannot repair
the old transfer. The existing holding and deduction representation is kept; this is not a ledger or
a separate observed and available balance model.

Final outcomes persist `finality_observation` and a balance-reconciliation token with the status and
notification job. No estimated amount or fee is refunded arithmetically. Successful balance repair
releases availability, clears recorded deductions and removes the repair token after rechecking the
transaction target and every returned holding version; a capped or failed read cannot clear that
token. Token and native balances can repair independently, and the transaction's repair stays pending
until both have succeeded without a concurrent change. If the approved policy changes while repair is
unfinished, the task obtains fresh canonical evidence under the new policy. Only an already
attributable terminal outcome can renew its repair authority, and only for the same outcome after
the new policy is satisfied; this replaces the observation link without repeating the notification,
and earlier immutable observations stay in the watch's history. Unknown evidence keeps holding
availability, and legacy rows gain no authority.

A worker interruption or provider outage leaves durable repair work for the five-minute sweep,
including for terminal transactions; a retry cannot enqueue a second lifecycle notification.
Unattributed legacy rows receive no new finality authority: `finality_observation` is a nullable link
that is never backfilled. Legacy pending, reorged or replaced holds and terminal repair tokens
without attributable finality stay conservative until operator attribution; current configuration
cannot supply missing historical provenance.

## History imports and previews

Manual wallet sync returns `success: false` with an actionable `syncResult.error` when verification
is missing, the provider fails, history cannot be read or a known holding cannot be refreshed. Both
clients display that reason. A partial refresh keeps any balances it did read, and leaves the
wallet's last successful sync time unchanged.

Wallet import previews use `POST /api/wallets/batch-check-balances/` with a `chain` (`ethereum`,
`base` or `bitcoin`) and 1 to 20 addresses. The account is the signed-in user's own and is not named
in the request; staff status does not widen it. Addresses need not be registered yet. The response
repeats the account and network and returns `balances[address]` as a decimal string, or `null` when
the provider cannot supply a valid balance; a confirmed zero stays `"0"`. Preview reads create or
update no wallet or holding. Both clients show failed reads as **Unavailable** and discard pending
responses when the network changes. Hardware and software import screens let the user choose
Ethereum or Base for their EVM addresses.

Alchemy transfer history follows each direction's `pageKey` through the final page, with an explicit
newest-first order. Pagination finishes before receipt lookups, because Alchemy cursors expire after
ten minutes. A repeated cursor, unreadable response or continuation beyond 100 pages per direction
fails the sync rather than presenting a truncated history as complete
([Alchemy pagination contract](https://www.alchemy.com/docs/reference/transfers-api-quickstart)).

History imports create rows only for previously unseen `(wallet, hash)` pairs. Repeated or
conflicting observations cannot overwrite an existing row's intent, status, receipt fields or
accounting. The import takes the wallet lock used by pending creation and confirmation before
checking or inserting rows. New history rows start `pending`, whatever the provider's history status,
and the five-minute confirmation sweep obtains a receipt before completing them. Imported rows carry
`imported_from_history`; the origin of rows recorded without it is not inferred. Receipt verification
for marked imports preserves block metadata when the provider cannot supply it and updates available
receipt fields under the wallet and transaction locks. It sends no lifecycle notifications and
changes no holdings, including for quarantined assets, and records no optimistic deduction. The
wallet sync still refreshes current balances and records holdings it finds
([holdings written from the chain](chain.md#holdings-written-from-the-chain)).

A confirmation job whose initial lookup finds no stored transaction returns `not_found` without
contacting the provider or entering a settlement writer. History imported after that lookup stays
pending for a later confirmation job; the earlier job cannot treat it as a locally submitted
transfer. Existing historical rows, including legacy `success` statuses, are preserved; repairing
them, and adopting a locally submitted transfer after history imported its hash first, need operator
attribution. The transaction table holds one row per wallet and hash, so it does not represent
several transfer events within one transaction. Imported history reports receipt outcomes; it does
not apply the finality policy for
[settling submitted transfers](#settling-submitted-transfers).

Next: [contracts and chain](chain.md),
[trading protocols](trading-protocols.md) and
[recovery](../operations/recovery.md).
