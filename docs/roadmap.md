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

The company-managed register foundation is delivered under
[#860](https://github.com/Ledova/ledova/issues/860): one registry product,
company authority and activation, company eligibility decisions, the
company-run register with imports, corrections, openings and wallet links,
non-paid grants and transfers, company-authorised chain actions, employee
awards with recorded vesting, fully paid external allotments, members' own
Profile particulars, member-specific invitations and own records,
unsigned certificates and core packs. The
[implementation index](plans/company-managed-registers/README.md) lists each
increment with its guide and pull request. Since
[#1452](https://github.com/Ledova/ledova/issues/1452) the openings from the chain, wallet links and
chain actions run through the API only: the web app has no wallets or on-chain features
([decision](decisions.md#wallets-removed-from-the-web-app)). Members' particulars requests were
removed on 31 October 2026; members tell the company directly
([decision](decisions.md#member-particulars-requests-removed)), and since 1 November the company
changes a member's particulars in one step ([decision](decisions.md#one-step-particulars-edit)).
Members' certificate requests were removed on 2 November 2026: the company prepares, signs and
delivers its certificates, and Ledova keeps each one's fingerprint
([decision](decisions.md#member-certificate-requests-removed)).

The development workflow ([#943](https://github.com/Ledova/ledova/issues/943),
closed 11 October) now uses fresh PostgreSQL migrations, minimum test suites
with binding caps and the same lean checks on every pull request on GitHub's
runners ([testing guide](engineering/testing.md)).

Earlier platform work, recorded in the
[product alignment programme](https://github.com/Ledova/ledova/issues/645) and
its phase issues:

- Issuance on chain with whitelisted recipients, authorised caps and recovery of
  interrupted requests ([contracts and issuance](engineering/chain.md)).
- Private uploads and the operator console. The investor directory, offerings,
  applications and recorded payments are now
  [planned for a later release](business/offerings.md)
  ([#1421](https://github.com/Ledova/ledova/issues/1421)).
- The authoritative stored register ([#647](https://github.com/Ledova/ledova/issues/647)):
  append-only events, holdings served with the chain unreachable, retained
  former members and staff-prepared outputs ([the register](business/register.md)).
- The secondary market ([#5](https://github.com/Ledova/ledova/issues/5),
  [#646](https://github.com/Ledova/ledova/issues/646)): order, matching and
  settlement, enabled by default under
  [accepted experimental limits](business/trading.md#accepted-experimental-limits).
- Company-scoped on-chain approvals with expiry ([#648](https://github.com/Ledova/ledova/issues/648)).
- Shareholder publications ([#649](https://github.com/Ledova/ledova/issues/649)):
  documents, resolutions and dividends published by platform staff on the
  company's instruction ([shareholder publications](business/publications.md)).
- Reporting and portability ([#650](https://github.com/Ledova/ledova/issues/650)):
  the [company pack](business/member-records.md#the-company-pack) and the
  [account-data export](engineering/records.md#account-data-export).
- [The signed-in app](https://github.com/Ledova/ledova/issues/732) rebuilt around
  the register on web and mobile ([decision](decisions.md#the-signed-in-app)),
  with shared API types generated from the committed OpenAPI snapshot
  ([decision](decisions.md#clients-and-api-types)).

## Remaining work

### Human release acceptance

The [11 October essential journey](operations/evidence/essential-register-2026-10-11.md)
records the joined web/company and iOS/member flow without routine platform-staff
actions. Genuine physical-device and live human release checks remain under
[#624](https://github.com/Ledova/ledova/issues/624); the controlled browser and
simulator observation does not establish them.

### Deferred

- Integrated AUD collection, partly paid allotments and calls, payment
  automation, reconciliation and refunds.
- Tokenising an imported register, and splits and consolidations. A later
  mirror must preserve existing supply rather than issue those shares again.
- [Offerings and applications](business/offerings.md): not part of the first
  release; the design and decisions stay documented.

Deferred work is not cancelled or implicitly delivered; the existing payment,
chain, authority, privacy and retention safeguards stay effective, and the
optional investor crypto on-ramp keeps
[#920](https://github.com/Ledova/ledova/issues/920)'s guards.

## Not on the roadmap

The owner [closed the expansion tickets as not planned on 18 October](decisions.md#registry-focus-and-cancelled-expansion-tickets):
secondary share sales and AUD settlement expansion ([#869](https://github.com/Ledova/ledova/issues/869)),
advanced company resolutions and distributions ([#870](https://github.com/Ledova/ledova/issues/870)),
and filing preparation and submission integrations ([#872](https://github.com/Ledova/ledova/issues/872)).
These closures do not remove existing functionality or establish delivery of the proposals.

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. The
[legal positions](legal/positions.md) record the unresolved conditions before
any real-world use.
