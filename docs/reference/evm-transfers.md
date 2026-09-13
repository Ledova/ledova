# EVM transfer submissions

[Reference](README.md) · [Documentation](../README.md)

The durable contract for user-signed native and ERC-20 transfers. Start with the [transfer overview](../architecture/transfers.md).

User-signed EVM wallet transfers commit a `WalletSubmission` before the first
send RPC. Its exact signed bytes, locally computed hash, signer, chain ID,
nonce, asset and deployment identity, recipient, amount, decimals and signed gas
cap are frozen with the pending transaction and its optimistic deduction. The
request's declared amount and fee cannot override those signed terms. Retrying
the same bytes reuses the transaction and deduction. Different bytes at a
recorded nonce, and hashes represented only by history or legacy transaction
rows, are refused before broadcast. The submission entry point requires the
requesting user's ownership of the wallet and an outermost transaction boundary so
that no caller can roll back the record after sending.

Before reserving a transfer, the wallet validates the signed gas limit against
the intrinsic gas charge for its supported native or ERC20 payload, including
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
cover wallet submissions; operator signer allocation and writer cutover remain
part of the separate operation-identity work.

Apply `wallets/0018_global_submission_identity` with old transfer writers stopped.
If existing EVM journal rows share a chain transaction or signer nonce, migration
stops without rewriting, deleting or choosing an owner for them. Preserve the
records and resolve their ownership/accounting before retrying the migration.
The migration does not infer intent from legacy transaction/history rows.

A successful response means durable acceptance, not proof of mining. A timeout,
provider error or mismatched acknowledgement leaves the locally derived hash
pending. The five-minute `recover_wallet_submissions` sweep attempts at most 100
pending submissions across EVM and Bitcoin, starting with the least recently
attempted. For EVM it checks the original chain ID and exact signed identity
before looking for a receipt. A
matching receipt is left to the confirmation sweep; an unresolved receipt or
chain identity does not authorize another send. With no receipt, it resends only
the recorded bytes. Queue failure and a process exit before or after the send do
not require reconstructing intent from client metadata. A terminal transaction
is not sent again. This sweep neither allocates another nonce nor signs a
replacement.

Apply `wallets/0016_wallet_submission` before starting the updated API and worker
processes, and stop old processes before permitting new transfers. Existing
transactions are retained without inferred journal records. PostgreSQL protects
the journal, its wallet identity and its transaction's signed terms against
direct mutation; delivery timestamps can only advance. Related financial rows
cannot be cascade-deleted through these protected links, and reversing the
migration refuses to discard a nonempty journal. Backups of this table contain
signed transactions that can be broadcast and require the same protection as
other signed payloads. Do not clear rows to make a migration reversal succeed.

This journal covers native and ERC20 transfers signed by EVM wallet users.
Legacy adoption, replacement policy, canonicality/finality and a full accounting
ledger remain separate work. It retains the existing
generation-fenced balance reconciliation and does not activate operator signers
or disabled trading routes. `make chain-test` includes real local native/ERC20
submission and settlement checks, including a node acknowledgement lost after
mining; ordinary tests separately exercise process exits and concurrent retries
on PostgreSQL.
