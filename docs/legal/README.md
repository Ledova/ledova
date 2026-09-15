# Legal and regulatory

[Documentation](../README.md) · [Positions](positions.md) · [Regulatory pathway](regulatory-pathway.md) · [Handover](handover.md)

This folder records what the project has decided about the law it operates
under, why, and what it still has to find out. **Nobody qualified has been asked
any of it.** The owner cannot afford counsel, so each question is worked out from
primary sources and written down as a position: the source it rests on, what
would show it wrong, which way to be wrong where the directions are not equal,
and the trigger that must happen before the question bites. Nothing here is
legal advice or a legal opinion.

| Page | What it holds | Read it when |
| --- | --- | --- |
| [Company-hosted instance](company-hosted-instance.md) | Operating model A: a company runs its own instance for its own shares; what it can do without permission, its duties, the perimeter, the path for a first company | Before offering the software to a company to run itself |
| [Registry service](registry-service.md) | Operating model B: one operator keeps the registers of many companies on instruction; the clerk boundary, the perimeter, the path to market | Before operating a hosted service for anyone |
| [Positions](positions.md) | The positions taken, one per question, with sources, triggers, the model each binds, and status | Before changing anything that touches the register, evidence, licensing or the licence |
| [Regulatory pathway](regulatory-pathway.md) | What exists in Australia for operating the fuller model under restriction, what ASIC can and cannot change, precedents, fees and a staged path | Before talking to ASIC, applying for anything, or turning on issuance, payments or transfers |
| [Handover](handover.md) | The context another person or agent needs to continue this work without the conversation history | Before picking the work up, and after finishing a session of it |
| [LICENSE](../../LICENSE) | The Functional Source License the code is published under | Position 5 |

The previous single page, `docs/legal.md`, was absorbed into this folder on
2026-09-15. A stub remains at the old path only so that existing links resolve;
it goes when the wider documentation is next revised.

## How a position is written

Every position has the same parts, so a reader can tell a decision from a
silence:

- **What the source says** — the section, regulation, guide or instrument, read
  in full, with its number so it can be reread.
- **What the code does** — the implementation the position describes or
  constrains, linked.
- **The position** — the reading the project acts on.
- **What would show it wrong** — the fact or ruling that would overturn it.
- **Which way to be wrong** — where one error is a defect and the other an
  offence, the position leans towards the defect.
- **Trigger** — the event that must happen before the question is engaged.
- **Status** — either carried over from the previous page and reviewed, or
  *drafted* by the assistant and not yet confirmed by the owner. A draft is a
  reading written down; confirming it means the owner removes the marker in a
  later change. Product and legal decisions remain the owner's.

## What bites now, and what does not

The platform runs on a local chain or a supported testnet, with synthetic data,
and has never held a real security, a real investor's money or a real company's
register. The chain guards refuse any mainnet chain id and mainnet configuration
is absent from the repository. A question about how a register must be kept is
not engaged by a register of fictional members.

Each position therefore names its trigger. Most triggers are the first real
company's first real member, the first fee charged for keeping a real register,
or the first real offer of a security. The licence question (position 5) is the
exception: it waits on somebody wanting to compete, not on real use. A fork
alone is not a Competing Use, since the test is about the use made of the
software and the relationship between its Licensor and operator.

The positions serve two operating models, each with its own page, because the
law places register duties on the company and asks its licence questions of
whoever operates the register:

- **A, the [company-hosted instance](company-hosted-instance.md):** a private
  company runs its own instance for its own shares, and its own officers make
  every entry. No new legal person appears; the project is a software supplier.
- **B, the [registry service](registry-service.md):** one operator keeps the
  registers of many companies on their written instructions. The operator is a
  second legal person, with an agreement per company and a boundary to hold.

The pivot between them is who makes the entries, not who hosts the servers. Each
model's page says what it can do with no permission and where its perimeter is;
the [regulatory pathway](regulatory-pathway.md) covers the features beyond that
perimeter, which position 4b reads as needing a licence, a registration or
relief in either model.

## Sources

None of these is advice, and none of them knows anything about this deployment.
Read the provision before relying on a summary of it.

**Legislation**

