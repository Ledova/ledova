# Technical references

[Documentation](../README.md)

Start with the relevant [architecture overview](../architecture/README.md) when
you need context. These documents describe the contracts behind a particular flow.

They describe current implementation, not the future workflows in the accepted
[company-managed register plan](../architecture/company-managed-registers.md).
An operator alias/role, bounded operator transaction or signer in a protocol is
a technical execution boundary; it does not itself establish a Ledova employee's
mandate to make a company's register decision. Existing crypto/payment protocols,
recovery and historical evidence remain in force while company authority and
routine self-service replacements are implemented.

| Contract | Reference |
| --- | --- |
| Native/ERC-20 signed identity and durable recovery | [EVM transfers](evm-transfers.md) |
| Bitcoin signed bytes, input ownership and recovery | [Bitcoin transfers](bitcoin-transfers.md) |
| Receipt attribution, chain observations and nonce evidence | [Transaction evidence](transaction-evidence.md) |
| A person's own data export and the evidence it carries | [Account-data export](account-data-export.md) |
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
