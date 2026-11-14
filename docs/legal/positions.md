# Legal positions taken without advice

[Legal and regulatory](README.md) · [Regulatory pathway](../regulatory-pathway.md)

**Current positions, recorded from 15 September 2026 and dated individually below.**
The [3 October 2026 one-product decision](../plans/company-managed-registers/plan.md)
and the [4 October 2026 minimal-involvement decision](../decisions.md#company-representative-verification)
postdate the historical readings on this page. Position 4 was reassessed for
the registry-only scope on 9 November; other positions retain their own dates. Neither product decision establishes a
legal conclusion, and platform payment, crypto and support functions must be
assessed on what they actually do. Where a position's "What the code does"
names platform staff, the [current capability boundaries](../product.md#current-capability-boundaries)
say what staff still do; register entries run under company appointments. The
4 October decision also sets
the rule that no impersonation or fraud verification is added unless a legal
duty on Ledova requires it, and sends any such duty here to be raised with the
owner with its source.

These are the project's positions from primary sources, not professional opinions.
Each position has the [same parts](README.md#how-a-position-is-written).
Read the provision before relying on a summary of it; the
[sources](README.md#sources) are listed once.

Positions 1 to 5 were carried over from the previous [legal note](https://github.com/Ledova/ledova/blob/6ddae7f87ba05d6d7271b43225d261a42b25e111/docs/legal.md) and
reviewed on 2026-09-15; position 4 was rewritten because a registry that only
records changes its shape. Position 5 records the owner-directed licence change
of 2026-09-20. Positions 6 to 9 and 11 retain their dated draft status. Position 4 was
reassessed on 9 November; position 10 records the accepted privacy direction.
Neither owner acceptance nor source review is professional legal clearance.
Position 12 records the 9 November 2026 replacement of the earlier PyMuPDF dependency;
its historical licensing analysis remains in Git history.

The "Binds" column names the [historical analysis](README.md#historical-analyses-a-and-b)
that engaged each position; where the earlier reading differs between them, the
position says so.

| #   | Question                                             | Triggered by                                                                    | Binds                                                            | Status                                                        |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | s169(7) retention of former members                  | The first real company's first real member                                      | A and B                                                          | Reviewed                                                      |
| 2   | s168, who is obliged to keep the register            | The same moment, plus the terms between operator and company                    | B; in A the company keeps it itself                              | Reviewed; analysis A sentence awaiting sign-off               |
| 3   | Evidence retention period                            | The first real identity document held                                           | A and B, once investor onboarding or the issuer KYC switch is on | Reviewed                                                      |
| 4   | Financial-services boundaries | Actual real-data activity, before any fee | Current service; historical A/B | Source-based assessment, 2026-11-09 |
| 5   | Software licensing and commercial permission         | Any commercial use or use of the code for a competing product or service        | A, B and third-party users                                       | Licence policy approved by owner 2026-09-20; not legal advice |
| 6   | Where and in what form the register is kept          | The first real register                                                         | A and B, with different forms to lodge                           | Drafted                                                       |
| 7   | Whether a register is a financial market             | Any feature where holders post offers to one another                            | A and B, with a different registrant                             | Drafted                                                       |
| 8   | AML/CTF obligations of the operator                  | Acting for a company in a transaction; holding an AFSL; touching virtual assets | B; a company acting for itself is not engaged                    | Drafted                                                       |
| 9   | Digital assets and custody                           | Any wallet whose keys Ledova holds for a member                                 | A and B                                                          | Drafted                                                       |
| 10  | Privacy                                              | The first real member's personal information                                    | A and B                                                          | Drafted                                                       |
| 11  | The company's own fundraising and scheme obligations | The first issue recorded for a real company                                     | A and B                                                          | Drafted                                                       |
| 12  | PDF runtime licensing | Backend builds and distributions | A, B and third-party users | PyMuPDF replaced 2026-11-09 |

Position 4 distinguishes the current recordkeeping assessment from regulated
expansion. Required legal permissions remain necessary if an activity reaches
their trigger; a paid opinion is not itself a software release requirement.

## 1. Section 169(7): members who ceased in the last seven years

**What the section says.** The register must include, for each person who
stopped being a member within the last seven years, the information the register
held about them and the date they stopped. The Act expressly permits those
entries to be **kept separately** from the rest of the register.

**Implementation.** See [current and former members](../business/register.md#former-members),
including the seven-year minimum and the separate former-member export.

**The position.** A derived current-holders view does not on its own satisfy
169(7), so the stored record exists. Keeping it separately is what the section
contemplates rather than a departure from it, which is why the export has two
sections rather than one merged list.

**What would show this wrong.** That a derived register satisfies 169(7) after
all — in which case the table is surplus and costs almost nothing. The
asymmetry is the whole reason to build it: being wrong in this direction wastes
a table, and being wrong in the other direction means the record that was
supposed to exist for seven years was never kept.

**The unresolved part is not the retention, it is the completeness.** The fold
reads `Transfer` events, so it sees every movement the chain records. What it
cannot see is a member who ceased before the class was deployed on this
platform. A company migrating an existing register onto Ledova brings history
the fold cannot reconstruct. An import now records those former members, and its
members' particulars, checked against the ASIC extract's figures: it adds them to
a class already opened from the chain, and for a class not yet on chain it is the
opening itself. Completeness then rests on the register the company brings,
which the ASIC extract checks only for current holdings.

**Status.** Reviewed 2026-09-15; unchanged except the last three sentences, which
now describe the import.

## 2. Section 168: who is obliged to keep the register

**What the section says.** A company must set up and maintain a register of its
members. The obligation is expressed as the company's. The note to the section
says the register may be kept on computer, pointing to s1306.

**Implementation.** See [operator setup](../operations/operator-console.md) and
[register protection](../engineering/records.md#deletion-protection).

**The position.** The company carries the obligation and the platform keeps the
register as its agent. That is the plain reading. In a
[company-hosted instance](company-hosted-instance.md) there is no agent: the
company keeps the register itself, and the agreement below is not needed;
historical analyses A and B therefore differ on this point.
The current plan removes the software modes and assigns ordinary register work
to companies; the agency reading and any required terms must be revisited
against the actual replacement service.

**Current service terms.** The earlier analysis proposed an agency agreement and
said none existed. The owner has since accepted registry-only Terms v2026-11-09
under Blueberry Money, preserving company responsibility and promising the
available exports. They do not claim to appoint Ledova as the company's legal
register keeper or establish legal sufficiency of that historical agency reading.
On 14 November 2026 the owner directed Terms v2026-11-15, prepared without legal
review: Ledova is described as technology infrastructure that reviews and approves
nothing, and the company takes responsibility for its records, decisions,
regulatory compliance, shareholder eligibility and identity checks, with an
indemnity for claims arising from its own records or breach
([decision](../decisions.md#terms-as-technology-infrastructure)). The Terms say
that using Ledova does not make Blueberry Money the company's agent or register
keeper, but a contract cannot settle what the operator actually does. Nor can
it remove the operator's own obligations: privacy law, the Australian Consumer
Law guarantees and the unfair contract terms rules for standard-form contracts
with consumers and small businesses, any licence that actual conduct requires,
and s174 duties if the service in fact maintains a statutory register. The Terms
apply their exclusions only as far as the law allows.
The [launch position](#registry-only-launch-preparation) records remaining live
supplier/legal assessment and complete company-disposal gates.

**The export trail.** Each register export is recorded durably: the
requester, share class, register sequence, row counts, time and whether the
company's own pages or platform admin produced it. Staff can query them all in
admin. A company's current register readers and administrators see only the
inspection copies and packs recorded as produced through the company's own
pages; no record of an output produced in admin, such as a pack produced on a
document that compels disclosure, is shown to the company. They are kept for the seven-year floor the owner chose on
21 September 2026. The record says who took a copy, not what they did with it:
every download is still a full sheet of members' residential addresses. The
[company pack](../business/member-records.md#the-company-pack), the export on exit that the
agreement would promise, is recorded the same way, once for each share class it
carries, with the instruction it was produced under, its recipient and the
SHA-256 of its manifest.

**Status.** Reviewed 2026-09-15; the note pointing s168 to s1306 and the
agreement's contents added. The company-hosted-instance sentence was drafted
when the page split into historical analyses A and B and awaits the owner's
sign-off.

## 3. The evidence-retention period

**What the sources say.** Two separate obligations land on seven years for
records of this kind: the Corporations Act's financial-records provision, and
the AML/CTF customer-identification record requirements. Seven years is the
conventional Australian answer and the reason 2557 days was chosen.

**Implementation.** [Retention configuration](../operations/configuration.md#storage-uploads-and-retention) owns the
former-member setting;
[file lifecycles](../engineering/security.md#deletion-and-retention) owns the serving and
purge rules. The classification-evidence and payslip clocks went with investor
eligibility on 2 November 2026 ([decision](../decisions.md#verification-limited-to-id-checks)).

**The position.** Seven years, from review or expiry, while Ledova kept
classification evidence and payslips. It keeps neither now: on 2 November 2026
the removal migrations deleted every retained evidence file and payslip, with
their records, whatever remained of each clock
([decision](../decisions.md#verification-limited-to-id-checks)). The basis was the
convergence of the two obligations above rather than a considered view of which
one governs, and that was the weakness: they are different obligations with
different triggers, and it is possible that neither ran from the moment the
code measured from.

**What would show this wrong.** A period that runs from the end of the
relationship rather than from the review. That is a larger change than the
length — the model does not record a relationship-ending event at all — and it
is the answer to watch for rather than the number.

**Which way to be wrong.** Keeping evidence too long is a privacy exposure;
destroying it too early is a compliance failure that cannot be undone. Where the
two conflicted, the code kept the evidence, the recoverable direction, until the
owner chose deletion with the removal of investor eligibility.

**Status.** Reviewed 2026-09-15; unchanged. Note that in neither historical
analysis is an identity document collected until investor onboarding is
switched on or the operator turns on the `issuer_kyc_required` setting, which
requires a company appointee to be identity-verified before their appointment
is effective; this position is engaged only then. The issuer switch was added to
this note on 2026-09-21.

## 4. Financial-services boundaries

**Source-based assessment, checked 9 November 2026.** The owner directs a free,
company-controlled registry and ownership mirror, without commissioning advisers
or making a paid opinion a project prerequisite. This is the project's reasoned
position, not legal advice, regulatory approval or a guarantee of exemption.
Earlier analysis of the larger trading platform remains in Git history.

### 4a. Company-directed recordkeeping and the administrative boundary

**What the sources say.** The [Corporations Act](https://www.legislation.gov.au/C2004A00818/latest/text)
requires a company's own register under ss168–169. ASIC receives specified
notifications, not every underlying record; its
[members-register guide](https://www.asic.gov.au/for-business-and-companies/companies/company-share-and-shareholder-rules-and-changes/members-register-requirements-and-changes)
explains the top-20 qualification for larger proprietary-company registers.
The company must keep its legal register and handle its own required notices.
A service actually engaged to maintain the statutory register can also have
inspection/copy duties under s174; calling it a mirror does not decide that fact.

Sections 766A–766C and 911A concern the actual financial services business,
including advice, dealing and arranging. The own-securities provision in
s766C(4), subject to s766C(5), concerns the company itself; it is not automatic
protection for its supplier. Section 18 includes business without a profit
purpose. **The assessment starts before real operation, not at the first fee.**

[Regulation 7.1.29](https://www.legislation.gov.au/F2001B00274/latest/text),
particularly (1) and (3)(g), addresses administrative registration/transfer
preparation on instructions, subject to its conditions. It is relevant to the
proposed boundary, not a blanket exemption for hosted registries.
[ASIC RG 36](https://download.asic.gov.au/media/wdnk4aja/rg36-published-8-june-2016-20220328.pdf),
paragraphs 36.42–53 and 36.59, considers the provider's role in bringing a
transaction about and warns that aggregated clerical activities can amount to a
financial-services business. Systematic activity need not seek profit. No fee,
commission or money handling helps describe our scope; none alone proves an exemption.

**What the code does.** The [registry-only boundary](../engineering/chain.md#registry-only-execution-boundary)
refuses new payment, trading, wallet and chain-execution admissions through APIs,
services and jobs. Company appointees record existing ownership, externally
arranged capital, awards and company-authorised changes with retained authority,
evidence and event dates. Ledova neither introduces investors nor collects the
investment money. Allotment and transfer **Approve** can also apply the local
ledger change and update recorded holdings; a non-paid grant applies separately.
Those paths make no bank, chain or ASIC call. Unsigned certificates are prepared
separately. Companies retain their legal records and filings. The
[current capability boundaries](../product.md#current-capability-boundaries)
and [issue workflows](../business/issuing-shares.md) describe what is delivered.

**The position.** Keep Ledova a company-directed records tool. Companies choose
participants and terms, make corporate decisions and supply the authority;
software validates and records their instructions. Describe those concrete roles
rather than calling Blueberry an investment intermediary. Open code and no fees
are useful project characteristics, not substitutes for assessing conduct.

**What would show this wrong.** An issue/transfer action that legally brings a
transaction into effect on another person's behalf, platform discretion over
investors or terms, introductions or offers, recommendations, money/custody, or
an actual statutory-register agency arrangement. Trace what **Approve** does
against this boundary; an external agreement and a disclaimer do not settle the
question on their own. Narrow or defer conduct whose basis cannot be supported;
do not infer an exemption from labels or fabricate a licence.

**Status.** The owner selected this source-based assessment approach on 9 November.
It is not a finding that every workflow qualifies for the administrative provision.
Record material uncertainty and revisit it when conduct changes. Paid advice can
remain optional; legal permissions required by the actual activity cannot.

### 4b. Activities beyond the registry scope

Investment recommendations, offers or investor introductions, matching or trading,
collecting money, custody and new chain execution stay outside this release. If a
future feature involves a regulated activity, obtain its necessary permission or
leave it unavailable; neither a free service nor a company's disclosure exception
provides a general platform exemption. The [regulatory pathway](../regulatory-pathway.md)
records the earlier expansion routes and is not a requirement to commission an
adviser before doing the current software work.

The company's own issue, transfer and employee-scheme obligations remain its
responsibility ([position 11](#11-the-companys-own-fundraising-and-scheme-obligations)).
ASIC notifications and a company declaration do not by themselves establish that
an issue was lawful. We make no such guarantee.

**Status.** The current registry-only exclusions remain enforced. Any expansion
needs a new owner decision and an assessment of the actual changed activity.

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
rights. On 9 November 2026 the copyright owner accepted the operator-specific permission
now recorded in section 6 of [LICENSE](../../LICENSE), for the software he owns. It grants
Blueberry Money use, modification, hosting and distribution for the Ledova service and
client applications, including commercial use, without transferring copyright. It
grants no other contributor’s or supplier’s rights. Contributors
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
tracked in [#661](https://github.com/Ledova/ledova/issues/661). The 9 November 2026 operator grant is recorded in LICENSE; this position itself
assigns no copyright or third-party rights. Git authorship review found no separate
human contributor in the post-noncommercial change set, but is not proof of ownership
of every line; earlier grants and third-party notices remain.

## 6. Where and in what form the register is kept

**What the sections say.** Section 172(1) requires a company's register to be
kept at its registered office, its principal place of business in this
jurisdiction, "a place in this jurisdiction (whether of the company or of
someone else) where the work involved in maintaining the register is done", or
another place in this jurisdiction approved by ASIC. Section 172(2) requires
notice to ASIC within seven days when the register is established at, or moved
to, a place other than the first two (Form 909). Section 1301 lets a
corporation that records a book otherwise than in writing keep the record at a
_place of storage_ different from the _place of inspection_, provided means are
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
[stored](../engineering/records.md#register-ledger): each share class keeps an append-only,
hash-chained event log and the holdings it produces, and the register is read
from them with the chain unreachable. A correction is a compensating entry that
those holdings already reflect. A scheduled job reconciles the stored register
with the chain and retains each result. Former members are stored, and an
import records members' particulars and pre-platform former members, and opens a
class not yet on chain from the company's register. Company appointees prepare
the s173(3) copy in **Documents** → **Inspection copies**
([inspection copies](../business/member-records.md#inspection-copies)),
on the company's written instruction: the register CSV, with the request date, the
instruction's reference and the recipient, marked late when prepared more than
seven days after the request. Ledova keeps its SHA-256 and the request details,
not the file; the company decides whether a request is proper and hands the copy
over. See [inspection copies](../business/member-records.md#inspection-copies).
Company register readers prepare certificates for an issue or transfer entry:
an unsigned PDF with a page for the member the entry moved shares to and a
balance certificate for a transferor who still holds shares, which the company
executes. Each page states the amount paid and the amount unpaid on its shares
(s1070C) where the register records them for exactly those shares, and Not
recorded otherwise. Ledova keeps its SHA-256 and the entry's number, not the
file. See [certificates](../business/member-records.md#certificates).
Staff prepare the figures for the company's notices of share issues and of
changes to its members and share structure, on its written instruction: the
issues, transfers and corrections entered from a chosen day, the class at the
register head and each changed member's holding, with amount paid only where it
is established. Ledova keeps their SHA-256 and the period, not the file, and the
company lodges the notices. See
[notice figures](../business/member-records.md#notice-figures).
A list in admin shows staff which certificates and notice figures are still due
and when, from the register and those records; it records nothing, and does not
know what the company lodged or delivered. See
[outputs due](../business/member-records.md#the-due-list).

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

| Obligation on the company                                         | Source              | Limit                                    |
| ----------------------------------------------------------------- | ------------------- | ---------------------------------------- |
| Notify ASIC of a share issue                                      | s254X               | 28 days                                  |
| Notify member and share-structure changes (proprietary companies) | s178A, s178C, s178D | with the s254X notice; otherwise 28 days |
| Certificate ready after an issue                                  | s1071H(1)           | 2 months                                 |
| Certificate ready after a transfer is lodged                      | s1071H(3)           | 1 month                                  |
| Register a transfer only on a proper instrument of transfer       | s1071B              | every transfer                           |
| Copy of the register on a proper request                          | s173(3)             | 7 days                                   |
| Notice of where the register is kept                              | s172(2)             | 7 days                                   |
| Notice of a change of storage or inspection place                 | s1301(4)            | 14 days                                  |
| Former members retained                                           | s169(7)             | 7 years                                  |
| Non-employee shareholders of a proprietary company                | s113(1)             | 50                                       |

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

**What the code does.** Secondary [trading](../business/trading.md) exists in the
API behind the `trading_enabled` flag. Fresh installation seeds it off; this does not change
an existing database's stored flag. An operator can change it, and the web app has had no Market
page since 29 October 2026.
The register itself lets nobody post an offer.

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

**Implementation and earlier service assumption.** Investor onboarding,
payment recording and token workflows exist in the software.
The earlier clerk-only service proposal assumed no movement of money or tokens;
the retired deployment mode did not enforce that whole proposal. The operator's
`issuer_kyc_required` setting requires a company appointee to be
identity-verified before their appointment is effective. The replacement
company-managed workflows and retained platform functions need their own
assessment.

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
_digital asset platform_ — a facility where the operator possesses digital
tokens for or on behalf of another person — and a _tokenised custody platform_
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
in either historical analysis: in a company-hosted instance the company must not
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
addresses; exports include them. The seven-year clock removes selected former-member
rows, not every immutable snapshot or document copy ([position 1](#1-section-1697-members-who-ceased-in-the-last-seven-years)).

**The position.** Assess both the operator and each company's actual activities;
neither a free service nor low turnover establishes an exemption. Follow the
Australian Privacy Principles as the design baseline, without claiming that the
implementation already satisfies them. The current preview notice, partial
account closure and experimental evidence retention do not establish readiness
for real personal information. No tax file numbers are requested.

### Registry-only launch preparation

**Accepted direction, 8–9 November 2026.** The owner selected Blueberry Money Pty Ltd
(ACN 691 391 214) to operate a free registry and ownership mirror, web first. Its
[official entity record](https://abr.business.gov.au/ABN/View?abn=34691391214) was checked
on 9 November. Under [#1589](https://github.com/Ledova/ledova/issues/1589), the owner
accepted the prepared Terms v2026-11-09, bounded retention periods and operator
permission. This is acceptance of policy and source changes, not legal advice,
a compliance finding or authority to launch with real data.

[Security](../engineering/security.md#account-closure-and-export) owns the implemented
erasure scope and clocks. Unnecessary account data is erased on closure; unused
signup data after thirty inactive days; expired sessions in daily maintenance.
Provider deletion has a thirty-day target and needs genuine permanent-deletion
confirmation, with specific reviewed holds. Company particulars, immutable history
and document copies remain separate for their identified purpose. The former-member
clock is not a universal legal basis for retaining every copy.

Company exit first verifies authority and supplies existing exports/company pack.
The [maintenance-only disposal path](../operations/operator-console.md#company-exit)
supports a reviewed non-chain company scope, with atomic database deletion and separately
retryable current-storage cleanup. It refuses retained execution history and preserves
other companies and accounts. It does not itself verify instruction/handover, resolve holds
or erase every supplier, support-mail, log or archive copy. Those require recorded treatment;
do not promise immediate complete erasure, disable guards or silently keep unnecessary
records indefinitely. Confirm actual supplier processing locations/agreements, identity-data necessity
and any specific retention basis from the live configuration and current sources.
The owner directs best-effort assessment without a compulsory paid adviser. No universal AML duty or AFSL exemption follows from being free
or calling the service a mirror.

The new public Terms leave corporate authority, the legal register, lawful inspection
and filings with companies; they cover service-related processing, support, proportionate
suspension and exit, and preserve mandatory Australian rights. The experimental
v2026-10-14 text remains accessible unchanged. Individuals explicitly accept a version
through immutable private receipts; old booleans are not backfilled. Company insert
guards use the new declaration/version while genuine earlier appointments and receipts
remain valid as history. Software permission is addressed separately in
[position 5](#5-software-licensing-and-commercial-permission).

**Collection and supplier assessment, 9 November 2026.** Web signup now collects only
name after email verification. Address can be supplied later for linked member particulars;
phone and DOB are not solicited. Existing values are preserved, and native collection is
unchanged pending its separate release work. This follows the APP 3 minimisation approach,
not an assumption that every account holder needs to supply statutory register particulars.

Read-only operational evidence confirmed AWS hosting of current application records/files
in Sydney and operator-controlled malware scanning. At that checkpoint, outgoing application
mail was captured rather than delivered. No configured identity provider or stored applicant was found, and no push
token is registered; reassess those suppliers before enabling them. Support mail routes to
Google Workspace. [AWS's privacy guidance](https://aws.amazon.com/compliance/data-privacy-faq/)
distinguishes selected-region customer content from account/metadata processing;
[Google's processing terms](https://cloud.google.com/terms/data-processing-addendum) do not
establish Australia-only processing or immediate deletion. The owner, Blueberry Money's sole
director, confirmed authority to use the existing supplier accounts on 9 November. The assessment
uses the standard published processing terms, without claiming a particular executed version
or edition-specific controls.

**Transactional mail, 10 November 2026.** Following separately approved operational activation,
Twilio SendGrid delivers signup codes, member invitations and password-reset links. These flows
send recipient addresses and message content, including their codes and links. The current
[Twilio processing terms](https://www.twilio.com/en-us/legal/data-protection-addendum) and
[subprocessor list](https://www.twilio.com/en-us/legal/sub-processors) allow processing outside
Australia, including the United States; they do not establish Australia-only processing or a
verified account-specific data centre. Provider retention, recovery, security and specific legal
requirements remain separate from Ledova account erasure. Deleting an account does not
automatically erase provider copies or prove immediate complete deletion. This assessment uses
the published terms, without claiming a particular executed agreement version. Delivery evidence
and account details remain private under [#1586](https://github.com/Ledova/ledova/issues/1586).

The final read-only Admin and Vault review on 9 November resolved support-mail treatment:
the support group keeps conversation history, the recipient's effective Gmail setting has no
automatic age expiry, and Vault has no default Gmail/Groups retention rules, custom rules or
domain, user or group holds. This is a dated observation, not a guarantee about future holds.
Under the accepted purpose-bound policy, review support correspondence when its support,
security or specific legal purpose ends, recheck holds and delete unnecessary group and
mailbox copies separately. Record any retained purpose, hold and review date. Gmail recovery
and supplier backend deletion remain distinct from immediate permanent erasure; account
deletion does not itself delete support correspondence. Keep account identifiers and detailed
operational evidence private. No setting, licence, hold or message was changed.

Google's [Gmail auto-deletion guidance](https://knowledge.workspace.google.com/admin/gmail/advanced/manage-email-storage-with-auto-delete-settings)
and [cross-matter hold reports](https://knowledge.workspace.google.com/vault/holds/review-all-holds-for-your-organization)
explain the checks. Its [mail recovery guidance](https://knowledge.workspace.google.com/admin/support/troubleshooting/restore-a-users-permanently-deleted-email)
and processing terms describe remaining recovery and deletion stages. Recheck actual copies
for each disposal; this assessment is not proof that a particular person's copies were erased.

Logs rotate by size, which proves no maximum age. Retired archives remain subject to their
existing retention locks and expiry, not immediate erasure. A bounded server inventory does
not prove every personal-device/export copy is absent. Exit must record each relevant copy's
purpose, hold and disposal or expiry confirmation. Keep operational evidence private, and
working email and copy-lifecycle acceptance under [#1586](https://github.com/Ledova/ledova/issues/1586).
This assessment itself changes no live settings and authorises no customer launch.

**Sources checked 9 November 2026:** OAIC
[APP 3](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information),
[APP 5](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-5-app-5-notification-of-the-collection-of-personal-information)
and [APP 11](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information);
[Corporations Act s169(7)](https://www.legislation.gov.au/C2004A00818/2026-09-19/2026-09-19/text/original/epub/OEBPS/document_1/document_1.html),
which concerns the company's register, not every platform copy;
[ACCC contract guidance](https://www.accc.gov.au/consumers/buying-products-and-services/contracts);
and [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
Apple's requirements concern the actual app and associated personal information;
source changes alone establish no App Store acceptance. Sumsub's
[deletion guidance](https://support.sumsub.com/data-access-and-deletion) and KYCAID's
[privacy notice](https://kycaid.com/privacy-policy/) require supplier-specific follow-through;
reversible deactivation is not proof of permanent deletion.

**What would show this wrong.** Nothing would make building to the principles
wrong; what could change is the date compliance stops being voluntary.

**Trigger.** The first real member's personal information.

**Status.** Policy and prepared Terms accepted 9 November 2026. Account erasure and
versioned acceptance and scoped company-disposal software are implemented. Source minimisation
and the supplier/copy assessment, including support-mail retention and hold verification, are
complete for [#1589](https://github.com/Ledova/ledova/issues/1589). Operational acceptance and owner
launch direction remain under [#1586](https://github.com/Ledova/ledova/issues/1586), without a
paid-adviser prerequisite. The public preview still requires fictional data.

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

**Implementation and earlier service assumption.** The
[planned offerings flow](../business/offerings.md) would host offers; the earlier
clerk-only service proposal assumed that it would not use that flow. Each
grant, allotment and issue is approved by a company decision that retains the
directors' authority document and names the approving director
([grants](../business/issuing-shares.md#grants-to-walletless-members),
[external allotments](../business/issuing-shares.md#external-investor-allotments)).

**The position.** Every obligation in this position belongs to the company and
its advisers. In historical analysis B Ledova records the outcome — the allotment,
its date, the number, class and price, the amount paid — and stores the board
resolution and the offer and acceptance as evidence beside the entry, so the
company's later scheme reporting and any concession claim can be substantiated
from the register. Ledova does not prepare, host or send the offer; the moment
it does, [position 4b](#4b-activities-beyond-the-registry-scope)
applies. The candidate first client's issue to an employee fits s113(3)(a)(ii)
and Division 1A without the platform's involvement in the offer.

**What would show this wrong.** Nothing in the reading; what could go wrong is
the company relying on the platform's fields as if they were the scheme's
documents.

**Trigger.** The first issue recorded for a real company.

**Status.** Drafted 2026-09-15, awaiting the owner's sign-off.

## 12. PyMuPDF, an AGPL runtime dependency

**Status: superseded by the replacement under #1589, 9 November 2026.** New
backend builds no longer install PyMuPDF. WeasyPrint renders escaped certificate
HTML; pypdf checks uploads inside the existing resource-limited worker. Both
[WeasyPrint](https://github.com/Kozea/WeasyPrint/blob/main/LICENSE) and
[pypdf](https://github.com/py-pdf/pypdf/blob/main/LICENSE) use BSD-3-Clause.
Existing certificate bytes and history remain stored unchanged. This replacement
needs neither an Artifex commercial licence nor the PyMuPDF 2 adoption proposed
in [#1160](https://github.com/Ledova/ledova/issues/1160).

This removes the PDF-specific AGPL dependency, not every software-licensing duty
or the [operator's own permission](#5-software-licensing-and-commercial-permission).
Retain installed Python licence files and system library/font copyright notices
when distributing images. Native shaping libraries remain dynamically supplied;
[Pyphen](https://github.com/Kozea/Pyphen/blob/main/LICENSE) offers GPL/LGPL/MPL
alternatives with dictionary notices, and
[Noto fonts](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE)
use OFL 1.1. Do not describe the entire dependency graph as BSD or apply Ledova's
licence to it. Font embedding does not put the certificate itself under OFL.

The historical [22 September decision](../decisions.md)
and earlier text remain in Git history. The replacement is a technical and
licensing choice, not a general compliance finding. Runtime details are in
[upload validation](../engineering/security.md#upload-validation) and
[certificate rendering](../engineering/records.md#certificate-format).

## Related documents

[Product decisions](../decisions.md), [operator setup](../operations/operator-console.md),
[retention configuration](../operations/configuration.md#storage-uploads-and-retention), [register design](../business/register.md),
the [regulatory pathway](../regulatory-pathway.md),
and the authoritative [LICENSE](../../LICENSE).
