# Regulatory pathway

[Legal and regulatory](README.md) · [Positions](positions.md) · [Handover](handover.md)

What exists in Australia, as at 15 September 2026, for operating Ledova's fuller
model — issuance, investor onboarding, payments, tokenised shares, transfers —
under restriction and without breaching the law; what ASIC can and cannot
change; what only Parliament can change; the precedents; the costs; and a staged
path. It is the owner's reading of regulator pages and primary sources, written
down by the assistant, and it is not advice. The [positions](positions.md) page
records what the project has decided; this page records what it could apply for.
The [company-hosted instance](company-hosted-instance.md) and
[registry service](registry-service.md) pages say who the applicant would be in
each operating model; most of this page concerns the service, because a company
acting for itself rarely needs anything below rung 2.

## The frame

Three facts reorder the question from "the framework was not designed for us"
to "the framework has licensed this already, at a scale we cannot afford yet".

1. **The full model is licensed.** FCX, a FinClear subsidiary, holds the first
   Tier 2 Australian market licence for unlisted equities and funds and a
   clearing and settlement facility licence, granted in late 2024, and settles
   trades in private and unlisted public company shares atomically on a
   distributed ledger. Wholesale participants trade on their own behalf; retail
   holders may sell. That is the end state of the twelve-feature product
   definition, granted under existing law.
2. **The legislated sandbox excludes unlisted shares and is being repealed.**
   INFO 248's eligible products are listed securities, deposit and payment
   products, insurance, superannuation, simple schemes and Commonwealth
   debt; "fully paid ordinary shares" appear only for a crowd-funding service.
   The statutory review delivered to Government on 22 May 2026 found 19
   admissions from 103 applications and, of 16 leavers, 12 closures and one
   full licence. The Government response of 7 September 2026 agrees to repeal
   the sandbox "through a future legislation prioritisation process" and to let
   ASIC design a replacement "using existing relief powers", supports
   "thematic sandboxes, including digital financial market infrastructure
   sandbox arrangements, subject to resourcing and detailed design", and will
   convene a public-private financial innovation committee.
3. **The novel part is the register, not the market.** ASIC's commissioned
   landscape review, REP 835 of June 2026, names as a priority "clarifying
   whether distributed ledgers can operate as appropriate registries for
   issuance, which would support native tokenisation and shift away from
   digital twin models", and recommends a pathway that would "clarify the legal
   status of distributed ledgers as registries". Trading unlisted shares on a
   ledger is done; a ledger *being* the register of members is the open
   question, and it is the one this project would be bringing.

So an approach to ASIC that says "we do not fit the categories" invites the slow
queue for new policy. One that says "FCX-shaped, at pilot scale, inside these
volunteered conditions, plus one novel question about the register" is a
minor-and-technical departure from things ASIC has already done, with one
novel head.

## Mechanisms that exist

