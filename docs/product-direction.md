# Ledova Product and Architecture Direction

## Purpose of this document

This document defines the agreed business model and product direction for Ledova. It is a handover for the agents updating the Ledova repositories, documentation, architecture and implementation.

The central decision is:

> Ledova is non-custodial, multi-company share-registry and tokenisation infrastructure built on public blockchain networks. Companies use Ledova to administer and represent their shares, but each company remains responsible for issuing shares, approving and verifying investors, meeting its legal obligations, approving transfers and maintaining its legal shareholder register.

Ledova must be designed as infrastructure used by companies and investors, not as an exchange, broker, custodian, market operator, investment adviser or counterparty.

This is a product and architecture direction, not legal advice. The implementation must preserve the boundaries in this document, and the final operating model must be reviewed by Australian corporate and financial-services counsel before launch.

## 1. The business model

Ledova is a multi-tenant software platform serving multiple companies. Each participating company can use Ledova to manage its share registry, shareholder relationships and blockchain-based ownership records.

The intended relationship is:

```text
Company -> legal shares -> Ledova infrastructure -> public blockchain -> investor wallet
```

The primary regulated and commercial relationship remains between the company and its investors:

```text
Company <-> Investor
```

Ledova supplies the infrastructure that supports this relationship. It does not insert itself as the owner, seller, buyer, custodian or transaction counterparty.

Ledova may serve ten, one hundred or thousands of companies while preserving strict tenant isolation. Every company controls its own share classes, investor requirements, approvals, records and administrative keys.

## 2. Product positioning

Ledova should be positioned as:

- multi-company share-registry software;
- tokenisation infrastructure built on existing public blockchains;
- a non-custodial interface for companies and their investors;
- cap-table, governance and corporate-action tooling;
- a portable and independently verifiable ownership-record system.

Ledova should not be positioned as:

- a stock exchange or secondary market;
- a broker or dealer;
- an investment platform that recommends opportunities;
- a custodian of shares, tokens, fiat currency or private keys;
- a market maker or pricing service;
- a clearing or settlement facility;
- the issuer of a platform stablecoin.

A useful shorthand is:

> Ledova is closer to share-registry and cap-table infrastructure with public-blockchain verification than to an ASX-style exchange or a crypto exchange.

## 3. Foundational principles

### 3.1 Infrastructure rather than intermediary

Regulators and courts will consider what Ledova actually does, not only what it calls itself. The software, user journeys, permissions, contracts, revenue model and operational practices must all match the infrastructure position.

Simply placing responsibility in terms and conditions is insufficient if Ledova performs the regulated activity in practice.

### 3.2 Public blockchain rather than a Ledova blockchain

Ledova should provide software and smart contracts deployed on an established public blockchain or suitable public Layer 2 network. It should not create or control a proprietary Ledova blockchain for the initial product.

The public network supplies the shared ledger. Ledova supplies smart-contract templates, deployment tools, application interfaces, APIs, indexing and administration workflows.

### 3.3 Company-controlled operations

Each company must control decisions concerning its own shares and shareholders. Ledova may provide workflows and enforce configured rules, but it must not make the underlying eligibility, issuance or transfer decision.

### 3.4 Investor self-custody

Investors control their own wallets and private keys. Ledova must not hold private keys or possess shares or tokens on an investor's behalf.

Non-custodial does not mean freely transferable. A share may be held in an investor-controlled wallet while transfers remain subject to approval by the issuing company.

### 3.5 Company ownership and portability

Each company should control its smart-contract administration and be able to leave Ledova without losing access to its records or assets. Ledova must be replaceable.

### 3.6 Privacy by design

Personal information, identity documents, residential addresses, dates of birth and detailed verification records must remain encrypted off-chain. Only the minimum necessary wallet, holding, status and integrity references should be recorded on-chain.

### 3.7 Simplicity first

Every feature creates operational and potentially regulatory consequences. V1 should contain only the functions required to deliver the registry and ownership-verification proposition. When a feature is not essential, remove or defer it.

