# Technical references

[Documentation](../README.md)

Start with the relevant [architecture overview](../architecture/README.md) when
you need context. These documents describe the contracts behind a particular
flow as currently implemented; [company authority](../development/standards.md#company-authority)
states the boundary between technical execution and a company mandate.

| Contract | Reference |
| --- | --- |
| EVM and Bitcoin signed identity, input ownership and durable recovery | [Wallet transfers](wallet-transfers.md) |
| Receipt attribution, chain observations, finality policies and nonce evidence | [Transaction evidence](transaction-evidence.md) |
| A person's own data export and the evidence it carries | [Account-data export](account-data-export.md) |
| Create/cancel/modify intent and replay | [Order protocols](order-submissions.md) |
| Captured settlement context, execution and the PostgreSQL freeze map | [Swap settlement](swap-settlement.md) |
| Wallet history and balance effects | [Wallet reconciliation](wallet-reconciliation.md) |

The legacy signer inventory is in [outgoing signing](../architecture/outgoing-signing.md#legacy-inventory)
and upload repair in [uploads](../operations/uploads.md#repairing-stray-uploads-and-checking-mime-types).

For an incident or an uncertain transaction outcome, start with the
[operator recovery guide](../operations/recovery.md) before interpreting a protocol.
