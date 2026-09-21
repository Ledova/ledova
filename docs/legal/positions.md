# Legal positions taken without advice

[Legal and regulatory](README.md) · [Regulatory pathway](../regulatory-pathway.md)

Eleven questions the project depends on. Nobody qualified has been asked any of
them. Each position records what the source says, what the code does, the
reading the project acts on, what would show it wrong, which way to be wrong,
and the trigger that must happen before it matters. Read the provision before
relying on a summary of it; the [sources](README.md#sources) are listed once.

Positions 1 to 5 were carried over from the previous `docs/legal.md` and
reviewed on 2026-09-15; position 4 was rewritten because a registry that only
records changes its shape. Position 5 records the owner-directed licence change
of 2026-09-20. Positions 6 to 11 were drafted on 2026-09-15 by the
assistant from primary sources and are **not yet confirmed by the owner**.

The positions serve two operating models, the
[company-hosted instance](company-hosted-instance.md) (A) and the
[registry service](registry-service.md) (B). The "Binds" column says which
model a position is engaged by; where the reading differs between them, the
position says so.

| # | Question | Triggered by | Binds | Status |
| --- | --- | --- | --- | --- |
| 1 | s169(3) retention of former members | The first real company's first real member | A and B | Reviewed |
| 2 | s168, who is obliged to keep the register | The same moment, plus the terms between operator and company | B; in A the company keeps it itself | Reviewed; model sentence awaiting sign-off |
| 3 | Evidence retention period | The first real identity document held | A and B, once investor onboarding or the issuer KYC switch is on | Reviewed |
| 4 | Operating without an AFSL, in two halves | The first fee for a real register; the first real offer of a security | 4a binds B; 4b binds both | Rewritten, awaiting sign-off |
| 5 | Software licensing and commercial permission | Any commercial use or use of the code for a competing product or service | A, B and third-party users | Licence policy approved by owner 2026-09-20; not legal advice |
| 6 | Where and in what form the register is kept | The first real register | A and B, with different forms to lodge | Drafted |
| 7 | Whether a register is a financial market | Any feature where holders post offers to one another | A and B, with a different registrant | Drafted |
| 8 | AML/CTF obligations of the operator | Acting for a company in a transaction; holding an AFSL; touching virtual assets | B; a company acting for itself is not engaged | Drafted |
| 9 | Digital assets and custody | Any wallet whose keys Ledova holds for a member | A and B | Drafted |
| 10 | Privacy | The first real member's personal information | A and B | Drafted |
| 11 | The company's own fundraising and scheme obligations | The first issue recorded for a real company | A and B | Drafted |

Position 4 is the one where being wrong is an offence rather than a defect, and
its second half keeps the original stance: do not reach the trigger without a
licence, a registration or relief. The [regulatory pathway](../regulatory-pathway.md)
is the page about how those are obtained.

## 1. Section 169(3): members who ceased in the last seven years

**What the section says.** The register must include, for each person who
stopped being a member within the last seven years, the information the register
held about them and the date they stopped. The Act expressly permits those
entries to be **kept separately** from the rest of the register.

**Implementation.** See [current and former members](../architecture/register.md),
including the seven-year minimum and the separate former-member export.

**The position.** A derived current-holders view does not on its own satisfy
169(3), so the stored record exists. Keeping it separately is what the section
contemplates rather than a departure from it, which is why the export has two
sections rather than one merged list.

**What would show this wrong.** That a derived register satisfies 169(3) after
all — in which case the table is surplus and costs almost nothing. The
asymmetry is the whole reason to build it: being wrong in this direction wastes
a table, and being wrong in the other direction means the record that was
supposed to exist for seven years was never kept.

**The unresolved part is not the retention, it is the completeness.** The fold
reads `Transfer` events, so it sees every movement the chain records. What it
cannot see is a member who ceased before the class was deployed on this
platform. A company migrating an existing register onto Ledova brings history
the fold cannot reconstruct. An import now records those former members, and its
members' particulars, for a class already opened from the chain, checked against
the ASIC extract's figures. A class not yet on chain cannot be opened from an
import yet, and in either operating model that remains the first gap, because a
real company arrives with a register and former members already.

**Status.** Reviewed 2026-09-15; unchanged except the last three sentences, which
now describe the import.

## 2. Section 168: who is obliged to keep the register

**What the section says.** A company must set up and maintain a register of its
members. The obligation is expressed as the company's. The note to the section
says the register may be kept on computer, pointing to s1306.

**Implementation.** See [operator setup](../operations/operator-console.md) and
[register protection](../architecture/register.md).

**The position.** The company carries the obligation and the platform keeps the
register as its agent. That is the plain reading. In a
[company-hosted instance](company-hosted-instance.md) there is no agent: the
company keeps the register itself, and the agreement below is not needed; the
two deployment modes are one product serving those two legal arrangements.

**What this leaves undone, and it is not a legal question.** An agency
relationship has to exist in the terms between the operator and each company.
There are no such terms. That is a document to write, not advice to buy, and it
is the gap to close first because it is free to close. In the registry service
it is also the first onboarding artefact: a registry services agreement
naming the company's authorised officers, requiring instructions in writing,
fixing where the data is kept, promising an export on exit, disclaiming advice,
and capping liability.

**The export trail.** Each register export is recorded durably: the
requester, share class, register sequence, row counts and time. The records are
kept for staff: the operator can query them in admin, and no company-facing
route exposes them. They are kept for the seven-year floor the owner chose on
21 September 2026. The record says who took a copy, not what they did with it:
every download is still a full sheet of members' residential addresses.

**Status.** Reviewed 2026-09-15; the note pointing s168 to s1306 and the
agreement's contents added. The company-hosted-instance sentence was drafted
for the model split and awaits the owner's sign-off.

## 3. The evidence-retention period

**What the sources say.** Two separate obligations land on seven years for
records of this kind: the Corporations Act's financial-records provision, and
the AML/CTF customer-identification record requirements. Seven years is the
conventional Australian answer and the reason 2557 days was chosen.

**Implementation.** [Retention configuration](../operations/uploads.md) owns the
independent evidence and former-member settings;
[file lifecycles](../architecture/files-and-retention.md) owns the serving and
purge rules.

**The position.** Seven years, from review or expiry. The basis is the
convergence of the two obligations above rather than a considered view of which
one governs, and that is the weakness: they are different obligations with
different triggers, and it is possible that neither runs from the moment this
code measures from.

**What would show this wrong.** A period that runs from the end of the
relationship rather than from the review. That is a larger change than the
length — the model does not record a relationship-ending event at all — and it
is the answer to watch for rather than the number.

**Which way to be wrong.** Keeping evidence too long is a privacy exposure;
destroying it too early is a compliance failure that cannot be undone. Where the
two conflict, the code keeps the evidence, which is the recoverable direction.

**Status.** Reviewed 2026-09-15; unchanged. Note that neither operating model
collects an identity document until investor onboarding is switched on or the
operator turns on the issuer KYC switch, which requires a company's owner to be
identity-verified before the company is submitted for review; this position is
engaged only then. The issuer switch was added to this note on 2026-09-21.

## 4. Operating without a licence: the two halves

The original question was what would allow an operator to run this platform
without an Australian financial services licence (AFSL), and the original answer
was to not reach the trigger. The registry-service model splits the question.
One half can be answered from primary sources; the other keeps the original answer
and gains a [pathway](../regulatory-pathway.md) for reaching the trigger lawfully.

### 4a. A registry service acting only on instruction is not a financial service

**What the sources say.** Section 766A lists the financial services; keeping a
register is not among them. Section 766C(2) makes *arranging* for another person
to deal a dealing in itself, and s766C(4) provides that a body corporate's
transaction relating only to its own securities is not dealing — so the company
issuing its own shares is not dealing, and the question is only whether the
registry is arranging. Regulation 7.1.29 then provides that a person is taken
not to provide a financial service where the eligible service is provided in the
course of, is reasonably necessary for, and is integral to an *exempt service*,
and paragraph (3)(g) names as an exempt service: *arranging for another person
to deal "by preparing a document of registration or transfer in order to
complete administrative tasks on instructions from the person"*. RG 36.41(f)
lists that exemption. RG 36.52–53 add the warning: clerical work is exempt as
individual conduct, but "the aggregation of the individual clerical activities
carried out within that economic entity may (in many, but not all, cases)
amount to a financial services business of dealing, arranging and/or advising".
RG 36 Table 3 names the collection and transmission of money and benefits based
on sales as indicators of arranging; Table 4 says a computer link that is merely
a processing task the customer could have done themselves is not arranging,
while a "special direct link" without which the transaction would not occur
probably is.

**What the code does.** Today the register is a stored record, and
the platform also hosts offerings, subscriptions, payment recording, investor
classification and trading enabled by default for synthetic/testnet use — none of
which a registry service would run.
The [registry service](registry-service.md) page's feature table says which
features that model switches off or defers.

**The position.** A hosted register-of-members service is not a financial
service while all of the following hold: entries are made only on written
instruction from the company's authorised officers, with a director's approval
recorded; the service introduces no investors and hosts no offer; it receives no
subscription money; it holds no shares or tokens for anyone; it is paid a flat
fee, never per transaction; and it exercises no discretion, since directors
decide whether to register a transfer (s1072G lets a proprietary company's
directors refuse for any reason). Each of those clauses maps to an indicator in
RG 36, so each is a line the product must not cross by accident.

**What would show this wrong.** ASIC treating a hosted registry business as an
arranging business in aggregate despite instruction-only conduct; or a court
reading reg 7.1.29(3)(g) as confined to natural persons. Either would show as
enforcement against a share registry provider, of which none was found.

**Which way to be wrong.** Being wrong here is an offence, so the position leans
hard: every boundary above is documented, priced into the agreement, and
enforced by configuration, not by intention.

**Binds.** The [registry service](registry-service.md). A
[company-hosted instance](company-hosted-instance.md) has no operator to ask the
question of; a provider that only hosts such an instance and never makes an
entry is an IT supplier, not an arranger.

**Trigger.** The first fee charged for keeping a real company's register.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

### 4b. Issuance, payments and transfers need a licence, a registration or relief

**The question, as originally put.** The wholesale-client and
sophisticated-investor exceptions — s708 for offers, s761G for financial-product
advice — mean no retail disclosure document is required for offers made only to
investors who qualify. Whether that is the right exception, and whether it
covers everything the fuller model does, is a different question from whether
the classification is recorded correctly. The reading here is that it does not:
s708 relieves the *company* from disclosure and says nothing about a *platform*
that arranges the issue, so the platform's question is the licence, not the
exemption.

**What the code does.** `InvestorClassification` carries four categories and
deliberately not a fifth:

| Category | Provision |
| --- | --- |
| `product_value` | s708(8)(a) |
| `accountant_certificate` | s708(8)(c) |
| `professional_investor` | s708(11) / s761G(7)(d) |
| `associated_person` | s708(12) |

The experienced-investor category, s708(10) / s761GA, is absent on purpose: it
is the only one that turns on the operator holding an AFSL, and there is no
evidence this deployment does. That absence is the clearest statement in the
code of the position being described here.

**The position: do not reach the trigger without the permission the step needs.**
Operating a financial services business without a licence where one is
required is an offence, not a defect — the cost of being wrong is not
symmetrical with anything else on this page. So the platform stays on testnet
with synthetic data for issuance, payments and transfers until the operator
holds the AFSL authorisations, the market registration or the relief that the
[regulatory pathway](../regulatory-pathway.md) sets out, and the chain guards are
what make that a mechanism rather than an intention. This half binds both
operating models: in either, the licence question arises the moment the
platform rather than the company makes or hosts the offer.

**When it is worth paying for, it is one scoped question, not open-ended
advice.** The categories are enumerated, the provisions are named, the gaps are
listed, and what the software actually does is written down. A fixed-fee
opinion on a question that precise costs a small fraction of an open engagement
that starts with explaining the product.

**Dated follow-up.** The `accountant_certificate` category depends on who counts
as a qualified accountant, which is set by ASIC Corporations (Qualified
Accountant) Instrument 2016/786, due to sunset on 1 October 2026 and proposed to
be remade. [RG 154](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-154-certificate-by-a-qualified-accountant/)
is the guide. Recheck the instrument's status after that date; if the remade
instrument changes who may certify, this category's evidence rules change with it.

**Status.** Reframed 2026-09-15, awaiting sign-off. The stance that being wrong
is an offence is carried over; what changed is the release condition, from
"until someone qualified has answered this" to holding the permission each step
needs, and the sentence that this is not a question to answer by reading now
lives in the [folder's conventions](README.md#conventions).

## 5. Software licensing and commercial permission

**The decision.** On 2026-09-20 the owner directed the project to adopt the
[Ledova Noncommercial License 1.0](../../LICENSE) and keep the repository public
for learning and contributions. This is a custom source-available licence, not
an open-source licence or a lawyer-reviewed instrument.

**What the licence says.** Personal study, noncommercial education and research,
private noncommercial testing and preparing noncommercial contributions are
permitted. Sharing for those purposes requires the licence, copyright notices
and identification of modifications. Commercial use, including internal business
use, paid hosting and paid support, requires a separate written licence. So does
using the code to develop or offer a competing product or service, even for free.
These conditions extend to copies and modifications. There is no automatic
open-source conversion under the new licence.

**Who needs permission.** A company running the code for its own business and an
operator hosting it for other companies both need commercial permission. That
includes Blueberry Money: sponsorship transfers neither copyright nor commercial
rights. The repository contains no separate commercial agreement with that
company; this does not establish whether a private agreement exists. Contributors
retain their copyright; [contribution terms](../../CONTRIBUTING.md#licensing-of-contributions)
explain how their material is licensed. Software permission is separate from
financial-services permissions and the live-operation conditions.

**Earlier grants.** Releases before 2026-09-10 remain under Apache 2.0. Versions
published under FSL-1.1-ALv2 before this change keep that licence and its
irrevocable future Apache grant, effective two years after each version was made
available. The [previous licence at the pre-change commit](https://github.com/Ledova/ledova/blob/4f516468ef0788a73363a3175db2e32d6978cc3f/LICENSE)
records those terms. The new licence does not revoke rights already granted in
historical versions or previously licensed material, or replace third-party
licences. Keeping the history public leaves those versions accessible.

**The limits.** Public access allows inspection and downloading; GitHub's terms
also permit viewing and forking public repositories. A licence is a legal
permission boundary, not an access control. It does not stop independent
implementation of a competing product without using Ledova's protected material,
and it grants no general trademark permission.

**What would show the position wrong.** An applicable earlier grant, a
contributor's rights, third-party terms or a ruling on the custom wording could
limit a claimed restriction. The current text must not be presented as erasing
those rights or guaranteeing enforcement.

**Which way to be wrong.** Preserve existing grants and contributor ownership;
do not assert commercial rights that have not been obtained. Counsel should
review the custom terms before reliance on them in a commercial agreement or
enforcement action.

**Trigger.** Any commercial use or use of the code to develop or offer a
competing product or service, whether or not real securities or funds are involved.

**Status.** Licence policy approved by the owner on 2026-09-20. Implementation
tracked in [#661](https://github.com/Ledova/ledova/issues/661). No assignment of
copyright or separate commercial licence is created by this position.

## 6. Where and in what form the register is kept

**What the sections say.** Section 172(1) requires a company's register to be
kept at its registered office, its principal place of business in this
jurisdiction, "a place in this jurisdiction (whether of the company or of
someone else) where the work involved in maintaining the register is done", or
another place in this jurisdiction approved by ASIC. Section 172(2) requires
notice to ASIC within seven days when the register is established at, or moved
to, a place other than the first two (Form 909). Section 1301 lets a
corporation that records a book otherwise than in writing keep the record at a
*place of storage* different from the *place of inspection*, provided means are
provided at the place of inspection to make the matters available in written
form and the corporation has lodged a notice specifying both places (Form 991),
with fourteen days to notify any change. Section 1306 allows a book to be kept
"by recording or storing the matters concerned by means of a mechanical,
electronic or other device", or "in any other manner approved by ASIC", so long
as the matters are capable at any time of being reproduced in written form; and
s1306(3) requires the corporation to take "all reasonable precautions … for
guarding against damage to, destruction of or falsification of or in, and for
discovery of falsification of or in", the book. Section 173 gives anyone the
right to inspect the register, by computer where it is kept on one, and requires
a copy within seven days of a proper request. Section 175 lets a court order the
register corrected. Section 176 makes the register proof of its contents in the
absence of contrary evidence.

**What the code does.** The current-members register is
[stored](../architecture/register.md): each share class keeps an append-only,
hash-chained event log and the holdings it produces, and the register is read
from them with the chain unreachable. A correction is a compensating entry that
those holdings already reflect. A scheduled job reconciles the stored register
with the chain and retains each result. Former members are stored, and an
import records members' particulars and pre-platform former members for a class
opened from the chain.

**The position.** The stored database record is the register; anything on a
chain is at most a mirror of it. Three provisions decide that: s175, because an
immutable ledger cannot honour a court-ordered correction except by a
compensating entry that a reader must know to apply; s173, because a register
that returns an error when a third-party node is unreachable is not available
for inspection; and s1306(3), because a hash-chained, append-only event log is
the "reasonable precaution" against and for the discovery of falsification that
the section asks for, and it can be kept without a chain. The register is hosted
in an Australian region; the operator's Australian office is the place where the
work of maintaining it is done under s172(1)(c); the company lodges Form 909
and, because the record is stored on a computer elsewhere, Form 991. Both are
onboarding steps, not product features. In a
[company-hosted instance](company-hosted-instance.md) the company lodges only
the computer-storage notice, and only if the record sits away from its
registered office.

**The obligations the register has to make easy**, because they are the
company's and the product either serves them or causes them to be missed:

| Obligation on the company | Source | Limit |
| --- | --- | --- |
| Notify ASIC of a share issue | s254X | 28 days |
| Notify member and share-structure changes (proprietary companies) | s178A, s178C, s178D | with the s254X notice; otherwise 28 days |
| Certificate ready after an issue | s1071H(1) | 2 months |
| Certificate ready after a transfer is lodged | s1071H(3) | 1 month |
| Register a transfer only on a proper instrument of transfer | s1071B | every transfer |
| Copy of the register on a proper request | s173(3) | 7 days |
| Notice of where the register is kept | s172(2) | 7 days |
| Notice of a change of storage or inspection place | s1301(4) | 14 days |
| Former members retained | s169(3) | 7 years |
| Non-employee shareholders of a proprietary company | s113(1) | 50 |

Part 1.2AA (s110–110A) lets a document required or permitted to be signed under
the Act be signed electronically by a method that identifies the signer and
indicates their intention. Whether an instrument of transfer signed in-app
satisfies s1071B's "proper instrument of transfer", whose required details are
set by regulation, has not been checked against those regulations.

**What would show this wrong.** ASIC approving a distributed ledger as a form of
register under s1306(1)(c), or declaring an on-ledger transfer sufficient under
Part 7.11 — which is precisely the relief a [pathway](../regulatory-pathway.md)
route would seek, and the reason the ledger question is the novel one.

**Which way to be wrong.** A correctable record that is also mirrored on a chain
wastes a mirror. A chain that is the only record cannot be corrected, inspected
offline, or reproduced in writing when its node is down.

**Trigger.** The first real register.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 7. A register is not a financial market

**What the section says.** Section 767A(1) defines a financial market as a
facility through which offers to acquire or dispose of financial products "are
regularly made or accepted", or invitations regularly made that may reasonably
be expected to result in such offers. Section 767A(2)(a) excludes a person
making or accepting offers on their own behalf or on behalf of one party only.
Operating a financial market without an Australian market licence is prohibited
by Part 7.2; s791C lets ASIC exempt a particular market or person, or by
legislative instrument a class, with conditions and for a period. ASIC
Corporations (Low Volume Financial Markets) Instrument 2016/888 exempts a venue
with no more than 100 completed transactions and no more than $1.5 million in
value in a twelve-month period, on condition the operator is named on ASIC's
register; it sunsets on 1 October 2026 and ASIC has consulted (CS 60) on
remaking it with the value cap raised to $2.5 million.

**What the code does.** Secondary [trading](../architecture/trading.md) exists
behind a flag that is off by default. The register itself lets nobody post an
offer.

**The position.** A register of members, with transfers entered on instruction
after the parties have agreed elsewhere, is not a facility through which offers
are regularly made. It becomes one the moment holders can post an offer to other
holders through the platform, whether or not the platform matches or settles
them. At that moment the choice is registration as a low-volume market — ASIC's
register of 8 September 2026 shows one registration per issuer as an accepted
shape, including a crowd-funding intermediary that names the companies whose
shares trade through it — or a market licence. In a
[company-hosted instance](company-hosted-instance.md) the company itself is the
operator of such a board and the registrant; in a
[registry service](registry-service.md) the operator registers one market per
company.

**What would show this wrong.** ASIC treating a members-only notice board inside
a registry as a market; or the remade instrument narrowing who may register.

**Which way to be wrong.** Operating an unlicensed market is an offence; the
feature is not offered for real use until a registration or licence covers it.
The experimental deployment runs on synthetic data only, which does not engage
this trigger; see
[what bites now](README.md#what-bites-now-and-what-does-not).

**Trigger.** Any feature where holders post offers to one another.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 8. AML/CTF obligations of the operator

**What the sources say.** The AML/CTF Act's reforms have applied to
professional services, including trust and company service providers, since
1 July 2026. AUSTRAC's list of the new Table 6 designated services includes:
assisting a person in the planning or execution of a transaction to sell, buy
or otherwise transfer a body corporate (item 2); assisting with equity or debt
financing of a body corporate (item 4); assisting in the creation or
restructuring of a body corporate (item 6); acting as, or arranging for another
person to act as, a nominee shareholder (item 8); and providing a registered
office or principal place of business address (item 9). Separately, an AFS
licensee that arranges for a person to receive another designated service is
itself providing a designated service (item 54 of Table 1), with reduced
obligations where that is the only one. Virtual-asset services — exchanging,
transferring or safekeeping virtual assets for customers — have been designated
services since 31 March 2026 and require AUSTRAC registration before they are
provided. The AUSTRAC CEO may exempt a person from provisions of the Act under
s248 where the risks are low. These items were read from AUSTRAC's pages and
professional summaries, not from the amended Act.

**What the code does.** Investor onboarding and classification exist for the
fuller model; the registry model moves no money or tokens, and collects no
identity evidence unless the operator turns on the issuer KYC switch, which
requires each company's owner to be identity-verified before the company is
submitted for review.

**The position.** Keeping a register and preparing registration or transfer
documents on the company's instruction is not a Table 6 service, because the
operator is not acting for a party in the transaction, forming or restructuring
anything, or standing as nominee or registered office. The operator becomes a
reporting entity the moment it holds an AFSL and arranges issues (item 54 at
least), and a registrable virtual-asset service provider the moment it
exchanges, transfers or safekeeps stablecoins or tokens for a customer. Payment
in stablecoin straight to the company's own wallet, with Ledova only observing
the chain, is designed to stay outside that. A company running its own instance
is not a reporting entity for issuing its own shares or keeping its own
register, so this position binds the [registry service](registry-service.md).

**What would show this wrong.** AUSTRAC guidance treating the registration of
a share transfer on instruction as "assisting in the execution" of it under
item 2; or a reading of the virtual-asset items that catches a platform that
merely displays a company's incoming stablecoin payments.

**Which way to be wrong.** Enrolling with AUSTRAC when not required costs a
program and some reporting; providing a designated service unregistered is a
criminal offence. Where in doubt, enrol.

**Trigger.** Acting for a company in a transaction; holding an AFSL; touching a
virtual asset on a customer's behalf.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 9. Digital assets and custody

**What the sources say.** ASIC's INFO 225, updated in 2025 and read here from ASIC's summary page rather than the sheet itself, treats a token that
represents a share as the financial product it represents, and applies the
existing custodial and depository standards to any financial product "based on
any technology". The Corporations Amendment (Digital Assets Framework) Act 2026
received assent on 8 April 2026 and commences on 9 April 2027; it makes a
*digital asset platform* — a facility where the operator possesses digital
tokens for or on behalf of another person — and a *tokenised custody platform*
financial products whose operators need an AFSL, with a small-scale exemption
for operators holding under $5,000 per client and processing under $10 million
a year (whether that exemption reaches tokens that are already financial
products was not verified). ASIC's class no-action position for digital asset
businesses expired on 30 June 2026 and was available only to businesses
operating before 31 December 2025. RG 166 requires a custodian of financial
products to hold net tangible assets of $10 million or ten per cent of revenue,
or $150,000 where custody is incidental and under ten per cent of revenue.

**What the code does.** Share tokens are issued to whitelisted addresses and the
operator holds a signer for deployment; investors verify their own wallets.
Wallet functionality is part of the [product definition](../product.md).

**The position.** Ledova never possesses a token for or on behalf of a member,
in either operating model: in a company-hosted instance the company must not
hold tokens for its shareholders through the instance, and in a registry service
the operator must not. Members either hold their own keys or there are no tokens
in their hands at all. The [product definition](../product.md#4-self-custody-and-ownership-records)
settles this as a design decision, not only a legal position: self-custody, with
no Ledova-held key capable of seizing holdings. The moment a key for a member's
holding sits with the operator, the operator is a custodian of a financial
product today and a digital asset platform from April 2027, and the financial
requirements that follow are beyond this project.

**What would show this wrong.** ASIC guidance under the 2026 Act treating a
whitelisted, transfer-restricted registry token as something other than the
share it records; or the small-scale exemption being confirmed to cover
tokens that are financial products, which would change the economics rather
than the position.

**Which way to be wrong.** Not holding keys costs convenience for members.
Holding them without the licence and capital is an offence.

**Trigger.** Any wallet whose keys Ledova holds for a member.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 10. Privacy

**What the sources say.** The Privacy Act exempts a business with annual
turnover of $3 million or less unless it falls in a listed category. The OAIC's
current list includes health service providers, businesses that trade in
personal information for a benefit, Commonwealth contractors, credit reporting
bodies, and reporting entities under the AML/CTF Act. Removal of the exemption
has been recommended and announced as future work; no legislated removal date
was found on the OAIC's pages as at 15 September 2026, and vendor claims of one
should not be relied on.

**What the code does.** The register holds members' names and residential
addresses; exports include them; classification evidence and payslips carry
retention settings ([position 3](#3-the-evidence-retention-period)).

**The position.** In a company-hosted instance the Privacy Act question attaches
to the company under its own status; in a registry service it attaches to the
operator as well. Whether or not the exemption applies to the operator on a
given day, the platform is built to the Australian Privacy Principles: a
privacy policy, collection limited to what the register and the client's
instructions need, access and correction on request, breach notification
readiness, and no tax file numbers, which the registry model has no reason to
collect because it pays no dividends. The client company will ask for this, and
becoming an AML reporting entity or trading in personal information would
remove the exemption without notice.

**What would show this wrong.** Nothing would make building to the principles
wrong; what could change is the date compliance stops being voluntary.

**Trigger.** The first real member's personal information.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 11. The company's own fundraising and scheme obligations

**What the sources say.** Section 113(3) forbids a proprietary company from
engaging in any activity that would require disclosure under Chapter 6D, except
an offer of its shares to existing shareholders or employees, or a crowd-sourced
funding offer; s113(1) caps non-employee shareholders at fifty, counting joint
holders once and excluding employees and crowd-sourced funding shareholders.
Division 1A of Part 7.12, in force since 1 October 2022, gives employee share
scheme offers by an unlisted company relief from disclosure, licensing,
advertising and hawking rules: an offer must state that it is made under the
Division; an offer for no monetary consideration needs only that statement;
where participants pay, the cap is $30,000 per participant per year plus
seventy per cent of dividends and cash bonuses, with unused amounts accruing.
The ATO's start-up concession for employee share scheme interests requires the
company to be incorporated less than ten years, unlisted, with turnover under
$50 million, the discount on shares to be at most fifteen per cent of market
value, and the interests held for three years. The Division 1A and concession
details come from professional and ATO summaries, not the enacted text.

**What the code does.** The [offerings flow](../architecture/offerings.md) hosts
offers; the registry model does not.

**The position.** Every obligation in this position belongs to the company and
its advisers. In the registry model Ledova records the outcome — the allotment,
its date, the number, class and price, the amount paid — and stores the board
resolution and the offer and acceptance as evidence beside the entry, so the
company's later scheme reporting and any concession claim can be substantiated
from the register. Ledova does not prepare, host or send the offer; the moment
it does, [position 4b](#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief)
applies. The candidate first client's issue to an employee fits s113(3)(a)(ii)
and Division 1A without the platform's involvement in the offer.

**What would show this wrong.** Nothing in the reading; what could go wrong is
the company relying on the platform's fields as if they were the scheme's
documents.

**Trigger.** The first issue recorded for a real company.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## Related documents

[Product decisions](../decisions.md), [operator setup](../operations/operator-console.md),
[retention configuration](../operations/uploads.md), [register design](../architecture/register.md),
the [regulatory pathway](../regulatory-pathway.md),
and the authoritative [LICENSE](../../LICENSE).
