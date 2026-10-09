# Product and functionality

[Documentation](README.md)

Updated 10 October 2026 · Agreed product direction, paired with the
[regulatory pathway](regulatory-pathway.md)

## Purpose

Ledova is a share registry that companies and their shareholders use to manage
their relationship, company decisions and ownership records. Authorised company
representatives maintain the register and direct issuance and ownership changes;
shareholders manage their particulars, evidence, requests and holdings. The
software records authority, applies approved actions and preserves their history.

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
| Investors and shareholders                 | Discover companies, review opportunities, manage their particulars, evidence, requests and holdings, obtain permitted records and certificates, and make or accept sale offers. The same person may buy and sell.                                                      |
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

| Capability                     | Intended behaviour                                                                                                                                                                                      | Status                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Company setup and authority    | Establish share classes, opening ownership and company appointments; retain the existing representative checks, scoped authority and revocation.                                                        | Delivered                                                                                                                                    |
| Register and cap table         | Maintain member particulars, issued ownership, approved changes, corrections and attributable history; reconcile chain records where relevant.                                                          | Delivered                                                                                                                                    |
| Employee awards                | Retain the company's award agreement and vesting schedule, distinguish entitlements from issued shares, and record company-confirmed vesting and approved issues without requiring an employee payment. | Planned; [first scope decided](decisions.md#first-scopes-for-employee-awards-and-external-capital)                                           |
| Investor capital and allotment | Record an externally agreed investment and capital evidence, then the exact company-approved allotment. Agreement, receipt and issued ownership remain separate.                                        | Planned; [first scope decided](decisions.md#first-scopes-for-employee-awards-and-external-capital)                                           |
| Member access                  | Let shareholders and employees read permitted own records and request particulars changes through one account-to-member association.                                                                    | Partly: own name and address editing; the association policy is an owner decision ([#866](https://github.com/Ledova/ledova/issues/866))      |
| Basic outputs                  | Supply company-authorised certificates, inspection copies and exports with genuine register provenance and private access.                                                                              | Partly: register exports and inspection copies are company-run; certificates and the company pack are staff-prepared ([#871](https://github.com/Ledova/ledova/issues/871)) |

Company discovery, marketplace, payment and chain features already present in
the experimental product remain subject to their existing controls; expanding
them is outside this core scope. Companies set their own terms; Ledova does not
guarantee prices, liquidity or investment performance.

## 3. Planned registry journeys

### Employee awards and vesting records

1. The company records its agreement, recipient, award terms and vesting schedule.
2. The record distinguishes the contractual entitlement from shares actually
   issued under that arrangement.
3. The company confirms relevant vesting events and approves the exact issue
   when an allotment is due; Ledova retains the supporting authority and evidence.
4. The register and employee's permitted view show actual ownership and its
   history alongside the distinct award record.

Current non-paid grants issue their full approved quantity outright; they do
not calculate vesting or promise future issues. An option or conditional award
must not silently become issued shares.

### Investor capital and newly issued shares

1. The company and investor agree terms through their established investment
   process; a funding-round label alone establishes no payment or ownership.
2. The company records that agreement and genuine external capital evidence,
   including amount, currency, date and reference where provided.
3. The company approves and records the exact recipient, class and share allotment.
4. Ledova updates ownership once and retains the agreement, authority and history.

Money is received outside this registry workflow by the company or its appointed
provider. Recording company-provided evidence does not claim that Ledova
collected funds or independently verified receipt. A commitment or payment alone
does not establish that shares were issued.

### Ownership changes and access

Retain imports, grants, supported direct transfers and compensating corrections
as genuine ledger events. Keep the actual dates, actors, instruments and
resulting quantities. Members can obtain their permitted records and outputs
without a wallet where no chain action is involved. Contractual terms, receipt,
company issue authority, technical execution and register entry stay distinct.

Existing primary subscriptions use staff-recorded AUD bank-transfer and
stablecoin receipts, and secondary settlement uses a prefunded stablecoin atomic
swap. Their controls, evidence and recovery are preserved; they do not deliver a
company-managed off-chain allotment or a direct AUD secondary market, and new
integrated collection is deferred.

## 4. Self-custody and ownership records

Investors control their wallet keys. Ledova does not hold their money or
assets, own shares on their behalf, or act as buyer or seller. Use an
established public blockchain or suitable public Layer 2.

Self-custody allows disclosed restrictions on share transfers. Companies
control their own administration and required approvals under defined rules.
Any party able to change eligibility, block transfers, recover holdings or
upgrade contracts must have explicit, limited and auditable authority. Do not
add an unrestricted Ledova key capable of seizing holdings.

The working first-version design keeps the company member register
authoritative and reconciles it with the blockchain representation, subject to
legal confirmation. Detect discrepancies and retain authorised corrections; do
not assume token possession alone establishes membership.

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

<a id="roles-and-deployment-modes"></a>

## Roles and deployment

One registry product runs on Ledova-hosted or private infrastructure, with one
or several companies per instance and the same authority model; hosting
location does not make platform staff the company's register administrators.
The repository's terms for the users above:

| Term     | Meaning                                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator | The deployment's single configuration record, the technical database and signer roles named after it, and the platform staff tooling in Django admin. None of these is a company mandate; see [tenancy](architecture/tenancy.md) for the technical roles |
| Company  | The entity that keeps the register and issues shares. API names and some historical records say `issuer`                                                                                                                                             |
| Investor | A person investing through their account and verified wallets                                                                                                                                                                                        |
| Member   | A person entered on a company's register, with or without an account or a wallet                                                                                                                                                                      |
| Account  | The person's customer account, linked to one profile                                                                                                                                                                                                 |
| Wallet   | An account's address on a specific network; the same EVM address on two networks is two wallet records                                                                                                                                               |

## Current capability boundaries

This is the repository's experimental implementation of the definition above,
not a claim that it can operate a real market. Keep all identities, companies,
payments and assets synthetic. Company onboarding, authority, eligibility
decisions, register commands and the chain actions below run from the clients
under company appointments; the rows say what platform staff still do. The
[implementation index](plans/company-managed-registers/README.md) links each
delivered increment's guide.

| Capability                      | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company onboarding              | A representative signs up, supplies the company's information and [declares their authority](plans/company-managed-registers/authority-requests.md); a current administrator [activates the company](plans/company-managed-registers/company-activation.md) after the configured identity and ABR checks and edits its [information and documents](plans/company-managed-registers/company-information.md). Company details are shown as provided by the company. Platform staff keep technical warning, suspension and recovery powers.                                                                             |
| Company authority               | Initial scoped appointments, invitations, delegation of `admin`, `prepare`, `approve`, `apply`, `finance` and `read_register`, administrator team reads, revocation and the legacy-owner upgrade, in both clients and the API. Ownership, shareholding and platform staff permissions grant no appointment.                                                                                                                                                                                                                                                                                                         |
| Share classes on chain          | Company-authorised [empty deployment](plans/company-managed-registers/company-deployments.md), [wallet nominations and instructions](plans/company-managed-registers/company-wallet-approvals.md), [non-paid chain grants](plans/company-managed-registers/company-register-issues.md), [capital increases](plans/company-managed-registers/company-capital-increases.md), [pause and unpause](plans/company-managed-registers/company-pause-changes.md) and [paid issues over existing recorded PAID subscriptions](plans/company-managed-registers/company-paid-issues.md), each with exact retained decisions and original execution recovery. Platform mint requests and technical retries stay with platform staff. Imported classes are not tokenised; a later mirror must not issue twice. |
| Participant eligibility         | Participants submit sources and request a decision from one company; current company approvers [accept or refuse](plans/company-managed-registers/company-eligibility.md) with bounded expiry and can revoke. Directory, applications, market and swap effects use the exact-company decision. No global verification and no staff classification review.                                                                                                                                                                                                                                                              |
| Register                        | Company appointees read and export the register; prepare, approve and apply imports, corrections, openings from the chain, member particulars changes and member-wallet links; acknowledge reconciliation discrepancies; record [non-paid grants](plans/company-managed-registers/register-grants.md) to new or existing walletless members and [direct non-paid transfers](plans/company-managed-registers/register-transfers.md) with cessation history. All in both clients and the API with company-provided evidence ([runbook](operations/register-foundation.md)). Settled market transfers still enter through staff-reviewed director instructions ([#869](https://github.com/Ledova/ledova/issues/869)). |
| Register outputs                | Company appointees prepare [inspection copies](plans/company-managed-registers/company-inspection-copies.md). Certificates, notice figures and the company pack are prepared by platform staff on the company's written instruction and recorded as exports with a fingerprint; [#871](https://github.com/Ledova/ledova/issues/871) moves them to company appointments.                                                                                                                                                                                                                                            |
| Members' own records            | Members edit their own [name and residential address](plans/company-managed-registers/member-profile.md) in Profile, alongside phone. Reading one's own register record, confirmations, certificate requests and walletless association are not delivered ([#866](https://github.com/Ledova/ledova/issues/866)).                                                                                                                                                                                                                                                                                                 |
| Employee awards                 | Not delivered; current grants are outright ([first scope](decisions.md#first-scopes-for-employee-awards-and-external-capital), [#867](https://github.com/Ledova/ledova/issues/867)).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Investor capital                | Not delivered; the #867 paid path covers only recorded PAID subscriptions on deployed classes ([first scope](decisions.md#first-scopes-for-employee-awards-and-external-capital), [#868](https://github.com/Ledova/ledova/issues/868)).                                                                                                                                                                                                                                                                                                                                                                                 |
| Offerings and applications      | The company creates and submits offerings; platform staff review, approve, reject and close them in admin. Eligible investors see the directory and approved offering documents and apply in both clients with recorded payment instructions ([offerings](architecture/offerings.md), [subscriptions](architecture/subscriptions.md)).                                                                                                                                                                                                                                                                                 |
| Payments                        | Primary AUD bank-transfer and stablecoin receipts and refunds are recorded by platform staff in admin; secondary settlement is a prefunded stablecoin atomic swap. Historical financial records keep their original attribution. No integrated AUD collection exists, and new payment mechanics are deferred.                                                                                                                                                                                                                                                                                                             |
| Publications                    | Documents, resolutions with online member ballots, dividends and payment records are published by platform staff on the company's written instruction; members read them in Notices ([shareholder publications](architecture/shareholder-publications.md), [#870](https://github.com/Ledova/ledova/issues/870) deferred).                                                                                                                                                                                                                                                                                             |
| Portfolios and crypto wallets   | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Secondary trading               | Order, matching and settlement are enabled by default on the experimental deployment; releases still require the human checks in [#624](https://github.com/Ledova/ledova/issues/624).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Mobile                          | Holdings, Notices, Activity, Register, Invest and Wallets flows exist in the paper interface; native security needs a Ledova build, with separate device acceptance checks.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Crypto on-ramp                  | Optional personal investor functionality: the API checks a current investor account and owned receiving wallet before contacting the provider, and both clients refuse company entry and retire open provider views on account or role loss ([#920](https://github.com/Ledova/ledova/issues/920)). There is no off-ramp.                                                                                                                                                                                                                                                                                              |

The [roadmap](roadmap.md) orients the remaining work. A feature flag or configured
provider does not establish safety or regulatory compliance.

## Terms that must stay distinct

- A **share class** is a company's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorised shares** are the issuance cap; **issued shares** are actual
  register ownership, including genuine non-chain issues. A selected chain
  representation has a separate minted supply to reconcile. The
  [issuance reference](architecture/contracts-and-issuance.md) explains the
  historical API names.
- An **allotment** is the company's decision to issue shares to a person; an
  **issue** is the resulting register entry; **issuance** or a **mint** is its
  execution on a chain; a **grant** is a non-paid issue. An **award** is a
  promised entitlement, not shares, until the company approves the issue
  ([10 October decision](decisions.md#first-scopes-for-employee-awards-and-external-capital)).
- **Eligibility** concerns whether an investor qualifies for an offering.
  Each company's on-chain **whitelist** determines which addresses can receive or send its share tokens.
- The **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalised**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.

Next: the [regulatory pathway](regulatory-pathway.md),
[system architecture](architecture/README.md), [local setup](getting-started.md),
and the [reasons behind product choices](decisions.md).
