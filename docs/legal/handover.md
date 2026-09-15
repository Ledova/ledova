# Handover: the legal and regulatory work

[Legal and regulatory](README.md) · [Positions](positions.md) · [Regulatory pathway](regulatory-pathway.md)

Written on 2026-09-15 by the assistant from the conversations of 14 and 15
September 2026 and from the repository, so that another person or agent can
continue the regulatory work without that history. It records why the work
exists, what it decided, what it assumed, what it rejected, what is open, and
what to read next. The [positions](positions.md) and the
[pathway](regulatory-pathway.md) are the results; this page is the reasoning.

## 1. Where this came from

- Ledova was previously **Blueberry**: a private repository, hosted on AWS,
  that had reached the point of onboarding clients. The direction then changed
  and the project became source-available under FSL-1.1-ALv2, each release
  turning Apache 2.0 two years after publication. The individual owner holds the
  copyright; Blueberry Money sponsors the work and intends to be its first hosted
  operator, with no ownership or control transferred ([position 5](positions.md#5-the-licences-competing-use-test-and-who-we-is)).
- The owner cannot afford counsel. On 2026-09-11 the file of "questions to send
  a lawyer" was renamed `docs/LEGAL.md`, lowercased to `docs/legal.md` on
  2026-09-14, and reframed into positions taken from
  primary sources, each with its trigger, what would show it wrong and which way
  to be wrong. The owner signs off each position; drafts are marked until then.
- On **2026-09-14** the owner asked for the path of least legal and regulatory
  friction to a first real client, working backwards from a realistic one: the
  private company the owner works for, which wants to issue the owner shares.
  The answer was the registry-service model in section 4.
- On **2026-09-15** the owner asked the opposite question: whether there is a
  legitimate regulatory pathway — relief, a sandbox, a restricted approval — for
  the *fuller* model, so that Ledova could operate close to its intent while the
  model is evaluated, and contribute to how the framework evolves. The answer is
  the [regulatory pathway](regulatory-pathway.md).
- The same day the owner asked for this folder, with `docs/legal.md` absorbed
  into it and no other documentation changed, because the broader direction of
  the project is still being decided. Tracked as issue #580.
- Later on **2026-09-15** the owner split the analysis into two operating
  models, a company-hosted instance and a registry service, on the view that
  they carry different legal implications and should be analysed separately.
  The folder was restructured accordingly (issue #594): each model has its own
  page, and the positions say which model they bind.

## 2. What Ledova is, and where the code stands

The owner's definition, stated on 2026-09-06 and summarised in the
[README](../../README.md) and [product page](../product.md); the README carried
the numbered list from 2026-09-07 until 2026-09-14, so this paragraph is now the
only place in the repository that enumerates it: a platform for creating and operating digital
private equity markets, where companies represent shares as tokens and use
Ledova for issuance, investor onboarding, ownership tracking and transfers, in
two shapes — a company running its own instance, or a registry provider hosting
many companies — with investors who need not be crypto-native. Twelve features:
company onboarding; tokenised shares; investor onboarding with identity and
compliance; capital raising; fiat and stablecoin payments; a digital share
registry; share transfers under the company's rules; investor portfolios; a
company dashboard; compliance controls; self-hosted or multi-company operation;
and wallet functionality.

What the code does today, as far as this work depends on it:

- The **register of members is derived at read time** from chain transfer
  events ([register design](../architecture/register.md)); an unreachable chain
  makes the whole read unavailable. Former members are stored separately for
  seven years. There is no import of a pre-existing register, no stored
  authoritative current register, and no durable record of exports. The
  [roadmap](../roadmap.md#phase-2--eligibility-and-the-register) already names
  the stored register and the export record as remaining work.
- **Offerings, subscriptions, manually recorded payments and allotment** exist
  ([offerings](../architecture/offerings.md)); the payment provider is
  deliberately undecided ([decisions](../decisions.md#payments-and-settlement)).
- **Investor classification** carries four s708 categories and deliberately not
  the experienced-investor category ([position 4b](positions.md#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief)).
  Payslips are reviewed evidence beside a claim, read by the operator and never
  by the issuing company.
- **Secondary trading** code exists behind a flag that is off by default,
  pending the deferred-hardening issues.
- **Chain guards refuse any mainnet chain id**; all recorded use is testnet or
  local, with synthetic data. That is the mechanism behind "do not reach the
  trigger".
- Two deployment modes, `registry` (many companies, the default) and
  `single_issuer` (a company running its own instance), share one tenancy
  boundary; row-level security follows relationships rather than a tenant id.
- Company onboarding today is a **listing application** with nine required
  documents, operator review, activation, deployment of a share token, for which
  the company needs its selected operator wallet or a verified owner wallet on
  Base as the issuer address while the operator's admitted signer signs the
  transaction, and only then an offering. Several of those
  documents (business plan, risk disclosure) are offering artefacts, not registry
  ones.

## 3. The problems being solved

Two different problems, which the owner raised on consecutive days and which
pull in different directions:

1. **Get a real client onto the platform with the least friction**, without
   building a broad platform for every case. The constraint is legal: the fuller
   model needs licences the project does not have and cannot yet afford, and
   being wrong about that is an offence rather than a defect.
2. **Operate as close as possible to the full intended model**, lawfully, under
   restriction, while the model is evaluated — and take part in the discussion
   about how private digital securities infrastructure should be regulated. The
   constraint is that the existing framework was written for other
   infrastructure, and the owner's concern is that forcing Ledova into it could
   make the platform impractical.

The reconciliation reached: the two are rungs of one ladder rather than a fork,
and the ladder is climbed by whichever legal person operates the register. On the
positions as drafted, a company running its own instance and an operator keeping
registers on instruction are both lawful today; the licences, registrations and
relief are how each further feature is switched on; and the genuinely novel
question — a ledger being the register of members — is the one thing worth
asking a regulator to evaluate.

## 4. The reasoning

### Two operating models, one pivot

The law places register duties on the company and asks its licence questions of
whoever operates the register, so the analysis is split by operator:

- **A, the [company-hosted instance](company-hosted-instance.md).** A private
  company runs its own instance for its own shares and its own officers make
  every entry. No new legal person appears; the project supplies software, or
  at most hosts. It is the simplest legal position available, and where a first
  company can start with nothing to apply for.
- **B, the [registry service](registry-service.md).** One operator keeps the
  registers of many companies on their written instructions. The operator is a
  second legal person with an agreement per company and a boundary to hold. It
  is where the business is built.

The pivot is who makes the entries, not who hosts the servers. On position 4a's
reading, a host that never touches the register is an IT supplier, a provider
that makes entries on instruction is a clerk, and a provider that decides,
introduces or touches money is a financial service. The software's two deployment modes, single issuer and
registry ([product page](../product.md#roles-and-deployment-modes)), correspond
to the two models. Most of the licensing ladder in the
[pathway](regulatory-pathway.md#the-ladder) concerns model B, because a company
acting for itself rarely needs anything beyond a low-volume market registration.

### The registry-service model, and why the positions read it as needing no permission

- On the readings in positions 4a and 6 to 11: the company keeps the register
  under s168; the platform keeps it as the company's agent on written
  instructions, with a director's approval beside each entry. Preparing "a document of registration or transfer in order to
  complete administrative tasks on instructions from the person" is an exempt
  service under regulation 7.1.29(3)(g), listed in RG 36.41(f). The company
  issuing its own shares is not dealing (s766C(4)). A register lets nobody post
  an offer, so it is not a market (s767A). Nothing is held for anyone, so there
  is no custody and no digital asset platform. Nobody acts for a party in a
  transaction, so no AML/CTF designated service is provided. Each of those is a
  position with a trigger ([positions 4a, 6–11](positions.md)).
- The boundaries that keep it true are product rules: instruction-only,
  no introductions, no money, flat fees never per transaction, no keys held,
  directors decide. RG 36's indicators of arranging are the list of things not
  to build.
- **Why this model makes the licence question answerable.** The original
  position 4 could not be answered from free sources because it asked whether
  s708 reliance covered everything the platform does. In the registry model the
  platform makes no offer; the company does, off the platform, under s113(3) and
  Division 1A. The remaining question — is record-keeping a financial service —
  is one the regulations answer directly.
- **The register must be a stored, correctable record.** Section 175 lets a
  court order corrections, which an immutable ledger cannot honour; s173 requires
  availability for inspection, which a read that fails when a node is down does
  not give; s1306(3) asks for reasonable precautions against falsification,
  which a hash-chained append-only log provides without a chain. So the database
  is the register and the chain is at most a mirror ([position 6](positions.md#6-where-and-in-what-form-the-register-is-kept)).
- **The first client's transaction is an employee share issue.** A proprietary
  company may offer shares to employees without a disclosure document (s113(3)),
  and Division 1A of Part 7.12 needs only a statement where no money is paid.
  The company and its accountant do the offer; the register records the
  allotment, the certificate and the figures for the ASIC notice; the owner, as
  the recipient, should not be the only approver of their own entry.

### The fuller model, and why "we do not fit" is the wrong pitch

- ASIC has already licensed the model: FCX holds a Tier 2 market licence and a
  clearing and settlement facility licence for a ledger-settled market in
  unlisted company shares. The framework accommodates the model; it does not
  accommodate doing it small.
- The legislated sandbox never covered unlisted shares and is being repealed in
  favour of ASIC's ordinary relief powers, under which one can apply today
  (RG 51). Novel applications go to a slower queue and may be consulted on;
  minor-and-technical departures from existing relief do not.
- Project Acacia shows what a pilot instrument looks like: an exemption from the
  licence requirement and from market and clearing licensing, wholesale clients
  only, for a fixed period that ended on 28 February 2026. The RBA and DFCRC intend a standing
  digital financial market infrastructure sandbox in the second half of 2027,
  and the Government supports it.
- ASIC's own commissioned review (REP 835) names the legal status of
  distributed ledgers as registries as the priority to clarify, and warns
  against "digital twin" models. The one novel thing Ledova would bring is the
  ledger as register of record. The market part is not novel.
- ASIC's low-volume market instrument, whose operative text has not yet been
  read, exempts small markets from Part 7.2 on registration, and a crowd-funding
  intermediary appears on ASIC's register once per named company.
- Hence the ladder in the [pathway](regulatory-pathway.md#the-ladder): registry
  now; wholesale AFSL and AUSTRAC enrolment for issuance; low-volume
  registration per issuer for transfers; one targeted relief application or the
  2027 sandbox for the ledger layer; a Tier 2 licence as the end state.

## 5. Alternatives considered

| Alternative | What it would allow | Why it is not first, or its status |
| --- | --- | --- |
| Company-hosted instance, the software's `single_issuer` mode | The company keeps its own register on its own instance; no operator, no agreement, no licence fee | Now operating model A with [its own page](company-hosted-instance.md): the simplest legal position, where a first company can start; it earns the project nothing unless hosting or support is sold |
| Registry service on instruction | A first client now; features 1 and 6 for real | Chosen as rung 0B |
| Enhanced Regulatory Sandbox | 24 months without a licence | Unlisted shares ineligible; only a crowd-funding service would qualify; regime being repealed; poor track record |
| Crowd-sourced funding intermediary, possibly tested under the sandbox | Retail investment in proprietary companies through the platform, and CSF shareholders outside the cap of fifty | Needs an AFSL with a crowd-funding authorisation and gatekeeper duties; retail is not the current target; kept as the legislated retail path |
| Wholesale-only AFSL | Issuance and onboarding for s708 investors with no relief | Chosen as rung 1; blocked on a responsible manager and compliance budget |
| Low-volume market registration | Small transfer markets without a licence | Chosen as rung 2 |
| Individual relief for the whole model | A bespoke exemption from licensing, markets and disclosure | Would be a novel application to formulate new policy; ASIC has no reason to grant what FCX obtained by licence; rejected in favour of one narrow relief on the ledger question |
| No-action letter | Comfort on identified doubt | Not a foundation: needs doubt, binds no one, withdrawable; kept for single points |
| Wait for the thematic or DFMI sandbox | Regulator-led testing with peers | Timing is 2027 and not in the project's control; kept as the alternative venue for rung 3 |
| Tier 2 market licence plus CS facility licence | The full model | The end state; application fees alone run from five figures to six at the highest complexity; not a first step |
| Operate offshore or on the strength of "tokens are not securities" | — | Rejected: INFO 225 treats a token for a share as the share; the owner does not want to operate outside the law |

## 6. Assumptions

- Clients are Australian proprietary companies; the operator is in Australia;
  data is hosted in an Australian region. Nothing here has been checked for any
  other jurisdiction.
- The operating entity will be Blueberry Money or another company the owner
  controls; which one is open.
- No retail investors in any rung before crowd-sourced funding or a licence.
- The platform never receives subscription money and never holds keys for a
  member; money goes to the company's account, tokens are self-custodied or
  absent.
- The first client is the owner's employer, issuing shares to the owner as an
  employee under Division 1A, with the company's accountant handling the offer
  and the ASIC notices.
- The owner has no AFSL, no responsible manager and no compliance budget today.
- The chain is optional for the registry model; whether it becomes the register
  of record for a pilot is undecided.
- Positions 6 to 11 and the rewritten position 4 are drafts until the owner
  confirms them.
- Regulator pages and professional summaries were relied on where the primary
  text was not read; the pathway page lists which.

## 7. Positions and their status

All eleven are on the [positions page](positions.md) with their triggers.
Reviewed and carried over: 1, 2, 3, 5, with one model-binding sentence each in
2 and 5 drafted on 2026-09-15 and awaiting sign-off. Rewritten and awaiting sign-off: 4.
Drafted and awaiting sign-off: 6 (register location and form), 7 (a register is
not a market), 8 (AML/CTF), 9 (digital assets and custody), 10 (privacy),
11 (the company's own obligations). The owner confirms a position by removing
its draft marker in a later change.

## 8. Open questions

Each names why it matters and who decides.

1. **Which entity operates, and under what name.** Affects the agreement, the
   AFSL applicant, AUSTRAC enrolment and position 5. Owner.
2. **Is the database the register, with the chain off, for the first client?**
   Affects the entire build list below and whether rung 3 has anything to ask
   for. Owner; the assistant recommends yes.
3. **Remove the market features from the registry deployment, or leave them
   flagged off?** Less-is-more argues removal; the product definition argues
   keeping them. Owner; the assistant recommends flagging off until the first
   client is live, then deleting what was never turned on.
4. **Pricing.** Flat subscription is the recommendation; per-transaction fees
   are an indicator of arranging in RG 36. Owner.
5. **Is one low-volume registration per issuer, or one per platform, the right
   unit?** The register shows both single-company entries and a platform
   registered per named company; the instrument's text was not read. Investigate,
   then ask ASIC informally.
6. **Does the Digital Assets Framework Act's small-scale exemption reach tokens
   that are already financial products?** Changes the economics of a pilot, not
   the position. Investigate when ASIC's guidance appears.
7. **Which AML/CTF items catch a licensed Ledova beyond item 54?** Dealing in
   securities on behalf of a person, and handling money, may add items and full
   obligations. Investigate before rung 1.
8. **Does an in-app signature satisfy s1071B's "proper instrument of
   transfer"?** The details are in regulations not yet read; Part 1.2AA suggests
   yes for documents signed under the Act. Investigate before the first
   transfer is registered.
9. **Conflict of interest.** The owner would be employee, shareholder and
   operator of the registry recording their own issue. Mitigation is procedural:
   the director approves, the record shows who instructed and who approved.
   Owner to accept or change.
10. **When the sandbox regulations are repealed, and what ASIC's replacement
    looks like.** No date; the Minister's stated aim is a thematic sandbox
    underway "by next year". Watch.
11. **The remade low-volume instrument** after 1 October 2026: conditions and the
    value cap. Watch.
12. **The privacy exemption's removal date**, if any. Watch OAIC, not vendors.
13. **The registry services agreement's terms.** A document to write, not advice
    to buy. Owner and assistant.
14. **Whether to produce scheme reporting** (issue date, price, market value)
    from the register for clients' ATO obligations later. Product decision.
15. **Which operating model leads, and whether a managed single-company
    instance is the first paid product.** Hosting a company's own instance while
    its officers make the entries keeps model A's legal profile with something
    to sell; making entries for it moves to model B. Owner.

## 9. Next investigations

In the order they unblock work. Each says what to read and what it settles.

1. **Part 2 of ASIC Corporations (Low Volume Financial Markets) Instrument
   2016/888**, and the remade instrument after 1 October 2026. Settles the
   operator's conditions at rung 2 and question 8.5. The legislation register
   renders only in a browser.
2. **The Acacia instrument (F2025L00831) and its explanatory statement.**
   Settles the exact shape of a pilot exemption to copy at rung 3.
3. **The Corporations Regulations on the details a proper instrument of
   transfer must show**, and whether Part 1.2AA reaches it. Settles question
   8.8 before any transfer is registered.
4. **AML/CTF Act designated services Table 1 items for dealing in securities,
   and Table 6 in the amended Act**, rather than summaries. Settles positions 8
   and question 8.7.
5. **The Digital Assets Framework Act text**: the definitions of digital token,
   digital asset platform and tokenised custody platform, and the small-scale
   exemption. Settles question 8.6 and the wording of position 9.
6. **RG 105 and RG 166** for what a responsible manager and the base-level
   financial requirements actually demand of a wholesale-only licensee. Settles
   whether rung 1 is affordable.
7. **The Innovation Hub application form** and the Financial Innovation
   Committee's membership process. Settles how engagement starts.
8. **RG 261 and RG 262** in full, only if retail is ever wanted.
9. **The FCX operating rules and licence conditions** as published, for what a
   Tier 2 venue is held to. Settles the end state's real cost.
10. **Division 1A of Part 7.12** and the ATO's start-up concession pages in full,
    to replace the summaries behind position 11.
11. **State duties on unlisted share transfers**, which vary and were not looked at.
12. **The OAIC's reform page** for any legislated change to the small business
    exemption.

## 10. Engineering consequences already identified

For either operating model, in build order, each mapped to existing
documentation:

- A **stored, authoritative, append-only register** with hash-chained events
  for issues, transfers, cessations and corrections; the roadmap's Phase 2 item,
  and the answer to positions 1, 6 and 7. The chain-derived fold becomes a
  mirror or is switched off.
- **Import** of an existing register including former members within seven
  years, reconciled against the ASIC extract's share structure.
- **Issue and transfer workflows** with an attached instrument or resolution and
  a recorded director approval, reusing the reviewed-evidence pattern chosen for
  payslips.
- **Certificate PDF, ASIC notice figures export, and inspection copies** with a
  durable, queryable export record.
- **Two deployment configurations** matching the models, single issuer for A
  and registry for B, each with offerings, payments, classification, wallets,
  trading, payslips and the chain off by default, and an onboarding checklist
  without the business plan and risk disclosure. Model A additionally needs the
  instance to be installable by a company on its own, with the company's officers
  holding the product's operator role rather than a second party.
- A **registry services agreement** template and an onboarding checklist that
  includes Forms 909 and 991.

For the fuller model, nothing is built until the rung's permission exists; the
existing classification, offering and payment recording code is what rung 1
would switch on.

## 11. How the research was done

- Statute was read section by section from AustLII. AustLII sits behind a
  browser challenge, so scripted fetches fail; open one AustLII page in a real
  browser and fetch other sections same-origin from there. The Federal Register
  of Legislation renders instrument text only in a browser.
- Regulatory guides and reports were downloaded as PDFs and converted with
  `pdftotext`; the summaries a fetch tool returns for PDFs are unreliable.
- Fees were read from Schedule 1 of the Fees Regulations on AustLII, item by
  item.
- Where a primary text was not read, the pathway page says so, and this page's
  next investigations list it.
- Nothing on these pages should be cited as a legal conclusion. It is a reading,
  written down, awaiting the owner's sign-off where marked.

## 12. Conventions the owner has set for this work

- **Positions, not open questions.** A document that records questions nothing
  will close is worse than one that records a decision with its trigger; every
  position says what would show it wrong and which way to be wrong.
- **Never state a legal conclusion as fact.** It is the owner's reading; the
  owner signs off; the assistant drafts and marks drafts.
- **Answer what primary sources can settle; do not assemble a confident
  paragraph where being wrong is an offence.** Position 4b is deliberately
  reached only by licence, registration or relief.
- **Less is more.** Favour the simpler option; where a trade-off is meaningful,
  recommend and ask. Remove what a change makes redundant, in the same change.
- **Everything lands through a pull request**, documentation included, with an
  owning issue, and the documentation gate (`make check-docs`) green.
- **Product and legal decisions remain the owner's.**

## Glossary

| Term | Meaning |
| --- | --- |
| AFSL | Australian financial services licence, Part 7.6 of the Corporations Act |
| AML/CTF | Anti-Money Laundering and Counter-Terrorism Financing Act 2006 and its rules, administered by AUSTRAC |
| ASIC | Australian Securities and Investments Commission |
| CS facility | Clearing and settlement facility, licensed under Part 7.3 |
| CSF | Crowd-sourced funding, Part 6D.3A |
| DAF Act | Corporations Amendment (Digital Assets Framework) Act 2026 |
| DAP, TCP | Digital asset platform and tokenised custody platform, the two products the DAF Act creates |
| DFCRC | Digital Finance Cooperative Research Centre |
| DFMI | Digital financial market infrastructure |
| ERS | Enhanced Regulatory Sandbox, INFO 248, being repealed |
| ESS | Employee share scheme, Division 1A of Part 7.12 for offers and Division 83A of the tax Act for tax |
| FSL | Functional Source License, the code's licence |
| INFO | An ASIC information sheet |
| LVFM | Low volume financial market, Instrument 2016/888 |
| NTA | Net tangible assets, RG 166 |
| REP | An ASIC report |
| RG | An ASIC regulatory guide |
| Responsible manager | The person whose experience an AFSL applicant relies on, RG 105 |
| s708 | The exemptions from disclosure for offers to wholesale, sophisticated, professional and associated investors |
| Tier 2 | The lighter tier of Australian market licence in RG 172 |

Next: the [positions](positions.md) to confirm, then the
[pathway](regulatory-pathway.md) to act on.