| Mechanism | What it gives | Limits and cost | Fit |
| --- | --- | --- | --- |
| ASIC Innovation Hub | Informal guidance, pre-application meetings, referrals; relaunched March 2026 | Free; eligibility is needing, seeking or newly holding an AFSL | First call, no downside |
| Enhanced Regulatory Sandbox (INFO 248) | Up to 24 months without a licence for eligible services; ASIC has 30 days to object to a notification | Unlisted shares ineligible; a crowd-funding service is eligible; $10,000 per retail client for securities and schemes, $5 million total; no relief from Chapter 6D, Part 7.9, design and distribution, client money, AML or privacy; being repealed | Poor, unless testing a crowd-funding service before repeal |
| Individual relief (RG 51) | Exemptions and modifications under s926A (Part 7.6 licensing), s741 (Chapter 6D), s791C (Part 7.2 markets, individual or class), s1075A (Part 7.11 transfers) and others, with conditions and sunsets | 28-day in-principle target for complete standard applications; novel applications take longer and may be publicly consulted; fees below | The actual door, and what the replacement sandbox will be built on |
| No-action letter (RG 108) | ASIC states it will not take action for described conduct | Needs "room for doubt" about lawfulness, a satisfactory compliance history and minimal third-party effect; binds neither courts nor third parties; withdrawable | Comfort for one identified doubt, never a foundation |
| Pilot instrument (Project Acacia, Instrument 2025/425) | Exemption from s911A and Parts 7.2 and 7.3 for wholesale project clients for a fixed period, expired 28 February 2026 | Granted to a regulator-led project, not on application | The template for what a Ledova pilot instrument would look like |
| Low volume financial market registration (Instrument 2016/888) | Operate a market without a licence while under the thresholds, on being named on ASIC's register | 100 completed transactions and $1.5 million (proposed $2.5 million) per twelve months, per market; application describes structure, products, participants and operator capacity; conditions in Part 2 of the instrument, not yet read | Strong fit for transfers, one registration per issuer |
| Crowd-sourced funding (Part 6D.3A, RG 261/262) | Retail investment in proprietary companies through a licensed platform; CSF shareholders do not count toward the cap of fifty | AFSL with a crowd-funding authorisation for one named platform; $5 million per company per twelve months; $10,000 per retail investor per company per year; five-day cooling-off; gatekeeper duties; the company needs two directors and annual reports | The legislated retail path, if retail is ever wanted |
| Tier 2 market licence, with a CS facility licence if the platform settles | The full model, FCX-style | RG 172 as proposed in April 2026: tier 2 is "most other licensed market venues", exempt from some obligations, still bound to a fair, orderly and transparent market, supervision and notifications; ASIC "would consider adapting licensing obligations … to facilitate emerging or specialised venues" (draft RG 172.56) | The end state |
| AUSTRAC exemption (s248) | Relief from AML/CTF provisions where risk is low, published with conditions | Only if a designated service is unavoidable | Rarely needed if the model avoids designated services |
| Policy engagement | Innovation Hub, the Financial Innovation Committee, ASIC's digital-asset standards consultations through 2027, the DFMI sandbox the RBA and DFCRC intend for the second half of 2027 | Time | Where "contributing to how the framework evolves" actually happens |

## Precedents worth citing

- **FCX** — Tier 2 market licence and CS facility licence, unlisted company
  shares and unit trust interests, DLT atomic settlement, tender and auction
  markets. Shows the model fits; sets the ceiling.
- **Project Acacia** — ASIC relief for tokenised asset settlement pilots,
  wholesale only, time-boxed, with the RBA and DFCRC. Shows what a pilot
  instrument contains; the RBA's final report and the DFMI sandbox follow from it.
- **Birchal on the low-volume register** — a crowd-funding intermediary
  registered as the operator of low-volume markets in the shares of named
  companies, updated as companies are added and cease. Shows per-issuer
  registration by a platform operator. Almost every other entry on the register
  of 8 September 2026 is a single company's own shares, mostly community bank
  companies, run as an electronic list of buyers and sellers who settle directly.
- **Advanced Share Registry** — a registry operator registered for a low-volume
  market in its own shares, processing the transfer at settlement through a
  third-party settlement agent. Shows a registry running a market without ceasing
  to be a registry.
- **Crowd-sourced funding intermediaries** — the only legislated shape in which
  a platform intermediates retail investment in proprietary companies.

## What ASIC can change, what it cannot, and what needs Parliament

**ASIC can exempt from or modify, with conditions and time limits:** the AFSL
requirement and the conduct and disclosure provisions of Chapter 7 (s926A,
s951B, s992B, s1020F); fundraising disclosure under Chapter 6D (s741); market
and clearing licensing under Parts 7.2 and 7.3 (s791C, s820C), for a person, a
market or a class since the 2024 financial market infrastructure reforms; the
transfer and certificate mechanics of Part 7.11 (s1075A); the place and form of
a register, through approvals under s172(1)(d) and s1306(1)(c); and the tier and
conditions of any market licence.

**ASIC cannot change:** the proprietary company limits in s113; the definitions
of financial product, dealing and financial market, which sit in the Act and in
regulations Treasury writes; the AML/CTF Act; the commencement or scope of the
Digital Assets Framework Act; tax; the Chapter 2C register obligations beyond
the two approvals above; privacy; state duties; or what a court decides.

**What needs Parliament or regulations:** retail secondary trading of
proprietary company shares at scale outside crowd-sourced funding or a licensed
market; any change to the fifty-shareholder cap or the bar on public offers by
proprietary companies; a purpose-built digital market infrastructure regime,
which the Financial Innovation Strategy of 3 September 2026 contemplates; the
repeal of the sandbox regulations; and any regulation prescribing that conduct
is or is not dealing or operating a market.

