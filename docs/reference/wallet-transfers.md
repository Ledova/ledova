# Wallet transfer submissions

[Reference](README.md) · [Documentation](../README.md)

The durable contracts for user-signed EVM transfers and externally signed Bitcoin transactions. Start with the [transfer overview](../architecture/transfers.md).

## EVM

User-signed EVM wallet transfers commit a `WalletSubmission` before the first
send RPC. Its exact signed bytes, locally computed hash, signer, chain ID,
nonce, asset and deployment identity, recipient, amount, decimals and signed gas
cap are frozen with the pending transaction and its optimistic deduction. The
request's declared amount and fee cannot override those signed terms. Retrying
the same bytes reuses the transaction and deduction. Different bytes at a
recorded nonce, and hashes represented only by history or legacy transaction
rows, are refused before broadcast. The submission entry point requires the
requesting user's ownership of the wallet and an outermost transaction boundary so
that no caller can roll back the record after sending. A stablecoin transfer is
also refused, before a journal or send RPC, unless the sending wallet and the
recipient each hold a live approval with at least one company or the recipient
is the operator's receiving wallet on its configured chain; see
[whitelist changes](../architecture/outgoing-signing.md#whitelist-changes). A
retry of recorded bytes is not checked again.

Before reserving a transfer, the wallet validates the signed gas limit against
the intrinsic gas charge for its supported native or ERC-20 payload, including
every access-list entry and storage key, even repeated entries
([EIP-2930](https://eips.ethereum.org/EIPS/eip-2930)). The admission minimum also
includes the calldata floor from
[EIP-7623](https://eips.ethereum.org/EIPS/eip-7623). This floor is required by the
wallet even when an older local test node would accept a lower limit. A limit
below the minimum is refused before a journal, deduction or send RPC. Passing
this check does not establish that contract execution will succeed.
The signed maximum fee must be positive and the gas limit must fit its unsigned
64-bit envelope field. A zero priority fee remains allowed with a positive fee
cap. The decoder also rejects high-s transaction signatures, as required by
[EIP-2](https://eips.ethereum.org/EIPS/eip-2), even when ordinary signer recovery
would return the wallet address.

EVM wallet submissions reserve both `(chain_id, tx_hash)` and
`(chain_id, sender_address, nonce)` across account wallets. Another wallet cannot
adopt the recorded spend or create a second deduction by submitting different
terms at that nonce. The requesting account receives a generic conflict without
another account's identity or payload. The original wallet can retry the exact
bytes, and distinct nonces or networks remain separate spends. These constraints
cover wallet submissions; the operator key's signer allocation belongs to the
[outgoing foundation](../architecture/outgoing-signing.md).

A successful response means durable acceptance, not proof of mining. A timeout,
provider error or mismatched acknowledgement leaves the locally derived hash
pending. The five-minute `recover_wallet_submissions` sweep attempts at most 100
pending submissions across EVM and Bitcoin, starting with the least recently
attempted. For EVM it checks the original chain ID and exact signed identity
before looking for a receipt. A
matching receipt is left to the confirmation sweep; an unresolved receipt or
chain identity does not authorise another send. With no receipt, it resends only
the recorded bytes. Queue failure and a process exit before or after the send do
not require reconstructing intent from client metadata. A terminal transaction
is not sent again. This sweep neither allocates another nonce nor signs a
replacement.

This journal covers native and ERC-20 transfers signed by EVM wallet users.
Legacy adoption, replacement policy, canonicality/finality and a full accounting
ledger remain separate work. It retains the existing generation-fenced
[balance reconciliation](wallet-reconciliation.md) and admits no operator
signer; trading is enabled by default and unaffected by this journal.
`make chain-test` includes real local native/ERC-20 submission and settlement
checks, including a node acknowledgement lost after mining; ordinary tests
separately exercise process exits and concurrent retries on PostgreSQL.

## Bitcoin

Bitcoin wallet transfers commit a separate `BitcoinSubmission` and every
`BitcoinSubmissionInput` reservation before broadcasting. The local decoder
computes the transaction ID from the serialization without witness data and
retains the full signed serialization and witness hash. The endpoint must match
both the configured `test` or `regtest` network and its pinned genesis hash.
Every previous output must be available from the confirmed UTXO set, have the
wallet's script, and carry an exact integer number of satoshis. The transfer
amount comes from the signed outputs; its fee is the difference between the
verified input values and all signed outputs. Caller amounts and fee estimates
cannot override either value. The node must independently admit the signed
transaction through `testmempoolaccept`, returning the same identities and fee,
before the backend records acceptance.

The supported shape is one external recipient, with optional change back to the
same wallet. Multiple outputs to that recipient are aggregated. Testnet/regtest
P2PKH, P2SH and native witness-v0 addresses are supported. Taproot, arbitrary
output scripts, multiple recipients, self-consolidations, unconfirmed input
outputs and inputs belonging to another wallet are refused. The application
still does not build or sign Bitcoin transactions. Bitcoin token-contract
metadata is refused. An existing history row cannot be adopted as a submission,
and different witness bytes at a recorded transaction ID cannot replace its
stored payload. Network-wide transaction and outpoint uniqueness prevents a
second wallet/account from recording another deduction for the same spend.

An unknown broadcast result remains a pending local transaction. Recovery
checks the recorded network, signed terms, previous outputs and node admission
again. It sends only the stored bytes. A matching raw transaction and witness
hash in the node's mempool resolve a lost acknowledgement without another send;
a mined receipt belongs to the confirmation writer. Unavailable evidence leaves
recovery unresolved. Input reservations are retained after terminal states; a
replacement/release policy is separate work.

`python scripts/test-bitcoin-chain.py` exercises this path on PostgreSQL with an
isolated Bitcoin Core 31.1 regtest node, external networking disabled and no
peers. On Linux x86_64 it downloads the official archive and verifies its pinned
SHA256. `BITCOIN_TEST_BINARY` can select an already installed 31.1 daemon, and
`--port` selects a free local RPC port. It uses a temporary data directory and
cookie and stops only its own process. CI runs the same command. The test covers
real signature refusal, mempool acceptance, lost responses, process exits before
and after actual sends, recovery, mining and duplicate confirmation. Notification
and external balance-refresh boundaries are isolated; these tests do not certify
Bitcoin address-history providers, finality, reorg handling or hardware wallets.

## Migration notes

Apply `wallets/0016_wallet_submission` before starting the updated API and worker
processes, and stop old processes before permitting new transfers. Existing
transactions are retained without inferred journal records. PostgreSQL protects
the journal, its wallet identity and its transaction's signed terms against
direct mutation; delivery timestamps can only advance. Related financial rows
cannot be cascade-deleted through these protected links, and reversing the
migration refuses to discard a nonempty journal. Backups of this table contain
signed transactions that can be broadcast and require the same protection as
other signed payloads. Do not clear rows to make a migration reversal succeed.

Apply `wallets/0017_bitcoin_submission` before admitting Bitcoin transfers and
stop old API/worker processes first. Its owner policies protect raw bytes and
input records on the request database role. PostgreSQL freezes the signed terms,
wallet identity and input records, requires every input reservation at commit,
and refuses a populated migration reversal. The Bitcoin journal needs the same
backup protection as the EVM journal.

Apply `wallets/0018_global_submission_identity` with old transfer writers stopped.
If existing EVM journal rows share a chain transaction or signer nonce, migration
stops without rewriting, deleting or choosing an owner for them. Preserve the
records and resolve their ownership/accounting before retrying the migration.
The migration does not infer intent from legacy transaction/history rows.
