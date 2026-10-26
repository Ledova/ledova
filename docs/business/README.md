# Business processes

[Documentation](../README.md) · [Product and terminology](../product.md)

How Ledova's business processes work: what stays with the company, who may do what, how a
company decision is made and recorded, and where each process is described. It is written for
company representatives, product owners, support and platform staff, and engineers learning a
domain. The product definition and capability status are in [product](../product.md). Each domain
document also holds the staff procedures done on a company's written instruction, and how the
rules are enforced is in the [engineering overview](../engineering/README.md).

## What Ledova does and what stays with the company

Ledova operates the platform; each company operates its own share register. Routine register work
is done by people the company appoints and never needs a Ledova employee to perform or approve it;
[who does what](#who-does-what) lists the tasks platform staff still perform. For an existing
company, Ledova mirrors the ownership records the company supplies
([purpose](../product.md#purpose)), and this boundary holds throughout the product:

- The company keeps its legal register of members, historical records, lawful register access
  arrangements and filings where they already belong. Ledova does not label the mirror a statutory
  register, and neither a copied snapshot, the stored register nor a share token on its own
  establishes legal ownership or membership.
- Opening the mirror records shares that already exist. It is never a fresh issue, a payment or a
  chain mint, and a later tokenisation mirrors existing holdings rather than issuing them again.
- Company details, uploaded documents, member particulars, the ASIC totals a company states and the
  source references it gives are shown as provided by the company. Apart from the document check
  behind retained instructions and publications
  ([staff verification](companies.md#staff-verification-of-a-company-document)), Ledova staff
  verify none of them.
- The company is responsible for its information, its ASIC filings and its legal obligations, as
  the Terms a representative accepts at signup say. The registry lookup checks a company's
  identifiers and name; it does not establish a representative's mandate.
- Ledova changes a company's administrators only through its existing administrators or at the
  direction of a court or regulator, and no staff tool appoints one. Recovering your own account is
  a separate matter.
- Ledova adds no fraud or impersonation checks of its own unless a legal duty on Ledova requires
  one; such a duty is raised with the owner rather than built
  ([representative verification decision](../decisions.md#company-representative-verification)).

Ledova does not collect or verify the money behind an externally arranged allotment, sign
certificates (the company executes them), or prepare or lodge filings; what else it does not do,
such as holding money or giving investment advice, is in [product](../product.md). This repository
is an experimental implementation: identities, companies, payments and assets are synthetic and
chains are test networks
([current capability boundaries](../product.md#current-capability-boundaries)).

Deferred under the [9 October priority](../decisions.md#essential-registry-and-development-workflow-priority):
new integrated AUD payments and marketplace settlement (#869), advanced governance such as
company-run publications and voting (#870), and filing preparation and lodgement (#872). Not built:
splits and consolidations ([issuing shares](issuing-shares.md#splits-and-consolidations)). The
[roadmap](../roadmap.md#deferred) orders the remaining work, and the
[accepted company-managed register plan](../plans/company-managed-registers/plan.md) describes the
target state.

## Who does what

Today the [users](../product.md#1-who-uses-ledova) act as follows.

| Who                                     | What they do today                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company administrators and appointees   | People the company appoints, each with their own account. Within the capabilities their appointment records, they set up and activate the company, appoint the team, record share classes through the API, run the register, record awards and allotments, decide participant eligibility and wallet approvals, invite members and prepare outputs.                                         |
| The registering account (company owner) | The account that registered the company. Ownership grants no appointment and supplies no register decision. It keeps some earlier owner-only workflows: creating and submitting offerings, submitting the directors' register instructions for settled market transfers and retained issues, opening Representative authority and Published to your members. It can also read the register. |
| Members                                 | People entered on a company's register, with or without an account or a wallet. After accepting a company-issued invitation they read their own particulars, holdings, history and awards, ask the company to change particulars and obtain their own certificates ([member records](member-records.md)). Being a member grants no company authority.                                       |
| Investors                               | People with an investing account. They verify their identity, share evidence with a company to obtain its eligibility decision, nominate wallets, apply for offerings and, on the experimental deployment, trade ([participants](participants.md)). One person can be an investor, a member and a company appointee at once.                                                                |
| Platform staff                          | Run hosting, security, integrations, background jobs and support, and recover technical failures. Separately authorised staff handle crypto, screening and payment operations. Staff permissions never count as a company appointment.                                                                                                                                                      |
| Automation                              | Validates and applies exact company-approved instructions, signs chain transactions with the platform's operator key, reconciles records and reports failures. It records the human decision behind each effect and never supplies company authority.                                                                                                                                       |

Platform staff still perform these tasks, each described where linked:

- review, approve, reject and close offerings, accept applications and issue their payment
  instructions, record primary payments and refunds, and scale offerings back
  ([offerings](issuing-shares.md#offerings);
  [applications and payments](issuing-shares.md#applications-payments-and-paid-issues));
- publish documents, resolutions, dividends and payment records, and enter represented ballots, on
  the company's written instruction ([publications](publications.md));
- work the due list, and prepare notice figures and broader restricted company packs on written
  instruction ([due list](member-records.md#the-due-list); [company pack](member-records.md#the-company-pack));
- review the director instructions behind settled market transfers and retained issues
  ([settled transfers](register.md#settled-transfer-instructions);
  [retained issues](register.md#retained-issue-instructions));
- verify the company documents those instructions and publications rely on
  ([staff verification](companies.md#staff-verification-of-a-company-document));
- issue a compliance warning, suspend, delist or reinstate a company, and retry its registry check
  ([staff registry controls](companies.md#staff-registry-controls));
- review compliance alerts from identity screening and transaction monitoring
  ([participants](participants.md#transaction-monitoring)), and accounts that still hold a company
  wallet approval after losing their standing
  ([holder standing review](../operations/operator-console.md#holder-standing-review));
- run settlement-asset and yield-token mint requests
  ([mint requests](../engineering/chain.md#mint-requests)) and update a yield token's net asset
  value ([NAV updates](../engineering/chain.md#nav-updates));
- admit the platform's signing accounts
  ([signer admission](../engineering/chain.md#signer-admission));
- recover infrastructure, retry already admitted technical work and recover chain transactions
  ([recovery](../operations/recovery.md)).

### Company capabilities

A company appointment names one person and one company and records two separate sets of
capabilities: those the person holds personally, and those they may delegate onward when inviting
others. It may have an expiry and can be revoked. An appointment counts only while the person's
account is active with a verified email, the company's
[identity requirement for representatives](companies.md#representative-identity-requirement) is
met, and the appointment has neither expired nor been revoked
([appointments](companies.md#what-an-appointment-records)).

| Capability (app label)                                   | What it permits today                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manage company information and team                      | Edit company information and documents, invite, read and revoke the team, activate the company, invite members to member access and revoke it, and produce the core company pack. It also counts as each register capability below (prepare, approve, apply and read). It does not decide participant eligibility. |
| Prepare register changes (includes reading the register) | Upload company evidence and prepare register changes, issues, wallet instructions and other company commands; read the eligibility queue and prepare an eligibility decision.                                                                                                                                      |
| Approve register changes (includes reading the register) | Approve or reject a prepared change, acknowledge a reconciliation discrepancy, and accept, refuse or revoke a participant's eligibility.                                                                                                                                                                           |
| Apply authorised changes (includes reading the register) | Apply an approved change so that its effect is recorded.                                                                                                                                                                                                                                                           |
| Manage company payments                                  | Recorded and delegable. No delivered workflow requires it yet; payment recording stays with platform staff.                                                                                                                                                                                                        |
| Read company register                                    | Read the register, its history and export, proposals, decisions and evidence copies, and prepare inspection copies and unsigned certificates.                                                                                                                                                                      |

Anyone holding prepare, approve or apply reads the full register, including residential addresses
in the register CSV and retained evidence copies, because they work from member details; the
invitation labels say so
([owner's authority rules](../decisions.md#company-run-register-authority-and-evidence)).

## How a company decision works

Most company changes to the register, a share class or a wallet approval follow the same
pattern. The rules come from the
[owner's authority rules](../decisions.md#company-run-register-authority-and-evidence), and the
[engineering overview](../engineering/README.md#company-authority-boundaries) explains how they
are enforced.

1. Prepare. A person with prepare (or administration) uploads the company's evidence and prepares
   the exact change: the class, member, quantity, dates and terms. Preparing changes nothing.
2. Approve or reject. A person with approve (or administration) reads a preview of the exact
   change and what it still lacks, and approves it or rejects it. The preview shows the people,
   terms, documents and dates, each affected holding and the issued (for an issue, also the
   authorised) shares before and after; a particulars change is shown beside the current
   particulars with their date and source. A rejection needs a written reason of at most 1,000
   characters; an approval takes none. Approval alone changes nothing.
3. Apply. A person with apply (or administration) applies the approved change. Only this step
   records the effect, and it records the effect, the decision and any change to holdings together.

One person may take every step; Ledova adds no compulsory second approver or approver-conflict
rule, and company policy decides whether a separate approver is needed. Application needs an
approval whose approver still holds a current appointment; otherwise someone approves again.
Rejection stays available until the change is applied or rejected.

Investor-allotment and non-paid transfer reviews on the web combine approval and application in one
**Approve** action, requiring both capabilities (or administration) and recording the approval and
ledger effect atomically ([external allotments](issuing-shares.md#external-investor-allotments),
[transfers](register.md#non-paid-transfers-between-members)). They retain any existing current
approval and create at most one entry. Other decision families keep the separate steps above.

Each step confirms an exact preview. If anything the step depends on changes before you confirm,
such as the proposal, your appointment or the register, the step is refused and you review it
again. Every step rechecks your appointment, including the identity requirement, at the moment it
is recorded, so a revocation that lands first refuses the step and records nothing.

These company actions are taken in one step rather than prepared, approved and applied:

- recording a share class through the API, with current personal administration or prepare
  ([share classes](issuing-shares.md#share-classes));
- eligibility decisions and revocations, by a person holding approve personally
  ([participants](participants.md#deciding-withdrawing-and-revoking));
- discrepancy acknowledgements, with administration or approve
  ([register](register.md#acknowledging-a-discrepancy));
- recording employee awards and vesting events, with administration or prepare
  ([issuing shares](issuing-shares.md#employee-awards-and-vesting));
- member invitations and revocations of member access, with administration
  ([member records](member-records.md#member-access)).

The company owner still submits the directors' instructions for settled market transfers and
retained issues, which platform staff review and apply ([settled transfers](register.md#settled-transfer-instructions);
[retained issues](register.md#retained-issue-instructions)).

### Named directors

Issues (grants, paid issues and allotments), company-recorded transfers, openings, corrections and
wallet links rest on documentary authority: the company names the approving director and uploads
the director resolution, or a court order where one applies. A company appointment supplies the
capability to record the decision; it does not make the appointee that director. The director need
not have a Ledova account, so the company can record an external board resolution without every
director signing up, and no two-person rule is added. The named director cannot be the recipient
of an issue or a party to a transfer; names are compared ignoring letter case and extra spaces. An
owner account is not proof of director authority.

### Company-provided evidence

An upload is checked like every other upload and kept privately with its fingerprint, and the
proposal keeps its own copy, so a later change to the upload cannot change what was decided; if a
retained copy no longer matches its record, the proposal cannot be decided and a new one is needed.
Preparation accepts only the preparer's own upload for that company. Ledova staff verify none of
it ([what stays with the company](#what-ledova-does-and-what-stays-with-the-company)).

### Nothing is overwritten

Decisions, withdrawals and revocations are kept with the actual person, appointment and time.
Register entries cannot be edited or deleted: a correction is a new entry that names the one it
reverses ([compensating corrections](register.md#compensating-corrections);
[how entries are protected](../engineering/records.md#entries-and-the-hash-chain)). A proposal
submitted for the retired staff review and still waiting can only be rejected; the company
prepares a new one.

### When the outcome is uncertain

If the reply to a confirmed step is lost, for example because the connection drops, the page keeps
your original request. Do not prepare the same change again: restore your access, refresh, and
recover the original request. Recovery first looks up what the server recorded and never applies a
step twice. It works while you can still read the register, even if your preparation or approval
authority has since ended; a fresh decision still needs current authority. Recovery lasts while the
page stays open; leaving the page discards the unsent form
([recovering a submitted company request](../engineering/frontend.md#recovering-a-submitted-company-request)).

### Chain effects

When an applied decision needs a chain transaction, such as a share-class deployment, a grant on a
deployed class or a wallet approval, the platform signs and sends it. Unsigned work waits and
rechecks the company's authority before signing. Once signed, a transaction is followed to its
outcome even if the authority behind it later ends. A transaction that has been sent is not yet
confirmed, and a confirmed one is not yet final ([chain](../engineering/chain.md)).

## The app at a glance

The web dashboard reaches the records and workflows described here. The mobile app is for
shareholders and holds only their own records, notices and account
([decision](../decisions.md#mobile-app-for-shareholders)). The account type chosen
at signup selects navigation only; company actions follow the person's current appointments, and
the server decides what each person may read. Every page withholds stale records and their actions
after a failed read, keeps an open draft without submitting it until a read succeeds, and closes
open forms when the account, session or selected company changes, so an old confirmation or late
reply never acts for the new one
([clients](../engineering/frontend.md#clients-and-the-shared-package);
[lists and forms](../engineering/frontend.md#lists-figures-and-currency)).

On the web, the sidebar shows:

- Company, for a person who can read a company's register: Dashboard, Ledger, Shareholders and
  Documents. Ledger opens the share-class overview; its separate caret
  expands Issue shares, Transfer shares and Corrections. Shareholders opens the people list;
  its caret expands ESS (Employee share scheme), Member access and Member requests. Personal holds Your shares.
- For everyone else: Dashboard and Documents, both personal.
- Configuration: Settings ([Profile and Settings](participants.md#profile-and-settings)).
- More: Notices and Activity; for investing accounts an Invest group with Directory, Applications,
  Market (when trading is enabled) and Verification; Offerings for company accounts; and Wallets.
- Help & Support, the signed-in person's name, Sign out and the theme switch.

Signing in opens the company Dashboard for a person who can read a company's register, and the
personal Dashboard otherwise. Account preference alone does not choose a company workspace; if the
access check fails, the page offers a retry rather than guessing.

The company Dashboard opens with one line naming the company and its status. Until setup is
complete, a personal administrator also sees **Getting started**: **Verify and activate your
company** ([activation](companies.md#activation-and-the-registry-check)) and **Set up your ledger**
([register setup](register.md#bringing-in-existing-records)). Completed tasks disappear; once both
are complete, the whole card disappears. Register setup completes once the register of the company
shown is opened, not when a class is merely created, and it does not wait for activation. Someone
who can prepare the register but is not an administrator is pointed to Ledger instead.

Once a register exists, the Dashboard shows the selected company's recorded ownership: issued
shares, current shareholders (each person counted once across classes) and the number of share
classes, then one ownership donut per class with its five largest shareholders and Others, with
exact share counts and percentages of that class's issued shares. A class without an opened
register makes the company totals incomplete, and a failed or inconsistent read withholds totals
and charts rather than showing zero. Detailed history and every action are on the
[Ledger page](register.md#the-register-page).

The personal Dashboard (My shares on mobile) shows the person's own register records, with no
wallet needed and never company totals or other shareholders. Their certificates and certificate
requests are in personal Documents on the web and in My shares on mobile
([member records](member-records.md)).

The mobile app has three tabs and a notifications bell, and opens on Holdings. **Holdings** opens
My shares, **Documents** opens [Notices](publications.md#the-notices-page) and **Account** holds
Profile and the app's settings ([Profile and Settings](participants.md#profile-and-settings)).
Mobile signup creates individual accounts only ([investor signup](participants.md#investor-signup)).

Each page is described in the domain document for its process below;
[pages](../engineering/frontend.md#pages) lists every page with its route, its audience and the
section that describes it.

## Lifecycle map

Follow a company and its participants through Ledova:

1. [Company setup and authority](companies.md): signup, the representative's
   declaration, the team, company information and documents, and activation.
2. [Investors, members and eligibility](participants.md): accounts and identity
   checks, each company's eligibility decisions, wallet nominations and approvals, and monitoring.
3. [Register of members](register.md): opening the mirror from company records or
   from the chain, corrections, particulars, wallet links, reconciliation, transfers and former
   members.
4. [Issuing shares](issuing-shares.md): share classes, employee awards and vesting,
   grants, externally arranged allotments, offerings and subscriptions.
5. [Member access and register outputs](member-records.md): member invitations,
   own records and requests, inspection copies, certificates, notice figures and the company pack.
6. [Shareholder publications](publications.md): documents, resolutions and
   ballots, and distributions with their payment records.
7. [Wallets, transfers and trading](trading.md): wallet sends, the experimental
   market and how trading sits beside company decisions.

Next: [company setup](companies.md) ·
[engineering overview](../engineering/README.md) ·
[operations](../operations/README.md) · [decisions](../decisions.md)
