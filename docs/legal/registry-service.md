# Operating model B: a registry service

[Legal and regulatory](README.md) · [Company-hosted instance](company-hosted-instance.md) · [Positions](positions.md) · [Regulatory pathway](regulatory-pathway.md)

One operator hosts the platform and keeps the share registers of many private
companies, making each entry on the written instruction of that company's
authorised officers with a director's approval recorded beside it. The software
ships this shape as its registry deployment mode, the default
([product page](../product.md#roles-and-deployment-modes)).

This page is the project's reading of primary sources and regulator guidance,
not advice; the [positions](positions.md) it rests on are numbered where they
apply, and the drafted ones remain unconfirmed until the owner signs them off.

## Whom the law looks at

Both the companies and the operator. Each company still carries every duty for
its own register; the Act places them on the company and its directors and does
not move them because someone else keeps the book. The operator carries those
duties as the company's agent, and that agency exists only if it is written
down ([position 2](positions.md#2-section-168-who-is-obliged-to-keep-the-register)):
a registry services agreement naming the company's authorised officers,
requiring instructions in writing, fixing where the data is kept, promising an
export on exit, disclaiming advice, and capping liability. Without it there is a
hosted database and an unallocated duty.

The operator also carries its own risk as a business, which is the substance of
this page. It holds many companies' shareholders' personal information; it is
paid to act; and the financial services law asks whether a business that is paid
to act around securities is arranging in them. The reading in
[position 4a](positions.md#4a-a-registry-service-acting-only-on-instruction-is-not-a-financial-service)
is no while the operator stays a clerk, and the rest of this page is about what
"clerk" means.

## The clerk boundary

Arranging for someone to acquire or dispose of shares is dealing (s766C(2)),
which needs a licence. Regulation 7.1.29(3)(g) provides that preparing "a
document of registration or transfer in order to complete administrative tasks
on instructions from the person" is an exempt service; RG 36.41(f) lists it, and
RG 36.53 warns that clerical work exempt as individual conduct can still add up
to a licensable business "in many, but not all, cases" when a company is built
from it. RG 36's Tables 2 to 4 name the indicators of arranging: collecting and
passing on money, being paid when a deal happens, negotiating terms, and
providing a link without which the transaction would not occur.

The operator stays outside the perimeter, on that reading, while all of the
following hold:

- entries are made only on written instruction from a company's authorised
  officers, with a director's approval recorded;
- the operator introduces no investors and hosts no offer;
- it receives no money for shares;
- it holds no shares, tokens or keys for anyone;
- it charges a flat fee, never a fee per transaction;
- it exercises no discretion, because directors decide whether to register a
  transfer.

Each clause maps to an indicator in the guidance, so each is a line the product
must not cross by accident. Three lines describe what a provider can be: a
provider that only hosts a company's own instance and never touches the register
is an IT supplier ([model A](company-hosted-instance.md)); a provider that makes
entries on instruction is a clerk, exempt, and must stay exactly that; a provider
that decides anything, introduces anyone or touches any money is a financial
service. This model is the second line.

## Where the perimeter is for an operator

| Regime | When the operator crosses it | What it then needs |
| --- | --- | --- |
| Market licensing | When holders can post offers to each other through the platform, whether or not it matches or settles them (s767A). | Registration with ASIC as a low-volume market, one registration per company; a crowd-funding intermediary already appears on ASIC's register that way ([position 7](positions.md#7-a-register-is-not-a-financial-market)). Matching or settling trades at scale needs a market licence and possibly a CS facility licence, the shape FCX holds. |
| Financial services licensing | When the platform hosts a company's offer, checks investors' eligibility for it, introduces investors, takes money for shares, is paid per transaction, or holds shares, tokens or keys for holders. | An AFSL: dealing and arranging in securities, wholesale-only to begin, a responsible manager, base financial requirements, four to eight months; custody adds a $10m net tangible assets requirement. See the [pathway](regulatory-pathway.md#the-ladder). |
| AML/CTF | The Table 6 services in force since 1 July 2026 are not engaged by keeping a register on instruction; an AFS licensee that arranges any designated service is caught; exchanging, transferring or safekeeping virtual assets for customers has needed registration since 31 March 2026 ([position 8](positions.md#8-amlctf-obligations-of-the-operator)). | Nothing while a clerk; enrolment and a program once licensed; registration before touching stablecoins for a customer. Observing payments made straight to a company's own wallet is designed to stay outside. |
| Digital assets, from 9 April 2027 | Possessing tokens for or on behalf of holders; INFO 225 already treats a token that represents a share as the share, so holding them is custody today ([position 9](positions.md#9-digital-assets-and-custody)). | Never hold them. |
| Privacy | From the first real shareholder record: the operator holds other people's personal information for many companies ([position 10](positions.md#10-privacy)). | The Australian Privacy Principles built in regardless of the small-business exemption, data in Australia, and an agreement that allocates responsibility with each company. |

## Feature by feature

| Feature | Status in this model |
| --- | --- |
| Register of members, certificates, figures for notices, for many companies | No permission, within the clerk boundary |
| A company issues its own shares, including to employees | No permission if the offer happens off the platform and the operator records the result; licence if the platform hosts the offer |
| Recording transfers the directors approve | No permission, on written instruction |
| A board where holders post offers, settled between the parties | Register with ASIC, once per company |
| Matching or settling trades on the platform | Licence: market and settlement, the FCX shape |
| Taking money for shares | Avoid: route it to the company's account; holding it is client money and needs a licence |
| Finding investors, hosting an offer, checking eligibility | Licence: wholesale-only AFSL plus AML enrolment |
| Taking stablecoin payments | Avoid handling them: observe payments to the company's wallet only, or register as a virtual-asset service |
| Holding tokens or keys for holders | Avoid: custody licensing today, the 2027 regime after |
| The ledger as the register of record | Relief or the 2027 sandbox, as the [pathway](regulatory-pathway.md#the-ladder) sets out |

## Getting an operator to market

Lawful without permission from the first client, on the positions as drafted,
provided the boundary is built into the product rather than left to good
intentions.

1. **Choose the operating entity.** Every contract, privacy obligation,
   enrolment and licence attaches to it.
2. **Write the registry services agreement**: authorised officers, instructions
   in writing, director approval recorded, data kept in Australia, export or
   escrow on exit, no advice, flat fees, a liability cap, and an explicit
   statement that the company remains the keeper of its register.
3. **Build the boundary in.** No entry without an instruction and an approval on
   record; no offer pages; no payment collection; no wallets holding keys for
   holders; subscription pricing only.
4. **Host in Australia** with an append-only, tamper-evident log, an inspection
   export, and the seven-year record of former members.
5. **Onboard each company** with its ASIC extract, constitution, existing
   register including former members, and certificates; reconcile against
   ASIC's share structure; have the company lodge Form 909, naming the
   operator's place, and Form 991 for the computer storage.
6. **Add transfer boards by registration**, one low-volume market per company,
   when companies want them.
7. **Seek a wholesale-only AFSL** only when hosting offers is wanted, and enrol
   with AUSTRAC at the same time. The cost is a person, the responsible manager,
   more than a fee.
8. **Ask for relief on the ledger question** or enter the 2027 sandbox; keep the
   market licence as the end state.

| Cost | In this model |
| --- | --- |
| Licence and enrolment fees at the start | None: the clerk model needs no AFSL, market licence or AUSTRAC enrolment |
| What it does need | An entity, an agreement per company, Australian hosting, a privacy program, and the boundary enforced by the software |
| Later, if wanted | Low-volume registration per company; a wholesale AFSL at $2,233 or $5,025 plus a responsible manager; relief at $3,487 per head of power |

## What to avoid

This model becomes a financial service by accretion, one helpful feature at a
time: an introduction here, a payment there, a fee per transaction, a wallet
that holds a key. Each is a deliberate step with a named permission, never a
default.

- Making an entry without a written instruction and a recorded approval.
- Hosting a company's offer, listing it to investors, or checking investors'
  eligibility for it before holding an AFSL.
- Receiving money for shares, even briefly, even as a convenience.
- Holding tokens or keys for holders, or exchanging or transferring stablecoins
  for anyone.
- Charging per transaction, which is one of RG 36's indicators of arranging.
- Acting as nominee shareholder, providing a registered office, forming
  companies, or handling a transfer or a raise for a client, all designated
  services under the AML/CTF Act since 1 July 2026.
- Opening a transfer board before it is registered.
- Treating the ledger as the register without an approval.

## How this differs from the company-hosted instance

In the [company-hosted instance](company-hosted-instance.md) a company runs its
own instance and its own officers make every entry. No legal person is added, no
agreement is needed, and the project is only a software supplier; the company
carries the technical burden and the project earns nothing unless it sells
hosting or support. That model is the simplest legal position available and is
where a first company can be tomorrow. This model is where a company that keeps
registers for others is built: lighter than a licence, heavier than a
licence-free instance, and safe only while the boundary holds.

## Open questions

1. Which entity operates, and under what name.
2. Whether a low-volume market registration is per company or per platform.
   ASIC's register shows both single-company entries and a platform registered
   per named company; the instrument's text has not been read, and it is being
   remade on 1 October 2026.
3. Which AML/CTF services a licensed operator would provide beyond item 54, once
   it hosts offers.
4. Whether an instrument of transfer signed inside the platform is a "proper
   instrument of transfer" under s1071B.
5. Pricing: a flat subscription is the recommendation, because a fee per
   transaction is an indicator of arranging.

Next: the [regulatory pathway](regulatory-pathway.md) for the features beyond the
clerk boundary, and the [handover](handover.md) for the reasoning.
