# Wallet transfers

[Architecture](README.md) · [Wallets and valuations](wallets-and-valuations.md)

Wallet transfer preparation and broadcast support selected native and crypto
asset transfers on allowed test networks. Share classes are refused by these
routes; share movement has its own issuance and trading mechanisms.

EVM clients sign locally or through a hardware-wallet QR exchange. Bitcoin sends
are signed with external tooling. Both backend submission paths decode signed
bytes and verify their supported intent before recording a durable journal.
Caller-declared recipient, amount and fee do not override signed terms.

## Transfer lifecycle

1. Check the caller's account, wallet identity and verification, network and
   asset/deployment configuration.
2. Decode and validate signed intent. Bitcoin additionally resolves owned,
   confirmed previous outputs and requires node mempool admission.
3. Commit immutable submission identity, signed bytes, the pending transaction
   and applicable deductions before the first send.
4. Broadcast the stored bytes. A timeout or mismatched acknowledgement leaves
   the transaction unresolved; it does not authorize a fresh nonce or payload.
5. Recovery and confirmation sweeps revisit the journal. Outcome writers verify
   the requested hash and captured local row before applying changes.
6. Balance reconciliation remains independently retryable. Chain observations
   preserve inclusion/finality evidence without changing accounting.

| Detail needed | Reference |
| --- | --- |
| EVM gas bounds, global nonce/hash identity and exact-byte retry | [EVM transfers](../reference/evm-transfers.md) |
| Supported Bitcoin scripts, input reservations and recovery | [Bitcoin transfers](../reference/bitcoin-transfers.md) |
| Confirmation, reorg observations and nonce-spend evidence | [Transaction evidence](../reference/transaction-evidence.md) |
| An unresolved transfer or worker | [Recovery guide](../operations/recovery.md) |

The separate [outgoing signing foundation](outgoing-signing.md) is not activated
by wallet submission journals. Global operator signer cutover, replacement and
full accounting/finality policy remain distinct hardening work.
