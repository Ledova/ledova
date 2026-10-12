# Company-managed register implementation

[Accepted decision and plan](../../architecture/company-managed-registers.md) · [Owner decisions](../../decisions.md#company-managed-registers-and-one-product)

GitHub [#860](https://github.com/Ledova/ledova/issues/860) is the working
backlog for the one-registry-product transition; #861 retired the product
modes. This folder holds one short guide per delivered increment: what the
company or participant does, what is recorded, the API family and the
increment's own boundaries. Who may prepare, approve, apply and reject is stated
once in the [owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence);
the uncertain-reply rule is stated once under
[company decisions and signer authority](../../architecture/outgoing-signing.md#company-decisions-and-signer-authority),
and each family's unsigned holds and recovery after authority loss in its own
[outgoing signing](../../architecture/outgoing-signing.md) section. The guides
link those rules rather than restating them. The
[9 October priority](../../decisions.md#essential-registry-and-development-workflow-priority)
put the development workflow ([#943](https://github.com/Ledova/ledova/issues/943),
closed 11 October) first and orders the remaining register work; new integrated
AUD payments, trading, advanced governance and filings are deferred.

The [11 October journey cleanup](https://github.com/Ledova/ledova/issues/1000)
organised these existing capabilities around My shares and four company
destinations, with named invitations and focused investor and employee issue
tasks. The 12 October web increments
([#1012](https://github.com/Ledova/ledova/issues/1012),
[#1013](https://github.com/Ledova/ledova/issues/1013) and
[#1014](https://github.com/Ledova/ledova/issues/1014)) add a compact sidebar,
company ownership Dashboard, consolidated Settings and personal holdings and
award charts. Native navigation and signup remain unchanged. The guides below
describe the delivered structure on web and mobile.

Verification references in the guides are each increment's original evidence;
the [11 October minimum-test policy](../../decisions.md#minimum-tests-and-fresh-migrations)
governs current coverage.

## Delivered increments

| Issue                                               | Increment                                                                                                       | Guide                                                                                            | PR                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [#862](https://github.com/Ledova/ledova/issues/862) | Authority requests, admission, team invitations, revocation, legacy-owner upgrade; company information          | [authority-requests.md](authority-requests.md), [company-information.md](company-information.md) | [#911](https://github.com/Ledova/ledova/pull/911) at `13684719c5245f1d61809d46e37a904f833e1c6d`      |
| [#863](https://github.com/Ledova/ledova/issues/863) | Administrator activation                                                                                        | [company-activation.md](company-activation.md)                                                   | [#913](https://github.com/Ledova/ledova/pull/913), [#914](https://github.com/Ledova/ledova/pull/914) |
| #863                                                | Eligibility records and the consumer cutover                                                                    | [company-eligibility.md](company-eligibility.md)                                                 | [#915](https://github.com/Ledova/ledova/pull/915), [#917](https://github.com/Ledova/ledova/pull/917) |
| [#864](https://github.com/Ledova/ledova/issues/864) | Register reads, imports, corrections, discrepancy acknowledgement, chain openings, particulars and wallet links | [Register foundation](../../operations/register-foundation.md)                                   | through [#936](https://github.com/Ledova/ledova/pull/936)                                            |
| [#865](https://github.com/Ledova/ledova/issues/865) | Non-paid register grants; non-paid register transfers and cessation history                                     | [register-grants.md](register-grants.md), [register-transfers.md](register-transfers.md)         | [#937](https://github.com/Ledova/ledova/pull/937), [#938](https://github.com/Ledova/ledova/pull/938) |
| [#867](https://github.com/Ledova/ledova/issues/867) | Empty share-class deployment                                                                                    | [company-deployments.md](company-deployments.md)                                                 | [#941](https://github.com/Ledova/ledova/pull/941)                                                    |
| #867                                                | Wallet nominations and company wallet approvals                                                                 | [company-wallet-approvals.md](company-wallet-approvals.md)                                       | [#942](https://github.com/Ledova/ledova/pull/942)                                                    |
| #867                                                | Non-paid chain grants                                                                                           | [company-register-issues.md](company-register-issues.md)                                         | [#944](https://github.com/Ledova/ledova/pull/944)                                                    |
| #867                                                | Capital increases                                                                                               | [company-capital-increases.md](company-capital-increases.md)                                     | [#948](https://github.com/Ledova/ledova/pull/948)                                                    |
| #867                                                | Pause and unpause                                                                                               | [company-pause-changes.md](company-pause-changes.md)                                             | [#950](https://github.com/Ledova/ledova/pull/950)                                                    |
| #867                                                | Paid issues from recorded PAID subscriptions                                                                    | [company-paid-issues.md](company-paid-issues.md)                                                 | [#951](https://github.com/Ledova/ledova/pull/951)                                                    |
| #867                                                | Promised employee awards, recorded vesting and separate approved imported-register grants                       | [employee-awards.md](employee-awards.md)                                                         | [#973](https://github.com/Ledova/ledova/pull/973)                                                    |
| [#868](https://github.com/Ledova/ledova/issues/868) | External agreements, company-recorded receipts and separately approved fully paid imported-register allotments  | [external-allotments.md](external-allotments.md)                                                 | [#974](https://github.com/Ledova/ledova/pull/974)                                                    |
| [#866](https://github.com/Ledova/ledova/issues/866) | Own Profile name and residential address                                                                        | [member-profile.md](member-profile.md)                                                           | [#953](https://github.com/Ledova/ledova/pull/953)                                                    |
| #866                                                | Member-specific invitations, own records and company-reviewed particulars and certificate requests              | [member-access.md](member-access.md)                                                             | [#985](https://github.com/Ledova/ledova/pull/985)                                                    |
| [#871](https://github.com/Ledova/ledova/issues/871) | Company inspection copies                                                                                       | [company-inspection-copies.md](company-inspection-copies.md)                                     | [#954](https://github.com/Ledova/ledova/pull/954)                                                    |
| #871                                                | Company certificates, core pack provenance/download and recipient-only member fulfilment                        | [register-outputs.md](register-outputs.md)                                                       | [#986](https://github.com/Ledova/ledova/pull/986)                                                    |
| [#873](https://github.com/Ledova/ledova/issues/873) | Fresh-schema essential company/member journey and actual outputs                                                | [11 October observation](../../operations/evidence/essential-register-2026-10-11.md)             | Final acceptance increment under #873                                                                |

Two guides describe non-paid grants: company-register-issues.md covers
**on-chain** grants minted on a deployed class, and register-grants.md covers
**off-chain** grants entered in an imported register with no contract.

## Remaining scope

| Issue                                               | Remaining                                                                                                                                                                                                        | Current prerequisites                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [#624](https://github.com/Ledova/ledova/issues/624) | Physical-device and live human release acceptance                                                                                                                                                                | Genuine device/human and configured-chain evidence            |
| Deferred                                            | [#869](https://github.com/Ledova/ledova/issues/869) trading and settlement, [#870](https://github.com/Ledova/ledova/issues/870) advanced governance, [#872](https://github.com/Ledova/ledova/issues/872) filings | Scheduled by the owner; no essential increment waits for them |

## Ownership boundaries

#866 owns the single account/member association and permitted own-record UI;
#871 basic outputs; #873 the essential journey evidence; #869, #870 and #872
trading, advanced governance and filings.

## History

A 3 October file-by-file documentation audit set the baseline; the #955
consolidation (PRs #956 to #964) acted on it, and the audit is in Git history.
The [one-product decision](../../decisions.md#company-managed-registers-and-one-product)
and [representative verification](../../decisions.md#company-representative-verification)
are in decisions.md. Closed [#645](https://github.com/Ledova/ledova/issues/645)
and its phase tickets delivered the earlier foundation, closed
[#846](https://github.com/Ledova/ledova/issues/846) the synthetic fixtures, and
open [#624](https://github.com/Ledova/ledova/issues/624) keeps the separate
physical-device/live release acceptance. The earlier staff-assisted
screenshots, PDF, gallery and embedded artifact are preserved as dated evidence.
