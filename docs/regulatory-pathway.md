# Regulatory pathway

[Documentation](README.md) · [Product and functionality](product.md)

Updated 19 September 2026 · Australian operating model under assessment

## Purpose and status

Ledova is intended to provide a multi-company share registry and non-custodial
marketplace on a public blockchain. Investors discover companies, shareholders
advertise shares for sale, and participants make or accept offers through the
platform. Companies also administer new share issues and ownership records.

This planning brief identifies the route to lawful operation; it is not a legal
opinion or regulatory approval. The [product page](product.md) defines the
agreed features and behaviour.

**Preserve discovery, listings and trading while establishing the necessary
obligations, controls and permissions.** Bring material trade-offs back to the
owner.

## 1. Regulatory objective

Allocate company and investor obligations to those parties where legally
available, and provide tools that make compliance practical and demonstrable.
Establish the minimum lawful obligations for the platform operator itself.

Company approval, self-custody and contractual allocations do not
automatically remove duties attaching to Ledova's activities. ASIC separately
addresses arranging transactions and operating facilities for
financial-product offers. Both must be assessed against the actual service.
See [ASIC INFO 225, Parts B and D](https://www.asic.gov.au/regulatory-resources/digital-transformation/digital-assets-financial-products-and-services).

Distinguish agreed requirements, proposed controls and legal conclusions.
Substantiate any exemption, licensing or approval claim.

## 2. Responsibility allocation to validate

| Party | Proposed allocation |
| --- | --- |
| Issuing company | Share rights, primary-issue terms, disclosures, applicable eligibility requirements, required approvals and responsibility for the member register. |
| Selling shareholder | Ownership and authority to sell, accurate sale information, applicable sale obligations and transfer authorisation. |
| Buying investor | Accurate identity and eligibility information, agreements, investment decision, payment and wallet authorisation. |
| Screening or verification provider | Accurate checks, documented evidence, updates and corrections within its mandate, with an identified accountable customer. |
| Ledova or another identified operator | Obligations arising from running the service, including any permissions, required platform controls, records, complaints and regulatory cooperation. |
| Other regulated providers | The functions they actually perform within the scope of their permissions and contractual responsibilities. |

Counsel must validate delegation and retained accountability. Identify the
actual operator of each regulated activity; a partner label is insufficient.

## 3. Questions that determine the pathway

| Area | Question requiring assessment |
| --- | --- |
| Discovery, listings and offers | Does the actual facility constitute a financial market, and what permission or exclusion applies? |
| Applications, acceptance and execution | Which actions constitute dealing or arranging, and who performs them? |
| Primary fundraising and secondary sales | Which disclosure, promotion, investor eligibility and company-law rules apply to each offer and participant group? |
| Money and settlement | Do payment coordination or completion mechanisms create payment, client-money or clearing-and-settlement obligations despite the intended absence of custody? |
| Keys and administrative authority | Do eligibility publishing, pauses, recovery or upgrade powers alter the custody or control analysis? |
| Ownership records | When does legal membership change, how does it relate to the token, and how are discrepancies or corrective orders handled? |
| AML/CTF and sanctions | Does any party provide a designated service; what screening, reporting, restriction and recordkeeping duties apply? |
| Privacy and cooperation | What information may be collected, retained, exported or disclosed, and under what authority? |

Distinguish identity verification, company eligibility, sanctions and
designated-service requirements. Assess the actual offers, users,
jurisdictions and roles; do not assume identical KYC obligations for every
company.

## 4. Operating routes to compare

| Possible route | What must be established |
| --- | --- |
| Applicable exclusion or exemption | Exact legal basis, eligible activities and parties, conditions, volume limits and ongoing obligations. |
| Licensed operator or partner | Its actual role, necessary permissions, responsibility, supervision and the remaining Ledova obligations. |
| Ledova's own permissions | The licences or authorisations required for the chosen activities and the resources needed to meet them. |
| Specific regulatory relief | Whether relief is legally available and appropriate, its scope, conditions and implementation requirements. |

These are candidates, not findings that Ledova qualifies. An AFSL arrangement
does not necessarily resolve market-licensing requirements. The distinction is
reflected in [ASIC's market and financial-services guidance](https://www.asic.gov.au/regulatory-resources/digital-transformation/digital-assets-financial-products-and-services).

Verify the current instrument before considering low-volume-market relief. Do
not assume eligibility or separate allowances per tenant. Compare all routes
against functionality, scale, cost, control and portability.

## 5. Controls to present as part of the proposal

The [product page](product.md#5-verification-and-transaction-controls)
specifies behaviour. Here, establish whether the controls are sufficient, who
is accountable and the required failure response.

### Screening and restrictions

Use the [DFAT Consolidated List](https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list)
for applicable Australian sanctions and the [ASIC banned and disqualified registers](https://www.asic.gov.au/online-services/search-asic-registers/banned-and-disqualified-registers)
for relevant role restrictions. An ASIC management ban is not automatically a
share-ownership ban. Match the person and the scope of the restriction rather
than treating each appearance as a universal prohibition.

Absence from a list does not establish permission to transact. Sanctions can
concern ownership or control and restricted activities; assess the relevant
framework and applicable orders as well. See [DFAT's sanctions explanation](https://www.dfat.gov.au/international-relations/security/sanctions/about-sanctions).

Establish identity-to-wallet links, source reliability, interpretation, update
delays and review of mistaken matches. Identify authority for eligibility
updates, revocation, corrections and provider replacement. A technical feed
does not decide the law.

### Prevention, evidence and lawful assistance

Apply requirements at the stage they govern: offer access, listing, acceptance,
payment or transfer. Establish whether any rules concern existing holdings,
required restrictions, freezes or reporting in addition to future transfers. A
transaction check alone is not a complete response to every legal obligation.

Preserve evidence of parties, wallets, terms, checks, approvals, payments and
ownership changes. Support complaints, preservation requests and lawful
disclosure through authorised, logged access, protecting private information.

Document limitations, mitigations, residual risk and the legal basis for
proceeding. Cooperation and records do not waive mandatory requirements.

## 6. Practical engagement sequence

| Step | Lead | Concrete output |
| --- | --- | --- |
| Define the operating model | Owner with product and engineering | Actual screens, transaction sequence, parties, users and jurisdictions, projected volume, fee options, and control of keys, assets and money. |
| Obtain a targeted assessment | Australian corporate and financial-services counsel | Activity-by-activity classification, responsibility allocation, viable operating routes and questions for regulators. |
| Approach ASIC | Owner and counsel | A concise request describing the complete product and asking about unresolved licensing, market and relief questions. |
| Resolve specialist questions | Owner, counsel and relevant specialists | Sanctions questions for DFAT's Australian Sanctions Office; AML/CTF assessment and AUSTRAC engagement where relevant. |
| Demonstrate the safeguards | Engineering and the intended operator | Evidence that required checks, contract restrictions, corrections, outages, records and portability work as described. |
| Establish the launch basis | Owner and accountable operator, advised by counsel | Chosen route, applicable permissions and conditions, responsibilities, operating procedures and release scope. |

ASIC's [Innovation Hub informal assistance](https://www.asic.gov.au/for-business-and-companies/innovation-hub/informal-assistance-for-fintechs-and-regtechs)
is a route for early discussion. It does not provide legal advice, endorsement
or permission to operate. Do not treat a conversation, acknowledgement or
pending application as a licence or waiver.

Demonstrate difficult cases: restricted participants, stale feeds, mistaken
identity, direct contract calls, failed payments or transfers, and provider
changes. Explain limits and responses.

## 7. Decisions and conditions for live operation

Maintain one short decision log covering:

- The operator and legal route for each activity.
- Eligible companies and investors, and the permitted offer and acceptance
  process.
- Binding agreement, payment, transfer and legal-register timing.
- Screening authority, administrative control, failure handling and applicable
  reporting.
- Outstanding permissions, conditions, owners and evidence required before
  release.

Development and testing with simulated transactions can proceed while these
matters are resolved. Establish the lawful basis before enabling the affected
regulated live activity. Do not rely on best efforts followed by an
explanation after launch.

When the first design cannot meet a requirement, propose alternatives or
staged delivery for owner review. Retain the core marketplace in the product
plan and state any limitation explicitly.

Agents need owner authorisation to contact regulators, submit applications or
launch services. Recheck current law and instruments before relying on the
selected pathway.

Next: the [legal positions](legal/positions.md) and [operating models](legal/README.md)
behind the assessment, then the [decision log](decisions.md).
