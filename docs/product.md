# Product and functionality

[Documentation](README.md)

Updated 14 October 2026 · Agreed product direction, paired with the
[regulatory pathway](regulatory-pathway.md)

## Purpose

Ledova is a share registry that companies and their shareholders use to manage
their relationship, company decisions and ownership records. Authorised company
representatives maintain the register and direct issuance and ownership changes;
shareholders manage their particulars, evidence, requests and holdings. The
software records authority, applies approved actions and preserves their history.

For an existing company, Ledova mirrors company-provided ownership records to
help investors and employees understand its share structure. The company keeps
its legal register, historical records, lawful access arrangements and filings;
Ledova does not replace those arrangements or establish legal ownership by
importing a snapshot. The [14 October setup decision](decisions.md#existing-register-mirror-and-simple-setup)
sets this boundary. Opening the mirror records existing shares rather than
issuing them again.

The core is a simple private-company register: non-paid employee awards and
vesting records, shares allotted for externally arranged investor capital,
accurate ownership and history, member access and basic outputs. Ledova records
and supports the company's established processes; it does not need to design
employment incentives, funding rounds or payment collection. The
[9 October decision](decisions.md#essential-registry-and-development-workflow-priority)
sets that priority and defers new integrated AUD payments, trading, advanced
governance and filing workflows. Wallets and tokenisation are required only for
a selected chain action, and a private installation runs the same product.

Sections 1 to 6 define what to build. [Current capability boundaries](#current-capability-boundaries)
says what the repository delivers today.

## 1. Who uses Ledova

| User                                       | What they can do                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company representatives                    | Manage the company's shareholder relationships, share classes, membership records, issuance, required approvals and governance under recorded company authority. Company decision-makers approve company decisions; authorised company administrators carry them out. |
| Investors and shareholders                 | Discover companies, review opportunities, manage their particulars, evidence, requests and holdings, obtain permitted records and certificates, and make or accept sale offers. The same person may buy and sell.                                                     |
| Platform staff: infrastructure and support | Operate hosting, security, integrations and background jobs; recover technical failures and provide controlled support. Routine company register work and company decisions belong to the company.                                                                    |
| Platform staff: crypto and payments        | Perform separately authorised crypto, screening and payment operations, including required reviews and reconciliation. These permissions do not grant authority to make company decisions or administer a company's member register.                                  |

Companies have isolated private workspaces. Only intentionally published
profiles and listings are discoverable across the platform.

Only investors acting in their personal investing capacity may use the optional
crypto on-ramp. Company authority and ownership of a receiving wallet do not
grant that permission, and companies must not buy cryptocurrency through it.

Roles may support automated execution: the software can validate and apply a
company-approved instruction without a platform staff member operating the
register. Automation must preserve the named company authority and evidence
behind each decision. A technical support or signing role cannot supply that
authority.

## 2. Core functionality

| Capability                     | Intended behaviour                                                                                                                                                                                      | Status                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Company setup and authority    | Establish share classes, opening ownership and company appointments; retain the existing representative checks, scoped authority and revocation.                                                        | Delivered                                                                                              |
| Register and cap table         | Maintain member particulars, issued ownership, approved changes, corrections and attributable history; reconcile chain records where relevant.                                                          | Delivered                                                                                              |
| Employee awards                | Retain the company's award agreement and vesting schedule, distinguish entitlements from issued shares, and record company-confirmed vesting and approved issues without requiring an employee payment. | Delivered ([guide](business/issuing-shares.md#employee-awards-and-vesting))                            |
| Investor capital and allotment | Record an externally agreed investment and capital evidence, then the exact company-approved allotment. Agreement, receipt and issued ownership remain separate.                                        | Delivered for fully paid allotments ([guide](business/issuing-shares.md#external-investor-allotments)) |
| Member access                  | Let shareholders and employees read permitted own records and request particulars changes through one account-to-member association.                                                                    | Delivered ([guide](business/member-records.md#member-access))                                          |
| Basic outputs                  | Supply company-authorised unsigned certificates, inspection copies and supported core company packs with genuine register provenance and private access.                                                | Delivered for the [supported core](business/member-records.md#outputs-at-a-glance)                     |

Expanding the discovery, marketplace, payment and chain features already in the
experimental product is outside this core scope ([roadmap](roadmap.md#deferred)).
The scope excludes Ledova custody, nominee holdings, investment recommendations,
proprietary market making, a Ledova stablecoin and a proprietary blockchain, and
no fee model is selected. Companies set their own terms; Ledova does not
guarantee prices, liquidity or investment performance.

## 3. Registry journeys

### Employee awards and vesting records

The company records the award agreement, recipient, share class, whole quantity
and vesting schedule, then each vesting event with its quantity, date and
evidence. The schedule is retained text: Ledova does not calculate vesting, and
a date never creates a holding. Vested shares reach the register only through a
separate company-approved non-paid grant that references the award, so the
contractual entitlement and the issued shares stay distinct. There is no
employee payment, exercise price, forfeiture or tokenised fulfilment
([guide](business/issuing-shares.md#employee-awards-and-vesting)).

### Investor capital and newly issued shares

The company and investor agree terms through their own process. The company
records the agreement, its own receipt of the money with amount, date and
evidence, and then reviews the exact fully paid allotment. Approve records
approval and one issue together, on the web. Agreement, receipt,
decision and ownership remain separate records.
Ledova neither collects nor verifies the money, and a receipt alone never issues shares.
Partly paid allotments, calls and payment collection are deferred
([guide](business/issuing-shares.md#external-investor-allotments)).

### Ownership changes and access

Retain imports, grants, supported direct transfers and compensating corrections
as genuine ledger events. Keep the actual dates, actors, instruments and
resulting quantities. Members can obtain their permitted records and outputs
without a wallet where no chain action is involved. Contractual terms, receipt,
company issue authority, technical execution and register entry stay distinct.

## 4. Self-custody and ownership records

Investors control their wallet keys. Ledova does not hold their money or
assets, own shares on their behalf, or act as buyer or seller. Use an
established public blockchain or suitable public Layer 2.

Self-custody allows disclosed restrictions on share transfers. Companies
control their own administration and required approvals under defined rules.
Any party able to change eligibility, block transfers, recover holdings or
upgrade contracts must have explicit, limited and auditable authority. Do not
add an unrestricted Ledova key capable of seizing holdings.

The company's legal member register remains its source of ownership records.
Ledova's stored register supplies the platform's ownership mirror and can be
reconciled with a blockchain representation. Detect discrepancies and retain
authorised corrections; neither a platform snapshot nor token possession alone
establishes legal membership.

## 5. Verification and transaction controls

Companies or their providers verify identity, wallet control and eligibility.
Reusable evidence does not automatically grant approval across companies. The
[regulatory pathway](regulatory-pathway.md) identifies the relevant sources and
legal questions.

The proposed mechanism uses a screening service to supply verifiable status or
signed approvals to the share contract. Providers, token standards and data
formats remain open.

The required behaviour is:

- Apply checks at relevant stages, including listing, acceptance and transfer
  where required.
- Bind approvals to the correct participant, company, wallet and action;
  enforce expiry, revocation and protection against reuse.
- Enforce rules on direct contract calls and delegated transfers; check
  administrative and recovery paths for bypasses.
- Refresh affected permissions when evidence or restrictions change, with
  documented update delays.
- Hold affected actions when required checks are stale, unavailable or
  unresolved, with review and recovery procedures.
- Resolve mistaken identity matches and expired restrictions through an
  accountable correction process.

Keep private evidence off-chain. Screening providers must be replaceable while
preserving effective restrictions.

## 6. Privacy and portability

Encrypt private records and restrict access. Publish minimal contract data and
proofs; wallets and hashes are not automatically anonymous.

Retain a tamper-evident history linking listings, accepted terms, approvals,
payment evidence and blockchain events. Authorised exports support complaints,
administration and lawful information requests.

Companies can export their register, holdings, share classes, documents,
approvals, history, permitted verification records and contract information.
Include the authority and instructions needed to continue through another
interface or provider while preserving required restrictions.

## Roles and deployment

One registry product runs on Ledova-hosted or private infrastructure, with one
or several companies per instance and the same authority model; hosting
location does not make platform staff the company's register administrators.
The repository's terms for the users above:

| Term     | Meaning                                                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator | The deployment's single configuration record, the technical database and signer roles named after it, and the platform staff tooling in Django admin. None of these is a company mandate; see [tenancy](engineering/security.md#tenancy-model) for the technical roles |
| Company  | The entity that keeps the register and issues shares. API names and some historical records say `issuer`                                                                                                                                                               |
| Investor | A person investing through their account and verified wallets                                                                                                                                                                                                          |
| Member   | A person entered on a company's register, with or without an account or a wallet                                                                                                                                                                                       |
| Account  | The person's customer account, linked to one profile                                                                                                                                                                                                                   |
| Wallet   | An account's address on a specific network; the same EVM address on two networks is two wallet records                                                                                                                                                                 |

## Current capability boundaries

This is the repository's experimental implementation of the definition above,
not a claim that it can operate a real market. Keep all identities, companies,
payments and assets synthetic. Company onboarding, authority, eligibility
decisions, register commands and the chain actions below run from the clients
under company appointments; the rows say what platform staff still do. The
[implementation index](plans/company-managed-registers/README.md) links each
delivered increment's guide.

| Capability                    | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company onboarding            | A representative signs up, supplies the company's information and [declares their authority](business/companies.md); a current administrator [activates the company](business/companies.md#activation-and-the-registry-check) after the configured identity and ABR checks and edits its [information and documents](business/companies.md#company-information-and-documents). Company details are shown as provided by the company. Platform staff keep technical warning, suspension and recovery powers.                                                                                                                                                                                                                                         |
| Company authority             | Initial scoped appointments, invitations, delegation of `admin`, `prepare`, `approve`, `apply`, `finance` and `read_register`, administrator team reads, revocation and the legacy-owner upgrade, on the web and through the API. Ownership, shareholding and platform staff permissions grant no appointment.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Share classes on chain        | Company-authorised [empty deployment](business/issuing-shares.md#deploying-an-empty-class), [wallet nominations and instructions](business/participants.md#wallet-nominations-and-company-wallet-approvals) (API only since [#1452](https://github.com/Ledova/ledova/issues/1452)), [non-paid chain grants](business/issuing-shares.md#non-paid-chain-grants), [capital increases](business/issuing-shares.md#raising-the-authorised-shares) and [pause and unpause](business/issuing-shares.md#pausing-and-unpausing-a-class), each with exact retained decisions and original execution recovery. Platform mint requests and technical retries stay with platform staff. Imported classes are not tokenised; a later mirror must not issue twice. |
| Participant eligibility       | Participants submit sources and request a decision from one company; current company approvers [accept or refuse](business/participants.md#company-eligibility-decisions) with bounded expiry and can revoke. In the API, wallet nominations, company wallet approvals and trading use the exact-company decision. No global verification and no staff classification review.                                                                                                                                                                                                                                                                                                                                                                       |
| Register                      | Company appointees read the register; prepare, approve and apply imports, corrections, openings from the chain, member particulars changes and member-wallet links; acknowledge reconciliation discrepancies; record [non-paid grants](business/issuing-shares.md#grants-to-walletless-members) to new or existing walletless members and [direct non-paid transfers](business/register.md#non-paid-transfers-between-members) with cessation history. All on the web and through the API with company-provided evidence ([runbook](business/register.md)). Settled market transfers still enter through director instructions that platform staff review ([#869](https://github.com/Ledova/ledova/issues/869)).                                    |
| Register outputs              | Company appointees prepare [inspection copies](business/member-records.md#inspection-copies), unsigned certificates and complete imported/non-tokenised core packs; members obtain only their own retained certificate ([outputs](business/member-records.md#outputs-at-a-glance)). Notice figures and broader restricted packs retain their existing staff workflow.                                                                                                                                                                                                                                                                                                                                                                               |
| Members' own records          | Members edit personal [Profile](business/participants.md#member-profile) particulars, accept a company-issued invitation and read their own holdings/history/awards without a wallet. Company-reviewed particulars requests and recipient-only certificate fulfilment use the same [association](business/member-records.md#member-access); member status grants no appointment.                                                                                                                                                                                                                                                                                                                                                                    |
| Employee awards               | Company appointees record promised awards and vesting events on opened imported registers and issue vested shares through a separate approved non-paid grant ([employee awards](business/issuing-shares.md#employee-awards-and-vesting)). No tokenised award fulfilment, employee purchase or option exercise.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Investor capital              | Company appointees record the external agreement, the company's receipt attestation and the exact fully paid allotment on opened imported registers; Approve records the approval and one issue together, on the web ([external allotments](business/issuing-shares.md#external-investor-allotments)). Partly paid allotments, calls and payment collection are deferred.                                                                                                                                                                                                                                                                                                                                                                           |
| Offerings and applications    | Planned for a later release, not part of the first ([planned offerings](business/offerings.md)); neither the web app nor the API has them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Payments                      | Recording application receipts and refunds is [planned with offerings](business/offerings.md#payments-refunds-and-scale-back); secondary settlement is a prefunded stablecoin atomic swap in the trading API. Historical financial records keep their original attribution. No integrated AUD collection exists, and new payment mechanics are deferred.                                                                                                                                                                                                                                                                                                                                                                                            |
| Publications                  | Documents, resolutions with online member ballots, dividends and payment records are published by platform staff on the company's written instruction; members read them in Notices ([shareholder publications](business/publications.md), [#870](https://github.com/Ledova/ledova/issues/870) deferred).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Portfolios and crypto wallets | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Secondary trading             | Order, matching and settlement are enabled by default on the experimental deployment, through the API only: the web app has no Market page. Releases still require the human checks in [#624](https://github.com/Ledova/ledova/issues/624).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mobile                        | A [shareholder app](decisions.md#mobile-app-for-shareholders): Holdings (own records, awards, certificate and particulars requests), Documents (certificates and notices from every company) and Account (profile, invitations and settings), in the Paper and Dark themes; native security needs a Ledova build, with separate device acceptance checks.                                                                                                                                                                                                                                                                                                                                                                                           |
| Crypto on-ramp                | Optional personal investor functionality: the API checks a current investor account and owned receiving wallet before contacting the provider, and the web app refuses company entry and retires open provider views on account or role loss ([#920](https://github.com/Ledova/ledova/issues/920)). There is no off-ramp.                                                                                                                                                                                                                                                                                                                                                                                                                           |

The [roadmap](roadmap.md) orients the remaining work. A feature flag or configured
provider does not establish safety or regulatory compliance.

## Terms that must stay distinct

- A **share class** is a company's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorised shares** are the issuance cap; **issued shares** are actual
  register ownership, including genuine non-chain issues. A selected chain
  representation has a separate minted supply to reconcile. The
  [issuance reference](engineering/chain.md) explains the
  historical API names.
- An **allotment** is the company's decision to issue shares to a person; an
  **issue** is the resulting register entry; **issuance** or a **mint** is its
  execution on a chain; a **grant** is a non-paid issue. An **award** is a
  promised entitlement, not shares, until the company approves the issue
  ([10 October decision](decisions.md#first-scopes-for-employee-awards-and-external-capital)).
- **Eligibility** is one company's decision that a participant qualifies; its wallet approvals rely on it.
  Each company's on-chain **whitelist** determines which addresses can receive or send its share tokens.
- The planned **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalised**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.
