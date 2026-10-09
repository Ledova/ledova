# Roadmap

[Documentation](README.md) · [Current capabilities](product.md)

This page orients the remaining work; the
[open issues](https://github.com/Ledova/ledova/issues) are the working list.
[Programme #860](https://github.com/Ledova/ledova/issues/860) and the
[implementation index](plans/company-managed-registers/README.md) carry the
current claims and dependencies; the
[9 October decision](decisions.md#essential-registry-and-development-workflow-priority)
sets the order below. Reuse these issues rather than creating a parallel backlog.

## Shipped

The company-managed register foundation, delivered under #860:

- One registry product ([#861](https://github.com/Ledova/ledova/issues/861)):
  the product modes are retired.
- Company authority ([#862](https://github.com/Ledova/ledova/issues/862)):
  [self-declaration admission, invitations, scoped delegation and revocation](plans/company-managed-registers/authority-requests.md)
  and [company information and documents](plans/company-managed-registers/company-information.md).
- Activation and participant eligibility ([#863](https://github.com/Ledova/ledova/issues/863)):
  [company activation](plans/company-managed-registers/company-activation.md)
  and [company eligibility decisions](plans/company-managed-registers/company-eligibility.md),
  which replaced staff classification review.
- Register commands ([#864](https://github.com/Ledova/ledova/issues/864)):
  register reads by appointment, imports, corrections, reconciliation
  acknowledgement, openings from the chain, member particulars changes and
  member-wallet links, in the API and both clients
  ([stored register runbook](operations/register-foundation.md)).
- Non-paid [register grants](plans/company-managed-registers/register-grants.md)
  and [transfers](plans/company-managed-registers/register-transfers.md) with
  cessation history ([#865](https://github.com/Ledova/ledova/issues/865)).
- Company-authorised chain actions ([#867](https://github.com/Ledova/ledova/issues/867),
  six increments): [empty deployments](plans/company-managed-registers/company-deployments.md),
  [wallet nominations and instructions](plans/company-managed-registers/company-wallet-approvals.md),
  [non-paid chain grants](plans/company-managed-registers/company-register-issues.md),
  [capital increases](plans/company-managed-registers/company-capital-increases.md),
  [pause and unpause](plans/company-managed-registers/company-pause-changes.md)
  and [paid issues over recorded subscriptions](plans/company-managed-registers/company-paid-issues.md).
- Members editing their own [name and address in Profile](plans/company-managed-registers/member-profile.md)
  ([#866](https://github.com/Ledova/ledova/issues/866), first increment).
- The first [#943](https://github.com/Ledova/ledova/issues/943) increment:
  the registry workflow runs first in CI and test timings are captured.

Earlier platform work, recorded in the
[product alignment programme](https://github.com/Ledova/ledova/issues/645) and
its phase issues:

- Issuance on chain: whitelisted recipients, authorised caps and recovery of
  interrupted requests ([contracts and issuance](architecture/contracts-and-issuance.md),
  [operator recovery](operations/recovery.md)).
- The investor directory, offerings, applications, recorded payments and
  allotment, private uploads and the operator console. Offering review and
  payment confirmation remain platform-staff actions
  ([capability boundaries](product.md#current-capability-boundaries)).
- The authoritative stored register ([#647](https://github.com/Ledova/ledova/issues/647)):
  an append-only event log and holdings served with the chain unreachable and
  reconciled with it, retained former members, and staff-prepared inspection
  copies, certificates and notice figures with a list of those due
  ([the register](architecture/register.md)).
- The secondary market: order, matching and settlement code, its recovery
  journeys proven end to end ([#5](https://github.com/Ledova/ledova/issues/5)),
  trading enabled by default, and the accepted
  [experimental limits](architecture/trading.md#accepted-experimental-limits)
  ([#646](https://github.com/Ledova/ledova/issues/646)).
- Company-scoped on-chain approvals with expiry
  ([#648](https://github.com/Ledova/ledova/issues/648),
  [product §5](product.md#5-verification-and-transaction-controls)).
- Shareholder publications ([#649](https://github.com/Ledova/ledova/issues/649)):
  documents, resolutions and dividends published to each class's members by
  platform staff on the company's instruction
  ([shareholder publications](architecture/shareholder-publications.md)).
- Reporting and portability ([#650](https://github.com/Ledova/ledova/issues/650)):
  the staff-produced [company pack](architecture/company-pack.md) and the
  [account-data export](reference/account-data-export.md).
- [The signed-in app](https://github.com/Ledova/ledova/issues/732) rebuilt around
  the register, on the web and in the mobile app, as
  [decided](decisions.md#the-signed-in-app), and shared API types generated from
  the committed OpenAPI snapshot ([decisions](decisions.md#clients-and-api-types)).

## Remaining work

### First: simplify development and CI

[#943](https://github.com/Ledova/ledova/issues/943) continues: measure the slow
test work, improve scheduling and simplify proven duplicate coverage or setup,
keeping meaningful checks, green CI on current main and independent review at
the merging head.

### Next: finish the essential register

- **Employee awards and vesting records (#867).** Record the award as a promised
  entitlement with its agreement and vesting events; shares reach the register
  only through a separate company-approved non-paid grant
  ([10 October first scope](decisions.md#first-scopes-for-employee-awards-and-external-capital)).
- **External investor capital and allotments ([#868](https://github.com/Ledova/ledova/issues/868)).**
  Record the agreement, the company's receipt attestation and the exact
  fully paid allotment as distinct records, including on walletless,
  non-tokenised registers; partly paid allotments are deferred
  ([10 October first scope](decisions.md#first-scopes-for-employee-awards-and-external-capital)).
- **Member records and access ([#866](https://github.com/Ledova/ledova/issues/866)).**
  One company-controlled account-to-member association, own holdings and
  history, company-reviewed particulars requests and certificate request
  status, fulfilled through #871. The invitation and binding policy is still an
  owner decision.
- **Basic outputs ([#871](https://github.com/Ledova/ledova/issues/871)).**
  Register exports, inspection copies, certificates and the company pack
  prepared through company appointments with exact register provenance, and
  permitted member access once #866's association lands. Inspection copies came
  first ([PR #954](https://github.com/Ledova/ledova/pull/954)).
- **Core acceptance ([#873](https://github.com/Ledova/ledova/issues/873)).**
  Once those essential increments land, record the web/mobile company and
  member journey with zero routine platform-staff actions, and the preserved
  upgrade evidence. The separate human release checks stay under
  [#624](https://github.com/Ledova/ledova/issues/624).

### Deferred

- Integrated AUD collection, payment automation, reconciliation, refunds and
  secondary settlement, and new trading work
  ([#869](https://github.com/Ledova/ledova/issues/869)).
- Advanced publications, voting and distributions
  ([#870](https://github.com/Ledova/ledova/issues/870)) and filing preparation
  and submission ([#872](https://github.com/Ledova/ledova/issues/872)).
- Tokenising an imported register, and splits and consolidations. A later
  mirror must preserve existing supply rather than issue those shares again.

Deferred work is not cancelled or implicitly delivered; the existing payment,
chain, authority, privacy and retention safeguards stay effective, and the
optional investor crypto on-ramp keeps
[#920](https://github.com/Ledova/ledova/issues/920)'s guards.

## Not on the roadmap

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. The
[legal positions](legal/positions.md) record the unresolved conditions before
any real-world use.
