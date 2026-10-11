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
that no caller can roll back the record after sending.

`POST /api/wallets/{uuid}/prepare-transfer/` refuses with 400 a recipient that
is not an address on the wallet's network. It answers an EVM transaction's
`value` as a JSON-RPC hex quantity of wei, for example `"0x8ac7230235dc1c00"`
for 9.99999999 ETH and `"0x0"` for a token transfer, so a client never reads an
amount above 2^53 as an approximate JavaScript number; a native amount with
more than 18 decimal places is refused with 400 instead of being rounded.

Wallets > Send refuses a share class outright. A stablecoin sent from
Wallets > Send has no company registry to ask, so
`wallets.services.transaction_confirmation.require_stablecoin_approvals` checks
instead that the sending wallet and the recipient each hold a live stored
approval for at least one company: when the transfer is prepared, and again when
the signed transfer is submitted, before the submission is recorded or
broadcast. A transfer to the operator's receiving wallet, on the chain it is
configured for, is exempt on both sides, because the stablecoin payment
instruction names it and nothing approves it; an unset receiving wallet, or one
on another chain, exempts nothing. The refusal is 403
`stablecoin_approval_required` and says which side lacks an approval. The
recipient's wallet belongs to another account, so the lookup runs on the
operator connection and answers only yes or no. A submission already recorded
is not checked again: a repeated request and the recovery sweep re-send the
bytes the check admitted. Approvals themselves are described under
[whitelist changes](../architecture/outgoing-signing.md#whitelist-changes).

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
signer. The ordinary suite has no chain tests; `make chain-test` is one manual
local EVM contract smoke
([11 October policy](../decisions.md#minimum-tests-and-fresh-migrations)).

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

Fresh migrations install the current journal/input-reservation guards and unique
transaction/signer identity constraints. Journal backups contain signed bytes
that can be broadcast and need restricted access. Preserve those records and
their original evidence under the
[approved rebuild plan](../operations/upgrades.md#fresh-database-rebuild).
