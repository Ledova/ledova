# Product and functionality

[Documentation](README.md)

Updated 5 October 2026 · Agreed product direction, paired with the
[regulatory pathway](regulatory-pathway.md)

## Purpose

Ledova is a share registry that companies and their shareholders use to manage
their relationship, company decisions and ownership records. Authorised company
representatives maintain the register and direct issuance and ownership changes;
shareholders manage their particulars, evidence, requests and holdings. The
software records authority, applies approved actions and preserves their history.

The core is the private-company share registry and the workflows for issuing,
managing, transferring and purchasing company shares. Buying cryptocurrencies
through an on-ramp is optional investor functionality, outside that core.
Companies must not buy Bitcoin, Ethereum or any other cryptocurrency through
Ledova's on-ramp.

The same product also gives investors a place to discover companies, acquire
shares and sell existing holdings, with verifiable ownership records on a public
blockchain. Private self-hosting runs this same software and its company access
boundaries.

**Company discovery, shareholder sale listings, and making or accepting offers
through Ledova are core features.** The product must preserve them while
supporting the controls needed to operate lawfully.

This page defines what to build; the [regulatory pathway](regulatory-pathway.md)
covers the route to launch. The sections after the product definition describe
the repository's current implementation of it.

## 1. Who uses Ledova

| User | What they can do |
| --- | --- |
| Company representatives | Manage the company's shareholder relationships, share classes, membership records, issuance, required approvals and governance under recorded company authority. Company decision-makers approve issuer decisions; authorised company administrators carry them out. |
| Investors and shareholders | Discover companies, review opportunities, manage their particulars, evidence, requests and holdings, obtain permitted records and certificates, and make or accept sale offers. The same person may buy and sell. |
| Infrastructure and support staff | Operate hosting, security, integrations and background jobs; recover technical failures and provide controlled support. Routine company register work and issuer decisions belong to the company. |
| Crypto and payment operations staff | Perform separately authorised crypto, screening and payment operations, including required reviews and reconciliation. These permissions do not grant authority to make issuer decisions or administer a company's member register. |

Companies have isolated private workspaces. Only intentionally published
profiles and listings are discoverable across the platform.

Only investors acting in their personal investing capacity may use the optional
crypto on-ramp. Company authority and ownership of a receiving wallet do not
grant that permission. Company wallet actions needed for authorised share
workflows remain separate from crypto purchases.

Roles may support automated execution: the software can validate and apply a
company-approved instruction without a Ledova staff member operating the register.
Automation must preserve the named company authority and evidence behind each
decision. A technical support or signing role cannot supply that authority.

## 2. Core functionality

| Capability | Intended behaviour |
| --- | --- |
| Company onboarding | Register the company and record the representative's authorisation declaration under the [accepted authority plan](architecture/company-managed-registers.md#representative-verification), retaining the existing identity check and ABR lookup; establish its authorised users, shareholder relationships, share classes and initial ownership records. |
| Company discovery | Let investors browse company profiles and available investment opportunities, with appropriate access to offer information. |
| Share registry and cap table | Let authorised company users maintain membership particulars, approve register openings and changes, and record issuance and ownership changes with their authority and evidence; reconcile the register with blockchain records. |
| Primary issuance | Let companies present their terms, collect applications, complete checks and approvals, confirm external payment and issue shares. |
| Shareholder marketplace | Let verified holders list shares, state price and quantity, and propose, accept, reject or withdraw offers under defined rules. |
| Investor verification | Connect identities to verified wallets and track eligibility, agreements, approvals and restrictions for each company. |
| Wallets and transfers | Let investors authorise transactions with their own wallets; enforce required transfer rules within the share contracts. |
| Shareholder administration | Let the company and its shareholders exchange particulars, evidence and requests, publish documents, communicate, vote and manage corporate actions; provide company-approved certificates and a clear history. |
| Reporting and portability | Produce authorised register outputs, certificates, company records and transaction evidence for administration, review or migration; prepare company-reviewed information for ASIC reporting where supported. |

Companies set primary-issue terms; buyers and sellers agree secondary-sale
terms. Ledova does not guarantee prices, liquidity or investment performance.

## 3. The investment journeys

### Investing in newly issued shares

1. The company publishes an opportunity and the permitted offer information.
2. The investor reviews the documents, submits the required information and
   completes the applicable application or offer process.
3. Required checks and company approvals are recorded, and payment goes
   directly to the company or an independent provider.
4. Authorised issuance is completed and the company's register and blockchain
   representation are reconciled.

### Buying shares from another shareholder

1. A seller creates a listing after their holding and authority to sell have
   been verified.
2. A buyer discovers the listing, reviews the information and proposes or
   accepts terms through Ledova.
3. The parties complete required agreements, checks and company approvals; the
   product shows the status of each step.
4. Payment goes to the selling shareholder or an independent provider. The
   relevant wallet authorisation permits the transfer.
5. The transfer is confirmed and ownership records are reconciled.

Confirm the binding effect of acceptance and the final payment-and-transfer
sequence through the regulatory pathway.

