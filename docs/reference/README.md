# Technical references

[Documentation](../README.md)

Start with the relevant [architecture overview](../architecture/README.md) when
you need context. These documents describe the contracts behind a particular flow.

| Contract | Reference |
| --- | --- |
| Native/ERC-20 signed identity and durable recovery | [EVM transfers](evm-transfers.md) |
| Bitcoin signed bytes, input ownership and recovery | [Bitcoin transfers](bitcoin-transfers.md) |
| Receipt attribution, chain observations and nonce evidence | [Transaction evidence](transaction-evidence.md) |
| Create/cancel/modify intent and replay | [Order protocols](order-submissions.md) |
| Captured settlement context and execution | [Swap settlement](swap-settlement.md) |
| The immutable reviewed intent and its freeze map | [Reviewed intent](reviewed-intent.md) |
| Legacy signer inventory and future cutover | [Outgoing history](outgoing-history.md) |
| Android native scanner ownership and instrumentation | [Scanner probe](native-scanner-probe.md) |
| Wallet history and balance effects | [Wallet reconciliation](wallet-reconciliation.md) |
| Moving historical uploads and auditing MIME types | [Private-storage migrations](private-storage-migrations.md) |
| Gate implementation, scope and calibration | [Gate internals](gate-internals.md) |

For an incident or an uncertain transaction outcome, start with the
[operator recovery guide](../operations/recovery.md) before interpreting a protocol.
