# Company setup and authority

[Business processes](README.md) · [Documentation](../README.md)

How a company joins Ledova and who may act for it: signup and the representative's declaration,
team invitations and appointments, company information, and activation. It is written
for company representatives, support staff and anyone learning how company authority is established. The representative declares their own authority and Ledova does
not verify it ([self-declaration decision](../decisions.md#company-representative-verification));
who holds which capability is in [company capabilities](README.md#company-capabilities). All of it
happens on the web; the mobile app is for shareholders
([decision](../decisions.md#mobile-app-for-shareholders)).

- [Company signup](#company-signup)
- [Representative authority requests](#representative-authority-requests)
- [Team invitations and appointments](#team-invitations-and-appointments)
- [What an appointment records](#what-an-appointment-records)
- [Who may administer a company](#who-may-administer-a-company)
- [Company information](#company-information)
- [Activation](#activation)
- [Representative identity requirement](#representative-identity-requirement)
- [The Company page](#the-company-page)

## Company signup

Company signup and the representative's initial authority finish in one flow on the web
([combined signup decision](../decisions.md#combined-company-signup-and-initial-authority),
as amended the [same day](../decisions.md#simple-signup-documents-and-team-after-registration)).
Ledova does not look the company up in the ABR or any other register, at signup or at
[activation](#activation) ([decision](../decisions.md#abr-company-check-removed)).

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

After signup, invite users at **Settings → Team**. A company keeps no separate documents on Ledova;
it uploads its own evidence with the register work that needs it
([decision](../decisions.md#company-documents-removed)). The company remains Draft until a current
administrator activates it: registration does not incorporate a company with ASIC, appoint a
director, activate the company or issue shares. Until then, the **Getting started** list
on the web company Dashboard links its personal administrators to unfinished activation and register
setup tasks; completed tasks disappear ([the Dashboard](README.md#the-app-at-a-glance)).

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
**Settings → Team → Representative authority** on web. The page lists your requests by company, ACN,
submission date and status; each opens its own page with a **Request** card and, once admitted, an
**Appointment** card with the recorded declaration behind **Show the declaration**, and the request's
actions at the foot.

1. Use your verified account for the selected draft company you own.
2. Choose your personal capabilities and, separately, the capabilities you intend to delegate.
   Initial admission requires Manage company information and team personally. Set an expiry if
   needed. Selecting capabilities grants nothing.
3. Optionally attach a supporting PDF, PNG or JPEG. It is checked and kept privately; no ASIC extract
   is required.
4. Submit the request. The platform freezes the company and representative details, the
   capabilities, the expiry and any file, and shows what it captured.
5. On the request's page, accept the displayed declaration of your workspace and team authority, which also accepts the
   Terms on the company's behalf, and admit the request. Where your instance requires a verified
   identity, an unverified one leaves the request pending. Admission does not activate the company.
6. Read the appointment's personal and delegatable capabilities, expiry and status. An attached
   file stays available from the request's page (**Download evidence**).
7. Withdraw a pending request you no longer want. After admission, **Revoke appointment** asks you
   to confirm the permanent loss of this appointment's authority under the revocation rules below;
   the declaration and any file stay in the history.

## Team invitations and appointments

Open the team from **Settings → Team** for the selected company. Before company access is granted,
open **Settings → Account → Company invitation → Accept invitation**. Investor-only accounts
can open it too: accepting an invitation or reading your appointments needs no company appointment. The web page starts with
appointments, the selected company's team and issued invitations; **Invite a company user** and
**Accept a company invitation** open focused inline forms. Someone with no appointments, other than
a company's owner, lands straight on accepting an invitation. It also keeps the owner's contextual Representative authority
task.

1. To invite someone, choose one of your current appointments that can delegate for the selected
   company. Choose the personal capabilities and, separately, any onward delegation for the invitee. Set an
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
- Two people accepting the same code at once produce one appointment, and the same account retrying
  gets its retained appointment back.
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

Editing basic company information needs a
current personal appointment with Manage company information and team for that exact company, or
the draft setup exception below. Delegatable-only capabilities, ownership, shareholding and platform
staff permissions supply no administration.

### The draft setup exception

Before a company has its initial appointment, its current owner, if active and email-verified, can
edit the draft. Any admitted initial appointment, or a legacy-owner
appointment, closes the exception for good; a revoked, expired or hidden initial appointment and a
later change of owner cannot reopen it. A pending request leaves the draft editable, so admission
rechecks the captured details.

### Privacy of authority records

- An authority request is visible only to its requester, an appointment to its appointee and an
  invitation to its inviter.
- Team reads need current administration of that exact company and never show another person's
  private declaration, identity or financial evidence, or signup file.
- An owner whose administrative appointment has ended can still select the company and read its
  basic details, but contact details stay hidden and every edit needs current administration.

## Company information

A current company administrator reads and edits the company's basic information at
**Settings → Profile** on web ([Settings](participants.md#profile-and-settings)). On web,
[choose the company on Dashboard](README.md#the-app-at-a-glance).

1. Read the selected company's name, address, contact details and status.
2. Choose **Edit company** to change the permitted fields inline on web, save, and wait for the confirmed receipt
   and refreshed information.

Rules:

- The ACN, ABN and company type can change only while the company is Draft. The registered name
  and the officeholder declaration (the declarant's name and the board resolution reference) can
  change only while it is Draft or, for an older company, Additional Information Required.
- An ACN and an ABN must pass their check digits, and an ASIC-registered company's ABN must be its
  ACN with two check digits in front. A check-digit pass is a typo filter, not verification: Ledova
  does not confirm that a number belongs to a real company.
- Changing the registered name, ACN, ABN, company type or officeholder declaration starts a new
  company revision, which closes any open activation review.

## Activation

A current personal administrator activates the company on the web. Activation records your
declaration and, where your instance requires it, needs your verified identity; the company is not
looked up in the ABR or any other register ([decision](../decisions.md#abr-company-check-removed)).
It establishes no share issue, payment or wallet approval. Before activation, the company's
administrators can keep its own non-tokenised register records, such as the mirrored register,
awards, allotments, transfers and member access, but wallet nominations, chain deployments and
issues, capital increases and company wallet instructions wait for an Active company.

1. Establish your authority first, through signup or an accepted administrator invitation.
2. Open **Settings → Activation** on web, shown only to personal administrators, or use the same
   step in Getting started on the Dashboard. Refresh the company details and your appointment.
   A company account role or an owned draft does not substitute for an appointment; an appointed
   investor can use the same page.
3. Choose **Review activation**, read the company and the exact declaration on the main page on web, tick **I accept this
   declaration for this company** and choose **Confirm activation** once.
4. The company becomes Active. Ledova keeps an activation receipt recording you, your appointment,
   the declaration and your identity status at that moment.

A change to your appointment, the company details or the declaration invalidates an open
confirmation. If the reply is lost, the same unchanged request returns the retained receipt without
activating again. Where your instance requires a verified identity and yours is not verified,
activation is refused and nothing is recorded; verify your identity and review activation again.
Activation readiness disappears when personal administration ends. Activation sends no notification.

Companies activated before the ABR check was removed keep their activation receipts; the lookup
results, and attempts that never activated a company, were deleted
([decision](../decisions.md#abr-company-check-removed)).

The earlier owner submission and platform-staff review is retired. Its records remain, and older
companies may still show its states (Submitted for Review, Under Review, Additional Information
Required, Approved, Rejected or Withdrawn).

### Staff company controls

Platform staff with the company change permission in admin keep bounded technical controls over an
active company: issue a compliance warning, suspend, delist, resolve a warning and reinstate.
Resolving a warning or reinstating returns the company to Active only when it has an activation
receipt or a historical officeholder attestation. These controls cannot activate a new draft or act
as company appointment authority, and the status changes send no notification. They exist only in
admin: there is no API for them, and the database refuses these status changes from a staff account
without the change permission.

## Representative identity requirement

Each instance chooses whether company representatives must have a verified identity; it is off by
default. When it is on, the person's verified identity is required for every act of company
authority: initial admission, accepting an invitation, activation, company administration,
member invitations, and register and wallet decisions. Staff technical
recovery of a company is not affected. A representative becomes verified only through the
configured identity provider, from **Verify your identity** at signup review or later from
**Settings → Account** on web with the identity check's **Review**, which Activation's identity step links to. With the requirement on and no
provider, every company decision is refused
([operator configuration](../operations/operator-console.md#operator-configuration)). The investor
requirement is separate ([participants](participants.md#account-standing)).

## The Company page

The company section of web **Settings → Profile** shows the selected company's details
as provided by the company: status, trading name, type, ACN, ABN, email (administrators only), phone
and address, and whether the ownership overview is shared with members. Administrators see
**Edit company**.

On web, select the company in Dashboard. Settings opens Profile, combining personal and permitted
company sections with separate editors and permissions, beside Account and Data and privacy. Team and
Activation have their own Settings items, without a repeated Company administration link card. A member association alone provides no company administration controls. Representative authority is a contextual task in Team.

Share classes are listed and added only in [Ledger](register.md#bringing-in-existing-records).

Next: [investors and members](participants.md) ·
[register of members](register.md) ·
[how a company decision works](README.md#how-a-company-decision-works)