Show acceptance, payment, transfer and register updates as distinct events.
Handle pending or failed actions, cancellations, disputes, refunds and retries
accurately, without double-selling or introducing custody.

### Share payments and optional crypto purchases

AUD must be supported as a valid payment method for purchasing company shares,
not only as a displayed price or valuation. Paying AUD is distinct from buying
an AUD-denominated stablecoin. A share purchase must not require buying Bitcoin,
Ethereum or another cryptocurrency through the on-ramp.

The owner has not decided the payment rails/provider, collection, receipt
verification, reconciliation, refunds or the secondary AUD settlement sequence.
[#868](https://github.com/Ledova/ledova/issues/868) owns primary company/provider
payment workflows; [#869](https://github.com/Ledova/ledova/issues/869) owns the
separate secondary-payment and settlement design. Record these choices for the
owner before implementing an undecided model. Payment evidence, company issue
authority, execution and the register effect remain distinct.

Current primary subscriptions have staff-attested AUD bank-transfer instructions
using operator payment settings. Current secondary settlement uses a prefunded
stablecoin atomic swap. These are existing mechanisms to preserve, not proof
that the company-managed AUD payment requirement is complete. The
[5 October decision](decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)
records their limits and the investor-only on-ramp guards.

## 4. Self-custody and ownership records

Investors control their wallet keys. Ledova does not hold their money or
assets, own shares on their behalf, or act as buyer or seller. Use an
established public blockchain or suitable public Layer 2.

Self-custody allows disclosed restrictions on share transfers. Companies
control their issuer administration and required approvals under defined
rules. Any party able to change eligibility, block transfers, recover holdings
or upgrade contracts must have explicit, limited and auditable authority. Do
not add an unrestricted Ledova key capable of seizing holdings.

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

## 7. Initial delivery scope

Start with one fictional issuer on testnet, expanding later. The owner chose
_For sale_ and _Wanted_ lists over the existing automatic matching for the first
Market version, which has no seller acceptance or rejection. Buyers still fund
before placing an offer. These
[scope decisions](decisions.md#the-signed-in-app) do not introduce advanced trading
mechanisms or authorize a live market.
Keep the mobile app, shared web/mobile package and compliance capabilities in
the product plan.

The initial scope excludes Ledova custody, nominee holdings, investment
recommendations, proprietary market making, a Ledova stablecoin and a
proprietary blockchain. Subscription and transaction-linked pricing remain
options to assess; no fee model is settled here.

Raise alternatives or staged delivery for owner review when a constraint
affects a core feature. The regulatory pathway determines conditions for live
operation.

## 8. Guidance for implementation

Agents updating [Ledova/ledova](https://github.com/Ledova/ledova)
should inspect current code and open work, preserve valid functionality and
data, reuse relevant issues and keep documentation aligned. Company roles must
not reintroduce shared personal accounts.

The next product priority is [company-managed registers](architecture/company-managed-registers.md):
company authority and membership workflows, register actions, shareholder records,
certificates and ASIC reporting preparation. Replace routine staff gates with
scoped company workflows while retaining the existing evidence, isolation,
recovery and audit controls. Company users must make issuer decisions; background
jobs may execute those decisions under limited technical authority. Keep crypto
and payment operations permissions separate.

Prioritise the registry/share lifecycle over optional crypto purchasing.
[#920](https://github.com/Ledova/ledova/issues/920) tracks the investor-only
on-ramp restriction; it does not make crypto acquisition a prerequisite for the
company-managed programme. Implement AUD share-payment support through the
payment issues above once the remaining product choices are recorded.

ASIC preparation means producing information for company review and an explicit
submission workflow. It does not promise automatic filing; required forms,
authority, integrations and lodgement support must be established before any
filing capability is described as available.

Demonstrate an incremental flow covering discovery, a seller listing, offer
acceptance, approvals, simulated external payment, contract-enforced transfer
and reconciliation. Verify private-data isolation, revocation, provider
failure, direct contract calls, duplicate requests and migration to another
interface. Legal permissions are a separate launch decision.

In the current experimental secondary protocol, the buyer funds before placing
an offer: the simulated external payment is the
buyer's deposit, recorded before acceptance, which becomes the stablecoin that
pays the seller inside the settlement. Acceptance, payment, transfer and register
updates remain distinct events, and settlement stays an atomic exchange of shares
for payment ([decision](decisions.md#payments-and-settlement)).
This protocol does not establish direct AUD settlement or require a crypto
on-ramp purchase as the target share-payment journey.

Keep architecture, test and migration detail in the repository. Maintain a
short decision log for blockchain, provider, authority, payment and fee
choices, using the regulatory pathway where relevant.

<a id="roles-and-deployment-modes"></a>

## Roles and deployment

The accepted direction is one registry product, used on Ledova-hosted or private
self-hosted infrastructure. Hosting location does not introduce a separate
single-issuer product or make Ledova staff the company's routine register
administrators. A private instance may contain one company or several, using the
same company access boundaries and authority model.

The repository's current terms for the users above:

| Term | Meaning |
| --- | --- |
| Operator | Current deployment configuration and staff tooling for Django admin, review queues and the operator signer; target infrastructure and separately scoped crypto/payment operation responsibilities |
| Issuer | The company offering and issuing shares; “company” names the entity |
| Investor | A person investing through their account and verified wallets |
| Account | The person's customer account, linked to one profile |
| Wallet | An account's address on a specific network; the same EVM address on two networks is two wallet records |

One operator configuration exists per deployment. The legacy `Registry` and
`Single issuer` setting and its evidence visibility branches are removed by
[`operators/0002`](operations/upgrades.md#one-registry-product). Supporting
payslips and classification evidence retain private access, human review and
retention controls on every instance. This retirement does not grant company
administration capabilities. See [operator setup](operations/operator-console.md)
for existing configuration and
[company-managed registers](architecture/company-managed-registers.md) for the
target responsibility and migration plan.

## Current capability boundaries

This is the repository's experimental implementation of the definition above,
not a claim that it can operate a real market. Keep all identities, companies,
payments and assets synthetic.

The company-managed direction above is accepted product scope, not a description
of capabilities already delivered. Several company and register actions still
require staff tooling today. Their current gates must remain effective until
company authority, permissions and replacement workflows are implemented.

| Capability | Current boundary |
| --- | --- |
| Company onboarding and share classes | Self-declaration admission and administrator company activation retain the configured identity/ABR checks and evidenced failure/retry outcomes; company/token screens and separate chain-configuration requirements remain |
| Representative authority | Draft-company owners can submit private requests, accept the exact authorisation/responsibility declaration and obtain an initial scoped appointment after existing configured identity/ABR checks; [withdrawal and self-revocation](plans/company-managed-registers/authority-requests.md) retain evidence/history. Scoped team invitations, acceptance, administrator team reads, retained revocation, web/mobile screens and the legacy-owner upgrade are delivered; dependent register commands remain planned |
| Tokenized shares | Whole-share issuance and authorized caps are enforced on chain, and so is each company's whitelist, with its expiry, for both the sender and the recipient of a transfer; approvals are set by staff per company, and classification and account changes reach the chain through [a refresh](architecture/outgoing-signing.md#refreshing-an-approval), normally within fifteen minutes |
| Investor classification | Claim/evidence submission and review status exist in both clients; staff review is in admin; eligibility scopes discovery and subscriptions |
| Primary offerings and subscriptions | Directory, with the documents of approved offerings, Applications and recorded payment instructions are available in both clients; payment confirmation, refunds and allotment remain operator actions |
| AUD and stablecoin payments | Current primary AUD bank-transfer and stablecoin receipts, refunds and allotment are operator-attested in admin. Company/provider AUD payment workflows are required in #868; collection, verification, reconciliation and refund mechanics remain undecided. Current secondary stablecoin settlement does not deliver direct AUD settlement |
| Register | Current members are read from the stored register once a share class's opening is applied, with the chain unreachable; former members are retained records; a scheduled job reconciles them with the chain, and every export is recorded; register readers read each reconciliation and its acknowledgements through the API, and each class's entries and latest reconciliation through the API or the Register in either client, where a current company approver or administrator acknowledges a discrepancy with a reason; an import adds particulars and pre-platform former members to a class opened from the chain, or opens a class not yet on chain, which then records no change until tokenising, future work; the company prepares, approves and applies an import itself through the API or the Register in either client, with its own evidence and stated ASIC figures, and a compensating correction that reverses one entry exactly, with its own authority document, in the same places; an issue or transfer is entered only under a register instruction naming its approving director that staff reviewed; staff prepare inspection copies, certificates and notice figures on the company's written instruction, and list those still due; the issuer can list the completed effects still waiting to be entered, with the reason each waits; the company owner and anyone holding a current company appointment with administration or a register capability read the register and its export in both clients, and retained register proposals through the API |
| Portfolios and crypto wallets | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation |
| Secondary trading | Order, matching and settlement are enabled by default on the experimental deployment; releases still require the human checks in [#624](https://github.com/Ledova/ledova/issues/624) |
| Mobile | Holdings, Notices, Activity, Register, Invest and Wallets flows exist in the paper interface; native security needs a Ledova build, with separate device acceptance checks |
| Crypto on-ramp | Optional personal investor functionality. The API checks a current investor/dual-role account and owned receiving wallet before contacting the provider; both clients refuse company/unknown entry and retire deferred/open provider views on account or role loss (#920). External-provider and physical-device acceptance remain separate. There is no off-ramp |

The [roadmap](roadmap.md) orients the remaining work. A feature flag or configured
provider does not establish safety or regulatory compliance.

## Terms that must stay distinct

- A **share class** is an issuer's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorized shares** are the issuance cap; **issued shares** are the minted
  supply. The [issuance reference](architecture/contracts-and-issuance.md)
  explains the historical API names.
- **Eligibility** concerns whether an investor qualifies for an offering.
  Each company's on-chain **whitelist** determines which addresses can receive or send its share tokens.
- The **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalized**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.

Next: the [regulatory pathway](regulatory-pathway.md),
[system architecture](architecture/README.md), [local setup](getting-started.md),
and the [reasons behind product choices](decisions.md).
