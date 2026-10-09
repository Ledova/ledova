# Technical references

[Documentation](../README.md)

Start with the relevant [architecture overview](../architecture/README.md) when
you need context. These documents describe the contracts behind a particular flow.

They describe current implementation. Most routine self-service replacements in
the accepted [company-managed register plan](../architecture/company-managed-registers.md)
are delivered; the operator role, a bounded operator transaction or the
operator key in a protocol is a technical execution boundary, not a company
mandate, and the existing crypto/payment protocols, recovery and historical
evidence remain in force.

| Contract | Reference |
| --- | --- |
| EVM and Bitcoin signed identity, input ownership and durable recovery | [Wallet transfers](wallet-transfers.md) |
| Receipt attribution, chain observations, finality policies and nonce evidence | [Transaction evidence](transaction-evidence.md) |
| A person's own data export and the evidence it carries | [Account-data export](account-data-export.md) |
| Create/cancel/modify intent and replay | [Order protocols](order-submissions.md) |
| Captured settlement context, execution and the PostgreSQL freeze map | [Swap settlement](swap-settlement.md) |
| Legacy signer inventory and cutover holds | [Outgoing history](outgoing-history.md) |
| Wallet history and balance effects | [Wallet reconciliation](wallet-reconciliation.md) |
| Moving historical uploads and auditing MIME types | [Private-storage migrations](private-storage-migrations.md) |

Gate implementation notes are in [gates](../development/gates.md), and the
Android scanner's instrumentation in
[native probes](../development/native-probes.md#android-scanner-instrumentation).

For an incident or an uncertain transaction outcome, start with the
[operator recovery guide](../operations/recovery.md) before interpreting a protocol.
