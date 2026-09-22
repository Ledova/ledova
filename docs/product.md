# Product and functionality

[Documentation](README.md)

Updated 19 September 2026 · Agreed product direction, paired with the
[regulatory pathway](regulatory-pathway.md)

## Purpose

Ledova helps private companies administer their shares and gives investors a
place to discover companies, acquire shares and sell existing holdings. It
combines a multi-company share registry, investor marketplace and verifiable
ownership records on a public blockchain.

**Company discovery, shareholder sale listings, and making or accepting offers
through Ledova are core features.** The product must preserve them while
supporting the controls needed to operate lawfully.

This page defines what to build; the [regulatory pathway](regulatory-pathway.md)
covers the route to launch. The sections after the product definition describe
the repository's current implementation of it.

## 1. Who uses Ledova

| User | What they can do |
| --- | --- |
| Company representatives | Manage company information, share classes, issuance, investor requirements, required approvals, ownership records and shareholder governance. |
| Investors and shareholders | Discover companies, review opportunities, manage holdings, advertise shares for sale and make or accept offers. The same person may buy and sell. |
| Platform and compliance staff | Operate the service, administer authorised workflows, review exceptions and support complaints and lawful information requests through controlled access. |

Companies have isolated private workspaces. Only intentionally published
profiles and listings are discoverable across the platform.

## 2. Core functionality

| Capability | Intended behaviour |
| --- | --- |
| Company onboarding | Register the company, verify representative authority and establish its administration, share classes and initial ownership records. |
| Company discovery | Let investors browse company profiles and available investment opportunities, with appropriate access to offer information. |
| Share registry and cap table | Record shareholders, share classes, holdings, issuance and ownership changes; reconcile the register with blockchain records. |
| Primary issuance | Let companies present their terms, collect applications, complete checks and approvals, confirm external payment and issue shares. |
| Shareholder marketplace | Let verified holders list shares, state price and quantity, and propose, accept, reject or withdraw offers under defined rules. |
| Investor verification | Connect identities to verified wallets and track eligibility, agreements, approvals and restrictions for each company. |
| Wallets and transfers | Let investors authorise transactions with their own wallets; enforce required transfer rules within the share contracts. |
| Shareholder administration | Provide documents, communications, voting, corporate actions and a clear history of holdings and transactions. |
| Reporting and portability | Export company records, transaction evidence and contract information for administration, authorised review or migration. |

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

Start with straightforward listings and direct offers. Automatic matching, a
continuous order book and advanced trading mechanisms are separate choices.
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

Agents updating [RonildoBraga/ledova](https://github.com/RonildoBraga/ledova)
should inspect current code and open work, preserve valid functionality and
data, reuse relevant issues and keep documentation aligned. Company roles must
not reintroduce shared personal accounts.

Demonstrate an incremental flow covering discovery, a seller listing, offer
acceptance, approvals, simulated external payment, contract-enforced transfer
and reconciliation. Verify private-data isolation, revocation, provider
failure, direct contract calls, duplicate requests and migration to another
interface. Legal permissions are a separate launch decision.

Keep architecture, test and migration detail in the repository. Maintain a
short decision log for blockchain, provider, authority, payment and fee
choices, using the regulatory pathway where relevant.

## Roles and deployment modes

The repository's terms for the users above, and its two deployment modes:

| Term | Meaning |
| --- | --- |
| Operator | Runs the deployment, Django admin, review queues and operator signer |
| Issuer | The company offering and issuing shares; “company” names the entity |
| Investor | A person investing through their account and verified wallets |
| Account | The person's customer account, linked to one profile |
| Wallet | An account's address on a specific network; the same EVM address on two networks is two wallet records |

One operator exists per deployment. **Registry** mode hosts multiple companies
and is the default. **Single issuer** mode represents a company operating its
own instance. Both use the same tenancy boundary. Single issuer also disables
supporting-payslip storage and its API/admin surfaces; classification evidence
and human review remain available. See [operator setup](operations/operator-console.md).

## Current capability boundaries

This is the repository's experimental implementation of the definition above,
not a claim that it can operate a real market. Keep all identities, companies,
payments and assets synthetic.

| Capability | Current boundary |
| --- | --- |
| Company onboarding and share classes | Application/review flow, company and token screens exist; operator approval and chain configuration are required |
| Tokenized shares | Whole-share issuance, authorized caps and recipient whitelist are enforced on chain |
| Investor classification | Claim/evidence submission and review status exist in both clients; staff review is in admin; eligibility scopes discovery and subscriptions |
| Primary offerings and subscriptions | Investor directory, subscription and payment instructions are available in the dashboard; the mobile investor flow remains unscheduled |
| AUD and stablecoin payments | Operator records receipt, refunds and allotment in admin; bank-feed and stablecoin-watcher reconciliation is planned |
| Register | Current members are read from the stored register once a share class's opening is applied, with the chain unreachable; former members are retained records; a scheduled job reconciles them with the chain, and every export is recorded; an import adds particulars and pre-platform former members to a class opened from the chain, or opens a class not yet on chain, which then records no change until tokenising, future work; an issue or transfer is entered only under a register instruction naming its approving director that staff reviewed; the issuer can list the completed effects still waiting to be entered, with the reason each waits |
| Portfolios and crypto wallets | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation |
| Secondary trading | Order, matching and settlement are enabled by default on the experimental deployment; releases still require the human checks in [#624](https://github.com/Ledova/ledova/issues/624) |
| Mobile | Wallets, portfolio, company/token screens, eligibility and supporting-document flows exist; native security needs a Ledova build, with separate device acceptance checks |
| Fiat conversion | An optional on-ramp integration exists; there is no off-ramp |

The [roadmap](roadmap.md) orients the remaining work, including the unscheduled
mobile investor flow. A feature flag or configured provider does not establish
safety or regulatory compliance.

## Terms that must stay distinct

- A **share class** is an issuer's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorized shares** are the issuance cap; **issued shares** are the minted
  supply. The [issuance reference](architecture/contracts-and-issuance.md)
  explains the historical API names.
- **Eligibility** concerns whether an investor qualifies for an offering.
  The on-chain **whitelist** determines which addresses can receive share tokens.
- The **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalized**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.

Next: the [regulatory pathway](regulatory-pathway.md),
[system architecture](architecture/README.md), [local setup](getting-started.md),
and the [reasons behind product choices](decisions.md).