## 4. Responsibility boundary

| Function | Primary responsibility | Ledova's role |
| --- | --- | --- |
| Decide whether to issue shares | Company | Provide administration workflow |
| Define share classes and rights | Company and its advisers | Store and present configured data |
| Set price and commercial terms | Company | Record company-supplied terms where appropriate |
| Prepare offers and disclosures | Company and its advisers | Provide controlled document workflow |
| Decide who may invest | Company | Apply company-configured eligibility workflow |
| Verify investor identity | Company or its chosen provider | Integrate tools and store status/evidence securely |
| Determine required KYC, AML, sanctions or investor-classification checks | Company and its advisers | Support configurable verification requirements |
| Approve an investor | Company | Record and enforce the company's decision |
| Receive investor funds | Company or independent provider | Record external payment status only |
| Approve share issuance | Company | Execute the approved administrative action |
| Approve a transfer | Company | Enforce approval before the contract permits transfer |
| Maintain the legal member register | Company | Supply registry software and exports |
| Control investor wallet and keys | Investor | Connect to the wallet; never custody keys |
| Control company administrative keys | Company | Support secure setup and recovery procedures without taking custody |
| Provide the ledger network | Public blockchain | Integrate with and index the network |
| Provide UI, APIs and smart-contract templates | Ledova | Build, operate and maintain the software |
| Provide investment advice | Nobody within Ledova | Explicitly out of scope |

Use the broader term **investor verification** in the product. A company is not necessarily subject to identical KYC or AML obligations in every situation. Its required checks will depend on its activities, offer, investors and applicable law.

## 5. Legal ownership and the blockchain record

For V1, the company's legal register of members should remain the authoritative record of legal ownership unless specialist legal advice establishes a different valid structure.

The blockchain should provide a cryptographically verifiable representation and history of the company's ownership records. The product must not assume that possession of a token alone automatically establishes legal membership.

The platform must keep the legal register and blockchain representation synchronised through explicit, auditable workflows. If they diverge, the system must flag the discrepancy and prevent silent reconciliation.

## 6. Asset and smart-contract model

Each company should have logically isolated contracts or contract state for its own share classes. The exact technical pattern can be selected during architecture design, but it must preserve the following properties:

- the company controls issuance and transfer authorisation;
- investors control their own wallets;
- Ledova cannot move, freeze, confiscate or reverse holdings using a platform-wide key;
- an investor cannot transfer company shares to an unapproved wallet when company approval is required;
- every issuance, cancellation and transfer is auditable;
- administrative actions use strong access controls, preferably multisignature approval for production;
- contracts are versioned, documented and independently testable;
- upgrades cannot give Ledova unilateral control over company or investor assets;
- the company can migrate to another software provider or interface.

Do not use an unrestricted, freely transferable ERC-20-style design for V1. Use a restricted or permissioned transfer model appropriate to company shares.

## 7. Core V1 workflows

### 7.1 Company onboarding

1. A company creates a tenant.
2. The company supplies its legal and administrative information.
3. Authorised company representatives are verified.
4. The company configures share classes and investor requirements.
5. The company establishes control of its administrative wallet or multisignature account.
6. The relevant contract infrastructure is deployed or configured.
7. Existing shareholder and cap-table data is imported and reconciled.

Company onboarding must not imply that Ledova has approved the company's fundraising, disclosures or legal structure.

### 7.2 Investor onboarding and verification

1. An investor creates an account and connects or creates a self-custodial wallet.
2. The investor applies to interact with a specific company.
3. The company specifies the evidence and declarations required.
4. The company or its selected provider completes the necessary checks.
5. The company approves or rejects the investor.
6. Ledova records the decision and permits only the actions authorised by the company.

Approval should be company-specific. Approval by Company A must not automatically make an investor eligible for Company B.

### 7.3 Primary share issuance

1. The company creates an issuance proposal or invitation.
2. The investor receives the company's documents and accepts the required agreements.
3. The company confirms investor eligibility.
4. Payment occurs directly to the company or through an independent payment provider.
5. The company confirms receipt and approves issuance.
6. Ledova records the legal-register update and executes the corresponding on-chain action.
7. The investor sees the holding in their own wallet and Ledova account.

