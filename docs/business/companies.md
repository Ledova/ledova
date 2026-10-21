# Company setup and authority

[Business processes](README.md) · [Documentation](../README.md)

How a company joins Ledova and who may act for it: signup and the representative's declaration,
team invitations and appointments, company information and documents, and activation with the
registry check. It is written for company representatives, support staff and anyone learning how
company authority is established. The representative declares their own authority and Ledova does
not verify it ([self-declaration decision](../decisions.md#company-representative-verification));
who holds which capability is in [company capabilities](README.md#company-capabilities).

- [Company signup](#company-signup)
- [Representative authority requests](#representative-authority-requests)
- [Team invitations and appointments](#team-invitations-and-appointments)
- [What an appointment records](#what-an-appointment-records)
- [Who may administer a company](#who-may-administer-a-company)
- [Company information and documents](#company-information-and-documents)
- [Activation and the registry check](#activation-and-the-registry-check)
- [Representative identity requirement](#representative-identity-requirement)
- [The Company page](#the-company-page)

## Company signup

Company signup and the representative's initial authority finish in one flow on web and mobile
([combined signup decision](../decisions.md#combined-company-signup-and-initial-authority),
as amended the [same day](../decisions.md#simple-signup-documents-and-team-after-registration)).
Signup does not look the company up in the ABR; that happens at
[activation](#activation-and-the-registry-check)
([decision](../decisions.md#abr-company-lookup-at-activation)).

1. Create your account, verify your email and choose **Company representative** as the account
   type.
2. Complete your personal profile.
3. Enter the company at **Company details** and continue. Saving creates the company as Draft.
4. Review the saved information. A short statement beside **Complete company setup** says that
   choosing the button confirms you are authorised to administer this company, including managing
   its users, and accepts the Terms of Service (version 2026-10-14, which state the company's
   responsibilities) on the company's behalf. No file, checkbox or delegation choice is needed. If
   your instance requires a verified identity for representatives and yours is not verified yet,
   choose **Verify your identity** here first; **Complete company setup** waits until the check
   passes.
5. Choose **Complete company setup**. This records your acceptance of that declaration, keeps a
   no-file authority request and admits it. Signup completes only once your initial appointment is
   confirmed.

Admission checks that you still own the draft company, that its name, identifiers and type and your
own email and name have not changed since the request was captured, that any expiry you chose has
not passed and, where your instance requires it, that your identity is verified. A refused admission
leaves the request pending and signup unfinished; a pending request grants no authority. A company
has exactly one initial admission; expiry or revocation of that appointment does not permit another.

The initial appointment gives you Manage company information and team personally, and all six
capabilities as delegatable so that you can build the team afterwards. It records you, the company,
the declaration version and text and the admission time.

After signup, add optional supporting files at **Settings → Company documents** and invite users at
**Settings → Company team**; mobile reaches both from **Settings → Company settings**.
Later documents do not alter the retained signup request. The company remains Draft until
activation passes the registry check: registration does not incorporate a company with ASIC,
appoint a director, activate the company or issue shares. Until then, the **Getting started** list
on the company Dashboard (the Register tab on mobile) links its personal administrators to
Activation and to register setup ([the Dashboard](README.md#the-app-at-a-glance)).

Resuming an unfinished signup:

- An unfinished account can sign in again. On the web, a company account with saved personal
  details returns to Company details with its saved company; other accounts resume at the account
  type step.
- Before choosing **Complete company setup**, you can change your email from **Your account**
  ([changing your email](participants.md#going-back-and-changing-your-email)). Signup starts
  again, and your draft company stays with your account and reappears at Company details.
- A retry must settle the retained authority request and the Terms outcome before completion. It
  cannot infer success from a submitted request or a lost response.
- If the pending request's personal scope is not exactly Manage company information and team, its
  delegation does not include all six capabilities, or it has an expiry, choose **Update saved
  setup**. This withdraws the old proposal so that a fresh request with the signup defaults can be
  made; it does not change any appointment.
- If you already hold a current personal administration appointment for the company, the final
  button uses it instead of another declaration: it records your acceptance of the current Terms
  against that appointment if not already recorded and changes nothing else, so older, narrower and
  invited appointments keep their original declaration, capabilities, delegation and expiry.
  Revoked, expired or otherwise ineffective appointments cannot complete signup.
- Opening or resuming the review records nothing; only choosing **Complete company setup** records
  the acceptance.

## Representative authority requests

An owner of a draft company can also request initial authority outside signup, from
**Representative authority** on the Company page on web or mobile.

1. Use your verified account and the draft company you own, selecting it explicitly if you own
   several.
2. Choose your personal capabilities and, separately, the capabilities you intend to delegate.
   Initial admission requires Manage company information and team personally. Set an expiry if
   needed. Selecting capabilities grants nothing.
3. Optionally attach a supporting PDF, PNG or JPEG. It is checked and kept privately; no ASIC extract
   is required, and files can instead be added later as company documents.
4. Submit the request. The platform freezes the company and representative details, the
   capabilities, the expiry and any file, and shows what it captured.
5. Accept the displayed declaration of your workspace and team authority, which also accepts the
   Terms on the company's behalf, and admit the request. Where your instance requires a verified
   identity, an unverified one leaves the request pending. Admission runs no registry check and does
   not activate the company.
6. Read the appointment's personal and delegatable capabilities, expiry and status. An attached
   file stays available from the request history.
7. Withdraw a pending request you no longer want. After admission, **Revoke appointment** asks you
   to confirm the permanent loss of this appointment's authority under the revocation rules below;
   the declaration and any file stay in the history.

## Team invitations and appointments

Open the team from **Company → Company team** or **Settings → Company team** (on mobile,
under **Settings → Company settings**). Investor-only accounts can open it too: accepting an
invitation or reading your appointments needs no company workspace. The page has sections to
accept an invitation, read your appointments, invite and manage the company team, and read the
invitations you issued, with a link to
[Company eligibility](participants.md#company-eligibility-decisions).

1. To invite someone, select the company and one of your current appointments that can delegate.
   Choose the personal capabilities and, separately, any onward delegation for the invitee. Set an
   appointment expiry and an acceptance deadline if needed.
2. Create the invitation and share its one-time code privately with the intended person. The code
   is shown once, in the current form only; it disappears when the form is replaced or your account
   or selected appointment changes, and it is not available from history. If you did not keep it,
   create another invitation.
3. To accept, enter the code and agree to the displayed authorisation and company responsibility
   declaration. Your own account, verified email and the identity requirement apply. Editing the
   code clears your agreement; a failed acceptance keeps the input for a deliberate retry.
4. Read your appointment's source, capabilities, expiry and status, and the invitations you issued
   with their acceptance outcome. Expired and revoked records stay in these histories. Current
   company administrators can also read the selected company's team: name, email, capabilities and
   status.
5. Revoke your own appointment or, as a current company administrator, any appointment in that
   company. Confirm the permanent action in the dialog. A cancelled, reused or stale confirmation
   cannot take effect, and a failed or unconfirmed result needs a fresh confirmation.

Invitation rules:

- Everything offered, personal and delegatable together, must fall within the delegatable scope of
  the appointment you invite from. You may delegate a capability you do not hold yourself; that
  does not grant it to you. Granting or delegating Manage company information and team also needs
  your own current personal administration appointment for that company.
- The acceptance deadline defaults to seven days and may be at most thirty days ahead. An
  appointment expiry, if set, must be in the future.
- Ledova keeps only a fingerprint of the code, sends no email and builds no link containing it. The
  code authorises the first eligible account that accepts it.
- Acceptance is refused when the deadline or the offered appointment expiry has passed, when you
  issued the invitation yourself, when you already hold an unrevoked, unexpired appointment for that
  company (even one that is temporarily ineffective), when the inviter no longer has the authority
  to offer it, or when the identity requirement is not met. After an earlier appointment expires or
  is revoked, a new invitation can be accepted.
- No registry check runs for an invitation. Two people accepting the same code at once produce one
  appointment, and the same account retrying gets its retained appointment back.
- Revoking the inviter blocks new acceptances of their invitations but does not revoke appointments
  already accepted.

Revocation rules:

- Revocation is permanent and keeps the full history. A replacement comes only through a new
  invitation; no self-declaration restores an initial or legacy-owner appointment.
- You can revoke your own appointment even after losing identity verification.
- Administrators may revoke an initial appointment or another administrator's appointment. There
  is no last-administrator exception: revoking the last administrator leaves the company without
  one.

## What an appointment records

An appointment has exactly one source: an admitted initial request, an accepted invitation, or the
retired owner upgrade. Besides its capabilities and expiry
([company capabilities](README.md#company-capabilities)), it records the appointee, their profile
and the declaration they accepted. Appointments, requests, withdrawals, invitations
and revocations cannot be edited or deleted
([how company rows are protected](../engineering/security.md#company-rows)).

- Signup admission records the 2026-10-14 workspace and Terms declaration. Invitation acceptance
  and company activation each keep their own 2026-10-04 declaration; a person accepting a limited
  invitation does not declare workspace administration. Earlier admitted declarations keep their
  original version and text.
- An administrator's later acceptance of the current signup Terms is kept separately, with the
  person, profile, company, appointment, version, text and time. It grants no capability and does
  not rewrite the appointment.
- Legacy-owner appointments, from the retired owner upgrade, carry personal administration and all
  six delegatable capabilities and no declaration. A fresh installation creates none.
- Supporting files keep the private-file lifecycle
  ([retention](../engineering/security.md#deletion-and-retention)).

## Who may administer a company

Editing basic company information and uploading, reading or removing company documents need a
current personal appointment with Manage company information and team for that exact company, or
the draft setup exception below. Delegatable-only capabilities, ownership, shareholding and platform
staff permissions supply no administration.

### The draft setup exception

Before a company has its initial appointment, its current owner, if active and email-verified, can
edit the draft and upload its documents. Any admitted initial appointment, or a legacy-owner
appointment, closes the exception for good; a revoked, expired or hidden initial appointment and a
later change of owner cannot reopen it. A pending request leaves the draft editable, so admission
rechecks the captured details.

### Privacy of authority records

- An authority request is visible only to its requester, an appointment to its appointee and an
  invitation to its inviter.
- Team reads need current administration of that exact company and never show another person's
  private declaration, identity or financial evidence, or signup file.
- An owner whose administrative appointment has ended can still select the company and read its
  basic details, but private documents and contact details stay hidden and every edit or file
  action needs current administration.

## Company information and documents

A current company administrator reads and edits the company's basic information and manages its
documents from Company settings on web and mobile
([Settings](participants.md#profile-and-settings)). If several companies are available, select the
company explicitly first.

1. Select the company and read its name, address, contact details and status.
2. Choose **Edit company** to change the permitted fields, save, and wait for the confirmed receipt
   and refreshed information.
3. In **Company documents**, view a retained file, upload a document of a chosen type, or confirm
   removal of an eligible document. Documents are optional; use Other documents for representative
   authority records.

Rules:

- The ACN, ABN and company type can change only while the company is Draft. The registered name
  and the officeholder declaration (the declarant's name and the board resolution reference) can
  change only while it is Draft or, for an older company, Additional Information Required.
- An ACN and an ABN must pass their check digits, and an ASIC-registered company's ABN must be its
  ACN with two check digits in front. A check-digit pass is a typo filter, not verification: only
  the registry lookup says a number belongs to a real company.
- Changing the registered name, ACN, ABN, company type or officeholder declaration sets the registry
  check back to pending, so the next activation runs a fresh lookup.
- A document attached to an approved or closed offering cannot be removed, because investors may
  already have read it ([offer documents](issuing-shares.md#offer-documents)).

### Staff verification of a company document

Settled-transfer and retained issue instructions
([register](register.md#settled-transfer-instructions);
[issuing shares](issuing-shares.md#retained-issue-instructions)) and
[shareholder publications](publications.md) rely on a company document that platform staff have
verified. Company register commands use the company's own evidence instead.

1. In **Admin → Companies → Company documents**, choose **Review and verify document**. You need an
   active staff account with **Can change company document**.
2. Open the private file and review its company, document type and validity details.
3. Confirm. The confirmation is bound to you and the document and expires after 15 minutes.

Confirmation re-reads the file and records a fingerprint of its bytes and of the document's and
company's identifying details. It is refused when the preview changed, the file is missing, empty
or the wrong size, the document is rejected or its validity is not current; a web address alone
cannot establish content. Ledova clears the verification automatically when the company's
identity, the document's details or its rejection reason change; the company may revoke a
verification but cannot grant one. A register action that relies on the document rechecks the
current file, the company and the validity dates against that fingerprint each time; a publication
needs a current verification of one of the company's documents and records its fingerprint
([how verification is enforced](../engineering/backend.md#company-document-verification)).

## Activation and the registry check

A current personal administrator activates the company on web or mobile. Activation is what
allows participants to request the company's eligibility decisions and, once it is
[open to investors](issuing-shares.md#listing-the-company-in-the-directory), to apply for its
offerings. It establishes no offering, share issue, payment, participant eligibility or wallet
approval. Signup does not look the company up in the ABR; activation does. Before activation, the
company's administrators can keep its own non-tokenised register records, such as the mirrored
register, awards, allotments, transfers and member access, but eligibility decisions, offerings,
chain deployments and issues, paid issues, capital increases and company wallet instructions wait
for an Active company.

1. Establish your authority first, through signup or an accepted administrator invitation.
2. Open Activation, shown only to personal administrators, from **Settings → Verify and activate
   your company** or the same step in Getting started (the Dashboard on the web, the Register tab
   on mobile). Refresh the company details and your appointment. A company account role or an
   owned draft does not substitute for an appointment; an appointed investor can use the same page.
3. Choose **Review activation**, read the company and the exact declaration, tick **I accept this
   declaration for this company** and choose **Confirm activation** once.
4. Read the retained outcome. A passing attempt makes the company Active. A pending, failed or
   unconfigured check leaves the status unchanged and stays in the record; resolve the stated
   requirement, then choose **Try activation again**.

A change to your appointment, the company details or the declaration invalidates an open
confirmation. If the reply is lost, the same unchanged request can be recovered without another
lookup; a confirmed pending or failed result can be followed by a newly reviewed attempt.
Activation readiness and attempt details disappear when personal administration ends. Activation
sends no notification.

The earlier owner submission and platform-staff review is retired. Its records remain, and older
companies may still show its states (Submitted for Review, Under Review, Additional Information
Required, Approved, Rejected or Withdrawn).

### How the registry check matches

The registry check looks the company up in the Australian Business Register (ABR). The instance
must have the lookup configured
([configuration](../operations/configuration.md#company-registry-lookup)); without it every
attempt stays pending and nothing is sent to ABR. The lookup uses the ABN, or the ACN when the ABN
is blank. An ABN the register reports is recorded with the attempt but does not replace the
identifier the company supplied.

A check passes only when all of these hold:

- the ACN matches, and so does the ABN when one was supplied;
- the registration is active;
- the registered company name matches after ignoring case, spacing and Unicode form; trading names
  and near matches do not count;
- the company type matches: Proprietary Limited must be a private company (PRV), and a Public or
  Unlisted Public Company a public company (PUB). ABR does not distinguish listed from unlisted
  companies, so listing status is not checked.

| Outcome | When                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Passed  | Every condition above holds for the exact company details and revision the attempt captured                                                  |
| Failed  | No record found, an identifier mismatch, a cancelled registration, a name mismatch, or a contradictory company type                          |
| Pending | Lookup not configured, provider failure or time-out, an incomplete or suppressed record, an unknown status, or a missing or unsupported type |

A passing result is applied only if the company, the person, the appointment and the company
details are unchanged when it returns. There is no manual override and no fallback to an earlier
pass.

### Staff registry controls

Platform staff with the company change permission in admin keep bounded technical controls over an
active company: issue a compliance warning, suspend, delist, retry the registry check, resolve a
warning and reinstate. A registry retry does not change the status. Resolving a warning or
reinstating returns the company to Active only after a fresh matching lookup and either the
company's genuine applied activation or a historical officeholder attestation. These controls
cannot activate a new draft or act as company appointment authority, and the status changes send
no notification. They exist only in admin: there is no API for them, and the database refuses
these status changes from a staff account without the change permission.

## Representative identity requirement

Each instance chooses whether company representatives must have a verified identity; it is off by
default. When it is on, the person's verified identity is required for every act of company
authority: initial admission, accepting an invitation, activation, company administration,
eligibility decisions, member invitations, and register and wallet decisions. Staff technical
recovery of a company is not affected. A representative becomes verified only through the
configured identity provider, from **Verify your identity** at signup review or later from Profile
(also **Settings → Verify your identity**) with **Review identity check**; with the
requirement on and no provider, every company decision is refused
([operator configuration](../operations/operator-console.md#operator-configuration)). The investor
requirement is separate ([participants](participants.md#account-readiness)).

## The Company page

Company shows the selected company's details as provided by the company: status, trading name,
type, ACN, ABN, email (administrators only), phone and address. Administrators see **Edit company**.
It also shows the company's UUID in full, with **Copy company UUID**, to give investors for their
eligibility requests ([requesting a decision](participants.md#requesting-a-decision)).

Its Company administration section links to:

- **Representative authority**, for the company's owner on the web and for everyone on mobile;
- **Company team** and **Company eligibility** (on mobile, Company eligibility is reached from
  Company team);
- **Published to your members**, for the company's owner
  ([the Published page](publications.md#the-published-page)).

Activation is at the top of Settings, and share classes are listed and added only in
[Register](register.md#bringing-in-existing-records). Company documents follow for administrators.

Next: [participants and eligibility](participants.md) ·
[register of members](register.md) ·
[how a company decision works](README.md#how-a-company-decision-works)
