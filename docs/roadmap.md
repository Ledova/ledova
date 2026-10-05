# Roadmap

[Documentation](README.md) · [Current capabilities](product.md)

This page orients the remaining work; the
[open issues](https://github.com/Ledova/ledova/issues) are the working list. The
[product alignment programme](https://github.com/Ledova/ledova/issues/645) and its
phase issues record how the shipped work was built.

The accepted direction of 3 October 2026 is one registry product for companies
and their shareholders, including private self-hosting of the same software.
Companies make issuer decisions and manage their member registers. The owner
clarified the [product priorities on 5 October 2026](decisions.md#registry-priority-crypto-on-ramp-and-aud-payments):
share issuance, management, transfers and purchases are core; crypto on-ramp
purchases are optional personal investor activity, and companies must not use
the on-ramp to buy cryptocurrency. Ledova operates infrastructure and separately
scoped payment services. Company share-wallet operations remain distinct. The
[company-managed register plan](architecture/company-managed-registers.md)
defines this direction and the transition from the current staff-gated workflows.
The [GitHub programme #860](https://github.com/Ledova/ledova/issues/860) and
[implementation index](plans/company-managed-registers/README.md) track its 13
increments, dependencies and verification. The
[documentation audit](plans/company-managed-registers/documentation-audit.md)
records alignment of the complete baseline document set.

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
- Company-scoped on-chain approvals with expiry
  ([#648](https://github.com/Ledova/ledova/issues/648),
  [product §5](product.md#5-verification-and-transaction-controls)).
- Shareholder administration ([#649](https://github.com/Ledova/ledova/issues/649)):
  documents, resolutions and dividends published to each class's members
  ([shareholder publications](architecture/shareholder-publications.md)).
- Reporting and portability ([#650](https://github.com/Ledova/ledova/issues/650)):
  the [company pack](architecture/company-pack.md) carries the company, its
  registers, the approvals and history behind them, each class's chain evidence
  and settlements, its documents, its publications with each resolution's result
  and each dividend's payment records, and its contract information, and the
  [account-data export](reference/account-data-export.md) carries every
  transaction.
- [The signed-in app](https://github.com/Ledova/ledova/issues/732) rebuilt around
  the register, on the web and in the mobile app, as
  [decided](decisions.md#the-signed-in-app).
- Shared API types generated from the committed OpenAPI snapshot
  ([decisions](decisions.md#clients-and-api-types)).

Phase 0 verification and the bounded cross-account matcher are recorded in
[#646](https://github.com/Ledova/ledova/issues/646). The owner accepted the
[experimental limits](architecture/trading.md#accepted-experimental-limits).

## Remaining work

### Priority: company-managed registers

This is accepted target scope; the current company owner account and staff admin
do not yet provide these delegated company workflows. Preserve their existing
controls. Follow the plan's [canonical delivery sequence](architecture/company-managed-registers.md#delivery-sequence)
for dependencies; the priorities below group that work by theme:

- **Company authority and roles.** Give individual company users explicit
   membership, decision and administration permissions, invitations, delegation
   and revocation. Record who can approve each issuer action and the authority
   supporting it. Separate those roles from infrastructure support, technical
   signing and crypto/payment operations, preserving company isolation.
- **Company and shareholder relationship.** Provide company-managed member
   records and shareholder access to their own particulars, evidence, requests
   and permitted documents. Let the company review changes and retain their
   history, including authority and consent where the workflow requires them.
- **Company-directed register actions.** Move openings, imports, member-wallet
   links, issue and transfer instructions, and corrections into company-scoped
   proposal and approval workflows. Automate validation, execution and recovery
   after company approval; retain append-only entries, current authority checks,
   evidence fingerprints, idempotency, reconciliation and isolation. Routine
   register work must not depend on Ledova staff making issuer decisions.
- **Primary issues and company payment evidence.** Replace routine staff offering
   and subscription decisions with company workflows, configured checks and
   exact company-authorised issue/allotment instructions. Companies or their
   payment providers receive primary payments; preserve old instruction snapshots
   and separate platform market deposit/settlement work. AUD must be a valid
   share-payment option, not just pricing or AUDY.
   [#868](https://github.com/Ledova/ledova/issues/868) owns primary payment work;
   [#869](https://github.com/Ledova/ledova/issues/869) owns secondary payment and
   settlement work. Rail/provider, verification, reconciliation, refund and
   secondary settlement choices remain undecided; share purchases must not require
   a crypto on-ramp purchase or conversion. Support employee grants
   and other supported non-paid issues without manufacturing a payment receipt.
- **Certificates and register outputs.** Give authorised company users the
   workflows for certificates, inspection copies, notice figures and company
   exports, with scoped shareholder requests and access. Preserve the register
   sequence, evidence, issuance history and output audit trail behind each
   document. Staff-prepared outputs are the current foundation, not the completed
   self-service experience.
- **ASIC reporting preparation.** Prepare reviewable information and change
   records from company-approved register events, identify supported reporting
   cases, and track the company's review and submission status. Establish the
   necessary forms, authority and integration before implementing lodgement.
   Automatic ASIC filing is not an existing or promised capability.

Verify each stage against company authority, shareholder privacy, withdrawn
permissions, changed evidence, duplicate actions and technical recovery. Company
decisions remain company decisions when a background job executes them; support
and crypto/payment roles must not gain register authority through automation.

### Other follow-ups

- Restrict optional crypto on-ramp purchases to personal investor use and refuse
  company use on both clients and the API
  ([#920](https://github.com/Ledova/ledova/issues/920)). The current exposure is
  an implementation gap; the policy does not itself close it. This feature is
  secondary to the registry and share workflows.
- Phase 1 follow-up: tokenising a share class an import opened,
  [built when one first needs to go on chain](https://github.com/Ledova/ledova/issues/647#issuecomment-5772293439).
- Splits and consolidations are
  [designed but not built](architecture/splits-and-consolidations.md); their
  implementation is a later issue.
- Payment-provider selection and settlement automation when scheduled
  ([the payment decision](decisions.md#payments-and-settlement)).
- Release checks on physical wallets and devices
  ([#624](https://github.com/Ledova/ledova/issues/624)). The closed
  [iOS preparation issue](https://github.com/Ledova/ledova/issues/779) records
  the earlier preparation, not completion of those physical acceptance checks.

## Not on the roadmap

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. Current register access is per
share class for its issuer and the operator; the priority work above adds scoped
company roles and permitted shareholder access, rather than a public investor
directory. The [legal positions](legal/positions.md) record the unresolved
conditions before any real-world use.