Ledova must not receive, pool or hold investor money.

### 7.4 Share transfer

1. The current shareholder initiates a transfer request.
2. The proposed recipient completes the issuing company's eligibility process.
3. The company reviews and approves or rejects the transfer according to its constitution, shareholder agreement and legal obligations.
4. If approved, the shareholder signs the blockchain transaction or authorisation using their wallet.
5. The contract executes the transfer only when all required approvals are present.
6. The legal register and blockchain representation are updated and reconciled.

Ledova must not automatically match buyers and sellers or negotiate the transaction.

### 7.5 Corporate actions and governance

V1 may support company-administered actions such as notices, documents, voting, resolutions, share certificates, dividends recorded as external payments, share splits and cancellations. Each action must have a clear authorising party, audit trail and reconciliation process.

## 8. V1 scope

The initial product should include only the capabilities required for companies to administer shares and for investors to verify and manage their holdings:

- multi-tenant company accounts with strict tenant isolation;
- company and authorised-representative administration;
- configurable share classes;
- cap table and legal member-register tooling;
- investor accounts and company-specific verification status;
- self-custodial wallet connection;
- company-controlled issuance;
- company-approved transfer requests;
- restricted smart-contract transfers;
- on-chain transaction history and verification;
- secure off-chain shareholder and verification records;
- documents, agreements and acceptance records;
- shareholder communications and governance workflows;
- complete audit logs;
- reporting and regulator-ready exports;
- company-controlled data and contract portability;
- reconciliation between Ledova, the legal register and blockchain state.

## 9. Explicitly out of scope for V1

Do not build or preserve the following features in V1 unless the business direction is reconsidered after specialist legal advice:

- central order book;
- automatic buyer and seller matching;
- public buy or sell buttons that cause Ledova to arrange a transaction;
- investor-to-investor marketplace;
- Ledova-set or Ledova-quoted prices;
- trade execution by Ledova;
- market making;
- investment recommendations, ratings or personalised advice;
- Ledova custody of shares, tokens, wallets or private keys;
- Ledova custody, pooling or transmission of investor money;
- internal cash or settlement accounts;
- nominee ownership controlled by Ledova;
- freely transferable share tokens;
- a Ledova-issued stablecoin;
- a proprietary Ledova blockchain;
- cross-company approval that bypasses each issuer's decision;
- any platform-wide key capable of seizing or moving investor holdings.

Remove stale functionality, documentation and terminology from earlier versions of the project when it conflicts with this direction. Do not retain unused concepts merely for possible future use.

## 10. Discovery and interaction boundary

The most sensitive unresolved product question is how companies and prospective investors find and communicate with each other without Ledova becoming a facility that arranges transactions or operates a financial market.

Until legal advice resolves this boundary, V1 should favour:

- private company invitations;
- company-controlled investor application links;
- neutral company profiles without transactional calls to action;
- `Request information`, `Contact company` or `Apply to company` flows;
- company-owned offers and documents;
- explicit company review before any issuance process begins.

Avoid exchange-like screens showing multiple companies, live prices, available quantities and immediate buy or sell actions.

This distinction must be substantive, not merely a choice of button labels. The company must actually control the offer, investor relationship, verification, approval, payment and issuance.

## 11. Data, privacy and security requirements

The public chain should contain only the minimum data required for verification and contract enforcement, such as:

- company or contract identifier;
- wallet address;
- share class and quantity;
- eligibility or approval reference where necessary;
- event history;
- hashes or integrity proofs for off-chain records.

Do not place identity documents or directly identifying personal data on-chain.

Off-chain records must use:

- encryption in transit and at rest;
- strict tenant isolation;
- role-based permissions;
- immutable security and administrative audit logs;
- documented retention and deletion policies;
- data minimisation;
- controlled exports;
- tested backup and recovery;
- incident detection and response procedures.

