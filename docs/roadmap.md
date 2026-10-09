# Roadmap

[Documentation](README.md) · [Current capabilities](product.md)

This page orients the remaining work; the
[open issues](https://github.com/Ledova/ledova/issues) are the working list. The
[product alignment programme](https://github.com/Ledova/ledova/issues/645) and its
phase issues record how the shipped work was built.

The accepted direction is one private-company registry for companies and their
shareholders, including private hosting of the same software. Companies make
issuer decisions; Ledova records ownership and supplies bounded tools.
The [9 October owner decision](decisions.md#essential-registry-and-development-workflow-priority)
puts CI simplification first, then employee award/vesting records, external
investor capital and allotments, ownership, member access and basic outputs.
It supersedes immediate payment and marketplace expansion. Companies remain
prohibited from buying cryptocurrency through the optional investor on-ramp.

[Programme #860](https://github.com/Ledova/ledova/issues/860) and the
[implementation index](plans/company-managed-registers/README.md) own the revised
scope, current claims and dependencies. Reuse these issues rather than creating
a parallel backlog. The [accepted plan](architecture/company-managed-registers.md)
and [baseline documentation audit](plans/company-managed-registers/documentation-audit.md)
retain the transition and delivered history.

## Shipped

- Issuance on chain: [company-authorised empty share-class deployment](plans/company-managed-registers/company-deployments.md),
  whitelisted recipients, authorized
  caps and recovery of interrupted requests
  ([contracts and issuance](architecture/contracts-and-issuance.md),
  [operator recovery](operations/recovery.md)).
- The investor directory, offerings, subscriptions, recorded payments and
  allotment, current/former register views, private uploads and the operator
  console ([product boundaries](product.md#current-capability-boundaries)).
- Eligibility readers and the authoritative stored register
  ([#647](https://github.com/Ledova/ledova/issues/647)): an append-only event log
  and holdings served with the chain unreachable and reconciled with it; reviewed
  company-run openings, imports and corrections; [non-paid walletless grants](plans/company-managed-registers/register-grants.md)
  and [direct transfers](plans/company-managed-registers/register-transfers.md);
  company-authorised non-paid chain issues, with retained former members; and staff-prepared
  inspection copies, certificates and notice figures, with a list of those due
  ([eligibility](architecture/companies-and-eligibility.md),
  [the register](architecture/register.md)).
- The secondary market: order, matching and settlement code, its recovery
  journeys proven end to end
  ([#5](https://github.com/Ledova/ledova/issues/5)), and trading enabled by
  default.
- Company-scoped on-chain approvals with expiry and the bounded
  [participant nomination/company instruction workflow](plans/company-managed-registers/company-wallet-approvals.md),
  preserving original signed recovery and technical removal causes
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

### First: simplify development and CI

[#943](https://github.com/Ledova/ledova/issues/943) is ready independently of #867.
Measure the slow test work, improve scheduling and simplify proven duplicate
coverage or setup. Avoid repeated full local runs during development. Keep
focused meaningful checks, applicable green CI on current main and independent
review at the merging head. The first timing increment does not establish all
proposed routing or verification tiers as delivered.

### Next: finish the essential register

- **Employee awards and vesting records.** Keep the delivered non-paid grants
  and add records for the company's existing award agreement and schedule.
  Distinguish contractual entitlements from issued shares, and record actual
  company-confirmed vesting/allotment events. Current grants are outright;
  structured vesting is not delivered. No employee-payment requirement or
  legal/tax rule engine is selected.
- **External investor capital and allotments (#868).** Record the company's
  investment agreement, genuine external capital evidence and exact approved
  allotment. Keep commitment, receipt and actual share ownership distinct.
  Company-managed off-chain investor allotment remains a gap; do not substitute
  a non-paid grant or require a new payment integration.
- **Member records and access (#866).** Finish permitted own-record access and
  particulars requests, with one account-to-member association. Its access
  policy remains an owner decision. Preserve privacy, company review and history.
- **Ownership and company authority.** Build on delivered appointments, register
  imports, corrections, non-paid issues/transfers and current #867 increments.
  Keep exact quantities, genuine evidence, revoked-authority refusal and
  original execution recovery. Wallets are needed only for chosen chain actions.
- **Basic outputs (#871).** Supply company-authorised certificates, inspection
  copies and exports with exact register provenance. These outputs no longer
  wait for deferred trading, governance or filing work.
- **Core acceptance (#873).** Record the essential web/mobile company/member
  journey and preserved migration evidence. Its completion no longer waits for
  #869, #870 or #872. Keep earlier journey artifacts and the separate genuine
  human release checks under #624.

### Deferred expansion

- Integrated AUD collection, payment automation, reconciliation, refunds and
  secondary settlement (#869). Recording genuine AUD capital evidence is still
  part of the essential investor record. Future payment mechanics remain an
  owner decision; existing instructions, receipts and recovery stay intact.
- New marketplace/trading work (#869), advanced publications, voting and
  distributions (#870), and filing preparation/submission workflows (#872).
  The existing governed functionality is retained; its expansion is not a core
  register completion requirement.
- Tokenising an imported register and splits/consolidations. A later mirror
  must preserve existing supply rather than issue those shares again.
- Optional personal investor crypto purchases. Preserve
  [#920](https://github.com/Ledova/ledova/issues/920)'s role and provider-lifetime
  guards; companies cannot purchase cryptocurrency through that integration.

Deferred work is not cancelled or implicitly delivered. Existing payment,
chain, authority, privacy and retention safeguards remain effective. Scope
changes must preserve pending execution, genuine evidence and historical records.

## Not on the roadmap

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. Current register reads are available to the company owner and current company
appointees with administration or register capabilities; permitted member access
remains #866 work. This is not a public investor directory.
The [legal positions](legal/positions.md) record the unresolved
conditions before any real-world use.