- [Corporations Act 2001 (Cth)](https://www.legislation.gov.au/C2004A00818/latest/text).
  Sections 110A, 113, 168–176, 178A–178D, 254X, 708, 741, 761G, 766A–766C, 767A,
  791C, 911A, 926A, 1071B, 1071H, 1072F–1072G, 1075A, 1301 and 1306 are the
  ones the positions rest on.
- [Corporations Regulations 2001](https://www.legislation.gov.au/F2001B00274/latest/text),
  regulation 7.1.29 in particular.
- [Corporations (Fees) Regulations 2001](https://www.legislation.gov.au/F2001B00272/latest/text),
  Schedule 1, for what an application costs.
- [Corporations Amendment (Digital Assets Framework) Act 2026](https://www.legislation.gov.au/C2026A00038/asmade/text),
  commencing 9 April 2027.
- [Anti-Money Laundering and Counter-Terrorism Financing Act 2006](https://www.legislation.gov.au/C2006A00169/latest/text),
  as amended for the 2026 reforms.
- [ASIC Corporations (Low Volume Financial Markets) Instrument 2016/888](https://www.legislation.gov.au/F2016L01501/latest/text)
  and [ASIC Corporations (Project Acacia Participation Exemption) Instrument 2025/425](https://www.legislation.gov.au/F2025L00831/asmade/text).

**ASIC**

- [Members register requirements and changes](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/members-register-requirements-and-changes),
  the plain-language statement of Chapter 2C.
- [RG 36 Licensing: financial product advice and dealing](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-36-licensing-financial-product-advice-and-dealing),
  for what arranging is and is not.
- [RG 51 Applications for relief](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-51-applications-for-relief)
  and [RG 108 No-action letters](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-108-no-action-letters),
  both reissued February 2025.
- [RG 154 Certificate by a qualified accountant](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-154-certificate-by-a-qualified-accountant/).
- [RG 172 Australian market licences](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-172-financial-markets-domestic-and-overseas-operators-australian-market-licences/)
  and the April 2026 draft update consulted on as CS 50.
- [RG 262 Crowd-sourced funding: guide for intermediaries](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-262-crowd-sourced-funding-guide-for-intermediaries).
- [INFO 225 Digital assets: financial products and services](https://www.asic.gov.au/regulatory-resources/digital-transformation/digital-assets-financial-products-and-services)
  and [INFO 248 Enhanced regulatory sandbox](https://www.asic.gov.au/for-business-and-companies/innovation-hub/enhanced-regulatory-sandbox-ers/info-248-enhanced-regulatory-sandbox/).
- [Licensing relief for low volume financial markets](https://www.asic.gov.au/regulatory-resources/markets/market-structure/licensed-and-exempt-markets/exempt-markets/licensing-relief-for-low-volume-financial-markets/),
  its [register](https://www.asic.gov.au/regulatory-resources/markets/market-structure/licensed-and-exempt-markets/exempt-markets/)
  and [CS 60](https://www.asic.gov.au/regulatory-resources/find-a-document/consultations/cs-60-proposed-remake-of-low-volume-financial-markets-instrument),
  the proposed remake.
- [REP 835 Innovation in financial markets and financial market infrastructure](https://download.asic.gov.au/media/d0fp1zbv/rep835-published-30-june-2026.pdf),
  prepared for ASIC by the DFCRC, June 2026.
- [25-129MR Project Acacia](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2025-releases/25-129mr-project-acacia-rba-and-dfcrc-announce-chosen-industry-participants-and-asic-provides-regulatory-relief-for-tokenised-asset-settlement-research-project/)
  and [ASIC's roadmap for digital assets law reform implementation](https://www.asic.gov.au/about-asic/news-centre/news-items/asics-roadmap-for-digital-assets-law-reform-implementation).
- [Innovation Hub: informal assistance](https://www.asic.gov.au/for-business-and-companies/innovation-hub/informal-assistance-for-fintechs-and-regtechs/).

**AUSTRAC, Treasury, OAIC, ATO**

- [Professional designated services](https://www.austrac.gov.au/new-austrac/designated-services-newly-regulated-entities/professional-designated-services)
  and [virtual asset services](https://www.austrac.gov.au/amlctf-reform/reforms-guidance/before-you-start/new-industries-and-services-be-regulated-reform/virtual-asset-services-reform),
  plus [exemptions under section 248](https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/exemptions-and-modifications/exemption-policy).
- AUSTRAC's published guidance on customer identification and record keeping,
  the second obligation behind position 3.
- [Independent review of the Enhanced Regulatory Sandbox](https://treasury.gov.au/review/enhanced-regulatory-sandbox):
  the final report of May 2026 and the Government response of 7 September 2026.
- [Statement on developing an innovative Australian digital asset industry](https://treasury.gov.au/publication/p2025-628504),
  March 2025.
- [OAIC: small business](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business),
  for who is covered despite the exemption.
- [ATO: employee share scheme start-up concession](https://www.ato.gov.au/businesses-and-organisations/corporate-tax-measures-and-assurance/employee-share-schemes/employers/types-of-ess/concessional-ess/start-up-concession-interests-acquired-after-30-june-2015).

What does not exist, and is worth knowing rather than searching for: community
legal centres and legal aid do not take commercial financial-services work.
Fixed-fee opinions are affordable only on questions already made precise, which
is what the positions page is for.

Next: [positions](positions.md), then the [regulatory pathway](regulatory-pathway.md).