No user-facing claim should suggest that a public blockchain makes the overall system automatically secure, compliant or legally authoritative.

## 12. Portability and failure independence

Portability is a core product requirement, not a future enhancement.

If Ledova stops operating, a company should retain:

- control of its administrative keys;
- access to its deployed contracts;
- access to the public on-chain history;
- an export of company configuration and share classes;
- its legal member register and cap table;
- shareholder and verification records it is legally entitled to retain;
- corporate-action and audit history;
- documents and acceptance records;
- contract addresses, ABIs and deployment metadata;
- a documented migration path to another interface or provider.

Exports should use documented, machine-readable formats in addition to human-readable reports. Avoid proprietary data structures that make departure impractical.

## 13. Revenue model constraints

The commercial model should reinforce the infrastructure position. Prefer software revenue such as:

- company subscription fees;
- implementation and migration fees;
- per-company or per-shareholder administration tiers;
- reporting and governance modules;
- enterprise support;
- API or infrastructure usage fees.

Do not assume that changing the pricing model determines the regulatory outcome. However, transaction commissions, spreads or compensation tied directly to completed investments may weaken the infrastructure framing and require specific legal review.

## 14. Regulatory validation required

Before launch, obtain written Australian legal advice on the actual proposed workflows, contracts, screens, terms and revenue model. Counsel should answer at least the following questions:

1. Does any Ledova onboarding, application, issuance or transfer workflow constitute dealing or arranging in a financial product?
2. Does any discovery, offer, communication or transfer function cause Ledova to operate a financial market?
3. Which functions, if any, require an Australian Financial Services Licence, authorisation by a licensee or a licensed partner?
4. Can Ledova act as a registry software provider while each company retains legal responsibility for its register of members?
5. How should the legal register and on-chain representation interact, and which record prevails if they differ?
6. Does the proposed token or blockchain record create obligations beyond those applying to the underlying shares?
7. Do Ledova or participating companies provide any designated service under the AML/CTF regime in each proposed workflow?
8. What verification, privacy, disclosure, fundraising, foreign-ownership and investor-classification obligations apply to each company?
9. Can restricted, company-approved self-custodial transfers operate as proposed?
10. Do the smart-contract upgrade, recovery or emergency mechanisms create custody or control exposure for Ledova?
11. Does the proposed fee model create broking, dealing or other regulatory exposure?
12. Are any exemptions or low-volume-market arrangements relevant, and what conditions would apply?

If one isolated function crosses a regulatory boundary, first consider removing it, making the company perform it outside Ledova or integrating a properly licensed independent partner. Do not automatically expand Ledova into a fully licensed exchange or custodian.

## 15. Repository update instructions

Agents updating Ledova should work in the following order.

### Phase 1: audit the current repository

Search the README, documentation, code, schemas, APIs, user interfaces and tests for concepts that conflict with this document, including:

- Ledova acting as issuer, broker, exchange, custodian or counterparty;
- platform-issued stablecoin;
- Ledova-controlled wallets or private keys;
- platform-held investor funds;
- direct buy and sell flows;
- order books or automatic matching;
- freely transferable share tokens;
- shared ownership records without tenant isolation;
- claims that the blockchain alone is the legal register;
- features inherited from earlier crypto-trading or portfolio products.

Produce a short conflict report before making broad architectural changes.

### Phase 2: update the documentation

Make this document the source of truth for product direction. Update the repository's README and relevant files under `docs/` so they consistently describe:

- the problem Ledova solves;
- the multi-company infrastructure business model;
- the responsibility boundary;
- the V1 scope and exclusions;
- the company-controlled, non-custodial architecture;
- public-chain integration and portability;
- the need for legal validation of sensitive workflows.

Keep the README at a bird's-eye level and link to focused documents for deeper detail. Consolidate duplication and remove stale material.

### Phase 3: propose the target architecture

Create or update architecture decision records covering:

- tenant isolation;
- company, user and investor relationships;
- company-specific investor approval;
- legal-register and blockchain reconciliation;
- smart-contract ownership and upgrade controls;
- wallet and key boundaries;
- off-chain personal data;
- audit logging;
- portability and exports;
- payment confirmation without custody;
- licensed-partner integration boundaries if later required.

Do not implement irreversible smart-contract or data-model decisions until these records are reviewed.

### Phase 4: align the domain model

The domain model should clearly separate:

- platform users;
- companies and tenants;
- company representatives;
- investors;
- company-specific investor eligibility;
- share classes;
- legal holdings and register entries;
- blockchain representations;
- issuance approvals;
- transfer requests and approvals;
- external payments and confirmation evidence;
- documents and agreements;
- corporate actions;
- audit events.

Avoid a generic account model that hides these different legal and operational roles.

### Phase 5: align services and interfaces

Ensure each workflow shows the responsible actor. Company approval must be explicit and auditable. Ledova services should orchestrate permitted infrastructure actions without silently making company decisions.

Remove or disable conflicting endpoints and screens rather than leaving ambiguous legacy behaviour accessible.

### Phase 6: tests and acceptance criteria

Add tests proving at minimum that:

- one company cannot access another company's data or actions;
- Ledova cannot transfer investor holdings using a platform key;
- an unapproved wallet cannot receive restricted shares;
- issuance requires company authorisation;
- a transfer requires all configured company approvals;
- payment status does not imply Ledova received or held funds;
- personal verification data is not written on-chain;
- the legal register and on-chain state are reconciled and discrepancies are visible;
- a company can export its complete records and contract metadata;
- legacy exchange, custody and stablecoin flows are absent or inaccessible.

## 16. Agent guardrails

All agents working on Ledova must follow these rules:

1. Treat this document as the product north star unless a later approved decision explicitly replaces part of it.
2. Prefer simplification and deletion of conflicting legacy functionality.
3. Do not invent missing legal conclusions. Record an open question instead.
4. Do not describe a renamed feature as compliant when its behaviour is unchanged.
5. Do not add marketplace, custody, payment-holding, advice or stablecoin features without explicit approval.
6. Preserve existing valid functionality only when it supports this model.
7. Before large changes, explain the proposed simplification, affected functionality and migration impact.
8. Use GitHub issues to divide work and prevent two agents from changing the same area simultaneously.
9. Label agent-owned issues consistently, including the `Codex` label where applicable.
10. Keep documentation and code changes in the same pull request when a code change alters the documented model.

## 17. Definition of success for V1

Ledova V1 succeeds when a company can:

- onboard and establish a strictly isolated tenant;
- configure its share classes and investor requirements;
- approve an investor for that company;
- issue shares after its own verification, documentation and payment process;
- represent the approved holding in an investor-controlled wallet;
- approve a compliant transfer to another eligible investor;
- keep its legal register and on-chain representation reconciled;
- communicate and conduct governance with shareholders;
- export its complete records and continue independently of Ledova.

It must accomplish this without Ledova holding investor money, assets or private keys; automatically matching buyers and sellers; providing investment advice; issuing a stablecoin; or exercising unilateral control over company or investor assets.

## 18. Immediate next deliverables

The first repository work should produce:

1. a current-state conflict audit;
2. an updated README outline;
3. a proposed `docs/` information architecture;
4. a regulatory-perimeter feature matrix;
5. target domain and system architecture diagrams;
6. a smart-contract control and portability decision record;
7. an incremental migration plan with small GitHub issues;
8. a list of decisions requiring owner feedback or specialist legal advice.

Do not begin by rewriting the whole application. Establish the documentation, boundaries and target architecture first, then migrate the product incrementally while preserving the functions that remain valid.

## Final direction

Ledova is not intended to make company shares unregulated. It is intended to let companies use modern, public and portable ownership infrastructure while keeping responsibility and control with the parties that issue and own the shares.

The architecture should consistently support this outcome:

```text
Company controls the shares and approvals
Investor controls the wallet and holdings
Public blockchain preserves verifiable records
Ledova supplies replaceable software infrastructure
```