## Numbers

Fees from Schedule 1 of the Corporations (Fees) Regulations 2001, read on
15 September 2026:

| Application | Fee |
| --- | --- |
| Relief, approval, declaration or no-action letter under Chapters 2C, 6D, 7 and others, per head of power (item 80) | $3,487 |
| Exemption or declaration under s1075A, Part 7.11 (item 71) | $17,590 |
| Individual market exemption under s791C(1), on grant (item 34) | $38,651 |
| Individual clearing and settlement facility exemption under s820C(1), on grant (item 45) | $38,651 |
| Australian market licence application, low / medium / high complexity (item 40) | $15,462 / $85,888 / $154,596 |
| AFSL application, wholesale, body corporate, low / high complexity, lodged electronically (item 1) | $2,233 / $5,025 |

Thresholds that shape the choices:

| Threshold | Value | Source |
| --- | --- | --- |
| Low-volume market: transactions per twelve months | 100 | Instrument 2016/888 |
| Low-volume market: value per twelve months, current / proposed | $1.5m / $2.5m | Instrument 2016/888; CS 60 |
| Sandbox per retail client, securities and schemes | $10,000 | INFO 248 |
| Sandbox aggregate exposure | $5m | INFO 248 |
| Sandbox maximum duration | 24 months | INFO 248 |
| Crowd-sourced funding per company per twelve months | $5m | Part 6D.3A |
| Crowd-sourced funding per retail investor per company per year | $10,000 | Part 6D.3A |
| Digital asset platform small-scale exemption, per client / per year | under $5,000 / under $10m | Digital Assets Framework Act 2026 |
| Custodian net tangible assets, full / incidental | $10m / $150,000 | RG 166 |
| Proprietary company non-employee shareholders | 50 | s113 |

Fees for a licence do not include the responsible manager, compliance
arrangements and, for retail, professional indemnity insurance and dispute
resolution membership; professional estimates for an AFSL run from four to eight
months end to end.

## The ladder

