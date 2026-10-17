# Wallet protocols

[Engineering](README.md) · [Documentation](../README.md)

The durable contracts behind user-signed wallet transfers and the chain evidence kept about them,
for engineers changing wallet code. What a member can send is in
[wallets and wallet sends](../business/trading.md#wallets-and-wallet-sends), and the operator
response to an unresolved transfer in [recovery](../operations/recovery.md#wallet-transfers-and-trading).

Contents: [transfer lifecycle](#transfer-lifecycle) · [EVM](#evm-transfers) and
[Bitcoin](#bitcoin-transfers) transfers · [chain observations](#wallet-chain-observations) ·
[settling](#settling-submitted-transfers) · [receipt attribution](#receipt-attribution) ·
[nonce-spend evidence](#evm-nonce-spend-evidence) · [balance repair](#balance-repair) ·
[history imports and previews](#history-imports-and-previews).

## Transfer lifecycle

Preparation and broadcast support selected native and crypto asset transfers on allowed test
networks. Share classes are refused: neither client's Send picker offers an asset of
type `tokenized_security`, so a paused class without readable class details stays excluded, and the
backend refusal resolves the destination through the caller's view of the class and then the global
asset catalogue, so it holds while a class is paused and hidden from non-issuers. A class marked
deployed whose address the factory never attested has no catalogue entry yet; until recovery
re-projects the deployment, only its issuer's view refuses a value-only transaction to it.

The application does not build or sign Bitcoin transactions. Both backend submission paths decode
the signed bytes and verify their supported intent before recording a durable journal; the caller's
declared recipient, amount and fee never override signed terms. Base transfers use ETH for native
quantities and gas, and Base's chain id for signing.

1. Check the caller's account, wallet identity and verification, network and asset and deployment
   configuration.
2. Decode and validate signed intent. Bitcoin also resolves owned, confirmed previous outputs and
   requires node mempool admission.
3. Commit immutable submission identity, signed bytes, the pending transaction and applicable
   deductions before the first send.
4. Broadcast the stored bytes. A timeout or mismatched acknowledgement leaves the transaction
   unresolved; it does not authorise a fresh nonce or payload.
5. Recovery and confirmation sweeps revisit the journal; outcome writers verify the requested hash
   and captured local row before applying changes.
6. Balance repair stays independently retryable. Chain observations keep inclusion and finality
   evidence without changing accounting.

Wallet journals stay outside the operator's
[outgoing signing foundation](chain.md#outgoing-signing-foundation) and admit no operator signer.
Replacement transactions and a full accounting ledger are not built.

## EVM transfers

User-signed EVM transfers, native and ERC-20, commit a `WalletSubmission` before the first send RPC:
the exact signed bytes, locally computed hash, signer, chain id, nonce, asset and deployment
identity, recipient, amount, decimals and signed gas cap, frozen with the pending transaction and its
optimistic deduction. Retrying the same bytes reuses the transaction and deduction. Different bytes
at a recorded nonce, and hashes represented only by history or legacy rows, are refused before
broadcast. The entry point requires the requesting user's ownership of the wallet and an outermost
transaction boundary, so no caller can roll back the record after sending.

`POST /api/wallets/{uuid}/prepare-transfer/` refuses with 400 a recipient that is not an address on
the wallet's network. It answers an EVM transaction's `value` as a JSON-RPC hex quantity of wei (for
example `"0x8ac7230235dc1c00"` for 9.99999999 ETH and `"0x0"` for a token transfer), so a client
never reads an amount above 2^53 as an approximate JavaScript number; a native amount with more than
18 decimal places is refused with 400 rather than rounded.

### Stablecoin approval check

A stablecoin has no company registry to ask, so `require_stablecoin_approvals`
(`backend/wallets/services/transaction_confirmation.py`) checks that the sending wallet and the
recipient each hold a live stored company approval for at least one company, when the transfer is
prepared and again when the signed transfer is submitted, before it is recorded or broadcast. A
transfer to the operator's receiving wallet on its configured chain is exempt on both sides, because
the stablecoin payment instruction names it and nothing approves it; an unset receiving wallet, or
one on another chain, exempts nothing. The refusal is 403 `stablecoin_approval_required` and says
which side lacks an approval. The recipient's wallet belongs to another account, so the lookup runs
on the operator connection and answers only yes or no. A recorded submission is not checked again:
a repeated request and the recovery sweep re-send the bytes the check admitted. Approvals are
described under [whitelist changes](chain.md#whitelist-changes).

### Gas admission

Before reserving a transfer, the wallet validates the signed gas limit against the intrinsic gas of
its supported native or ERC-20 payload, counting every access-list entry and storage key, repeats
included ([EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)), plus the calldata floor from
[EIP-7623](https://eips.ethereum.org/EIPS/eip-7623) even where an older local test node would accept
less. A lower limit is refused before any journal, deduction or send RPC; passing does not establish
that contract execution will succeed. The signed maximum fee must be positive and the gas limit fit
its unsigned 64-bit field; a zero priority fee is allowed with a positive fee cap. The decoder also
rejects high-s signatures, as [EIP-2](https://eips.ethereum.org/EIPS/eip-2) requires, even when
ordinary recovery would return the wallet address.

### Spend identity and recovery

EVM wallet submissions reserve both `(chain_id, tx_hash)` and `(chain_id, sender_address, nonce)`
across account wallets, so another wallet cannot adopt the recorded spend or create a second
deduction with different terms at that nonce; the requesting account receives a generic conflict
without another account's identity or payload. The original wallet can retry the exact bytes, and
distinct nonces or networks remain separate spends. The operator key's nonce allocation belongs to
the [outgoing foundation](chain.md#preparing-signing-and-broadcasting).

A successful response means durable acceptance, not mining; a timeout, provider error or mismatched
acknowledgement leaves the locally derived hash pending. The five-minute `recover_wallet_submissions`
sweep attempts at most 100 pending EVM and Bitcoin submissions, least recently attempted first. For
EVM it checks the original chain id and signed identity before looking for a receipt; a matching
receipt is left to the confirmation sweep, and an unresolved receipt or chain identity authorises no
send. With no receipt, it resends only the recorded bytes, so queue failure or a process exit before
or after the send needs no intent rebuilt from client metadata. A terminal transaction is not sent
again, no nonce is allocated or replacement signed, and legacy rows are not adopted.

## Bitcoin transfers

Bitcoin transfers commit a separate `BitcoinSubmission` and every `BitcoinSubmissionInput`
reservation before broadcasting. The local decoder computes the transaction id from the
serialisation without witness data and keeps the full signed serialisation and witness hash. The
endpoint must match both the configured `test` or `regtest` network and its pinned genesis hash.
Every previous output must be in the confirmed UTXO set, have the wallet's script and carry an exact
integer number of satoshis. The amount comes from the signed outputs and the fee is the verified
input value less all signed outputs, whatever the caller estimates. The node must independently
admit the transaction through `testmempoolaccept`, returning the same identities and fee, before the
backend records acceptance.

The supported shape is one external recipient, with optional change to the same wallet; several
outputs to that recipient are aggregated. Testnet and regtest P2PKH, P2SH and native witness-v0
addresses are supported. Taproot, arbitrary output scripts, several recipients, self-consolidations,
unconfirmed or foreign inputs and Bitcoin token-contract metadata are refused. A history row cannot
be adopted as a submission, and different witness bytes at a recorded transaction id cannot replace
its payload. Network-wide transaction and outpoint uniqueness prevents a second wallet or account
recording another deduction for the same spend.

An unknown broadcast result stays pending. Recovery rechecks the network, signed terms, previous
outputs and node admission and sends only the stored bytes; a matching raw transaction and witness
hash in the node's mempool resolve a lost acknowledgement without a send, a mined receipt belongs to
the confirmation writer, and unavailable evidence leaves recovery unresolved. Input reservations
survive terminal states, with no replacement or release policy.

Fresh migrations install the journal and input-reservation guards and unique transaction and signer
identity constraints. Journal backups hold broadcastable signed bytes, so restrict them and preserve
them with their evidence through a
[database rebuild](../operations/README.md#rebuild-a-database).

## Wallet chain observations

The five-minute `observe_wallet_chains` task keeps reading durable EVM and Bitcoin wallet journals
after confirmation or failure. Each run checks at most 25, preferring those never checked and then
the least recently started, and defers one started within two minutes. It records a durable
generation before RPC and appends normalised evidence only if the whole wallet and transaction target
and the generation still match, so a later reader supersedes an abandoned claim and a delayed result
cannot overwrite its evidence.

`WalletChainObservation` records inclusion, unknown evidence or an orphaned block separately from
whether an explicit finality policy is satisfied. A missing receipt alone cannot establish a reorg.
The observer compares canonical blocks at captured heights, keeps prior inclusion when later data is
unknown, and keeps both contexts when a transaction moves block. Tip and network checks before and
after the read detect inconsistent provider responses, not chain consensus. Recording an observation
changes no status, holding, refund, notification or broadcast; the
[settlement consumer](#settling-submitted-transfers) reads it.

`WALLET_CHAIN_FINALITY_POLICIES` defaults to the approved policies in
`backend/ledova_backend/chain_safety.py`: the finalized head for Base Sepolia and Ethereum Sepolia,
six inclusive confirmations on the Bitcoin test network, and nothing for a local chain or regtest. A
policy is keyed by recorded identity (`evm:<chain_id>` or `bitcoin:<genesis_hash>`) and is
`{"mode": "finalized"}` for EVM or `{"mode": "depth", "depth": <positive integer>}`.
`LOCAL_CHAIN_FINALITY_DEPTH` adds a depth policy for the configured local chain id only and is refused
for any other ([configuration](../operations/configuration.md#chain)); local fixture depths are not
public-testnet acceptance decisions. Each observation keeps its normalised policy version. EVM
finalized blocks must match the canonical block at their height; depth is derived inclusively from a
stable tip; a missing or invalid policy keeps finality unknown. Share issuances and swap settlement
use the same evidence collector and policies without a persisted observation; chain register
openings apply the same policies ([receipts and outcomes](chain.md#receipts-and-outcomes)).

Legacy rows without authoritative journals are not adopted. Only the operator role writes watches
and observations; an account's owner reads their own under RLS. PostgreSQL binds every watch to its
journal, protects claim generations and observation links, and refuses evidence rewrites, deletion
or migration rollback with retained watches. Preserve this history when investigating reorgs or
recovering a stopped worker. Each transaction's latest observation travels in its owner's
[account-data export](records.md#account-data-export).

## Settling submitted transfers

Submitted transfers settle from the immutable observations: an observation must match the journal's
network and hash, a canonical receipt block and the [approved policy](#wallet-chain-observations) for
that network. Legacy attribution remains operator work.

The principal-bearing confirmation task resolves its scoped wallet and transaction; a bounded
operator step records chain evidence outside financial writes, and the consumer returns to the
captured principal. Under the wallet then transaction locks it rechecks the observation generation,
full target fingerprint and current policy; starting a newer observation invalidates an older
consumer even before the newer RPC returns. Missing, orphaned, malformed or unavailable evidence
keeps `pending` and every deduction. A different outcome for the same hash is held for attribution
against its first included observation; a same-outcome reinclusion can settle once its earlier block
is proven orphaned and the new inclusion satisfies policy. Nonce consumption alone cannot refund
funds; replacement admission and synthetic reorg refunds are not supported.

## Receipt attribution

A receipt changes a transaction's status or accounting only when it identifies the requested
transaction. EVM `transactionHash` values may be 32-byte Web3 values or their hexadecimal text;
Bitcoin receipts keep the RPC response's `txid`, never substituting the requested hash or the
distinct witness hash. Missing, malformed or conflicting identities leave the transaction pending
for retry, history imports included, following the
[Ethereum receipt contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gettransactionreceipt)
and
[Bitcoin Core transaction contract](https://bitcoincore.org/en/doc/30.0.0/rpc/rawtransactions/getrawtransaction/).
Matching identity alone does not establish finality or canonicality.

Both EVM receipt consumers need the adapter's normalised integer `status`: `1` confirms and `0`
records a revert (Web3 converts raw hexadecimal statuses first). A missing status, boolean, float,
string or other value leaves the transaction and deductions unchanged; wallet confirmation retries,
and the platform monitor checks again next sweep. Bitcoin's adapter reports success with
`confirmed: true` and a positive integer confirmation count; missing, unconfirmed or malformed
evidence stays unresolved, and it reports no explicit failure receipt.

Wallet receipt tasks capture the pending transaction's stored fields and the wallet's account, chain
and address before querying the provider; the submission and history-only writers then lock wallet
and transaction and compare. A changed row, a transaction recreated at the same hash or a changed
wallet identity returns `observation_changed` (a job result, not a stored status) without applying
the receipt, notifying or starting repair; a pending row is observed afresh next sweep, and a newer
terminal decision stays. Provider and balance RPC stay outside these locks. This decides which local
record a receipt may affect, not canonicality or finality.

Successful and reverted receipts, imported ones included (without balance or notification
effects), keep the observed block hash, height, timestamp and actual native fee. An unavailable
timestamp stays unknown, never the current time. EVM timestamps come from a lookup by the receipt's
block hash, whose header must match that hash and height. Bitcoin header heights and times must
identify the requested block at the receipt's captured height; the receipt requests
`getrawtransaction` verbosity 2 and converts the optional BTC fee to exact integral satoshis, leaving
the actual fee unknown (the estimate is kept apart) without undo data or with an invalid fee.
Transaction-level `height` fields cannot replace a matching block header. These checks follow the
[Ethereum block contract](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getblockbyhash)
and [Bitcoin Core header contract](https://bitcoincore.org/en/doc/30.0.0/rpc/blockchain/getblockheader/)
and validate provider consistency, not independent chain truth.

Boolean, negative, fractional and oversized numbers do not become heights or fees; zero is valid.
Unavailable or malformed fields keep existing evidence for the same block context, but when a new
observed hash or height differs from the stored context (including a previously unknown one),
unavailable fields are cleared so an older block's time or fee cannot carry over. Receipt metadata
does not change signed intent or estimated fees, and missing metadata does not itself change outcome
admission.

The platform monitor (`check_pending_transactions`) fetches each receipt before locking the row and
applies an outcome only while the UUID, hash, pending or submitted status, recorded call and
business reference, nonce, gas terms and submission time still match; a newer terminal decision or
changed submission is kept, and duplicate observations rewrite no metadata. A supplied
`transactionHash` must match the requested hash; when it is absent the monitor assumes the
configured Base provider answered that hash, which proves neither canonical inclusion nor finality,
and the record has no chain id. These guards cover the generic monitor only: swap transaction types,
swap business references and reverse swap associations are excluded from selection and from the
receipt-write check, and their [dedicated recovery](trading-protocols.md#durable-execution) keeps
outcomes it cannot attribute to the original settlement. No scheduled task marks an old pending
transaction as failed.

Operator transactions without a hash stay unresolved. Recovering their identity, reviewing rows
already failed by historical cleanup, and a per-chain reorg policy for the generic monitor are not
built. Receipt recovery does not reopen terminal history or infer a compensating balance movement
from an old timeout.

## EVM nonce-spend evidence

When a journalled EVM transfer has no usable inclusion evidence, the wallet observer looks for the
transaction that consumed its sender nonce, anchored on the journal's signed bytes and, where
available, its canonical admission block. A bounded binary search over mined account nonces finds the
consuming block; the reader rebuilds supported legacy, type-1 and type-2 envelopes, checks hash and
recovered signer, and requires a matching canonical block and receipt, with the usual closing network
and head checks and fresh wallet and transaction claim checks.

The evidence identifies the original transaction, a matching payload with raised fee caps, another
payload, or a zero-value self-call, whose shape proves neither cancellation intent nor the absence of
contract execution; revert status is recorded separately. A nonce can also advance through a
delegated-account authorisation, so an increase with no attributable sender transaction stays
unknown. The reader only collects evidence: it admits no replacement, releases no reservation and
settles no wallet. Swap execution recovery runs it on the relayer's attempt once the mined nonce has
passed it ([durable execution](trading-protocols.md#durable-execution)).

Each read permits at most 66 distinct nonce queries, 10,000 transactions in the returned block, 128
KiB of input and 4,096 combined access-list entries and storage keys
(`backend/wallets/services/nonce_evidence.py`). Stored candidate evidence keeps the input's hash and
length, not a second copy of large calldata. Pruned historical state, unsupported envelopes and
inconsistent provider responses stay unknown. This is one provider's internally consistent evidence,
not a consensus proof, and the receipt's execution charge is recorded apart from complete fee
accounting. Bitcoin replacement discovery is not part of this reader.

## Balance repair

Ordinary holding refreshes enforce the owner's conservative availability policy: an affected holding
may decrease but cannot increase while a relevant local transfer is unresolved. Token amounts and
native fee holdings are affected independently, unrelated holdings still refresh, and imported
history creates no hold. A capped refresh records its held quantity and advances the balance version
but not the complete-sync generation, and reports no successful repair, so wallet sync reports a
partial refresh while a cap is active. Incoming funds and unused fee headroom in that holding can stay
unavailable indefinitely while an earlier transfer awaits attribution.

Balance RPCs run outside row locks, and wallet identity and holding balance-version checks discard
reads that overlap a newer debit or wallet change. For journaled wallets, balance reads must identify
the recorded network before and after RPC; a changed token contract or decimal scale cannot repair
the old transfer. The existing holding and deduction representation is kept; this is not a ledger or
a separate observed and available balance model.

Final outcomes persist `finality_observation` and a balance-reconciliation token with the status and
notification job; no estimated amount or fee is refunded arithmetically. Successful repair releases
availability, clears recorded deductions and removes the token after rechecking the transaction
target and every returned holding version; a capped or failed read cannot. Token and native balances
repair independently, and the transaction's repair stays pending until both succeed without a
concurrent change. If the policy changes mid-repair, the task gets fresh canonical evidence under the
new one, and only an attributable terminal outcome renews its repair authority, for the same outcome
once the new policy is met, replacing the observation link without a second notification; earlier
observations stay in the watch's history. Unknown evidence keeps holding availability.

An interruption or outage leaves durable repair work for the five-minute sweep, terminal
transactions included, and a retry cannot enqueue a second notification. `finality_observation` is a
nullable link never backfilled: unattributed legacy holds and repair tokens gain no finality
authority and stay conservative until operator attribution, which current configuration cannot
supply.

## History imports and previews

Manual wallet sync returns `success: false` with an actionable `syncResult.error`, which both
clients show, when verification is missing, the provider fails, history is unreadable or a known
holding cannot be refreshed; a partial refresh keeps the balances it read and the last successful
sync time.

Import previews use `POST /api/wallets/batch-check-balances/` with a `chain` (`ethereum`, `base` or
`bitcoin`) and 1 to 20 addresses, for the signed-in user's own account (not named in the request,
and not widened by staff status); the addresses need not be registered. The response repeats the
account and network and returns `balances[address]` as a decimal string, or `null` when the provider
cannot supply a valid balance; a confirmed zero stays `"0"`. Previews create or update no wallet or
holding. Both clients show failed reads as **Unavailable** and discard pending responses when the
network changes, and hardware and software import screens let the user choose Ethereum or Base for
EVM addresses.

Alchemy transfer history follows each direction's `pageKey` to the end, newest first, before any
receipt lookup, because cursors expire after ten minutes. A repeated cursor, unreadable response or
more than 100 pages per direction fails the sync rather than presenting a truncated history
([Alchemy pagination contract](https://www.alchemy.com/docs/reference/transfers-api-quickstart)).

History imports create rows only for unseen `(wallet, hash)` pairs, under the wallet lock pending
creation and confirmation use, never overwriting an existing row's intent, status, receipt fields or
accounting. New rows start `pending` whatever the provider says, carry `imported_from_history` (the
origin of rows without it is not inferred), and complete only once the five-minute confirmation sweep
obtains a receipt. That verification keeps block metadata the provider cannot supply and updates
available fields under the wallet and transaction locks, with no notification, holding change
(quarantined assets included) or optimistic deduction; the wallet sync still
[writes the holdings it finds](chain.md#holdings-written-from-the-chain).

A confirmation job whose initial lookup finds no stored transaction returns `not_found` without
contacting the provider or a settlement writer; history imported after that lookup stays pending for
a later job and is never treated as a locally submitted transfer. Existing historical rows, legacy
`success` statuses included, are preserved; repairing them, or adopting a locally submitted transfer
after history imported its hash first, needs operator attribution. The transaction table holds one
row per wallet and hash, so it cannot represent several transfer events in one transaction. Imported
history reports receipt outcomes without the finality policy for
[settling submitted transfers](#settling-submitted-transfers).

Next: [contracts and chain](chain.md), [trading protocols](trading-protocols.md) and
[recovery](../operations/recovery.md).
