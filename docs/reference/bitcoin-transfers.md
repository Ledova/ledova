# Bitcoin transfer submissions

[Reference](README.md) · [Documentation](../README.md)

The durable contract for externally signed Bitcoin transactions. Start with the [transfer overview](../architecture/transfers.md).

Bitcoin wallet transfers now commit a separate `BitcoinSubmission` and every
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

Apply `wallets/0017_bitcoin_submission` before admitting Bitcoin transfers and
stop old API/worker processes first. Its owner policies protect raw bytes and
input records on the request database role. PostgreSQL freezes the signed terms,
wallet identity and input records, requires every input reservation at commit,
and refuses a populated migration reversal. The Bitcoin journal needs the same
backup protection as the EVM journal. An unknown broadcast result remains a
pending local transaction. Recovery checks the recorded network, signed terms,
previous outputs and node admission again. It sends only the stored bytes. A
matching raw transaction and witness hash in the node's mempool resolve a lost
acknowledgement without another send; a mined receipt belongs to the confirmation
writer. Unavailable evidence leaves recovery unresolved. Input reservations are
retained after terminal states; a replacement/release policy is separate work.

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