Each rung is one the positions read as lawful without anyone's permission, or
names exactly the permission it needs. Relief is sought once, for the one thing
that is novel. Feature numbers refer to the owner's twelve-feature definition as
enumerated in the [handover](handover.md#2-what-ledova-is-and-where-the-code-stands).

| Rung | What it unlocks | What it needs | Still not allowed |
| --- | --- | --- | --- |
| 0A. [Company-hosted instance](company-hosted-instance.md) | Features 1, 6 and the record-keeping half of 7 and 9, for one company, now, with the company's own officers making every entry | The stored register, import and workflows in the [handover](handover.md#10-engineering-consequences-already-identified); the computer-storage notice if hosted away from the registered office | Tokens held for holders; transfers posted between holders without registration |
| 0B. [Registry service](registry-service.md) | The same, for many companies, on written instruction | The operating entity and the registry services agreement; Forms 909 and 991 by each company; the boundary built into the product; an Innovation Hub application | Offers, money, tokens held, transfers posted between holders |
| 1. Wholesale AFSL and AUSTRAC enrolment | Features 3, 4 and 10 for s708 investors; feature 5 with money paid straight to the company's account | AFSL authorisations for dealing and arranging in securities to wholesale clients; a responsible manager with relevant experience; RG 166 base-level financial requirements; an AML/CTF program (item 54 at least); no custody, no client money | Retail investors; holding tokens or money; a market |
| 2. Low-volume market registration per issuer | Feature 7 as a facility where holders post offers, up to 100 transactions and $1.5m (proposed $2.5m) per issuer per year | An application to be named on ASIC's register for each issuer's market; the instrument's Part 2 conditions; ceasing or licensing when a threshold is crossed | Anything above the thresholds; retail beyond what the instrument allows |
| 3. One targeted relief application, or the 2027 thematic sandbox | Feature 2 as the register of record: a ledger entry that is the transfer and the register, with the certificate replaced | A s1075A declaration on Part 7.11 mechanics and a s1306(1)(c) approval of the ledger as the register's form, framed like the Acacia instrument: wholesale only, capped, time-limited, reporting, sunset; a draft instrument, which RG 51 invites; or entry to the DFMI sandbox when it opens | Whatever the instrument does not name |
| 4. Tier 2 market licence, with a CS facility licence if Ledova settles | The full model at scale | Application, operating rules, supervision, notifications under draft RG 172.108, capital; a conditional s791C exemption can bridge from rung 2 | Nothing that the licence conditions forbid |

Rung 1 is the expensive step in people rather than fees: the responsible manager
requirement (RG 105) is the thing a one-person project does not have, and
without an AFSL issuance stays off the platform. Rungs 0 and 2 need no one.
Rung 3 is where the project would be contributing to the framework rather than
fitting inside it, and it is the rung the regulators have said they want to see
tested.

## How to frame an application

- **Ask early and narrowly.** RG 51.56: novel applications "should be made as
  early as possible"; ASIC "will refuse to grant relief if an applicant requires
  relief by a particular time" that leaves no time to consider it. Name each
  head of power; the fee is per head.
- **Volunteer the conditions.** Wholesale clients only, a transaction and value
  cap, a fixed period, reporting to ASIC, a sunset, and the ability to unwind:
  the Acacia instrument's shape. RG 51 weighs "the commercial benefit and any
  net regulatory benefit or detriment"; conditions are how the detriment is
  made minimal.
- **Show the precedent, not the gap.** FCX for the market, Birchal for
  per-issuer registration, Acacia for pilot relief. The only new question is the
  ledger as register, and REP 835 says ASIC wants that question answered.
- **Keep the digital twin out of it.** If the ledger merely mirrors a database
  register, there is nothing to ask for and nothing to test; position 6 already
  provides for a mirror. The application makes sense only if the ledger entry is to be
  the register of record for the pilot.
- **Do not lean on a no-action letter.** RG 108 requires doubt about lawfulness,
  binds no court and can be withdrawn. It is useful for one identified point,
  such as whether a specific transfer mechanism is a "proper instrument", not
  as the basis for a business.
- **Use the Innovation Hub first.** Eligibility is met once the operator is
  seeking an AFSL. The Hub cannot grant anything, but it is where the framing
  gets tested before a fee is paid.

## Dates to watch

| Date | Event |
| --- | --- |
| 31 March 2026 | Virtual-asset designated services in force; registration required before providing them |
| 1 July 2026 | Tranche 2 professional services designated services in force |
| 30 June 2026 | ASIC's class no-action position for digital asset businesses expired |
| 3 September 2026 | Financial Innovation Strategy released |
| 7 September 2026 | Government response to the sandbox review published |
| 1 October 2026 | Low-volume market instrument sunsets unless remade; qualified accountant instrument sunsets unless remade |
| 2026–2027 | ASIC consults on digital asset platform standards and guidance |
| 9 April 2027 | Digital Assets Framework Act commences; licence application window opens, with relief while applications are assessed |
| "By next year" (Minister, September 2026) | A thematic sandbox underway |
| Second half of 2027 | RBA and DFCRC digital financial market infrastructure sandbox |
| Not scheduled | Repeal of the sandbox regulations |

## What was verified, and what was not

Read in full: the Corporations Act sections and regulation 7.1.29 named in the
[positions](positions.md); Schedule 1 of the Fees Regulations; RG 36, RG 51 and
RG 108; the April 2026 draft of RG 172; INFO 248; REP 835; the sandbox review's
recommendations and the Government response; ASIC's low-volume register of
8 September 2026.

Taken from regulator web pages or professional summaries only: the operative
text of the Acacia instrument and of Part 2 of the low-volume instrument; the
Digital Assets Framework Act and its small-scale exemption; the AML/CTF Table 6
items and item 54; Division 1A of Part 7.12; RG 166's figures; RG 261/262
figures; FCX's licence conditions. Each is in the
[handover's next investigations](handover.md#9-next-investigations).

## Decisions this page does not make

1. Which rung is the goal for 2027: rungs 1 and 2, or only rung 0 while the
   register is rebuilt.
2. Whether an AFSL is affordable, given the responsible manager it requires;
   without it, issuance stays off the platform.
3. Whether the chain becomes the register of record for a pilot, or stays a
   mirror. That decides whether there is anything to ask ASIC for at rung 3.
4. Which operating model leads. The company-hosted instance is where a first
   company can start with nothing to apply for; the registry service is where the
   business is built and where every rung above 0 attaches.

Next: the [handover](handover.md).
