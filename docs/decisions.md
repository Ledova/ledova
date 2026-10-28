# Product and technical decisions

[Documentation](README.md) · [Roadmap](roadmap.md)

These are recorded owner choices and their reasons, in the owner's words where
they were given. This page makes no new product, licensing or legal decision,
and it does not say what the code does today: the
[capability boundaries](product.md#current-capability-boundaries) do that, and
the architecture guides own the mechanisms. Sections are grouped by topic; the
index gives each decision's date and whether it still stands. Superseded choices
stay here as history and are marked where they appear.

| Decision                                                                                                        | Date                                           | Status                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Company-managed registers and one product](#company-managed-registers-and-one-product)                         | 3 October 2026                                 | Current; replaces routine register work by platform staff                                                       |
| [Company-run register authority and evidence](#company-run-register-authority-and-evidence)                     | 5 October 2026                                 | Current                                                                                                         |
| [Company representative verification](#company-representative-verification)                                     | 4 October 2026                                 | Current; ABR lookup moved to activation by #1148                                                                |
| [Combined company signup and initial authority](#combined-company-signup-and-initial-authority)                 | 14 October 2026                                | Current; amended by #1022; ABR lookup moved to activation by #1148                                              |
| [Simple signup, documents and team after registration](#simple-signup-documents-and-team-after-registration)    | 14 October 2026                                | Current; #1022; ABR lookup moved to activation by #1148                                                         |
| [Identity verification after signup](#identity-verification-after-signup)                                       | 19 October 2026                                | Current; #1141                                                                                                  |
| [Verified email and email changes during signup](#verified-email-and-email-changes-during-signup)               | 19 October 2026                                | Current; #1146                                                                                                  |
| [ABR company lookup at activation](#abr-company-lookup-at-activation)                                           | 19 October 2026                                | Current; #1148                                                                                                  |
| [Existing register mirror and simple setup](#existing-register-mirror-and-simple-setup)                         | 14 October 2026                                | Current; setup amended by #1029                                                                                 |
| [Manual register setup: shares before shareholders](#manual-register-setup-shares-before-shareholders)          | 14 October 2026                                | Current; #1029, CSV entry removed under #1036                                                                   |
| [Eligibility and ownership records](#eligibility-and-ownership-records)                                         | September to 6 October 2026                    | Current                                                                                                         |
| [The stored register](#the-stored-register)                                                                     | September 2026; staff review retired 5 October | Current                                                                                                         |
| [Register CSV download removed](#register-csv-download-removed)                                                 | 28 October 2026                                | Current; inspection copies kept under Documents                                                                 |
| [Company-scoped approvals](#company-scoped-approvals)                                                           | 19 September 2026                              | Current                                                                                                         |
| [Shareholder publications](#shareholder-publications)                                                           | 23 September 2026                              | Current; expansion not planned (#870)                                                                           |
| [Splits and consolidations](#splits-and-consolidations)                                                         | 23 September 2026                              | Design only; deferred                                                                                           |
| [The company pack](#the-company-pack)                                                                           | 23 September 2026                              | Current                                                                                                         |
| [Essential registry and development workflow priority](#essential-registry-and-development-workflow-priority)   | 9 October 2026                                 | Register priority current; workflow part superseded 11 October                                                  |
| [Registry focus and cancelled expansion tickets](#registry-focus-and-cancelled-expansion-tickets)               | 18 October 2026                                | Current; #869, #870 and #872 not planned                                                                        |
| [First scopes for employee awards and external capital](#first-scopes-for-employee-awards-and-external-capital) | 10 October 2026                                | Delivered 11 October (#973, #974)                                                                               |
| [Member invitations and account association](#member-invitations-and-account-association)                       | 11 and 24 October 2026                         | Current; #866, web email invitations under #1165                                                                |
| [Minimum tests and fresh migrations](#minimum-tests-and-fresh-migrations)                                       | 11 October 2026                                | Current                                                                                                         |
| [Dependency advisories in ordinary CI](#dependency-advisories-in-ordinary-ci)                                   | 11 October 2026                                | Current                                                                                                         |
| [GitHub runners and Mac retirement](#github-runners-and-mac-retirement)                                         | 11 October 2026                                | Current                                                                                                         |
| [Binding caps and backup authorisation](#binding-caps-and-backup-authorisation)                                 | 11 October 2026                                | Current                                                                                                         |
| [ledova.io rebuild and release authorisation](#ledovaio-rebuild-and-release-authorisation)                      | 11 October 2026                                | Completed under #979; signer and funds decisions remain separate                                                |
| [Backend migration baseline](#backend-migration-baseline)                                                       | 10 October 2026                                | Superseded 11 October                                                                                           |
| [Registry priority, crypto on-ramp and AUD payments](#registry-priority-crypto-on-ramp-and-aud-payments)        | 5 October 2026                                 | Payment scope superseded 9 October; on-ramp restriction stands                                                  |
| [Payments and settlement](#payments-and-settlement)                                                             | 25 September to 2 October 2026                 | Current behaviour; new mechanics deferred                                                                       |
| [Assets and portfolio presentation](#assets-and-portfolio-presentation)                                         | 26 September 2026                              | Current                                                                                                         |
| [The signed-in app](#the-signed-in-app)                                                                         | 26 September to 2 October 2026                 | Navigation superseded 11 October; one look superseded 14 October; mobile 26 October                             |
| [Simpler signed-in journeys](#simpler-signed-in-journeys)                                                       | 11 October 2026                                | Web layout superseded 12 October; native journey superseded 26 October                                          |
| [Ownership dashboard and compact sidebar](#ownership-dashboard-and-compact-sidebar)                             | 12 to 28 October 2026                          | Current; company-centred Ownership browser replaces workspace selection (#1360) |
| [Dashboard, Settings and Register for a new company](#dashboard-settings-and-register-for-a-new-company)        | 19 October 2026                                | Current; #1155 (web); mobile (#1157) superseded 26 October                                                      |
| [Share classes, shareholders and employee awards](#share-classes-shareholders-and-employee-awards)              | 20 to 26 October 2026                          | Current; Ledger and revised workflows on the web (#1165); mobile superseded 26 October                          |
| [Paper and Dark themes](#paper-and-dark-themes)                                                                 | 14 October 2026                                | Current; #1040                                                                                                  |
| [Frontend UX standards](#frontend-ux-standards)                                                                 | 20 to 21 October 2026                          | Web delivered (#1176, #1178–#1183), picker server search deferred; on mobile, the shareholder screens (#1201)   |
| [Mobile app for shareholders](#mobile-app-for-shareholders)                                                     | 26 October 2026                                | Current; delivered under #1201                                                                                  |
| [The account-data export](#the-account-data-export)                                                             | 23 September 2026                              | Current                                                                                                         |
| [Tenancy, sessions and deployment](#tenancy-sessions-and-deployment)                                            | 3 October 2026                                 | Current                                                                                                         |
| [Contracts compiler and toolchain](#contracts-compiler-and-toolchain)                                           | Undated                                        | Current                                                                                                         |
| [Clients and API types](#clients-and-api-types)                                                                 | 14 September 2026                              | Current; mobile workflows superseded 26 October                                                                 |

## Company-managed registers and one product

On 3 October 2026 the owner chose one registry product and removed the intended
distinction between Registry and Single-issuer product modes. Private internal
instances use the same software and capabilities; self-hosting does not create
a separately maintained product mode.

**Ledova operates the platform; companies operate their own share registers.**
Companies and their investors, shareholders or employees handle their share
relationship and decisions directly. Ledova supplies infrastructure, records,
workflows, tools and authorised automation. Routine register actions must not
depend on platform staff performing or approving them. Platform operations remain
for the service and specifically scoped crypto/payment functions; these
permissions do not substitute for company authority.

This supersedes the earlier allocation of routine register review/entry to
platform staff and the two-mode product distinction. Historical decisions and
recordings retain the implementation they described. Authority, evidence,
isolation, audit and retention controls must be adapted to company actors rather
than discarded. The software licence and legal positions are not changed. The
[company-managed register plan](plans/company-managed-registers/plan.md)
records the decision; the [implementation index](plans/company-managed-registers/README.md)
lists what has been delivered under it.

### Company-run register authority and evidence

On 5 October 2026 (Australia/Sydney), the owner made three decisions about
company-run register work, answering questions in Claude's session. Claude recorded
the answers on #864
([authority and evidence](https://github.com/Ledova/ledova/issues/864#issuecomment-5986401458),
[read scope](https://github.com/Ledova/ledova/issues/864#issuecomment-5987962820)).
The owner then confirmed them directly in Codex's session the same day
([recorded on #860](https://github.com/Ledova/ledova/issues/860#issuecomment-5988858576)).
They apply to #864 and every later issue:

- A current company administrator may prepare, approve, apply and reject register
  changes; `prepare`, `approve` and `apply` are the narrower capabilities for
  delegates, with rejection taking `approve`, so an existing owner or a first
  representative can run the register alone. One person may take every step; no
  approver-conflict rule is added.
- Application needs an approval whose approver's appointment is still current;
  otherwise a current approver approves again.
- Register evidence is company-provided: uploaded documents are kept as evidence
  with their fingerprints, the company states the ASIC totals, and both are shown
  as provided by the company, with no platform-staff verification step. Evidence
  downloads are not logged; that can be added later for every register proposal
  at once. Evidence uploads that no proposal uses are kept until production
  retention is decided.
- A proposal submitted for the retired staff review and still waiting can only be
  rejected; the company prepares a new one.
- Holders of `prepare`, `approve` or `apply` read the full register, including
  residential addresses in the CSV and retained evidence copies, because they
  work from member details; the invitation labels for those capabilities say so.

The owner's amendment recorded on #860 also let #864 start before #863 closed,
except member-wallet links, which waited until #863 closed on 6 October 2026.
The same day the owner applied these rules to each register command and settled
what is specific to it
([imports](https://github.com/Ledova/ledova/issues/864#issuecomment-5988960147);
corrections and openings recorded on #864 and #860;
[links, reconciliation and particulars](https://github.com/Ledova/ledova/issues/864#issuecomment-5990240921)):

- An **opening** captures its chain boundary when the company prepares it, and
  approval and application check that boundary against the chain again. Its
  mapping of boundary addresses to members is part of the opening.
- A **wallet link** keeps the documentary authority decided on 21 September 2026,
  a director resolution naming the approving director or a court order, uploaded
  as an `authority` upload as openings and corrections do. The recorded default is
  that a link shows each address's proof of control and identity without
  requiring either; both are built that way and the owner has yet to confirm
  them. The statuses are live and informational, shown only for an address on
  the company's whitelist, and never choose a member.
- A **reconciliation discrepancy** is acknowledged in one company step: a current
  appointment holding `admin` or `approve` acknowledges one specific discrepancy
  of the latest reconciliation with a written reason. There is no platform-staff
  step and no second person.
- A **change to a member's particulars** needs a reason and one supporting
  document the company provides. Between imports and company changes the latest
  "as at" date wins, and a member's live verified identity still wins over both,
  as decided on 22 September 2026. Members editing their own particulars is
  separate work in [#866](https://github.com/Ledova/ledova/issues/866).

### Company representative verification

On 4 October 2026 (Australia/Sydney), the owner chose
[company self-declaration](https://github.com/Ledova/ledova/issues/862#issuecomment-5973451112).
A company registers itself and supplies its company and share information. Its
representative declares that they are authorised to act for it. The company
remains responsible for that information, its ASIC filings and its legal
obligations. Companies and investors remain responsible for their own actions;
Ledova provides infrastructure and tools with as little involvement as reasonably
possible. False information and impersonation are matters for regulators and
law enforcement, not a reason to add platform verification.

The owner also [accepted two refinements](https://github.com/Ledova/ledova/issues/862#issuecomment-5973465105):
company details are shown as **provided by the company**, never **verified by
Ledova**, and the terms make the company responsible for them. Ledova changes a
company's administrators only through its existing administrators or at the
direction of a court or regulator. Normal recovery of a person's own account is
separate from changing company administrators.

This supersedes the earlier same-day
[ASIC officeholder route](https://github.com/Ledova/ledova/issues/862#issuecomment-5970984155)
and [InfoTrack broker choice](https://github.com/Ledova/ledova/issues/862#issuecomment-5971158175),
retained as history. No ASIC search, broker, uploaded ASIC extract or InfoTrack
agreement is required for representative authority; those prerequisites no longer
block #862–#873. A declaration can establish the initial representative's
authority in the initial admission workflow. The existing representative identity
check and ABR company lookup remain unchanged, as do tenant isolation and
signed-transaction safeguards; the lookup later moved from admission to
activation ([19 October](#abr-company-lookup-at-activation)). The
[authority guide](business/companies.md)
describes the delivered admission, invitation, delegation and revocation
workflows.

Do not add impersonation or fraud verification unless a legal duty on Ledova
requires it. If such a duty is identified, raise it with the owner with its source
rather than building a check; see [legal positions](legal/positions.md). The
[accepted plan](plans/company-managed-registers/plan.md#representative-verification)
records the implementation boundary.

## Combined company signup and initial authority

On 14 October 2026 the owner authorised
[#1020](https://github.com/Ledova/ledova/issues/1020): company signup and initial
representative authority should finish in one visible flow, keeping the existing
**Company details → Review** routes. Review combines the retained evidence
request, explicit declaration, initial admission and signup completion through
the existing APIs. Saved company and profile data are reused, and an unfinished
account can sign in to resume. Completion requires a confirmed appointment;
submission alone is not admission.

The [same-day amendment below](#simple-signup-documents-and-team-after-registration)
supersedes the file and delegation choices in the original decision that follows,
and the [19 October decision](#abr-company-lookup-at-activation) moves its ABR
lookup to activation.

The initial personal scope is `admin`. Delegation is a separate visible choice:
it is empty by default and includes `admin` only when explicitly selected.
Existing representative identity, ABR and checked-file safeguards remain. The
supporting file is a platform requirement for retained evidence, not an ASIC
extract requirement. A missing file or failed provider does not establish
authority. Admission does not activate the company, issue shares or invite team
members, and no new platform-staff approval step is added.

This replaces the earlier instruction to leave signup unchanged while retaining
the delivered dashboard and native navigation. The
[authority guide](business/companies.md#company-signup)
owns the workflow. New browser evidence must record the actual flow and its
environment; local synthetic provider responses do not establish production or
genuine provider verification. Earlier galleries remain dated history.

### Simple signup, documents and team after registration

Later on 14 October 2026, the owner approved
[#1022](https://github.com/Ledova/ledova/issues/1022), amending the combined
signup above. Review keeps the saved personal/company summary and one short
authority/Terms statement beside **Complete company setup**. Choosing that
button explicitly acknowledges that the representative already has authority
to set up and administer that company's workspace, including its users, and
accepts the linked Terms on the company's behalf. There is no separate authority
checkbox; the declaration is visible at the action rather than hidden in legal
text. Company responsibilities are stated in the Terms. The displayed Terms and retained acknowledgement
use version `2026-10-14`; registration creates a software workspace, not an ASIC
incorporation, director appointment, company activation or share issue.

Signup requires no supporting file and has no separate administrator-delegation
checkbox. The initial personal scope remains `admin`; its recorded delegation
includes all six capabilities for team setup afterwards. Documents and invitations
use the existing company dashboard settings, with current company authority and the checked
private-file flow for actual uploads. Identity, ABR, immutable declarations,
tenant isolation, revocation and action-specific approvals remain; the ABR lookup
later moved to activation ([19 October](#abr-company-lookup-at-activation)). A missing
or failed required provider check cannot be treated as success. This replaces
the mandatory signup file and optional administrator-delegation choice under
#1020; it does not make evidence optional for later actions that require it.

An unfinished signup with an existing current company administrator appointment
can finish through the same final button. Its original declaration, capabilities,
delegation and expiry remain unchanged; an older or narrower appointment is not
replaced by a new bootstrap or silently expanded to the fresh-signup defaults.
The action records acceptance of the current Terms against that appointment when
needed and rechecks live authority. A fresh appointment that already records the
same acceptance supplies its retained receipt without another acceptance record.
Revoked, expired or otherwise ineffective authority cannot complete setup.

The experimental-use Terms state company responsibilities plainly and preserve
the synthetic-data, testnet and software-licence boundaries. This product
decision is not professional legal approval or a finding that the deployment
is exempt from financial-service or AML obligations. Actual company mandate is
still required; accepting Terms does not create it. The legal sources remain
[the Corporations Act](https://www.legislation.gov.au/C2004A00818/latest/text),
[electronic-signature guidance](https://www.ag.gov.au/legal-system/electronic-signatures-documents-and-transactions/electronic-signatures)
and [AUSTRAC's actual-services approach](https://www.austrac.gov.au/new-austrac/who-and-what-we-regulate).

The owner also explicitly authorised deletion of all local files under
`~/Developer/ledova-artifacts`, replacing earlier instructions to preserve those
local galleries and receipts. Retained application records and Git history are
unaffected. Do not create a replacement gallery or PDF until requested later;
the new flow is shown directly in Chrome. This increment authorises no live
deployment or further backup work.

### Identity verification after signup

On 19 October 2026 the owner removed the identity verification step from web
and mobile signup ([#1141](https://github.com/Ledova/ledova/issues/1141)) to
keep signup simple: people verify their identity afterwards from Profile, which
already offered the same check, and investor signup never required it. Where
an instance requires a verified identity for company representatives, initial
admission still refuses an unverified person, so the owner chose that company
review offers the same identity check before **Complete company setup** rather
than changing that rule. The investor and representative identity requirements
and where they apply are unchanged.

### Verified email and email changes during signup

Later on 19 October 2026 the owner reviewed signup's **Go Back** and decided
([#1146](https://github.com/Ledova/ledova/issues/1146)) that going back and
forward with the same verified email keeps it verified and never shows the code
step again, while changing the email restarts signup so the new address is
verified from the start. The owner chose the recommended defaults: the change
needs the current password and is allowed only before **Complete company setup**
is submitted. Restarting keeps the same account, so no second, half-finished
account is left behind, and clears the account type, eligibility answers, and
personal and financial details. Companies are never deleted by design, so a
saved draft company stays with the account instead of being cleared; weakening
that safeguard was not authorised.

### ABR company lookup at activation

Later on 19 October 2026 the owner decided
([#1148](https://github.com/Ledova/ledova/issues/1148)) that the ABR company
lookup is not part of signup. It belongs with the dashboard verification steps,
where identity is checked, so a new company is looked up at **Company →
Activation**, which already repeated the lookup before making it Active.
**Complete company setup** appoints the representative on their declaration,
keeping the draft ownership, unchanged-details, expiry and required-identity
checks, so signup finishes without ABR configuration and the company stays Draft.
Activation still gates eligibility decisions, offerings, chain deployments and
issues, paid issues, capital increases and company wallet instructions. Before
it, the company's administrators can keep the company's own non-tokenised
register records, such as the mirrored register, awards, allotments, transfers
and member access, without any lookup; until this decision, admission's lookup
came first. The owner confirmed that after the independent review of
[#1149](https://github.com/Ledova/ledova/pull/1149) raised it. This replaces the
ABR part of the [4 October](#company-representative-verification) and
[#1022](#simple-signup-documents-and-team-after-registration) statements that
admission keeps the lookup; earlier lookups and their links to appointments
remain as history.

## Existing register mirror and simple setup

On 14 October 2026 the owner approved
[#1025](https://github.com/Ledova/ledova/issues/1025): bring existing records,
review them and confirm the company's ownership mirror. The owner clarified:
"Ledova is proposing a place to mirror what is legally already registered" so
investors and employees can understand the private company's share structure.

The company keeps its legal register, historical records, lawful register access
arrangements and filings where they already belong. Ledova does not replace
them or establish legal ownership by copying their contents. A mirror opening
records already-issued shares, never a fresh issue, payment or chain mint.
Company-provided source references and any uploaded copies remain attributed to
the company; Ledova does not verify them or label the mirror a statutory register.

Setup records the existing classes, members, holdings and underlying allotment
particulars, with their original dates, paid/unpaid amounts, payment status,
share/certificate references where present and beneficial-ownership status.
Member accounts and wallets are unnecessary. An ASIC extract is an optional
cross-check, not a substitute for the company's complete records. Existing
platform evidence, retention, isolation and company-authority safeguards remain.

Corrections preserve earlier snapshots and confirmations. A replacement is
bound to the reviewed current mirror and must refuse to overwrite later share
activity or deployment. The guided screen and correction delivery are tracked
on #1025; this decision records accepted scope, not completed implementation.

## Manual register setup: shares before shareholders

On 14 October 2026 the owner approved
[#1029](https://github.com/Ledova/ledova/issues/1029): simplify the manual setup
into share details, shareholders and one combined review/confirmation step. Copy
the company's existing class name, code and type first, then add and edit
shareholders individually in the same forms. Codes such as A and B must not need
invented aliases. Original membership and allotment dates, quantities, paid/unpaid
amounts and relevant references remain part of the copied record.

Select an already recorded company class, or choose Ordinary (ORD), Preference
(PRF) or Redeemable (RED) to fill the common details. **Another class** keeps
manual name/code/type entry for the company's own classes. These choices must
match its existing records; the selector defines no legal share rights.

Use one cohesive workspace with a single page heading, compact progress,
focused forms and a clear ownership summary. Use a compact list and one
shareholder editor at a time. Draft edits do not overwrite confirmed history or
change a person's company member identity.
Use plain field labels, place optional share/certificate references together,
and omit the redundant derived payment-status display. Keep the explicit
trustee/nominee distinction as **Held for someone else?** with Yes/No, alongside
the original dates, quantities and paid/unpaid amounts.
Review uses one shareholder table with per-person particulars available when
needed. One **Confirm** button performs the applicable decision after a fresh
preview; it does not bypass separate approval/application authority or recovery.
Retained preparation, exact confirmation, authority and safe correction rules
still apply. Remove the page's dashboard-return button, source-reference input
and repeated legal-boundary paragraph. The copied snapshot retains company,
record date and actor attribution; absent source labels use the neutral
"Company-provided share records" metadata. Retained nonblank source labels stay
unchanged. The Terms and register documentation keep the company's
responsibilities explicit.

Document import is a separate future feature: an inactive **Import** button
beside **Continue**, with a tooltip explaining the feature and **Coming soon**.
There is no extraction implementation in this increment. Future extracted values
must populate these same editable forms for manual review and correction;
extraction cannot confirm ownership or bypass validation. Optional retained
supporting copies remain distinct from extraction.

The owner amended setup under
[#1036](https://github.com/Ledova/ledova/issues/1036) on the same day: remove CSV
entry, templates and parsing. Shareholders are entered and edited manually.
Future LLM document extraction will populate these same forms for review; it is
still deferred. This removes the setup input path, while existing register and
inspection exports remain available. The plain register CSV download was removed
on 28 October 2026 ([decision](#register-csv-download-removed)); inspection copies remain.

## Cohesive signed-in web experience

On 14 October 2026 the owner approved
[#1031](https://github.com/Ledova/ledova/issues/1031): refine the share-register
workspace and apply its simple layout, spacing, typography and component
principles across signed-in web pages. Use existing components, remove repeated
headings and explanations, and keep important ownership and next actions
visible. Completed records need a clear recorded state rather than instructions
for an unfinished draft. Company and personal workflows retain their authority,
privacy, confirmation and exact recovery boundaries. The owner limited this
pass to signed-in web; signup, native clients and the public website remain
outside its scope. The issue records each delivered increment.

## Eligibility and ownership records

Under the 3 October decision, company
[activation](business/companies.md#activation-and-the-registry-check) and
[company eligibility decisions](business/participants.md#company-eligibility-decisions)
replaced staff company activation and classification review on 6 October 2026
(#863). The scope, privacy and expiry requirements below remain; a reusable
identity fact is not approval for every company.

The first offerings target wholesale and sophisticated investors. The four
classification categories and the deliberately excluded experienced-investor
category are recorded in [legal positions](legal/positions.md#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief).
Those positions were taken without advice; deployment stays on test networks
with synthetic data pending the required advice.

An `associated_person` claim reaches only its named company's directory entries;
it does not widen the secondary market. A holder who lacks market eligibility
cannot see the market for shares they own. Revisit that trade-off before live
operation with real participants.
[Eligibility](engineering/backend.md#eligibility-decisions) owns enforcement details.

Anyone eligible to see an offering in the directory can open the documents
attached to its approved offerings, whether upcoming, open or closed (owner
decision, 2 October 2026). Drafts and offerings submitted, under review, rejected
or withdrawn publish none, and the company's other documents stay with the
company. The product has investors review the documents before they apply, with
appropriate access to offer information; directory eligibility is that access.
Once an offering is approved or closed, its documents are added to and never
removed (owner decision, 2 October 2026): the company or staff can attach a
supplementary memorandum, but nobody detaches or deletes a document investors
may already have read. The company's picker keeps to the offer document types:
prospectus or information memorandum, risk disclosure, business plan, financial
statements, auditor report, constitution and shareholder agreement (owner
decision, the same day).
[Offerings](business/issuing-shares.md#offerings) owns the routes.

The register leaves amount paid blank when it cannot be established exactly;
zero would assert an amount that is not known. Classification evidence has a
fixed retention horizon, independent of account deletion. The legal basis and
uncertain clock are in [legal positions](legal/positions.md#3-the-evidence-retention-period); implementation belongs to
[the register](engineering/records.md#holdings-and-identity-resolution) and [file retention](engineering/security.md#classification-evidence-and-payslips).

The owner chose on 21 September 2026 in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5766230810)
that the `issuer_kyc_required` switch gates two points only, submitting a
company for review and activating it, with every later action relying on that
gate rather than checking again. Since staff review was retired the switch is
checked wherever an appointment is exercised: admission, invitation acceptance,
activation, eligibility decisions and each register command;
[the representative identity requirement](business/companies.md#representative-identity-requirement)
states where it applies.

## The stored register

The staff reviewer below was retired by the rules above, decided on 5 October
and delivered under #864 by 7 October 2026. Inspection copies became
company-run in [PR #954](https://github.com/Ledova/ledova/pull/954);
certificates, notice figures and the company pack remain admin-only until
#871. The register's authority, evidence, identity, event history and
retention controls remain requirements.

Wallets become linked to register members only through documentary authority:
an opening's mapping, or a later wallet link. Staff verified it at first;
openings and links have since become company-run, with company-provided evidence
([company-run register authority](#company-run-register-authority-and-evidence)). A
completion to an unlinked wallet waits for that link instead of creating a member,
because one person holding two wallets would otherwise become two members that
the register could never merge. Member particulars are kept while the person is
a member and then for at least the former-member retention floor, so the
register's seven-year obligation and its purge share one clock. Both were
chosen on 21 September 2026 in [#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5755636585).
Register export records, which say who took a copy of the register, follow the
same floor and purge; the owner chose that the same day in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5766230810).
In the same decision, an import of an existing register depends on the class.
For a class already opened from the chain, it adds particulars and pre-platform
former members. For a class not yet on chain, it becomes the opening, and later
tokenising mints mirror it rather than add shares. A staff reviewer entered the
ASIC extract's issued total and member count, and application refused a mismatch;
since 5 October 2026 the company states them when it prepares the import.
An entry recorded automatically names the person who authorised its change: the
approver of an issue, or the transferor whose signed order is a transfer's
instrument, rather than the company owner or a service account that took no
action ([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5756732848)).
A reconciliation divergence that has been investigated and accepted is
acknowledged, one discrepancy at a time with a reason, in an append-only record
only the operator connection writes, and later runs treat it as explained, so a
share class can return to `matched`. Staff acknowledged them until 5 October
2026, when acknowledgement became a company step.
Transfers of zero shares are ignored, because anyone can emit one. Both were
chosen on 22 September 2026 in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273).
The same decision settled two import questions. An applied import's reviewed
copy and uploaded register file are evidence, kept like opening and correction
evidence: nothing expires them automatically during the synthetic experiment,
and production retention is decided before any real data. The retention purge
removes only the particulars the register reads and the imported former members.
A linked member's live verified identity is shown when it is present and
unambiguous; imported particulars fill in only for a member with no live
identity, and an ambiguous identity stays ambiguous, so a later profile change
reaches the register and particulars never hide a conflict
([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273)).

On 22 September 2026 the owner chose one register instruction as the approval
behind issues and transfers, over evidence attached to each workflow and over
standing authorities ([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273),
decision 2): an instruction listing the exact requests or settlements the company
approves, with a named approving director and documentary authority, and an
issue or transfer entered only once an applied instruction covers it. With it
the owner chose that directors decide on a settlement after it, while its entry
waits; that the retained signed order is the instrument of transfer, with s1071B
left open; that a refused settled transfer is not modelled yet, so it keeps
waiting and stays visible; that a late entry is dated when it is made; and that
evidence copies are retained like openings and corrections. New issues have
since become company decisions under the
[company-run rules](#company-run-register-authority-and-evidence): non-paid
register grants, chain grants and paid issues. The instruction route remains for
settled transfers until [#869](https://github.com/Ledova/ledova/issues/869).
[The register](engineering/records.md#register-commands) owns the mechanisms.

The same day the owner chose how the register's outputs are produced:
certificates, notice figures and inspection copies
([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273),
decision 1). Staff prepare each output in admin on the company's written
instruction, and each is recorded as a kind of register export. Ledova keeps a
fingerprint, not the file, and the company signs: a certificate is handed over
unsigned for the company to execute, and only its SHA-256 and register sequence
are kept. One certificate covers the shares one entry moved to one member, with a
balance certificate for a seller who keeps shares, and PyMuPDF renders it. The
alternatives were certificates generated automatically, stored and served to the
company, and figures without documents. The register owns the mechanisms of
[inspection copies](business/member-records.md#inspection-copies),
[certificates](business/member-records.md#certificates),
[notice figures](business/member-records.md#notice-figures) and
[outputs due](business/member-records.md#the-due-list);
[#871](https://github.com/Ledova/ledova/issues/871) moves their preparation to
company appointments, and inspection copies came first
([PR #954](https://github.com/Ledova/ledova/pull/954)).

PyMuPDF, which checks uploaded PDFs and renders certificates, is licensed under
the AGPL-3.0 or commercially by Artifex. The same day the owner chose to record
that as a legal position, to be revisited before any commercial or public
deployment, with no code change
([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273),
decision 6). [Position 12](legal/positions.md#12-pymupdf-an-agpl-runtime-dependency)
is that record.

The same day the owner settled how an import opens a share class not yet on
chain, one with no register entries, no approved issue and no applied register
instruction ([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5772293439),
decisions 1, 3 and 4). Applying the reviewed import records the register's
opening entry itself, with the same review, evidence and ASIC check, in one
submission; the alternative was an opening built from the import followed by a
second import for the particulars. A class it opens records no issue, transfer
or cessation until it is anchored on chain or a company-run non-paid grant or
transfer enters one. A mistaken opening import strands its class until partial
corrections exist; that is accepted during the synthetic experiment and settled
before any real data. [The register](engineering/records.md#register-ledger) owns the
mechanism.

### Register CSV download removed

On 28 October 2026, during the signed-in web walkthrough, the owner asked to remove the Ledger
exports page: "I think ledger exports is something that we don't need. So unless this is critical
for the business, I very much would like to delete." The owner first chose "Delete both", the CSV
download and inspection copies, after being told that Company pack already carries the register CSV.
Independent review found that premise incomplete: a company's own Company pack needs an
administrator and covers only complete non-tokenised core packs, so most companies would have had no
self-service copy of their register for an s173(3) request. Told this, the owner chose "Keep
inspection copies (Recommended)".

Ledova no longer offers the plain register CSV download. Inspection copies stay, as Documents →
Inspection copies, so any register reader can still produce the s173(3) copy for every class.
Earlier CSV export records stay until their retention purge.

## Company-scoped approvals

Company appointees authorise wallet approvals through the
[wallet nomination and instruction workflow](business/participants.md#wallet-nominations-and-company-wallet-approvals);
the staff-entered approval below is its history. The fresh-start deployment was
a one-time cutover, not the migration policy for company authority, which
preserves existing data.

Each company has its own on-chain whitelist registry with an expiry for every
approved wallet, decided by the owner on 19 September 2026 and settled in detail
on 22 September in
[#648](https://github.com/Ledova/ledova/issues/648#issuecomment-5775711424):

- **Fresh start, September 2026.** Moving to the new contracts meant new
  contracts and a new database. No testnet data was carried over and no register
  was re-anchored, because a deployed token can never be rebound to another
  registry.
- **An expired or removed holder cannot send.** A transfer checks both sides.
  No forced transfer is added, so such a holding is frozen until the approval is
  renewed. A holder can still burn their own shares.
- **An approval is for one company.** A wallet with no investor classification,
  such as a treasury, company or imported member, got the expiry staff entered,
  with blank meaning none; since the wallet workflow a company instruction with
  a finite expiry approves it.
- **A stablecoin payment asks for an approval with any company.** AUDY has no
  registry of its own, so a payment the platform sends checks that each party
  holds a live approval for at least one company, from the stored approvals
  rather than from a registry. The owner chose this on 22 September 2026 over
  dropping the check, keeping the rule the single global registry used to carry.
  The AUDY contract itself has never restricted transfers. Since #792 the rule is
  enforced on Wallets > Send, when a transfer is prepared and again when the
  signed transfer is submitted, before anything is recorded or broadcast: the
  owner chose that on 29 September 2026 in
  [PR #807](https://github.com/Ledova/ledova/pull/807#issuecomment-5881408794)
  over keeping the retired trading transfer route, which had been its only
  enforcement, or dropping the rule. A payment to the operator's receiving
  wallet is exempt on both sides: a transfer whose recipient is the configured
  receiving wallet, on its configured chain, compared case-insensitively on the
  exact address, because the stablecoin payment instruction sends investors
  there and nothing approves that address. An unset receiving wallet, or one on
  another chain, exempts nothing. The owner chose that the same day in
  [a second decision](https://github.com/Ledova/ledova/pull/807#issuecomment-5882450036)
  over approving the receiving wallet or accepting such payments only from an
  outside wallet.
- **The chain follows within fifteen minutes.** The platform refuses at once,
  and the refresh reaches the registry within one sweep interval plus one
  recovery interval. There is no lease: an approval does not lapse by itself
  between classification expiries. A lease would fail closed by construction,
  but at the cost of a renewal write for every approval on a clock, and the
  owner chose the documented delay over that on 22 September 2026.
- **One identity row per wallet.** `WhitelistEntry` stays the wallet's identity
  row, because the register names holders through it and two rows for one
  wallet would make every holder ambiguous. Approval state lives in a separate
  row for each entry and company that only the operator connection writes.

[Contracts and issuance](engineering/chain.md#contracts) owns
the mechanism and [chain setup](operations/chains.md#fresh-start-redeploy) the
redeploy.

## Shareholder publications

Platform staff publish, enter represented ballots and record payments on the
company's written instruction. The proposed company-run expansion under
[#870](https://github.com/Ledova/ledova/issues/870) was [closed as not planned](#registry-focus-and-cancelled-expansion-tickets).
The rules below bind any future owner-selected company-run replacement.

The owner chose on 23 September 2026, in
[the design note](https://github.com/Ledova/ledova/issues/649#issuecomment-5789320596),
that documents, resolutions and distributions share **one publication spine**
rather than three models. The argument is the roll: freezing who the members
were at a record date is the hardest part of
[#649](https://github.com/Ledova/ledova/issues/649), and one spine builds it
once. Separate models would have built it three times and brought meetings and
proxies the issue's non-goals exclude.

- **The first documents are the annual holding statement and the meeting
  notice.** The distribution statement is the artefact a dividend produces and
  arrives with that work, rather than being built twice.
- **Platform staff publish on the company's written instruction**, as inspection
  copies, certificates and notice figures were prepared then. Company
  self-service can be added later without changing anything a member sees.
- **The roll is frozen once, at the record date.** A publication is evidence
  that a company communicated with the members it had then, so resolving the
  audience again later would answer a different question. Nothing on a
  publication or its roll can be changed afterwards.
- **A member's identity is resolved once, in Python, and never by a wallet
  address.** `Wallet` is unique per (account, chain, address), so two accounts
  can hold one address and an address join in a policy would hand one member's
  statement to another. A member the register cannot name stays on the roll with
  no account and no online surface, the same refusal a certificate makes.
- **A read that cannot be recorded refuses the delivery.** Publication reads
  follow document reads: append-only, operator-only, no admin mutation path.
- **Publications share the register's retention clock**, measured from the
  publication, on the same seven-year floor that cannot be configured away.
- **A publication is announced as an ordinary notification**, with no new
  preference switch until someone asks to turn these off. The notice names the
  publication and nothing else; the holding and the document are reached only
  through the member's own audited read.

- **One vote per share, counted at the record date**, with the member counts
  recorded beside the shares so a head-count reading needs no rebuild. Each
  resolution stores its basis, so the basis it was counted on is part of the
  record.
- **The tally follows section 9 of the Corporations Act.** An ordinary
  resolution is carried when the shares voted for exceed the shares voted
  against, so a tie is not carried. A special resolution is carried when the
  shares voted for are at least 75% of the votes cast, which is the Act's
  definition of a special resolution. Abstentions are counted and shown, but are
  not votes cast, and a resolution on which no votes were cast is not carried.
  The database writes the tally into the close and the verifier recomputes it,
  so the rule lives in two places that are checked against each other.
- **No proxy machinery, and no online surface for a member the register cannot
  name.** A proxy is settled between the member and the company, and the vote it
  carries is entered by staff, marked staff-entered and signed with the authority
  relied on. A treasury holding, an unidentified member and an ambiguous one vote
  the same way, on the company's written instruction: the roll gives them no
  account, and the database refuses a member's ballot that names none.
- **A member's ballot is resolved under the policies and inserted by the
  operator connection.** The design note proposed an insert policy for the
  application role (its option (b)); slice 3 chose not to give the application
  role any write to a hash-chained table, because a trigger runs with its
  caller's rights and the member's own policy would narrow what it could read.
  The guarantee that a member casts only their own ballot stays in the database,
  and members, staff and the closing job share one write path and one lock.
  [Shareholder publications](business/publications.md#resolutions)
  describes the mechanism.

- **Dividends round down to the cent for each holder**, and what rounding leaves
  over is recorded as undistributed rather than given to anyone, so the company
  can never owe more than it declared and no tie-break is needed. The remainder
  is always less than a cent for each member on the roll.
- **The rate per share is the input and the declared total a check figure.** A
  board resolves a rate, and a total derived from it would move with the issued
  supply. Publishing is refused unless the declared total is exactly the shares on
  the roll times the rate, rounded down, which catches a typing error in either.
- **Entitlements are per holder, on the frozen roll.** Each roll row of a
  distribution carries its own entitlement, so the roll that says who was a
  member on the record date also says what each was owed, and the declared total
  is checked against their sum.
- **A payment is recorded, never asserted.** Payments are made off the platform.
  Staff record the company's written advice that it paid a member, with its
  reference and remittance evidence, on the same append-only chain as a
  resolution's ballots; a correction is a withdrawal and a new record. Every
  member-facing word and API field says the company recorded the payment, never
  that the member was paid, because the platform has no way to check it.
- **The member's own row is the distribution statement, for now.** Owner
  decision 4 put the distribution statement with the dividend work. The member's
  row on the publications page, which shows the rate, their frozen holding, their
  entitlement, the payment date and what the company recorded, meets it. A
  generated per-holder document was deliberately not built, and waits until a
  company asks for one.

- **Dividends sit beside transaction history, not in it.** A transaction is
  read from a chain and a dividend is what a company records, so the design
  note's §6.2 keeps them in two lists with a link between them rather than
  synthesising rows into the chain-derived history.
- **The home page's count is about the caller as a member.** A company owner
  reads its whole roll under the policies, but the summary counts only the roll
  rows naming the caller, so the owner of a company is not told its members'
  votes and dividends are waiting on it. A person holding through two register
  members is counted as waiting while either holding is.

[Shareholder publications](engineering/records.md#publications) owns the
mechanism and [publishing to members](business/publications.md#publishing-on-the-companys-instruction) the procedure.

## Splits and consolidations

The design for share splits and consolidations is written in
[#649](https://github.com/Ledova/ledova/issues/649) and any implementation
belongs to a later issue, which the owner chose on 23 September 2026 in
[the design note](https://github.com/Ledova/ledova/issues/649#issuecomment-5789320596).
The issue's own acceptance asks for the design to be written and reviewed before
implementation, and the work is larger than a design: a deployed share class has
no function that could perform either action, and a consolidation cannot be
executed at all, because nothing but the holder can destroy shares.
[Splits and consolidations](business/issuing-shares.md#splits-and-consolidations) owns the
reasoning and lists what an implementation issue must still decide.

## The company pack

Platform staff produce the pack in admin until [#871](https://github.com/Ledova/ledova/issues/871)
adds company-scoped preparation, which must preserve export privacy, provenance
and truthful contract ownership and handover instructions.

On 23 September 2026 the owner took every recommendation of
[the design note](https://github.com/Ledova/ledova/issues/650#issuecomment-5803509874)
for reporting and portability, recorded in
[#650](https://github.com/Ledova/ledova/issues/650#issuecomment-5803651807).

- **One archive.** The company data export is the portability pack, and the
  company's transaction evidence goes inside it. Product §6 names the company's
  records and the authority and instructions to continue elsewhere in the same
  sentence, and a company export plus a pack that wraps it with a README and
  contract files would be one generator run twice with a flag. One archive means
  one generator, one record kind and one consumer test.
- **Staff produce it in admin, within the request**, on the company's written
  instruction naming the recipient, or on the document that compels disclosure
  for a lawful request, and it is recorded as a `company_pack` kind of register
  export, once for each share class. That is Shape A: no new table and no
  customer route. A copy of one person's data for a third party is not built
  until real member data is held.
- **Only what the register holds leaves** of a member: name, residential
  address, holding, linked wallets and identity source. Email, phone, date of
  birth and verification evidence stay. The decision kept platform account ids
  back too until 19 October 2026, when the owner aligned it with what the pack
  carries: platform account numbers leave in decision records and in the
  fingerprint inputs of register entries and of dividend payment records and
  their withdrawals, even where the account is a member's
  ([what never leaves](business/member-records.md#what-never-leaves-and-why);
  [#1139](https://github.com/Ledova/ledova/issues/1139#issuecomment-6262477255)).
- **The company sees resolution tallies and read counts**, never how a member
  voted or who opened what, while every vote's record still verifies.
- **The pack explains how control of the contracts would be handed over and
  does not hand it over.** The README names each contract, its current owner
  and the exact calls.
- **The account-data export loses its 1,000-transaction cap**; that choice and
  its reasons are under [the account-data export](#the-account-data-export).
- **The pack is delivered immediately**, and refused above 256 MiB of stored
  files. Background production is built the first time a real pack exceeds that.
- **The README states what the pack grants**, in the owner's words: "The
  company, and a provider it names in writing, may use the records and the
  contract interface files in this pack to operate and move the company's own
  register and contracts."

[The company pack](engineering/records.md#company-pack-format) owns the mechanism and
[producing a company pack](business/member-records.md#producing-the-broader-pack-in-admin)
the procedure.

## Essential registry and development workflow priority

**Owner decision, 9 October 2026**, supplied directly in the active Codex session
and recorded as the [current programme policy on #860](https://github.com/Ledova/ledova/issues/860#issuecomment-6078277168).

Fix the expensive development workflow first through existing
[#943](https://github.com/Ledova/ledova/issues/943), without waiting for #867.
Measure slow test work, simplify proven duplication and unnecessary setup, and
improve scheduling while preserving meaningful coverage and reliability.
Use focused development checks, applicable green CI and independent review at
the merging head. The first timing increment does not deliver every proposed
CI tier or path filter. Essential coverage and safeguards remain required;
retire tests only where obsolete or duplicate coverage is established. The
[10 October baseline decision](#backend-migration-baseline) makes the specific
exception for upgrade/rollback tests of migrations that have already shipped.

_The workflow part of this decision was superseded on 11 October by
[minimum tests and fresh migrations](#minimum-tests-and-fresh-migrations), and
#943 closed the same day. The register priority below stands._

Then deliver a simple private-company share registry that records established
company processes:

- Non-paid employee awards, their agreement and vesting records, and the
  company's actual approved share issues. Employees need not buy their awards.
- Externally arranged investor capital and the company's approved allotment,
  with agreement, capital receipt and share issuance recorded distinctly.
- Accurate ownership and history, member access to permitted records, and basic
  certificates and register exports. The plain CSV download was removed on 28 October 2026
  ([decision](#register-csv-download-removed)); inspection copies and the company pack remain.

Current register and chain grants are outright non-paid issues; attached terms
do not implement vesting. A contractual award, an option and issued shares must
remain distinct where the company's arrangement distinguishes them. Vesting
recording is planned; no automatic legal/tax rule engine or option-exercise
scheme is selected. New off-chain investor allotments are also not delivered by
the current non-paid grant. The single account-to-member association remains
with #866; its invitation/access policy has not been selected by this decision.

Narrow #868 to external investment records and authorised allotment. Defer new
integrated AUD collection, reconciliation, refunds and market settlement, new
trading work (#869), advanced governance (#870) and filing workflows (#872).
Core outputs (#871) and core journey acceptance (#873) no longer wait for those
deferred issues. Reuse existing issues and preserve the delivered #865 history;
do not create a parallel programme or adopt another agent's claimed assets.

Keep useful existing payment and chain functionality, retained records and
execution recovery controls. No new chain or payment integration is required
for an off-chain registry entry. Existing company authority, tenant isolation,
private evidence, arithmetic, immutable history and retention remain effective.
Companies must not buy cryptocurrency through the on-ramp; personal investor
use stays optional with #920's guards. AUD amounts can be recorded as genuine
company-provided capital evidence without claiming Ledova collected or settled
them. Future payment mechanics still require an owner decision.

This changes priority and completion scope, not live-operation authorisation,
the licence or legal findings. #624 still needs genuine human release acceptance.

### First scopes for employee awards and external capital

**Owner decisions, 10 October 2026**, recorded on
[#867](https://github.com/Ledova/ledova/issues/867#issuecomment-6088911142) and
[#868](https://github.com/Ledova/ledova/issues/868#issuecomment-6088911736).

- **Employee awards: promised shares, issued on vesting.** The award is recorded
  as a promised entitlement (member, class, total quantity, agreement and
  evidence, with the schedule retained as recorded data, not computed). The
  company records each vesting event with its quantity, date and evidence.
  Shares reach the register only through a separate company-approved non-paid
  grant that references the award and the vested quantity, using the existing
  grant path. Elapsed dates never create holdings or decisions; nothing issues
  automatically. No restriction or forfeiture on issued shares, no exercise
  price and no employee purchase. Shares issued upfront with vesting or
  restriction-release events were not selected; a restricted-share arrangement
  can be a later increment if a company needs it.
- **External capital: fully paid allotments only.** The record holds the
  external agreement, the investor or member (new or existing, walletless
  allowed), class, whole quantity and AUD consideration. The company records its
  own receipt attestation (amount received, date, supporting evidence) before it
  approves the allotment; Ledova does not verify it, and it is not issue
  authority. Agreement, contribution record, company decision and the single
  register ISSUE stay distinct records, but may be captured in one
  prepare/approve flow. Partly paid allotments, calls and outstanding amounts
  are deferred; the existing amount-paid row shape stays so a later increment
  needs no migration. No collection, provider or refund mechanics.

_Delivered on 11 October: [employee awards](business/issuing-shares.md#employee-awards-and-vesting)
(#973) and [external allotments](business/issuing-shares.md#external-investor-allotments)
(#974)._

### Registry focus and cancelled expansion tickets

**Owner decision, 18 October 2026**, supplied directly in the active Codex session
and recorded on [#869](https://github.com/Ledova/ledova/issues/869#issuecomment-6248594626),
[#870](https://github.com/Ledova/ledova/issues/870#issuecomment-6248595030) and
[#872](https://github.com/Ledova/ledova/issues/872#issuecomment-6248595442).

The owner kept the focus on the private-company registry and closed the proposed secondary share
sales and AUD settlement expansion, advanced company resolutions and distributions, and filing
preparation and submission integrations as **not planned**, not delivered. This replaces the earlier deferral
of those three tickets; their proposals remain historical. Existing useful operations, guards,
retained records and evidence, and company responsibilities remain unchanged. A future expansion
needs a new explicit owner decision and scoped plan. This authorises no live operation or data deletion.

### Member invitations and account association

**Owner decision, 11 October 2026**, supplied directly in the active Codex
session and recorded on
[#866](https://github.com/Ledova/ledova/issues/866#issuecomment-6104290270).

The first account/member linking flow is a company-issued invitation for one
specific member, accepted by the signed-in recipient. Acceptance binds the
intended recipient to that company's member record; foreign or ambiguous
identities are refused. A member association grants permitted own-record
access, not a company appointment. Supported walletless records need no wallet
or eligibility for an unrelated investment.

The member can view permitted records and submit particulars or certificate
requests. Company review remains separate from member confirmation, and
certificate fulfilment follows the supported #871 outputs. This selects the
first linking flow; the implementation index records delivery separately.

On 24 October 2026 the owner replaced web users' manual code sharing and entry with an emailed
invitation link under [#1165](https://github.com/Ledova/ledova/issues/1165). The company sends it to
one named member's intended email; the signed-in recipient reviews and explicitly accepts it.
Tokens remain internal, verified-email and company/member binding stay mandatory, and a link alone
grants no access. The company sees acceptance status and an honest send result; provider acceptance
does not establish inbox delivery. Retry uses the original invitation and can send another copy of
the same email. Mobile's existing code flow remains deferred to its later pass.

## Minimum tests and fresh migrations

**Owner decision, 11 October 2026**, supplied directly in the active Codex session
and recorded on [#943](https://github.com/Ledova/ledova/issues/943#issuecomment-6103674410).

Use the bare minimum tests guarding the worst failures. This replaces the prior
coverage rules in AGENTS.md, CONTRIBUTING.md, the testing guide and #943,
including per-route cross-tenant rows, shipped-migration equivalence/adoption
proofs and real-process timing coverage. It changes testing requirements;
company authority and PostgreSQL data safeguards remain product behaviour.

| Suite               | Maximum executed cases | Keep                                                                                                                                                                                              |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend, PostgreSQL | 150                    | Delivered core API happy paths; tenant API/database isolation with at most five real-app-login tests; company authority; ownership totals and issuance idempotency; one fake-scanner refusal test |
| Dashboard           | 20                     | Main pages, sign-in and one core flow; existing Playwright smoke tests separately                                                                                                                 |
| Mobile Jest         | 10                     | App start, sign-in and one core flow; type-check and lint                                                                                                                                         |
| Shared package      | 10                     | Essential shared behaviour                                                                                                                                                                        |
| Contracts           | 20                     | Who can mint, pause and transfer                                                                                                                                                                  |

Delete other tests and unused helpers/fixtures. Real Redis/ClamAV, multi-process
timing, deferred and legacy suites leave the tree. EVM and Bitcoin leave CI;
`make chain-test` keeps one or two manually invoked smoke tests.

Every PR runs the same checks on GitHub's runners. Remove changed-file routing
and its tests. Keep the current Mac main runner selection (superseded
[below](#github-runners-and-mac-retirement)), fail-closed verdict,
PR wording and source gates, backend lint/system checks, RLS role/catalogue
checks and API schema snapshot. `make preflight` runs the CI checks except
native builds. Android and iOS native builds run only by manual dispatch before
a mobile release.

Delete project migrations and generate fresh initial migrations from current
models. They must install PostgreSQL RLS, roles/grants, functions/triggers,
history/share-total guards and issuance locks. Delete older-database baseline
adoption. Package-owned migrations stay with their dependencies. Held product
work, including #867, rebases onto the fresh migrations after this work lands.

At this initial checkpoint, ledova.io was left untouched and every part of its
[backup/export/rebuild/re-seed plan](operations/README.md#rebuild-a-database)
needed owner approval. The later [backup permission](#binding-caps-and-backup-authorisation)
and [release direction](#ledovaio-rebuild-and-release-authorisation) supersede
those restrictions for the completed operation.

Deliver in at most three PRs, with short descriptions, independent review at the
merging head and green CI. Targets are the whole PR run within **ten minutes on
GitHub's runners**, and all tests together within **five minutes on the Mac**.
Report actual counts and timings against those targets. Earlier timings and
verification remain historical evidence, not proof of the new targets.

### Dependency advisories in ordinary CI

**Owner follow-up, 11 October 2026**, after the minimum-suite targets were met
and #943 completed. [#975](https://github.com/Ledova/ledova/issues/975) records
the audit restore.

Run JavaScript production dependency advisories in `make ci-checks` and backend
advisories in `make backend-test`, so preflight includes each once. A new advisory
must fail. Keep only the explicit previously accepted package/advisory pairs
in [the security policy](../SECURITY.md#dependency-advisories); a severity
threshold or broad category must not silently accept future findings.
Dependabot remains unchanged. Report the measured audit time as part of the
ordinary check timings.

### GitHub runners and Mac retirement

**Owner follow-up, 11 October 2026**, after comparing completed main runs.
[#976](https://github.com/Ledova/ledova/issues/976) records the change.

Use GitHub-hosted `ubuntu-latest` for ordinary PR, main and manual CI runs.
The owner measured roughly 6½–8 minutes on the Mac pool against 5½ minutes
on GitHub, with each Mac job waiting 1–3½ minutes for a fresh VM. GitHub's
runners are free for this repository, so the earlier main self-hosted selection
is superseded. Keep the fail-closed verdict, PR wording and source gates.

Retire the Mac login service, deregister its remaining owned runners and close
its two groups to repository/public access. The original decision also preserved
the host source in Git as retired manual tooling, with private configuration
and evidence kept outside Git. Future reuse
requires a reviewed change and explicit host configuration; no Linux runner is
activated by this decision. Local Mac preflight remains supported.

**Owner cleanup amendment, 14 October 2026:**
[#1039](https://github.com/Ledova/ledova/issues/1039) removes the unused Mac runner
source from the current scripts tree, superseding the earlier source-preservation
instruction. Git history retains it; no separate retired folder is kept. Private
configuration and evidence outside the repository are unchanged.

## Binding caps and backup authorisation

**Owner follow-up, 11 October 2026**, supplied directly in the active Codex
session and recorded on [#977](https://github.com/Ledova/ledova/issues/977).

The existing caps remain binding: backend 150, dashboard 20, mobile 10, shared
10 and contracts 20 executed cases, with at most five real-app-login tenant
cases. Count every parameterized row. At capacity, a new core test replaces an
existing case or needs an explicit owner-approved cap increase in the same PR.
The author records before/after counts and names the replaced cases or links the
approval; independent review verifies them. No temporary overflow or silent cap
increase is permitted. This adds no reporting framework or broader test mandate.

**Owner frontend instruction, 18 October 2026**, supplied directly in the active
Codex session: Playwright smoke also has a binding cap of nine executed cases.
At capacity, a new case replaces an existing one or needs owner-approved cap
changes in the same PR. This supersedes the earlier outside-cap treatment.

The owner now authorises a ledova.io backup and read-only database/private-storage
inventory. This supersedes the initial restriction above; that permission needs
no repeat request. Access details and actual results belong to the separate
operational task, with private evidence and no live identifiers or personal data
in Git. Reversible isolated backup validation and mapping rehearsal may proceed
with workers, signers and external integrations disabled; ordinary preparation
needs no extra permission. This documentation records permission, not completed
live or isolated work.

At this checkpoint, live selective-record export, stopping writers, rebuild,
migrations, re-seeding, configuration and release still required the owner's
go-ahead, supplied in the [later direction below](#ledovaio-rebuild-and-release-authorisation). Signer activation
and real-funds use remain separate decisions.
The [short rebuild plan](operations/README.md#rebuild-a-database) preserves
the original database/storage and matching release/configuration for recovery.
A firm downtime estimate needed the actual database/storage inventory and sizes,
owner-confirmed record mappings and a measured safe isolated rehearsal; none was
available at this checkpoint. Record selection was pending that inventory and
the owner's decision, not a permission request for each preparation step.

## ledova.io rebuild and release authorisation

**Later owner direction, 11 October 2026**, supplied directly in the active
Codex session. The owner authorised production deployment and the fresh rebuild,
permitted resetting obsolete production data/resources to keep the project
simple, and then directed that no further backup work was needed. This
supersedes the preparation-only restriction above for that operation and needs
no repeat permission request. Signer activation and real-funds use remain
separate decisions.

The authorised operation completed under [#979](https://github.com/Ledova/ledova/issues/979).
Its [operational record](operations/evidence/ledova-io-rebuild-2026-10-11.md)
owns the release, retained setup, checks and limits. Existing protected backups
and private evidence remain retained; this decision does not claim later product
PRs were deployed.

## Backend migration baseline

**Historical owner decision, 10 October 2026**, recorded on
[#943](https://github.com/Ledova/ledova/issues/943#issuecomment-6096774615).

The earlier direction required an equivalent baseline at the
[recorded cut](https://github.com/Ledova/ledova/issues/860#issuecomment-6101119001),
safe old-database adoption, essential real-process tests and one backend group.
Those increments landed in #967, #968 and #969; their source, review and timings
remain in those PRs and Git history.

The owner confirmed the absence of old-format swaps, journal-less issuances and
earlier subscription rows ([initial confirmation](https://github.com/Ledova/ledova/issues/943#issuecomment-6097699851)),
and signed legacy issuances ([later confirmation](https://github.com/Ledova/ledova/issues/943#issuecomment-6101101076)).
Their obsolete compatibility paths were retired; current database guards and
unrelated retained records remain.

The [11 October decision](#minimum-tests-and-fresh-migrations) supersedes the
baseline adoption path, broad runtime/process coverage and earlier 15/20-minute
targets. The live rebuild later completed under [#979](https://github.com/Ledova/ledova/issues/979).
That checkpoint kept the Mac login
service running while Linux and administrator-level startup stayed deferred.
The later [GitHub runner decision](#github-runners-and-mac-retirement) retires it.

## Registry priority, crypto on-ramp and AUD payments

**Owner decision, 5 October 2026**, supplied directly in the active Codex session
and recorded in [#860](https://github.com/Ledova/ledova/issues/860#issuecomment-5991923610):

**Historical scope:** the [9 October decision](#essential-registry-and-development-workflow-priority)
supersedes the immediate AUD-payment and marketplace expansion described here.
The investor-only on-ramp restriction and preservation of existing controls stand.

- The core product is the private-company share registry and issuing, managing,
  transferring and purchasing company shares.
- Companies must not buy Bitcoin, Ethereum or other cryptocurrencies through
  Ledova's on-ramp. Only investors in their personal investing capacity may use
  it; crypto purchasing is optional and is not a core feature.
- AUD must be a valid payment method for purchasing company shares. AUD
  offering pricing alone, an AUD-valued deposit or an AUD-denominated
  stablecoin does not establish direct AUD payment support.

This supersedes the earlier unrestricted Buy crypto availability; its placement
inside Wallets and the historical delivery record remain retained.
[#920](https://github.com/Ledova/ledova/issues/920) adds a current personal
`investor` or `both` account check before the API contacts the provider, alongside
wallet ownership. Both clients hide company purchase entry points and guard
direct opening, deferred responses and open provider views against account or
investor-role loss. Unknown accounts fail closed. This adds no server signup,
identity or account-status requirement. A company appointment or share-operation
wallet grants no on-ramp purchase permission; authorised company wallet operations
remain separate. Synthetic tests establish the guards, with external-provider
and physical-device acceptance remaining separate.

At this decision's date no payment rail, provider, collection, receipt
verification, reconciliation, refund or secondary AUD settlement mechanism had
been selected, and none has since; the 9 October decision deferred them. It
neither selects a payment integration nor authorises live operation or real
funds.

## Payments and settlement

The 9 October decision defers new integrated payment and secondary settlement
work; the mechanisms below are the current experimental secondary protocol and
guarded functionality, not a direct AUD settlement design or a requirement to
purchase cryptocurrency through the on-ramp, and a payment receipt is never
authority to issue shares.

**A secondary buyer funds before placing an offer** (owner decision, 25 September
2026, on [#645](https://github.com/Ledova/ledova/issues/645)). Buy-order
admission requires the buyer to hold the settlement stablecoin when the order is
created, and the second settlement signature queues execution at once, so the
platform does not accept an unfunded offer and then wait for payment. The
simulated external payment is the buyer's AUD deposit, recorded by staff as a
mint request with its reference and date, whose mint is the stablecoin that pays
the seller inside the atomic swap. Acceptance, payment, transfer and the
register update stay distinct recorded events, and the seller is never exposed to
an unpaid transfer. Unfunded acceptance with payment-gated execution was declined:
it would add reserved liquidity, a payment deadline and a path for refusing an
unpaid offer. Prefunding does not remove every failure: the balance is checked
when the order is created and stays in the buyer's own wallet until the swap
executes, so a swap can still fail if the funds move first. The swap is atomic,
so a failure moves neither the shares nor the payment, and the settlement's
failed-execution handling applies.

**One match, never crossed** (owner decision, 2 October 2026, on
[#846](https://github.com/Ledova/ledova/issues/846)). A new order matched at most
one resting order, so an order larger than the best opposite order could leave
the book crossed once its trade settled. The owner chose "One match, never
cross": keep one match per order; any remainder rests only at a price that does
not cross the book, otherwise it is held back. Smallest change, no advanced
trading mechanisms. A held order takes its next single match from a sweep every
minute; a lapsed or reverted pair is never matched again, since re-pairing it
would let the party who did not sign lock the other's order in fifteen-minute
windows it could not cancel. [Secondary trading](business/trading.md#one-match-never-crossed)
states the rule. The same day the owner removed four statuses no code ever
wrote: an order's `executing`, `expired` and `failed`, and a mint request's
`approved`. Answering the change's open questions, also on 2 October 2026, the
owner kept the never-re-pair rule and the labels `Held Back` and
`Partially Filled, Remainder Held Back`, had the demo seed leave one held order
so the state shows in the development stack, and closed the race in which two
crossing orders placed at the same moment both rest: the minute's sweep also
holds back the newer of any two listed orders that cross, with no new locking,
so the book uncrosses within a minute.

Payment confirmation is stored on the subscription. The initial expected volume
is small and admin history records changes. There is no separate payment-per-tranche
model: a second payment updates the cumulative total with a note. A future
`SubscriptionPayment` table is additive if automated reconciliation needs it.

The bank-feed/payment provider remains undecided; selection and settlement
automation are deferred. Incoming AUD transfers must carry their reference text
unchanged through a webhook or a poll. References use the operator prefix plus
an eight-character Crockford code within an 18-character field. See
[B7c](https://github.com/Ledova/ledova/issues/115#issuecomment-5574962513)
and [operator configuration](operations/operator-console.md).

Shares are issued through allotment; generic wallet send endpoints refuse share
tokens. On-chain recipient whitelisting and the register's Transfer-event read
also account for subsequent share movements. Bitcoin sends remain externally
built and signed; the backend decodes and verifies them before admission.
See [transfers](engineering/wallet-protocols.md#transfer-lifecycle).

## Assets and portfolio presentation

Share classes stay out of the general asset list. Discovery belongs to the
eligible investor directory, while holders can read their own holdings.
A share Asset has no current price: nominal issue price is not a market valuation
of an unlisted security. A valuation sum must identify its value sources and
explicitly identify unpriced holdings
([B7d](https://github.com/Ledova/ledova/issues/115#issuecomment-5574975348),
[#346](https://github.com/Ledova/ledova/issues/346)). The
[signed-in app decision](#the-signed-in-app) replaced the earlier per-asset
chart presentation: Holdings lists shares by company and class, and crypto
actions stay in Wallets.

## Simpler signed-in journeys

The web layout below is superseded by the [12 October dashboard decision](#ownership-dashboard-and-compact-sidebar).
Its native journey is superseded by the [26 October mobile decision](#mobile-app-for-shareholders).

On 11 October 2026 the owner approved the reviewed journey proposal under
[#1000](https://github.com/Ledova/ledova/issues/1000). Keep signup unchanged.
Start with home/navigation and named-member invitations (#1003), then focused
investor issuance (#1004) and employee award/vesting/issue flows (#1005), followed
by mobile alignment (#1006). Use existing company processes and APIs, small
increments, plain terms and the binding test caps.

The web company workspace has Register, Employee awards, Documents and Company.
Personal My shares starts with associated register holdings and awards; a wallet
is optional. Optional investing, wallets and technical history are secondary.
Named recipients replace manual IDs, while exact identity, company appointments,
private evidence and original-request recovery remain required. An award,
recorded vesting, approval, external capital receipt and issued ownership stay
distinct. There is no extra Overview page, task engine, new role, legal document
generator, payment collection rail or filing integration in this direction.
Delivered behaviour is described in [frontend](engineering/frontend.md) and each
increment guide; later refinements remain planned until their PRs land.

## Ownership dashboard and compact sidebar

On 12 October 2026 the owner accepted the reviewed compact-sidebar proposal,
including ownership and award charts, with signup unchanged. Deliver the shell,
web landing and Settings grouping under [#1012](https://github.com/Ledova/ledova/issues/1012),
then the company ownership dashboard/compact register under
[#1013](https://github.com/Ledova/ledova/issues/1013), then personal holdings,
awards and documents under [#1014](https://github.com/Ledova/ledova/issues/1014).
Prepare independent work in parallel and merge focused reviewed increments in order.

Company users with readable register access land on Dashboard. Everyday work is
Dashboard, Register, Employee awards (named ESS on [20 October](#share-classes-shareholders-and-employee-awards))
and Documents; company details, classes
(moved to Register on [19 October](#dashboard-settings-and-register-for-a-new-company)),
appointments and named-member invitations (moved to Shareholders on
[20 October](#share-classes-shareholders-and-employee-awards)) belong in Settings. Personal views
show own holdings and relevant awards/documents. Investor and employee relationships
can overlap; account preference grants no company authority. Existing guarded
task pages, retained evidence and original-request recovery remain in use.

Use a bounded, aligned content grid and a compact sidebar. Show essential facts
and next actions directly. Holder bars retain exact shares and percentages of
issued shares in the selected class. Class-count charts appear only for multiple
classes. Award bars use disjoint unvested, vested-unissued and issued quantities;
issued award shares are already in holdings. Incomplete reads never imply zero
ownership or complete totals. No valuation, forecast, chart dependency, new role
or company-wide member disclosure is introduced. Broader personal visibility
needs a separate owner decision. Current delivery is described in
[frontend](engineering/frontend.md); signup and native landing remain as delivered.

The signup constraint above was replaced by the
[14 October combined signup decision](#combined-company-signup-and-initial-authority).
The dashboard layout and native signed-in navigation remain as delivered.

On 17 October 2026 the owner selected per-class ownership donuts under
[#1050](https://github.com/Ledova/ledova/issues/1050), with all classes visible,
the five largest holders and Others, exact quantities and per-class percentages.
Remove the dashboard's Recent changes and Register work cards and their class
selector; detailed history and actions stay in Register. This replaces the web
holder bars and separate class-count chart above without a new chart dependency.

On 26 October 2026 the owner accepted the ownership-map proposal under
[#1335](https://github.com/Ledova/ledova/issues/1335): replace the per-class donut cards with one
company overview and inline class drill-down, using the existing workspace and sidebar. Read exact
company aggregates first and page a selected class's holders on demand. Use modular Apache ECharts
for the desktop map, with the existing class selector and a narrow-screen table. This replaces the
17 October donut decision and the earlier chart-dependency restriction for this company overview.
Issued quantities remain separate from awards and options; the map shows counts, not voting power
or value. Historical transaction prices remain a later increment, distinguished by source and
purpose; do not infer investment prices from rights prose or treat option exercise prices as current
valuations. No automatic class or company valuation is authorised by this change.

On 27 October 2026 the owner selected one ownership ring with a linked class list under
[#1342](https://github.com/Ledova/ledova/issues/1342), replacing #1335's treemap presentation.
Keep its inline class details, exact company aggregates, sequence-bound holder pages and access
guards. Hover and keyboard focus highlight the matching class and centre quantity; every class
remains selectable in the list, with shared search and paging when long. Small classes are not
combined into Other, and zero-share classes remain listed. Use the installed modular ECharts pie
chart, tooltip and SVG renderer, retaining a list without the ring on narrow screens or chart failure.
The existing workspace, sidebar, issued-share denominator and valuation boundary remain unchanged.

On 27 October 2026 the owner approved a company-controlled read-only member ownership overview under
[#1355](https://github.com/Ledova/ledova/issues/1355). This extends the earlier own-records-only
dashboard scope: one company-administrator setting, off by default, shares issued company/class
totals and shareholder counts with current linked members. Each member also sees their own class
quantity and percentage. Retain the actor and time of the company's latest choice. Reuse the web
ownership ring and existing member-read safeguards; do not grant a company appointment or expose
other holders' names, identifiers, personal information, awards, documents or history. Sharing off,
revocation and failed reads clear the shared figures. Issued-share counts do not imply voting power,
economic value or fully diluted ownership. Named-holder and class-rights disclosure remain separate
decisions; mobile presentation is unchanged. This does not replace the company's legal register or
lawful access arrangements.

The owner then requested explicit **Your shares** and **Company ownership** views, usable for both
single-company shareholders and a local Taylor demo linked to three companies. Your shares is the
default; the existing searchable Company selector appears only for multiple companies and starts
with the first available association. Both views
remain company-bound, with no invented cross-company ownership percentage. Ordinary revalidation
preserves the view choice; an account/company change or unavailable sharing returns to Your shares.
The choice stays in memory and uses the existing member-read lifecycle.

The owner then approved one ownership panel under [#1358](https://github.com/Ledova/ledova/issues/1358):
the company name opens the searchable selector in its header, beside a connected view selector,
with figures and chart beneath. Single-company members see a plain company heading; narrow screens
stack the controls. Remove the repeated company heading and separate dashboard control rows, keeping
the controls outside the ring and awards in a separate card.

On 27 October 2026 the owner selected the **Ownership browser with the ownership ring** under
[#1360](https://github.com/Ledova/ledova/issues/1360), after comparing company-map, linked-browser
and zoomable-wheel proposals. This replaces the separate workspace Dashboards, remembered workspace
choice and header view/company selectors described above. Keep one searchable company collection,
then company → class → permitted detail, with a breadcrumb and browser Back/Forward. One company
opens directly; overlapping administrative and shareholder relationships create one company entry.
Show the person's own position alongside company information their current access permits.

Remove the sidebar workspace selector. Dashboard chooses company context; the sidebar retains
focused tasks with visible company context and explicitly named personal/company destinations.
Keep authorised deep links, unsaved-draft confirmation, account boundaries and held-execution
recovery. Company appointments and real member associations remain separate; selecting a company
grants neither. Sharing stays opt-in and aggregate-only for members, awards stay separate from
issued shares, and this adds no valuation or named-holder disclosure. Reuse the existing chart
library and ring with a selectable list; mobile is unchanged by this web increment.

On 28 October 2026, after seeing pages ask people with several companies to choose one on
Dashboard, the owner asked that sign-in always land in a company: "open the company I used last at
sign-in, falling back to the first company in my list, keep explicit links as they are, and update
the standard." The web remembers each account's last company in the browser. An address that names
no company opens it, or the first company in the person's list. Explicit company links are
unchanged, and an unavailable explicit company keeps its refusal.

Later the same day the owner asked to move the company's supporting documents out of Settings: "I
think this page [/company#documents] should be in documents section, not in settings". The owner
also asked about Company-recorded details: "this page … does not seems to be offering much so I
wonder if we can just merge into Profile". Company documents now sit under Documents at
`/documents/company`, and the old address redirects there. Profile shows the selected company's
recorded details for a linked member, with its update request, and the separate Settings item is
gone.

### Dashboard, Settings and Register for a new company

Its mobile part (#1157) is superseded by the [26 October mobile decision](#mobile-app-for-shareholders).

On 19 October 2026 the owner decided
([#1155](https://github.com/Ledova/ledova/issues/1155)) to separate the company
Dashboard, Settings and Register, with simplicity, clarity and no duplicated
functionality as the priority. The Dashboard stays clean and simple: a brief
overview of the company and, on first use, a clear explanation of what to do
next, without forms, instructions or setup processes; the ownership charts follow
once the register is set up. Settings holds verification, activation and initial
configuration, with verification and activation at the top. Register is where
the share register is set up and the only place share classes are created,
which changes the [12 October](#ownership-dashboard-and-compact-sidebar)
placement of classes under Settings. The register stays usable before activation
([19 October](#abr-company-lookup-at-activation)) and is listed after it in the
next steps. The web came first, in small steps the owner checked one at a time;
the mobile app followed under [#1157](https://github.com/Ledova/ledova/issues/1157).
When the independent review of
[#1156](https://github.com/Ledova/ledova/pull/1156) raised it, the owner chose to
keep it simple: share classes created on the web carry the internal quantity
guard, with no custom technical share limit, and mobile follows the same rule.

### Share classes, shareholders and employee awards

Its mobile parts are superseded by the [26 October mobile decision](#mobile-app-for-shareholders).

On 20 October 2026 the owner decided ([#1165](https://github.com/Ledova/ledova/issues/1165)) to
separate share-class management from shareholder management without duplicating functionality: a
shareholder created while allocating shares and one created anywhere else use the same functionality
and the same records. Register holds the share classes and their structure: class cards, Add share
class with its shareholders step, issuing shares and the history of recorded changes. Shareholders
shows who holds shares, with a page per person for their particulars, holdings, history, awards and
access to their own records. Member access moves there from Settings, which changes the
[12 October](#ownership-dashboard-and-compact-sidebar) placement of named-member invitations.
Employee awards stays a distinct workflow, because an award is an entitlement, not a shareholding
([10 October](#first-scopes-for-employee-awards-and-external-capital)); on the web its recipients
are chosen with the same person picker as every other flow, and issuing vested shares is to use the same issue
flow as Register. For award recipients the owner chose a person record from the award onwards, without a
place on the register of members until shares are issued. The web comes first, in steps the owner
checks one at a time: the Shareholders page
([#1166](https://github.com/Ledova/ledova/issues/1166)), one person picker
([#1167](https://github.com/Ledova/ledova/issues/1167)), issuing shares from Register
([#1168](https://github.com/Ledova/ledova/issues/1168)), award recipients as person records
([#1169](https://github.com/Ledova/ledova/issues/1169)) and the mobile app
([#1170](https://github.com/Ledova/ledova/issues/1170)).

_Award recipients as person records were delivered under #1169: an award gives a new recipient a
member ID with their name and address, replacing the earlier rule that an award creates no member
([employee awards](business/issuing-shares.md#employee-awards-and-vesting))._

On 20 October 2026 the owner also chose the destination's name
([#1185](https://github.com/Ledova/ledova/issues/1185)): the short label ESS in the company menu, and Employee
share scheme as the page title when it is opened. This replaces Employee awards as the destination's name; the
award records and actions inside it keep their own names.

On 20 October 2026 the owner approved the
[design for issuing from Register](https://github.com/Ledova/ledova/issues/1168#issuecomment-6288493034):
"I approve the #1168 design as drafted: Issue shares with Investor issue and Non-paid issue, two
record lists, and awards listing their non-paid issues." Register's one task, Issue shares, asks
which kind of issue, shows that form in place, and lists the class's investor and non-paid issues
under it. Each award lists the non-paid issues prepared from it. Tokenised classes keep their chain
issues in Share class settings.

On 21 October 2026 the owner approved the revised structure under
[#1165](https://github.com/Ledova/ledova/issues/1165). The register view starts with the company's current
share classes and structure, with direct class details showing the current position and optional
Class rights. Shareholder management and downloads keep their own destinations. Existing technical
controls and retained history stay available on demand rather than dominating the class page.
During the localhost walkthrough the owner named the web destination **Ledger**, with the subtitle
**Share classes and current ownership.** The owner also aligned the web routes and page folder
under `company/ledger`, with **Set up your ledger** and **Ledger opening** as the web task titles.
The legal term share register, stored records, API paths and native labels stay unchanged. Mobile
keeps Register until its later pass.

The owner then approved the sidebar as the primary navigation between web sections. Ledger's label
opens the share-class overview, with a separate caret for Issue shares, Transfer shares and History;
Shareholders, ESS and Documents stay siblings. Each task has a focused addressable view, reusing
the existing controllers and records. Page controls remain for the current page or record, including
Add share class, Class details and contextual issue or transfer actions. This removes the header
task switches and ownership overview from task views; Settings restructuring, signup and mobile
are outside this increment.

On 22 October 2026, during [#1165](https://github.com/Ledova/ledova/issues/1165), the owner separated
web History from operational work. History reads recorded changes and retained supporting facts,
with permitted downloads. Documents owns certificate preparation; a separate Ledger **Corrections**
sidebar view owns the existing correction and maintenance workflows. This changes placement, not
company authority, append-only records, instruction-bound output generation or original-request
recovery. Documents presents compact output choices, opening one preparation at a time, with
instruction entry, source/privacy guidance and explicit generation in the opened workflow. Mobile
stays unchanged.

_The web History/Corrections split was superseded by the 26 October consolidation below._

On 23 October 2026 the owner asked to finish the web refinements under #1165, reuse the existing
summary grids and aligned form actions in Documents, and merge the completed work after review
and checks. Mobile remains deferred under #1201.

The owner placed Add share class below the class cards, aligned right. The web standard for a
collection's primary creation action is one content-width action row beneath its cards, including
an empty collection card; record-specific actions stay with their records.
The default technical share limit is omitted from Ledger summary cards; its internal quantity
guard remains, along with any distinct finite class limit.

The same walkthrough replaced the Class rights dialog with inline editing in its existing card:
one heading, fields in place of the saved summary and previous versions, and Cancel and Save
together at the bottom right. Focus moves to Summary on opening and returns to Edit after closing
when that action is still available. This refines the web design standard for contextual record
edits; separate tasks, signing and confirmations may still use dialogs. Class-rights authority,
validation, retained revisions and original-save recovery stay the same.

The owner then replaced the fresh Document reference input with **Rights summary** and optional
class documents in the same inline form. The company records existing terms, with prompts for
voting, dividends, repayment of capital and other relevant restrictions; Ledova does not assume
rights from ORD or PRF, draft legal terms or calculate their effects. Documents belong to the
class and its retained rights revision, separate from shareholder attachments and company-wide
document access. Current company register readers can read linked files; current personal company
administrators record changes. Earlier text references and file versions remain in retained
history and exports. Member/public disclosure and mobile entry are outside this increment.

On 22 October 2026 the owner approved structured Class rights under #1165: voting, dividends,
capital on winding-up, transfers, conversion and redemption, with details revealed only where
relevant. Each group starts Not recorded, distinct from an explicit absence of a right; class names
and broad types supply no defaults. Additional rights retains custom terms, Documents retains
supporting files, and a known effective date stays separate from the actual recording time.
Existing summaries, references, documents and immutable revisions remain readable. The first web
scope records and displays existing class terms; it does not establish or vary rights, verify
documents or implement voting, payout, transfer, conversion, redemption or approval rules.
Holder-specific and award conditions stay with their own records. Member disclosure, broader
filtering and comparison interfaces, and mobile entry remain separate work.

The owner then simplified this layout to six compact choices with relevant structured details
beside each right, followed by one full-width **Additional terms** field. This replaces the separate
Conditions fields and Additional rights label. The shared field retains conditions, exceptions and
custom rights. Earlier group conditions are combined with category labels and existing text when
editing; a new save records the combined text without duplicate group conditions, leaving earlier
versions unchanged. The effective date, Documents, authority checks and save workflow stay the same.

On 22 October 2026 the owner also combined web investor-allotment approval and issuance under
#1165. A green **Review and approve** opens the main-page review without deciding anything; its
green **Approve** action records approval and the share issue in one idempotent transaction,
requiring current approval and application authority. Keep a current existing approval and the original-request
recovery, exact preview, evidence, identity, director and duplicate-issuance guards. A failed
transaction records neither new effect. The completed result shows **Approved** and its recorded
shares. Remove the separate Record issue action from this web workflow. Agreement, company-attested
receipt, approval and ledger entry remain distinct retained records. This settles no money and
changes neither non-paid/chain workflows nor mobile's separate steps.

The owner also moved web transfer review onto the main page under #1165, using the existing
summary, ownership impact and company-record cards with details and documents on demand. Opening
review makes no decision; Cancel returns to its record. Transfer approval and application remain
separate, with current authority, exact previews and original-request recovery preserved.

Later on 22 October 2026 the owner combined the final web transfer action, following investor
allotments: **Review and approve** still opens the main-page review without changing records, and
its green **Approve** records company approval and the ledger transfer in one idempotent
transaction. Remove the separate web Apply control. Require current approval and application
capabilities and both appointments; bind the exact ownership, class, company date and evidence, and
retain director-conflict, transferability and unchanged-total guards. Reuse a still-current earlier
approval without rewriting its history. An earlier approved transfer awaiting its entry shows
**Ready to complete**; success shows **Approved** with the recorded entry. Failure creates no new
partial approval or movement, and the original request can be recovered without moving shares twice.
Approval and entry stay distinct retained facts. This supersedes the separate web actions above;
separate API decisions and mobile remain unchanged, with mobile deferred under #1201.

Initial setup stays **Share details → Shareholders → Review**, copying existing holdings or opening
a genuinely empty class; it does not issue new shares. Later issues, transfers and history reuse
the same people and register records, without changing company authority,
exact-request recovery or retained history. Implement Ledger and class details first and show each
step in Chrome on localhost. Mobile remains deferred under
[#1201](https://github.com/Ledova/ledova/issues/1201).

The same walkthrough simplified the web Shareholders step: **Add documents (optional)** retains
just the register copy and ASIC extract. Fresh setup no longer asks for former shareholders or
ASIC comparison figures. Saved and historical records keep their existing values; an inherited
ASIC comparison is read-only and may be explicitly left out when revising. The company's legal
historical records and responsibilities remain unchanged.

The owner also removed the web shareholder form's ownership question and reference inputs.
New mirror allotments record beneficial ownership as **Not recorded**, never an assumed Yes or No.
Existing answers and references remain with retained records and corrections. Optional documents
use the same attachment control. The company continues to keep its complete legal register;
Ledova's mirror does not replace it. Mobile workflow changes remain deferred, with a read-only
compatibility label for unknown values.

The owner then separated the opening balance from optional allotment history. **Current shares
held** comes from the company's current records; copied historical allotments may be absent or
total a different quantity after transfers or cancellations. They neither issue shares nor impose
an allowance on future issues. Remove the remaining-share counter and the forced equality in web,
API and PostgreSQL validation. New opening snapshots do not infer the current holding's amount paid
from optional history. New web paid/unpaid fields default to zero, including when cleared; retain
earlier unknown amounts, calculated values and exact retries. The company's legal historical
records and the separate new-issue safeguards remain unchanged.

For the same form, the owner approved **Allocation history** and **Documents** without optional
markers. Keep optional sections empty until **Add allocation** or **Add document** beside their
heading is used. The owner then chose descriptive text buttons throughout this form, replacing the
icon controls and their tooltip helper. **Edit** and **Remove** sit together beside collapsed
summaries; **Remove** sits below full-width open entry fields. Buttons share typography and spacing,
and the main footer keeps Cancel and the emphasised **Add shareholder** or **Save changes** action.
This changes presentation, not whether history or documents are required.

On 24 October 2026 the owner resumed mobile for the web pages that are finished, asking to "only
update mobile screens that correspond to dashboard pages Codex has already completed and fixed" and
to leave the others untouched ([#1201](https://github.com/Ledova/ledova/issues/1201)). Mobile now takes
the shared names Ledger, Set up your ledger and Ledger opening, and its drawer mirrors the web
sidebar: Ledger with Issue shares, Transfer shares, History and Corrections, then Shareholders, ESS
and Documents. Member access, the member pages and ESS's award records stay unchanged on mobile
while their web walkthrough continues.

On 26 October 2026 the owner removed the duplicate web Ledger History destination under #1165.
Corrections keeps the same chronological entries, retained supporting records and permitted downloads,
with existing append-only maintenance actions gated by the person's current company capabilities.
Old web History links open Corrections with their company and class context. This supersedes the
separate web History view above without deleting audit records or expanding register-read authority.
Mobile retains its existing History destination; no mobile workflow changes are part of this decision.

On 26 October 2026 the owner placed web ESS under Shareholders. It retains the Employee share scheme
page title and existing address, with the shared Share class selector and one Record an employee award
action for the selected class. Editors and recovery keep their class pinned. Fresh entry reads are reused
instead of repeated; required revalidation withholds private records with an explicit loading state.
Award, vesting and issuance rules and mobile navigation remain unchanged.

Later on 26 October 2026 the owner removed web ESS's background refresher, including periodic and
focus/reconnect reads. Entry, explicit error recovery and post-change reads remain guarded; authentication
revalidation is unchanged. Award records use compact recipient/date and quantity rows, with charts,
documents and actions on demand. This supersedes ESS's automatic refresh policy above.

## Paper and Dark themes

On 14 October 2026 the owner directed under
[#1040](https://github.com/Ledova/ledova/issues/1040): keep the existing bright
Paper theme and add a Dark theme that users can switch to, with a consistent
look across the web app (including sign-in and signup), the mobile app and the
public website. Reuse the existing design system, avoid unnecessary complexity,
and preserve each person's choice across sessions. The owner's answers in the
same session: the choice is remembered on each device (browser storage on the
web, device storage on mobile; no account field, API or migration), and Paper
stays the default until someone picks Dark.

This supersedes the "One look" choice under
[the signed-in app](#the-signed-in-app) and the #792 reason for storing no theme
preference. Dark is a second palette for the same semantic tokens. The web
and mobile delivery is described in
[frontend](engineering/frontend.md#design-tokens-and-themes).

## Frontend UX standards

On 20 October 2026 the owner asked for the promised-recipient choice to scale to thousands of
shareholders, employees and recipients and, beyond it, for "a consistent, scalable, and
maintainable UX approach across Ledova": "Keep simplicity as a core principle. We shouldn't
introduce unnecessary abstractions, dependencies, or complexity. Prefer established patterns and
reuse what already exists whenever appropriate." The research, the review of both clients and the
proposal are in #1174, and the owner approved it as recommended:

- **The control follows the data.** Short fixed lists are radio buttons, bounded lists a native
  select, and anything that grows with a company a searchable list built on the Headless UI
  `Combobox` the dashboard already uses. Browsing records is a table or list with search, filters
  and paging, never a picker.
- **People are searched in the browser for now**, over the one list each flow already reads; server
  search follows when lists outgrow one read, behind the same control. After the first review the
  owner kept two departures from the proposal ("Keep both"): a list shows at most 50 matches and
  anyone further down is found by typing, with the full list on Shareholders, rather than scrolling
  every person; and a choice can be replaced but not emptied, so there is no clear button.
- **Forms are checked on submit**, with an error summary and a message on each field, rather than a
  disabled button that cannot say why.
- **Tables page by number and feeds load more.**
- **One home for the standards,** [frontend UX standards](engineering/frontend-ux.md). Each rule
  lands across the whole app with its reference implementation, so the document only describes
  delivered behaviour.
- **Order:** the standards document and searchable person choice first (#1176), then issuing shares
  from Register (#1168), then the remaining steps (#1177–#1183) alternating with #1169 and #1170.
- **Web first (21 October 2026):** "I think we should postpone the mobile changes, finish the
  dashboard and them test using the Chrome extension and them once I'm happy with the results we can
  start building the mobile". So the web half of each remaining step comes first, checked in the
  owner's Chrome, and the rest of the mobile work waits for the owner's go-ahead. Asked about the
  first mobile person-choice PR (#1196), already approved after its walkthrough, the owner chose to
  merge it.
- **One mobile issue (21 October 2026):** "Also everything related to mobile we should put on a
  separated git issue so we can continue to addressing all the issues and close it as we progress
  and what is pertinent to mobile we will add to this one single git issue". So all mobile work is
  in #1201, #1170 and #1177 closed as duplicates of it, and each step's issue closes when its web
  half lands.
- **The register's records load in full (21 October 2026).** Asked whether each share class's
  register records (allotments, transfers, awards, grants, openings, imports, corrections,
  particulars changes, member links, deployments and member access) should keep loading in full,
  given each record holds its own recovery for an uncertain reply, the owner chose "Keep in full
  (Recommended)": "Each share class's register records keep loading completely; they grow only with
  one company's register decisions. Recorded in the standards as the one stated exception to 'never
  read a growing list in full', to revisit if registers grow large. Shareholders, applications,
  notices, the eligibility queue and request histories still page or load more."
- **People stay searched in the browser (21 October 2026).** #1174 put the picker's server search
  in #1181. Most forms, though, filter the full people list for eligibility, and import, the
  shareholder page and mobile also read all of it. Asked whether to build it then, the owner chose
  "Defer the person picker's server search (#1181 option a): keep the browser search and record the
  switch at about 2,000 people." So server search, behind the same control with a typing delay and
  a page limit, follows when a company reaches about 2,000 people.
- **A company hands out its own identifiers (21 October 2026).** An investor's eligibility request
  takes a company's exact UUID, or an approved offering's, but since short references (#1240) no
  screen showed a company its own (#1246). The owner chose: "show the company its own ID (and each
  approved offering's) on its own pages with a Copy button; investors paste it into the request as
  today." So Company shows the company's UUID in full with Copy, and Offerings each approved
  offering's: the one exception to short references.

On 22 October 2026, the owner accepted a further web refinement under #1165: **Add person** on
Shareholders records a company person's particulars without shares or a login; transfers select
existing company people only. Recipients need not hold that class. Keep the shared searchable
control and the existing new-person paths for setup, issues and awards. The company person list
distinguishes people without shares from current shareholders, and registration keeps company
authority, an attributable source and the original request on retry. Mobile stays deferred.

On 28 October 2026 the owner asked for a UX review: make the chevron sections more intuitive,
remove or hide UUIDs and technical details, and reduce clutter. After an assessment proposing five
phases (#1378), the owner chose: "Start phase 1 with your defaults: remove Record details/Technical
details chevrons and internal IDs, fix the colliding labels." So the register's records outside
the chain views, certificates, inspection copies, member access and requests, Team,
representative authority and Profile drop their **Record details** and **Technical details**
sections and internal references. The identifiers a company hands out read as **Company ID** and
**Offering ID** wherever they are shown or typed. The chain views and the eligibility pages follow
in later phases.

## Mobile app for shareholders

On 26 October 2026 the owner made the mobile app a shareholder app: "make mobile shareholder-only.
Company administration, registration and activation stay on the web". The owner then added: "My
intention is not to provide mobile users with a way to access the remaining functionality through a
browser". So the app has no links or hand-offs to the web, including from notifications. The owner
agreed the screens through [mockups](https://claude.ai/artifact/CHeXcDVycP9csCT3SQnvh1) and wrote:
"All looks good. Also delete what is no longer used in the process".

- **Three tabs:** Holdings, Documents and Account, with notifications behind a bell. There is no
  drawer.
- **Holdings across companies and classes:** a card per company, with a line per share class and
  each award's vesting. A searchable list replaces the cards above about six companies, and holdings
  that have ended sit under Past holdings. Percentages are not shown, because members do not
  receive class totals.
- **Detail on demand:** a company, then one class with its history and a certificate for each
  change, then the certificate to share or save. Each award has its own page.
- **Documents** gathers every company's certificates and notices, filtered by company. **Account**
  holds the profile, the details each company records (one change can go to every company),
  invitations, app lock, notifications and appearance.
- **Removed from mobile:** company administration, registration and activation, the deferred
  investing screens (wallets, buying and sending crypto, trading, activity, Directory, Applications
  and eligibility), identity verification, Help and the QR scanner, with their code. Mobile signup creates individual accounts. A company account
  that has not finished signup is told the app is for shareholders.
- **Notifications for share events** (a certificate ready, shares vested or issued, a details
  change decided) needed new server notifications; S7 (#1344) adds them.

## The signed-in app

The web layout below is superseded by the [12 October dashboard decision](#ownership-dashboard-and-compact-sidebar).
Its mobile menus are superseded by the [26 October mobile decision](#mobile-app-for-shareholders).

The signed-in app is rebuilt around the register; crypto stays supported but is
no longer the core (owner decisions, 26 September 2026, on
[#732](https://github.com/Ledova/ledova/issues/732#issuecomment-5839112787)).
The programme is shipped. Where a choice below named staff review or owner-only
administration, the [company-managed decision](#company-managed-registers-and-one-product)
has since put that decision with company appointments; the personal shareholder
menus and the paper interface stay, and a signup account type alone grants no
company authority.

- **Menus.** Every account gets _Your shares_: Holdings, Notices and Activity,
  because anyone entered on a register can receive notices and votes, including
  a company representative who signed up as a company. Investing accounts also
  get _Invest_: Directory, Applications, Market (only while `trading_enabled` is
  on) and Verification. Company accounts get their company group (Register,
  Offerings, Company) and land on Register. The web Register implements this
  landing with the stored register of current members, rather than wallet balances.
  Each class opens from Register on its own ledger page, with Raise authorised
  shares, now a company-authorised capital increase. The role stays as chosen at
  sign-up; staff set "both" in admin, and a customer cannot change it afterwards.
  Since #864 an account without the company role also reaches Register, from
  Settings on the web and the drawer on mobile, when a current company
  appointment grants register access.
- **Names follow the product's terms.** Holdings replaces Home; Notices replaces
  Publications and Dividends; Activity replaces Transactions; Applications
  replaces Subscriptions; Market replaces Trading, and the coin-price page that
  held the name is retired; Verification replaces Eligibility; Register and
  Share classes replace Share Tokens; "Raise authorised shares" replaces Capital
  Increase; and the company application sits under Company instead of as
  Listing. Company details and Offerings use ledger sections. Directory keeps
  its name.
- **Crypto lives inside Wallets.** Buying crypto and sending stay, as actions
  inside Wallets rather than menu items. The coin-price page and favourites are
  deleted; the Buy crypto step shows the current price. Amounts are in AUD
  everywhere, with no display-currency choice.
  The [5 October owner decision](#registry-priority-crypto-on-ramp-and-aud-payments)
  supersedes unrestricted Buy crypto availability: purchases are optional and
  investor-only; companies must not use the on-ramp to buy cryptocurrency.
  Sending and authorised company share-wallet operations remain separate.
- **One look.** Paper only, with no theme switch, and no test-network or
  synthetic-data notices in the product. The theme part is superseded by the
  [14 October theme decision](#paper-and-dark-themes): Paper stays the default
  and Dark can be chosen.
- **Titles in the page.** For page titles the owner chose "Title in the page":
  "As shown: the title and the page's actions sit in one row on the content's
  own edge, at every width. The desktop header bar goes, and on long pages the
  title scrolls away." For the signed-in footer the owner chose "Remove it":
  "The operator stays named where it acts (listing review, Offering, Directory)
  and in the mobile app's Help. Public pages keep their footer, and no legal
  position needs it on every page." (Owner decisions, 26 September 2026, on
  [#732](https://github.com/Ledova/ledova/issues/732#issuecomment-5845666218).)
- **Holdings name each class when read.** For how holdings get their class and
  company names, the owner chose "Look them up on load": "No database change.
  While a company has paused transfers of a class, its holders see the asset's
  combined name (e.g. "Kestrel Foods Class A") instead of the separate company
  and class." (Owner decision, 26 September 2026, on
  [#732](https://github.com/Ledova/ledova/issues/732#issuecomment-5846254159).)
- **Notices stays personal.** Asked whether to accept the gap until the register
  work provides the company's own publication list, the owner chose "Accept the
  gap": "Notices stays personal; the company's own list arrives with the register
  work in step 6. Mobile keeps its current list until step 10." The company's
  list opens from Company as Published to your members in both clients,
  selecting the owned company explicitly and showing stored documents and
  recorded tallies without member voting controls. (Owner decision, 26 September
  2026, on [#732](https://github.com/Ledova/ledova/issues/732#issuecomment-5846254159).)
- **Mobile follows the web.** The mobile app takes paper and the new structure
  together, after the web.
- **Applications keep their names.** Asked how an application should keep
  showing its company, class and payment details while the company pauses the
  class, leaves the directory, or is warned or suspended by staff, the owner
  chose "Store them on the application": "One database change, filled in for
  existing applications. Applications, payment details and Withdraw stay
  available whatever the company does. Names are as at the time of applying, so
  a later trading-name change won't show on older applications." (Owner
  decision, 26 September 2026, on
  [#749](https://github.com/Ledova/ledova/issues/749#issuecomment-5846560619).)

The owner answered the two remaining scope questions on 27 September 2026
([#749](https://github.com/Ledova/ledova/issues/749#issuecomment-5850699327)):

- **Initial scope:** "One issuer first; expand later."
- **Initial Market:** "Keep automatic matching for the first version."

On these answers the first testnet Invest experience presents one fictional
company, and Directory lists its share classes and offerings with no registry
search. The API's visibility stays authoritative, so the client does not discard
an accessible class because another company was returned first. Market shows
_For sale_ and _Wanted_ over the existing automatic matching, with no seller
acceptance or rejection. The buyer-funds-before-offering decision remains
unchanged. These decisions set the implementation's scope, not permission for a
live deployment or real funds.

The owner answered four follow-up questions on 28 September 2026, asked after an
audit of this work ([#785](https://github.com/Ledova/ledova/issues/785)); pull
requests on #785 carry out the last three:

- **Staff outputs: not now.** Asked whether company users should see the
  status of the outputs staff prepare for them (certificates, inspection copies,
  the company pack) and how to ask for one, the owner chose "Not now": "Keep the
  static boundary text. Companies ask the operator directly; revisit when real
  issuers use it. No new issuer read of operator records." The 9 October
  decision has since put those outputs on [#871](https://github.com/Ledova/ledova/issues/871).
- **Data nothing reads goes.** For the favourites table and the hourly holding
  snapshots, the owner chose "Delete them": "Remove the favourites model, table
  and admin, and stop writing holding snapshots and drop that table. One
  migration; the data is synthetic and has no reader."
- **Offerings in AUD.** The owner chose "AUD only": "New offerings are priced in
  AUD; the staff choice is removed. Existing offerings keep their currency.
  Matches the rest of the app."
- **One preferences record.** On whether notification preferences should merge
  into user preferences, the owner chose "Merge them": "Move transaction alerts
  onto the user preferences record; delete the separate model, table, route and
  admin, with a migration carrying each person's setting across."

The owner answered a Send follow-up on 2 October 2026, during the display review
on #846: **Stop offering shares.** Both clients' Send pickers exclude share
classes, including ones whose class details cannot be read. Crypto and AUDY stay
sendable; shares move through allotment and the market.

The owner answered the tidy-up's three questions on 29 September 2026, accepting
each recommendation
([#792](https://github.com/Ledova/ledova/issues/792#issuecomment-5887890998)):
no company API key, because nothing authenticated with it; no theme or selected
portfolio preference, because paper is the only look and no client read the
portfolio; and routes offer only the methods in use, which
[#832](https://github.com/Ledova/ledova/pull/832) carried out by removing the
33 operations no client called, taking the schema from 191 operations to 158.
The [upgrade notes](operations/README.md#rebuild-a-database) record the key and preference
removals. The theme reason is superseded by the
[14 October theme decision](#paper-and-dark-themes), which keeps a theme choice
on each device rather than on the account.

The owner chose the look of the signed-in pages on 29 September 2026:

- **A card per section.** Shown an older build that grouped Settings, Profile,
  Wallets and Activity in cards, the owner said: "I like how those cards enhance
  the look and feel, otherwise everything looks a little cluttered." Shown two
  treatments, each section as a card with its title inside or a grouped list
  with the title above the card, the owner chose the first: "A for the cards, A
  is a better style." Each ledger section is a white card on the paper ground;
  the page's title and actions stay on the paper above the cards. (Owner
  decisions, 29 September 2026, on
  [#791](https://github.com/Ledova/ledova/issues/791#issuecomment-5878354674) and
  [#791](https://github.com/Ledova/ledova/issues/791#issuecomment-5879159623).)

The owner answered three more layout questions on 29 September 2026, accepting
each recommendation
([#791](https://github.com/Ledova/ledova/issues/791#issuecomment-5887891398)):

- **Wallet actions on each row.** On the web each wallet row carries its own
  action buttons, as merged in #825, rather than a per-row menu; on mobile a row
  opens the wallet's own screen. Nothing waits for a wallet to be selected
  first.
- **The bell's panel opens over the sidebar**, as it does now.
- **The drawer names the company.** On mobile the drawer's company group takes
  the company's name, as the web sidebar does, and falls back to "Company"
  while the name is being read, and when the read fails or finds no company or
  a blank name.

## The account-data export

A person's own data export carries every transaction of their wallets, with no
limit. It used to keep only the newest 1,000 and say nothing about the rest, so
a partial history was presented as the whole. The owner chose on 23 September
2026 to remove the limit
([#650](https://github.com/Ledova/ledova/issues/650#issuecomment-5803651807),
decision 6), over keeping it and marking the export as truncated. The platform
is built to the Australian Privacy Principles, which include access on request
([position 10](legal/positions.md#10-privacy)), and a copy that silently drops
the oldest rows is not access. Marking the truncation would have been honest but
still not a complete copy, and the volumes are small and the person's own. In
the same decision a fee of zero stays zero rather than reading as unknown, and
the mobile app shares the export as a file instead of a message, which a
complete history would make impractical. The export is not recorded, because it
carries only the requester's own data.
[The account-data export](engineering/records.md#account-data-export) owns the contents
and limits.

## Tenancy, sessions and deployment

The earlier implementation's registry and single-issuer modes shared one operator
model and tenancy boundary. The 3 October 2026
[one-product decision](#company-managed-registers-and-one-product) retired the
mode distinction: [#861](https://github.com/Ledova/ledova/issues/861) removed
the field and its API, client and evidence branches, and the fresh migrations
carry no mode column. Private evidence, unrelated configuration and
register/payment history are preserved.
PostgreSQL RLS enforces row isolation; product selectors still distinguish company
management, personal accounts and discovery. See [tenancy](engineering/security.md#tenancy-model).

There is one authentication path: simplejwt sessions with browser and mobile
transports. The unused v2 session design was withdrawn; its historical ADRs remain
in [the earlier tree](https://github.com/Ledova/ledova/tree/963c686/backend/docs/adr).
Email is read-only to customers; staff changes revoke their sessions.

The published compliance seed intentionally uses public figures. Operational
thresholds and evasion-sensitive rules belong outside this repository.

## Contracts compiler and toolchain

The compiler settings and the OpenZeppelin pin recorded in
[contracts and issuance](engineering/chain.md#contracts) are
a contract, not a default: any change to them moves the bytecode of every
contract, so a dependency update that needs one is a toolchain change.

OpenZeppelin stays at 5.4.0 because later releases use the Cancun `mcopy`
opcode in `utils/Bytes.sol` and do not compile under `paris`. Compiling under
`cancun` instead would re-target every contract, including the ones that never
import the affected code, and nothing in the tree needs a feature from 5.5 or
later. What reopens the decision is a needed feature or an advisory against
5.4.0 itself, not a version number going up.

The contracts package declares no runtime dependencies, so `npm audit
--omit=dev`, which is what `make audit` runs for it, reports zero trivially and
proves nothing. The full audit reports advisories across the Hardhat toolchain
that `npm audit fix` cannot change: many have no published fix, some would only
be satisfied by downgrading, and the rest want major moves off the pinned
Hardhat 2 and Toolbox 6 line. That is the same migration TypeScript 7 needs, so Hardhat,
Toolbox and TypeScript are one migration decision rather than three, and the
pinned line stays until it is taken. The exposure this leaves is build
integrity, not deployed code: the deliverable is compiled bytecode, and none of
the toolchain is linked into a contract. The counts measured at the time are in
the [architecture document before the reorganization](https://github.com/Ledova/ledova/blob/dc9e29597e10a7e1cf0f383dd4ac3040acb17529/docs/ARCHITECTURE.md#contracts)
and the dependency reconciliation in [#518](https://github.com/Ledova/ledova/issues/518);
rerun `npm audit` in `contracts/` for the current picture rather than reading
those numbers as current.

## Clients and API types

Both clients compile `@ledova/shared` from source, without a package build step.
Directory, Applications and company Offering workflows were available in both the
dashboard and mobile app, using shared hooks, until the
[26 October mobile decision](#mobile-app-for-shareholders) removed them from mobile. Earlier client boundaries are
recorded in [B7b](https://github.com/Ledova/ledova/issues/115#issuecomment-5574947880)
and [B2](https://github.com/Ledova/ledova/issues/115#issuecomment-5574848881).

Shared API types are generated from the committed OpenAPI snapshot. The owner
accepted PR #562 as the clean-release checkpoint on 2026-09-14; its reviewed head
and merge had identical trees, and all CI checks passed. The handwritten API
counterparts and partial drift parser retire with their generated replacements;
client state and cryptographic utilities retain their own types. See
[B7e](https://github.com/Ledova/ledova/issues/115#issuecomment-5575002254),
[the checkpoint approval](https://github.com/Ledova/ledova/issues/115#issuecomment-5656632666)
and [API gates](engineering/gates.md#the-api-type-drift-gate).

The source no-comments/no-docstrings rule remains an explicit repository choice;
[development standards](engineering/README.md) defines its scope.
