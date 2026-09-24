# Roadmap

[Documentation](README.md) · [Current capabilities](product.md)

This page orients the remaining work; the detail lives in the
[product alignment programme](https://github.com/Ledova/ledova/issues/645) and
its phase issues, and the [open issues](https://github.com/Ledova/ledova/issues)
are the working list. Phase labels are milestones, not dates.

## Shipped

- Issuance on chain: share-class deployment, whitelisted recipients, authorized
  caps and recovery of interrupted requests
  ([contracts and issuance](architecture/contracts-and-issuance.md),
  [operator recovery](operations/recovery.md)).
- The investor directory, offerings, subscriptions, recorded payments and
  allotment, current/former register views, private uploads and the operator
  console ([product boundaries](product.md#current-capability-boundaries)).
- Eligibility readers and the authoritative stored register
  ([#647](https://github.com/Ledova/ledova/issues/647)): an append-only event log
  and holdings served with the chain unreachable and reconciled with it; reviewed
  openings, imports and corrections; issues and transfers entered only on a
  director's reviewed instruction; retained former members; and staff-prepared
  inspection copies, certificates and notice figures, with a list of those due
  ([eligibility](architecture/companies-and-eligibility.md),
  [the register](architecture/register.md)).
- The secondary market: order, matching and settlement code, its recovery
  journeys proven end to end
  ([#5](https://github.com/Ledova/ledova/issues/5)), and trading enabled by
  default.
- Shared API types generated from the committed OpenAPI snapshot
  ([decisions](decisions.md#clients-and-api-types)).

Phase 0 verification and the bounded cross-account matcher are recorded in
[#646](https://github.com/Ledova/ledova/issues/646). The owner accepted the
[experimental limits](architecture/trading.md#accepted-experimental-limits).

## Remaining work

- Phase 1 follow-up: tokenising a share class an import opened,
  [built when one first needs to go on chain](https://github.com/Ledova/ledova/issues/647#issuecomment-5772293439).
- [Phase 2](https://github.com/Ledova/ledova/issues/648): company-scoped
  on-chain approvals with expiry ([product §5](product.md#5-verification-and-transaction-controls)).
- [Phase 3](https://github.com/Ledova/ledova/issues/649): shareholder
  administration — documents, voting, corporate actions. Splits and
  consolidations are
  [designed but not built](architecture/splits-and-consolidations.md); their
  implementation is a later issue.
- [Phase 4](https://github.com/Ledova/ledova/issues/650): reporting and the
  portability pack. The [company pack](architecture/company-pack.md) carries the
  company, its registers, the approvals and history behind them and its
  contract information, and the
  [account-data export](reference/account-data-export.md) carries every
  transaction; chain evidence, documents and publications remain.
- Payment-provider selection and settlement automation when scheduled
  ([the payment decision](decisions.md#payments-and-settlement)); the mobile
  investor directory and subscription flow.

## Not on the roadmap

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. Register access remains per
share class for its issuer and the operator. The [legal positions](legal/positions.md)
record the unresolved conditions before any real-world use.

## Open questions

- Should `NotificationPreferences` fold into `UserPreferences` with the next
  settings-screen change?
