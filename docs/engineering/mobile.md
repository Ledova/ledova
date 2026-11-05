# Mobile

[Engineering](README.md) · [Documentation](../README.md)

How the Expo React Native app consumes the shared package, navigates, themes itself, reaches the
network and stores secrets, and how its temporary document copies respond to session changes. The
app began as a shareholder app ([decision](../decisions.md#mobile-app-for-shareholders)) and is
being rebuilt like the web at phone width
([decision](../decisions.md#mobile-app-like-the-web-at-phone-width)). Shared page conventions are in
[signed-in page conventions](frontend-ux.md#signed-in-page-conventions); builds, probes and device
checks in [mobile releases](mobile-releases.md). Use a Ledova native build; Expo Go lacks its
networking overrides.

- [Architecture](#architecture)
- [Theme and appearance](#theme-and-appearance)
- [Session scope](#session-scope)
- [Native transport](#native-transport)
- [Secret storage](#secret-storage)
- [Native dependencies and randomness](#native-dependencies-and-randomness)
- [Document view copies](#document-view-copies)

## Architecture

Native projects are generated at prebuild
([toolchain](mobile-releases.md#toolchain-and-generated-projects)). The app maps onto the
[frontend layers](frontend.md#frontend-layers) and their
[dependency direction and placement](frontend.md#dependency-direction-and-placement) under its own
folder names, with relative imports and no path aliases:

| `mobile/src/`         | Dashboard counterpart   | Owns                                                                          |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `navigation/`         | `routes/` and the frame | The root stack, the sign-up gate and the signed-in frame                      |
| `screens/<area>/`     | `pages/`                | An area's screens with their hooks and helpers                                |
| `components/`         | `components/`           | `Page`, `Ledger` and groups such as `modal/` and `register/`                  |
| `hooks/`, `contexts/` | `hooks/`                | App-wide hooks; the app-lock, theme and member records contexts               |
| `services/`           | `services/`             | `apiClient`, the session scope, token storage, document copies, notifications |
| `config/`, `styles/`  |                         | Network policy and public links; the theme                                    |

Shared register UI (fields, the file picker's `FileField` and document sharing) lives in
`components/register`, and its styles and picked-file hook (`usePickedDocument.ts`) in `hooks/`; the
award chart that Dashboard and an award's page share is `components/AwardStatus.tsx`, and the
searchable list that a person or a shareholder is chosen from is `components/SearchSelect.tsx`, which
Shareholders' `PersonSelect.tsx` wraps. The signed-in
member records state is a context (`mobile/src/contexts/MemberRecordsContext.tsx`), with its notices and
pull to refresh in `mobile/src/components/MemberRecords.tsx`, and the account check, company notice
and register access notice that several areas show (`AccountCheck.tsx`, `CompanyContextNotice.tsx`,
`RegisterAccess.tsx`) in `components/`; Ledger and Shareholders read the selected company's classes and
holders through `hooks/useCompanyRegisters.ts`. Production screens import no other area's internals.
Profile, operator, member, company list, appointment and company ownership reads, Team's reads
and forms, Activation's company read and confirmation, representative authority's reads, actions
and request form, Documents' class source, certificate records, preparations and prepared
outputs, Shareholders' register, people and shareholder reads, list, Add person, particulars change
and member access form, the employee scheme's award, vesting and grant reads, award, vesting and
entitlement-change forms and award document downloads, a share class's read, class rights and
shareholder documents, Issue shares' allotment and grant reads, preparation forms, decision steps
and document downloads, Transfer shares' transfer read, preparation form and document download, and
Corrections' entries, corrections, opening records and particulars changes reads, its correction
form and entry read and their document downloads, and register setup's preparation, new class,
register and started-class reads and draft checks live in `packages/shared`, with native session,
result and transport policies kept in the client: the app passes its session to each shared read and
request.

### Shared package resolution

The app imports `@ledova/shared` from source, like the dashboard
([clients and the shared package](frontend.md#clients-and-the-shared-package)), and supplies one
copy of each peer, `react` and `@tanstack/react-query`: `mobile/metro.config.js` resolves both as if
imported from `mobile/index.ts`, `mobile/jest.config.js` maps them to the mobile app’s `node_modules` directory, and
`mobile/scripts/shared-peer-resolution.mjs`, the last step of `check-resolution.mjs`, fails if real
Metro resolutions from `App.tsx` and from a shared hook disagree. Run
`npm --prefix mobile run check:resolution` after dependency changes; `make check` runs it too.

### Navigation

`mobile/src/navigation` declares the root stack with sign-in and sign-up (`AppNavigator`, which
always opens at sign-in: a stored session is never resumed without a typed or biometric sign-in, and
sign-in clears the query cache on focus) and `SignupCompletionGate`. The gate returns an unfinished
account to sign-up, or, for a company account, to a notice that the app is for shareholders with
only Sign out; once the app has opened, it stays mounted while the account and profile reread, so a
pull to refresh keeps the screen and any unfinished work. A failed profile refresh keeps them too
while a confirmed profile exists. Without one, or when the preferences recheck fails, the gate shows
its error, and a failed sign-in check returns to Sign in. Sign-up's first step sets
the individual role, then pre-screening, personal details, financial profile and review follow; the
dashboard's routes and guards do not apply.

The signed-in app (`SignedInNavigator`) is one stack with the web's phone frame. Every page shows
the web's phone top bar (`TopBar`): the menu button, the page's title, its action (such as Switch
company or Filters) and the notifications bell. Representative authority's bar shows a back arrow,
Back to Account, in place of the menu button (`topBar` with a back target). The arrow returns to the
parent: it goes back to the parent when the parent is in the stack and otherwise opens the parent in
the page's place, so a class opened from Dashboard's **Class details** also returns to Ledger, as on
the web, while Android's Back and the iOS swipe return to the previous page. An
authority request's bar shows Back to Representative authority, a share class's and Set up your
ledger's bars Back to Ledger, an award's bar Back to Employee share scheme and a particulars change's
bar Back to shareholder, the same way. A parent that needs its company and member gets them from the page
(`keepParams`), because the arrow's `popTo` replaces the parent's params; the other pages have no back button yet ([#1547](https://github.com/Ledova/ledova/issues/1547)). Inside the frame `Page` sets
the title and action as the screen's `title` and `action` options (`FrameOptions`) and starts with
its lede. The bell opens the web's notifications panel beneath it (`NotificationsPanel`), the same
anchored panel (`AnchoredPanel`) as `FilterPopover`. It has a Notifications header with **Mark all
as read** while any are unread, and the web's rows with an unread dot and a dismiss button. It also has
**Load more notifications** and the web's loading, failure and "No notifications yet." states
(owner, 3 November 2026).
The menu (`AppMenu`) slides in from the left like the
web's phone drawer, 208 points wide: Dashboard, Ledger and Shareholders for a register reader of the
selected company, Documents and Settings, and a footer
with the person's name, the selected company as on the web, and Sign out, which asks first, beside the
Dark theme switch. It closes when its screen
loses focus, and it marks the section the page belongs to: Ledger for Ledger,
Issue shares, Transfer shares and Corrections with their preparations,
Shareholders for Shareholders, a shareholder's page, its particulars change, Employee share scheme and
Member access, Documents for Certificates, Inspection copies and Company pack,
Settings for Profile, Account, Data and privacy, Team and Activation, Dashboard for Invitation. Like
the web's sidebar, it marks Transfer shares on a
transfer's preparation and Corrections on a correction's preparation. Choosing Dashboard
returns to it. Ledger opens its overview, Shareholders its people list, Documents opens Certificates
and Settings opens Profile.
Like the web's groups, a caret shows a group's pages beneath it, open while one of them is shown.
Ledger and Shareholders appear, as on the web, when the selected company's `canReadRegister` allows
it. Ledger lists Issue shares, Transfer shares and Corrections.
Shareholders lists Employee scheme (read out as Employee share scheme, the web's tooltip) and Member
access.
Documents lists Certificates, Inspection copies and Company pack when the selected company's
`canReadRegister` allows it, as the web's sidebar does, and is otherwise one link to Certificates.
Settings lists Profile, Account and Data and privacy, then Team when the selected company's `canManage`
allows it, and Activation after it when the person also has a current own appointment with `admin`
(the shared `hasCurrentAdminAppointment`) or Activation is shown, as on the web. On a Settings page
the menu doesn't list,
such as Team opened from Account, Settings itself is marked. Every other choice opens
above Dashboard, so Android's Back returns there; iOS's swipe goes back too. Pages (`Page`) and their cards
(`Section`) use the web's phone sizes: 16-point margins and gaps, and cards with 16-point padding and
corners under a 20-point title; the page's own title is the top bar's. Dashboard
(`mobile/src/screens/holdings/DashboardScreen.tsx`) follows the web's per-company Dashboard. Its
companies are the web's list from the shared `useOwnershipCompanies` (owner, 3 November 2026): every
company the person administers, is appointed to or holds shares in, by name. The selected company is
remembered per account under the web's key (`ledova.company.<user>.<account>`, in AsyncStorage), and
is otherwise the first. With several companies, **Switch company** opens the web's company popover
beneath its icon (`FilterPopover` with `CompanyPicker`): a search field ("Type a company name") over
the companies, each with the web's detail (Company administrator or Company access, and Member), the
current one ticked on the left and highlighted (owner, 3 November 2026). For a company whose register
the person may read, Dashboard is the web's officer view, read through the shared
`useCompanyOwnership` with the class and holder page kept in the screen: Ownership overview with the
person's role, issued shares, current shareholders and share classes (your shares first for a member)
and the classes ranked by issued shares; choosing a class adds the trail and a class card with its
current shareholders, largest first, 25 to a page with the web's pager, and the member's own position
and awards where they hold shares. It has the web's loading, incomplete-total, unopened-class, no
shareholder and failure states with Try again, and the trail returns from a class the overview no
longer lists. The class card ends with the web's **Class details** row, which opens the class's page.
The app does not yet have the web's Getting started card. For a company where the person is only a
member, the Ownership
overview comes from the shared `ownershipView`, read from the member record's shared ownership, or
from the member's own shares when the company does not share its totals: your shares, issued shares,
current shareholders and share classes, then each class, ranked by the shared `rankOwnershipClasses`,
with its issued count, percentage and your holding. Choosing a class adds the web's trail and class
card (share class, issued shares, your shares and your share of the class) with **Certificates**, and
the member's awards follow with the web's award status and details. Without any company it shows Your
companies and Accept an invitation. Pulling down rereads the member records and, unless the person is
only a member of the selected company, the company list and any register they may read. The
Invitation screen takes the
pasted invitation link or its code (the text after the last `#`, trimmed), previews the inviting
company, the recorded shareholder, the invited email and the deadline, and accepts it through the
member-records state, reporting acceptance only once the server does. Documents, and a class's
**Certificates**, open the selected company's Certificates page
(`mobile/src/screens/documents/CertificatesScreen.tsx`), the web's. For a company whose register the
person may read (`canReadRegister`) it is the web's company view (`CompanyCertificates.tsx`), read
through the shared `useCompanyCertificates` with the app's session and no member record: Certificate
records for one share class, each issue or transfer newest first in the web's two-line rows: its
shareholders and changes, then the kind, class, entry and short date (and ledger date), with
**Certificate:** None due, the entry was reversed on a reversed entry and a compact **Prepare
certificate** beneath one that can be prepared. Filters holds the web's drafts, Share class
when there is more than one, Shareholder and Certificate status, with **Clear**, which keeps the class,
and **Apply**; the server filters the whole history before paging, and **Load more register entries**
reads the next page, a failed one leaving the list marked incomplete. **Prepare certificate** opens the
web's form in its row, hiding the other rows and holding the filters (`ClassCertificate.tsx`, through
the shared `useClassCertificate`): the share movements, company date, entry, ledger date and
recording time, **Preview**, which adds the PDF's page count, then **Download PDF**, which shares the
unsigned certificate ([document view copies](#document-view-copies)). For anyone else it is the member's own
entries in one share class, newest first. For a member with more than one class, Filters opens the
web's panel under its button (`FilterPopover`) with Share class and Apply. Each record shows the
shareholder and change, the entry and its date (and ledger date), with no action. A class the member
is not recorded in says so, as does a company that records neither register access nor a member
record for the person; a failed read offers Try again.
Inspection copies (`InspectionCopiesScreen.tsx`) is the web's page for a register reader of the
selected company: the selected class's name, with **Share class** in Filters when there is more than
one, then the Inspection copy card read through the shared `useClassRegister`,
`useInspectionCopies` and `useClassInspectionCopy`: its prepared copies straight beneath the title
(each recipient, then one muted line with the short request date, any late delivery and who prepared
it when, then the instruction), then **Prepare inspection copy**,
which opens the web's form beneath them. Its request date is typed as `YYYY-MM-DD` (Sydney), starting
at today; **Preview inspection copy** shows the request's rows and **Confirm and download inspection
copy** shares the CSV. Company pack (`CompanyPackScreen.tsx`) is the web's Company pack card, through
the shared `useCompanyPackAuthority`, `useCompanyPacks` and `useCompanyPack`: for a current
administrator, its prepared packs (each recipient, then who prepared it when and its share-class count,
then the instruction) and **Prepare company pack**, whose form takes the instruction and
recipient, keeps the web's included records and limitations behind **Show included records and
limitations** and shares the ZIP; for any other register reader, the web's notice that administration
is required. Both pages show the web's loading, failure and empty states, and without register access
for the selected company they read nothing and point to Dashboard. Pulling down rereads Certificates,
Inspection copies or Company pack while no preparation is open.
Shareholders (`mobile/src/screens/shareholders/ShareholdersScreen.tsx`) is the web's Shareholders view
at phone width for a register reader of the selected company, read through the shared
`useRegisterClasses` and `useRegisters` with the app's session (`useCompanyRegisters.ts`) and listed by
the shared `shareholderList`: Current shareholders, one row per person with each class they hold, such
as "FND 5 · 62.50%", and Identity needs review where it applies, then People without shares, with the
web's unopened-class, identity-review, empty and no-match lines and 25 to a page under the web's pager
(`mobile/src/components/Pager.tsx`, which Dashboard's class card also uses). Filters holds **Search
people**, which searches 300 ms after typing stops, with **Clear** and the web's match count, above
**Share class**, which applies at once and closes the panel; the search, class and page are kept on the
screen. Former shareholders follows, with each class's former-member history behind its **Show**
toggle, 25 at a time, and **Details** for a former member the register names. **Add person** opens the
web's form beneath them, through the shared `usePersonRegistration`, with its retry of an uncertain save
and the added person's name in its outcome line; while a save is unfinished the rows don't open. A row
opens the shareholder's page (`ShareholderScreen.tsx`, their name as its title) through the shared
`useShareholder`: Particulars with **Change particulars** or the profile note, Holdings with any
former holding, History, Employee awards, and Access to their own records with **Invite to their
records**, which opens Member access with them chosen, each with the web's loading, failure and private
states. **Change particulars** opens the web's Particulars change page (`ParticularsScreen.tsx`, through
the shared `useParticularsMember` and `useParticularsEdit`): the one-step form, which starts with their
current particulars and returns to the shareholder's page saying Particulars changed., where the edit
began. A member who keeps their own details in their profile gets Current particulars and the profile
note instead of the form. The change is listed under Corrections' Particulars changes. Each Employee awards row opens that award's page, and
**Open Employee share scheme** opens the scheme. **Issue shares to them**, under Holdings for someone
who can prepare the register when the person holds no linked wallet and their particulars are
retained, opens Issue shares for an opened draft class they hold, or else the company's first, with
them chosen in an investor issue, as on the web. **Transfer shares**, on a holding without a linked
wallet in an opened draft class for someone who can prepare the register, opens the transfer's
preparation with them as transferor, as on the web. A shareholder's page still leaves out Documents.
Member access
(`MemberAccessScreen.tsx`, through the shared `useMemberAccessForm`) has the web's People and
Invitations in the web's two-line rows: each person's name and access, then their email and short
linked date, with a compact **Revoke access**, whose reason form and confirmation dialog send nothing
until confirmed, and each invitation's name and status, then its email and short invited date, with
any deadline beneath. **Invite a member** replaces them with the web's form, choosing the recipient from a
searchable list of the company's members and award recipients (`PersonSelect.tsx`). Without register
access to the company, each of these pages reads nothing and points to Dashboard. Pulling down rereads
each of them while no form or action is open. Unlike the web, which keeps a held save on its page,
leaving an app page drops that save's retry, so adding the person, sending the invitation, recording
the award or its vesting, adding shareholder documents, saving a register setup, or preparing or
deciding a share issue, transfer, correction or copied opening again could record it twice; an
app-wide fix is planned.
Employee share scheme (`EmployeeSchemeScreen.tsx`) is the web's view at phone width for a register
reader of the selected company, read through `useCompanyRegisters.ts` and the shared
`useRegisterAwards`: one share class's card, titled with the class (oldest first by default, and **Share
class** in Filters when there is more than one, locked while a preparation is open or held), listing
each award as the web's two-line row (the recipient with its promised shares at the right, then the
agreement date and its vested and issued shares), or
the web's empty, read-only, loading and failure lines. **Record an employee award**, below the card for
someone who can prepare the register of an opened draft class, replaces the list with the web's form
(`AwardForms.tsx`, through the shared `useAwardForm`): the recipient from a searchable list of the
class's people without a linked wallet whose particulars are retained, with **New person** first and its
name and address, the promised shares, then Agreement (date, document and terms) and Vesting (the
schedule), with its retry of an uncertain recording. A row opens the award's page
(`EmployeeAwardScreen.tsx`, the recipient as its title, the class as its lede and a compact
**Recipient details** above it), read through the shared `useRegisterAward`, `useRegisterGrants` and the
award's events, as on the web: Entitlement (the web's chart with **Record vesting** and **End unissued
rights**), Agreement (its date with **Download agreement**, and the terms, schedule and recorded line
behind **Show terms and vesting schedule**), Vesting history (the latest three, with **Show all**, each a
compact row with **Download evidence** and, only while the event can be corrected, **Correct**),
Entitlement changes with their downloads, and the non-paid issues still in progress with their stage.
Recording vesting, ending rights and correcting a
vesting open the web's forms in the Entitlement card (through the shared `useAwardVestingForm` and
`useAwardAdjustmentForm`), and someone without preparation authority gets the web's read-only note
instead of actions. Dates are typed as `YYYY-MM-DD` (UTC), and documents are picked as for
representative authority. **Issue vested shares**, beside the Entitlement actions while vested shares
await issue, opens Issue shares for the award's class with its non-paid issue form, and each non-paid
issue opens Issue shares at its record, as on the web. Pulling down rereads either page while no form is
open or held.
Ledger (`mobile/src/screens/ledger/LedgerScreen.tsx`) is the web's Ledger overview at phone width for
a register reader of the selected company, read through `useCompanyRegisters.ts`: the web's Share
classes card, a compact row per class with its name and issued shares, then its code, current
shareholders, any authorised limit and a short note while its ledger is not opened or issues or
transfers wait or cannot be checked (`classFacts`); each row opens the class's page, which keeps the full notes. A company
without classes shows No share classes yet. **Add share class**, below the card for someone whose appointment allows preparation, opens Set
up your ledger. A class's page (`ShareClassScreen.tsx`, the class's name as its title) is the web's, read
through the shared `useShareClass`: Summary with the class's code and type, then Issued shares,
Current shareholders and any authorised shares one line each, **Ledger not opened** while that
applies, the non-transferable note and the waiting notes; Class rights (`ClassRights.tsx`, through the
shared `useClassRights`) with the structured rights one line each, Additional terms, the effective
date on one line, the documents with **Download**, the recorded
line and **Show previous versions**, and **Edit** when the server names a current administration
appointment, which opens the web's form in the card: the six rights groups with the fields their
choice needs, Additional terms, the effective date typed as `YYYY-MM-DD` (UTC) and the documents, with
the web's retry of an uncertain save; and Shareholder documents (`ShareholderDocuments.tsx`, through
the shared `useMemberDocuments`) with the class's retained supporting files, each with its category,
holder and **Download**, and **Add documents** for someone who can prepare the register, choosing the
holder from a searchable list and each file's category. Without register access to the company, both
pages read nothing and point to Dashboard, and a class of another company is not in a register you can
read. The class page's top bar has the back arrow, Back to Ledger ([navigation](#navigation)). Pulling
down rereads either page while no form is open.
Issue shares (`IssueSharesScreen.tsx`) is the web's Issue shares at phone width for a register reader
of the selected company, read through `useCompanyRegisters.ts`, the shared `useRegisterAllotments` and
`useRegisterGrants`, and sent through the shared `useAllotmentForm`, `useGrantPreparation` and
`useRegisterDecision`: the selected class's name, with **Share class** in Filters when there is more
than one, then the Share issues card with the web's groups
(Needs a decision, Issued and Rejected, from the shared `recordGroups`). Each investor and non-paid
issue is the web's compact row (recipient and shares, then kind, short company issue date and any AUD
amount), a button that shows or hides the stage, decision trail, particulars, terms and the documents'
downloads, which go to the share sheet; a prepared or approved issue adds its status and the
record's actions: **Reject** and **Review and approve**, and **Record issue** for an approved non-paid
issue, only for the steps the person's appointments hold.
Reviewing replaces the records with the web's Review share issue: the preview, ownership impact, company
records and unmet requirements, Cancel and the confirmation, where an investor's **Approve** records the
approval and the issue together, as on the web. **Prepare issue**, beneath the card, asks **What kind of issue?**: Investor
issue opens the web's three steps (Person and shares, Agreement and receipt, Company authority and
review) and Non-paid issue the web's non-paid form, with an employee award's recipient, available
vested shares and retained agreement when it was opened from the award. Each keeps its retry of an
uncertain preparation or decision, a read-only appointment gets the web's notes and no actions, and a
class with an unopened register or a deployed contract says so, with **Set up your ledger** for an
unopened draft class to someone who can prepare it. Share
class is locked while a preparation, review or held decision is open, since the app keeps only the
selected class's issues on the screen. Pulling down rereads the classes, the person's appointments and
the issues while none is open.
Transfer shares (`TransferSharesScreen.tsx`) is the web's Transfer shares at phone width for a register
reader of the selected company, read through `useCompanyRegisters.ts` and the shared
`useRegisterTransfers` and decided through `useRegisterDecision`: the selected class's name, with
**Share class** in Filters as on Issue shares, then the Share transfers card with the web's groups
(Needs a decision, Transferred and Rejected). Each transfer is the web's compact row (transferor to
recipient and shares, then "Non-paid transfer" and the short company transfer date), a button that shows
or hides the details and the documents' downloads to the share sheet; an unfinished transfer adds its
status and **Reject** and **Review and approve**, only for the steps the person's appointments hold.
Review share transfer replaces the records, and **Approve** records the approval and
the transfer together, as on the web. An unopened draft class offers **Set up your ledger**, as on Issue
shares. **Prepare a non-paid transfer**, beneath the card,
opens the web's three-step form on its own page (`TransferPreparationScreen.tsx`, through the shared
`useTransferPreparation`, keeping its retry of an uncertain preparation). Preparing or Cancel returns to
the class's transfers, with a prepared transfer in view and marked as prepared, as on the web. A
read-only appointment gets the web's note and no actions, and a class with an unopened register or a
deployed contract says so.
Share class is locked while a review or held decision is open, and pulling down rereads the classes, the
person's appointments and the transfers while none is.
Corrections (`CorrectionsScreen.tsx`) is the web's Corrections at phone width for a register reader
of the selected company, read through `useCompanyRegisters.ts` and the shared `useRegisterEntries`,
`useClassCorrections`, `useRegisterImports` and `useRegisterParticulars`, with decisions through
`useRegisterDecision`: the selected class's name, with **Share class** in Filters as on Transfer
shares, then Changes, the class's register entries newest first (`ClassEntries.tsx`), each the web's
compact row: its kind and short date, with **Correct**, a compact text `Action`, at the end of a
correctable row for someone who can prepare the register, then any ledger date, reversal or entry it
corrects, and its first two signed share movements with **Show all** for the rest, with **Load more
register entries** for later pages. Its Corrections follow under the web's groups (Needs a decision,
Corrected and Rejected, from `CORRECTION_GROUPS`), each (`CorrectionRecord.tsx`) the web's summary
of the entry it reverses, a button that shows or hides the stage, preparation, effective date, the
entry and its compensating changes, the authority, reason, evidence, decision trail and **Download
the authority document**, which goes to the share sheet; an unfinished correction adds its status
and **Reject**, **Approve** and **Apply** for the steps the person's appointments hold. A decision
replaces the records with the web's dialog content in place (Approve correction, Apply correction
with the web's compensation note, or Reject correction with its reason), keeping its retry of an
uncertain decision. Opening records (`ImportRecord.tsx`) lists the class's copied openings as the
web's summaries (kind and shares, then record date and members), each opening its details, **Show
the shareholders** (each shareholder's allotments and documents behind **Show allotments**) and the
register and ASIC downloads; an unfinished one adds its status and **Reject**, **Review** and
**Confirm** for the steps the person's appointments hold, and a rejected one shows its status; a decision replaces the records with the
web's Review, Confirm or Reject import, its preview of each member against the stored ledger and,
when confirming opens the register, the web's note that it issues no shares. For someone who can
prepare the register it starts with **Bring records**, or **Correct copied opening** once an applied
opening may be corrected, which opens Set up your ledger for the class. Particulars changes
(`ParticularsChanges.tsx`) follows for the whole company, five at a time with **Show all N
changes**, each the web's summary (the member, then what changed and its as-at date) opening who
made it and when, the particulars before and after, and an earlier change's supporting document.
**Correct** opens the web's correction form on its own page (`CorrectionPreparationScreen.tsx`,
through the shared `useCorrectionEntry` and `useCorrectionPreparation`): the entry being corrected
and its exact inverse, then Authority, Approving director for a resolution, Authority reference, the
effective date typed as `YYYY-MM-DD` (UTC), the authority document and the reason, keeping its retry
of an uncertain preparation. Preparing or Cancel returns to the class's Corrections, with a prepared
correction in view and marked as prepared, and a page that cannot show the form still offers Cancel.
A read-only appointment gets the web's notes and no actions. Share class is locked while a review or
held decision is open, and pulling down rereads the classes, the person's appointments, the entries,
corrections, opening records and particulars changes while none is.
Set up your ledger (`RegisterSetupScreen.tsx`) is the web's register setup at phone width, through the
shared `useImportPreparation`, `useNewShareClass`, `useImportRegister` and `useStartedClasses`
(`ImportForm.tsx`, `ImportShareholders.tsx`). Opened from **Add share class**, it is the web's three
steps for a new class: Share details (Ordinary, Preference, Redeemable or Another class with its name,
code and type, any class already started as links, and the record date), Shareholders (each opening
shareholder chosen from the company's people or New person, with their name, address, first date and
current shares, the optional **Allocation history** and **Documents**, and **Show company source
copies** for the register copy and ASIC extract), then Review, where **Confirm** records the review
and the confirmation together and returns to Dashboard. The web's disabled **Import** is left out. Opened
for a class, from **Set up your ledger** or Corrections, it brings records into its unopened register,
or replaces the latest applied opening's shareholder rows in full with a reason, and resumes a saved
draft for review. Dates are typed as `YYYY-MM-DD` (UTC). Each save and decision keeps the web's retry
of an uncertain result, and **Edit records** retires a prepared draft for editing. Shareholders are
compact rows (`MemberRow` in `ImportRecord.tsx`), with **Edit** and **Remove** in the draft and **Show
allotments** on Review, whose record date, shares held and shareholders are one line each. **Cancel**
returns to the page that opened it, on every step but Shareholders, where **Back** returns to Share
details, and a page that cannot show the form still offers it. The top bar's arrow returns to Ledger.
Settings has the web's three pages for everyone (`mobile/src/screens/settings/index.tsx`), Team and
Activation. Profile, the `Settings` route, is the web's Personal
information card: the person's details, each label above its value, and **Edit** opens their form
in the card. Pulling down refreshes the profile. Account (`Account`) has the web's four cards. Security
shows the identity check status from the profile (the app has no identity check flow, so there is no
**Review**), **Change** for the password, and the app's biometric sign-in and App lock switches, with
**Biometric security is not available on this device.** beneath them only where that applies; Account
details shows member since and last login in the same one-line rows; and Invitations' **Shareholder invitation** row has
**Accept**, which opens the Member invitation page, and, as on the web, the **Company officer
invitation** row has **Accept**, which opens Team on its accept form. Your appointments
(`mobile/src/screens/settings/Appointments.tsx`) lists the person's appointments across companies in
Team's rows, with **Show the declaration** and **Revoke appointment**, which asks first in the web's
dialog. The first three cards' rows follow the web's: the label on the left, and its status, value, one compact action
or switch on the right. Data and privacy (`DataPrivacy`) has the same rows and compact actions: Export data, whose **Export**
saves or shares the file, and Delete account with **Delete**; a screen reader hears the row and then the action, named
Export data or Delete account. The theme is the menu's switch. The pages share one state
(`MemberRecordsProvider`, in `contexts/`) holding the company list, the selected company and the member records, so an
invitation acceptance whose outcome is uncertain stays recoverable,
with its original code, after leaving the page, and the pages show a loading line rather than an
empty one while the list rereads. Only the focused page selects its record and class.
Team (`mobile/src/screens/settings/TeamScreen.tsx`, its forms in `TeamForms.tsx`) is the web's Team
page at phone width, read and sent through the shared `useCompanyTeam`, `useAcceptInvitationForm`
and `useTeamInvitationForm` with the selected company: the company's Team, **Invite a company user** and Invitations you
issued, with the web's rows, wording, loading, empty and failure states. The Team list is read only with a current
own administration appointment for that company; otherwise it says that authority is required.
Accepting and inviting replace the page with the web's inline form, and the invitation keeps its
draft when closed. Team opens on accepting at once from Account's **Company officer invitation**, and
for someone with no appointments who owns no company once their appointments load. The capabilities are
checkboxes, the invitation deadline and appointment expiry are typed as `YYYY-MM-DD` (UTC) with the
web's checks, and the one-time code shows once as selectable text to copy. **Revoke appointment**
asks first in the web's dialog. Pulling down rereads the page while no form or revocation is open.
Your appointments' **Representative authority**, shown as on the web to a company account that owns a company,
opens the web's Representative authority page (`AuthorityScreen.tsx`), read and sent through the
shared `useAuthorityRequests` and `useAuthorityRequestForm`: Authority requests, each a compact
row with the company and the request's status, then its ACN and short submission date, then
**Request authority**, which replaces the list with the web's New authority request form
(`AuthorityRequestForm.tsx`) for the
selected company when it is a draft the person owns, and otherwise the web's notice to choose a
company on Dashboard. The capabilities are checkboxes, the expiry is typed as `YYYY-MM-DD` (UTC)
with the web's check, and **Choose file** picks the supporting document through `expo-file-system`'s
own picker (`pickDocument` in `mobile/src/services/documentCopies.ts`), checked as on the web. A
request opens its page (`AuthorityRequestScreen.tsx`, the company's name as its title): the web's
Request and Appointment cards, each fact on one line with its label on the left and its value on the
right (`inline` `Fact`s), the declaration and Terms for an admin request still pending,
**Show the declaration**, **Download evidence**, which shares the file
([document view copies](#document-view-copies)), **Withdraw request** and **Establish appointment**
while pending, and **Revoke appointment**. Withdrawing and revoking ask first in the web's dialogs.
Pulling down rereads the requests while no request form is open and no action is running.
Its top bar's back arrow returns to Account, and the request page's returns to Representative
authority; Android's Back and the iOS swipe also return to the previous page.
Activation (`ActivationScreen.tsx`) is the web's page at phone width, through the shared
`useCompanySelection`, limited to personal administration of the selected company, and
`useCompanyActivation`: Activation status with the company's status on one line, wrapping when
long, **Show the historical record** with short dates, and **Review activation**, which replaces the
page with the company's declaration, the web's checkbox and **Confirm activation**, and Your
identity, whose row opens Account, while the company awaits activation. Pulling down rereads the company while no review is open.
A notification, tapped in that list or as a push, opens its screen: vested shares open Dashboard on
the award's company (with its class, where the overview lists it) and issued shares Certificates for
that class, each saying so when that company no longer records you. A certificate-ready notice sent
before members' certificate requests were removed, and a publication notice sent before shareholder
publications were removed, opens nothing.
Screens set their own titles inside the page.

## Theme and appearance

The app has the web's Paper and Dark looks from the same tokens
([design tokens and themes](frontend.md#design-tokens-and-themes)). `ThemeProvider`
(`mobile/src/contexts/ThemeContext.tsx`) reads `ledova.theme` from AsyncStorage once, through
`parseTheme`, rendering nothing until the read settles so the first frame has the stored look; a
missing, unknown or unreadable value, or a read pending after two seconds, means Paper, and an older
build's `ledova-theme` key is ignored. `useAppTheme()` returns one precomputed theme object per look
(`mode`, semantic colours, spacing, radius, type, layout and icon scales, font families),
`useThemedStyles` builds style sheets from it, and `useThemeChoice()` gives the menu's Dark theme
switch the mode and a setter. The choice is written only when picked and stays on the device,
not the account, through sign-out and restarts. One extra spacing step, `smd` (12), matches the
web's 12px.

Roles match the web: brand text, icons, spinners and pull-to-refresh tints on a surface use
`brand.light` (`interactive.active` equals it); fills under white text, selection borders and washes
use `brand.default` or `brand.mid` (`interactive.defaultSubtle`); error text uses
`status.error.text`, not the `error.default` fill.

With `userInterfaceStyle` `automatic` in `mobile/app.json`, the provider sets React Native's colour
scheme and the root view's background (the page ground) when the look is first known, before the
screens mount, and on every change, so alerts, switches, date pickers and, on iOS, the keyboard and
share sheet follow the in-app choice; the generated-project checks verify the Android `automatic`
resource and both iOS `Automatic` settings. The status bar is dark on Paper and light on Dark;
navigation uses React Navigation's light or dark theme with the token colours; the app-lock screen
draws the logo mark in `text.primary` and `brand.light`. Before JavaScript runs everything is Paper (splash
screen, Android adaptive-icon background, iOS dark launch status bar), and Android's navigation bar
buttons keep the launch style from the device setting.

Newsreader and Instrument Sans are bundled under `mobile/assets/fonts` and loaded by `AppFonts`
(`mobile/src/components/AppFonts.tsx`) behind a finite loading, error and retry gate.

## Session scope

`mobile/src/services/sessionScope.ts` keeps a session epoch: a fresh sign-in, biometric entry from
an absent session and sign-out advance it; token rotation keeps it, and conditional retirement from
an obsolete refresh does not invalidate a newer session. Work that must not outlive its session
passes the epoch captured at its start to the API client as `ledovaSessionEpoch`, optionally with a
`ledovaSubmissionGuard`; the request interceptor (`mobile/src/services/apiClient.ts`) checks both
before and after reading the stored access token, and refresh and replay check again. Credential
lookup, token refresh and late UI callbacks therefore cannot carry a result into a replacement
session, nor an old upload acquire a newer sign-in's credentials. Document copies and
drafts are bound to the account, company and session they opened under; a change of any retires a
pending document action.

## Native transport

Settings are in [client variables](../operations/configuration.md#clients); the app uses the bearer
transport ([authentication](security.md#authentication-and-sessions)).

Release builds require HTTPS for API requests. The shared URL
policy (`mobile/src/config/networkPolicy.ts`), which Axios absolute URLs and `baseURL` overrides
also pass, refuses credentials embedded in URLs, fragments, malformed URLs and any bearer
destination outside `EXPO_PUBLIC_API_URL`'s origin. With no stored session, an existing
Authorization header is removed before dispatch.

Native Debug allows exact `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` hosts, on any port. For a
physical development device, set `EXPO_PUBLIC_DEV_API_HOST` to one private LAN IPv4 and the API and
site URLs to that host before prebuild. A changed allowance needs regeneration and a rebuild, and a
Release build made from a Debug-configured prebuild still denies cleartext.

Android has separate main and Debug network security resources; iOS has separate Release and Debug
plists and a compile-time HTTP guard, numeric IP addresses included, in its request handler
(`LedovaHTTPRequestHandler`, installed by `mobile/plugins/withMobileSecurity.cjs`), since ATS alone
misses some local or numeric destinations on supported older Apple systems
([Android network security](https://developer.android.com/privacy-and-security/security-config),
[Apple ATS](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html)).

The API must serve requests directly: Android's React Native OkHttp client and an iOS subclass of
React Native's HTTP handler (registered through the new-architecture protocol provider) refuse
redirects, including 307 and 308 that could forward sign-in or refresh bodies; TLS validation,
cancellation and progress stay inherited.

## Secret storage

Access and refresh tokens share one `session.tokens.v2` SecureStore item
(`mobile/src/services/tokenStorage.ts`) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and no biometric
requirement. A healthy complete legacy pair migrates only after the replacement reads back and
removal of both originals is verified; an incomplete or failed migration exposes no credentials. A
serial queue orders session and biometric mutations, and a refresh response can update or retire
only the generation and refresh identity captured before its request, so a late one cannot recreate
a signed-out session or replace a newer sign-in.

Sign-out persists a non-secret retirement marker, removes the pair and verifies its absence without
an authentication prompt. A pair that native deletion silently leaves keeps reads refused after a
restart and makes sign-out report failure; an unwritable marker refuses reads in the running process
only, since durable retirement needs writable storage. A failed sign-out still clears cached account
data and returns to sign-in with a fixed-text warning, not the storage error; a server-accepted
account deletion is not reported as failed. Only a deliberate successful sign-in activates a new
pair.

Biometric sign-in stays optional, and its ready marker is retired and verified without prompting.
Expo's iOS native deletion ignores Keychain deletion status, so prompt-free sign-out cannot verify
erasure of the separately gated copy; the retired marker refuses its reads. The biometric read
applies the retirement marker and the in-process refusal before prompting, so a sign-out whose
retirement fails part-way cannot hand back the gated copy in that process, or after a restart once
the marker was written.

Earlier builds kept wallet seeds under their own gated SecureStore keys, and order and settlement
recovery records (identifiers only, no keys or signatures) in AsyncStorage; this app neither reads
nor deletes them.

Android keeps SecureStore's exclusions in the legacy backup XML and the Android 12+ cloud and
device-transfer rules, with non-secret preference backups still enabled. iOS device-only
accessibility keeps the selected secrets off other devices but does not stop backups of the app
container. SecureStore can survive an iOS uninstall and reinstall, and biometric enrolment or
passcode changes can invalidate gated items
([Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/),
[Android backup rules](https://developer.android.com/identity/data/autobackup)).

## Native dependencies and randomness

Operation keys come from Expo Crypto's native `randomUUID`, and nothing falls back to `Math.random`.
The app sets up no Node globals or shims; the wallet libraries that needed them went with the
screens that used them. `buffer` stays a runtime dependency because `react-native-svg` imports it
without declaring it, and `assert` and `util` arrive through `expo-notifications`. The resolution
check confirms that the app's own imports reach declared runtime dependencies; imports inside
`node_modules` are resolved by Metro when the app is bundled.

The document picker (`expo-document-picker`) went with the eligibility screens on 2 November 2026;
the next native build drops its module, and a development app built with it still runs the current
JavaScript. Make release builds from a fresh prebuild
([building from a clean checkout](mobile-releases.md#building-from-a-clean-checkout)).

A representative authority request's evidence, an employee award's agreement and the evidence for its
vesting and entitlement changes, a share class's rights documents and shareholder documents, a
share issue's authority, agreement, receipt, terms and acceptance documents, a register setup's
source copies and shareholder documents, a share transfer's
instrument and authority, and a correction's authority document are picked with
`expo-file-system`'s own picker (`File.pickFileAsync`,
through `FileField`), so no picker module returns. On iOS it hands over a copy in the temporary
folder's `-Inbox` folder, deleted when another file replaces it, the form goes (its request recorded,
the form cancelled or the page left) or the session changes; a closed authority request form keeps it
with its draft, and register setup keeps each copy its draft still holds, including on another step, in
a closed shareholder or during review, until the page goes. On Android it hands
over the chosen document itself, which the app never deletes, named from its address. As on the web,
a file whose name ends in a PDF, PNG or JPEG extension that doesn't match its type is refused. Any
other name, with no extension, as Android's names from an address usually are, or ending in something
else, such as `Payslip 04.11.2026`, becomes `document` with its type's extension from the shared
`UPLOAD_TYPES` (`uploadType` reads the extension).

For one release, each app start and session change still delete the copies an earlier build's
picker and uploads left behind (`sweepEarlierUploadCopies` in
`mobile/src/services/documentCopies.ts`): the picker's UUID-named files in the cache's
`DocumentPicker` folder, the old `ledova-upload-copies-v1` copies and, on iOS, the files in the
temporary folder's `-Inbox` folders, which also clears any evidence copy left there. It deletes only
files inside the app's own cache or, on iOS, temporary folder, and needs only `expo-file-system`. The
release after that removes it.

## Document view copies

Viewing a document downloads it into the app-owned `ledova-document-views-v1` cache directory and
hands the copy to the share sheet (`shareDocumentCopy`). Data and privacy shares the
[account-data export](records.md#account-data-export) this way, as one JSON copy, and a
representative authority request's page its evidence, under its original file name. Documents'
unsigned certificate, inspection copy and company pack arrive as bytes, through `SHARE_SHEET_FILES`
in `mobile/src/services/documentCopies.ts`, the app's file delivery for the shared output hooks
([downloads](frontend.md#client-sessions-and-caches)): checked as on the web, by the response's
content type, since React Native's Android blobs carry none, and shared under the web's file name. An
award's agreement and event evidence take the same route through the shared `useAwardRecordDownload`,
and a share class's rights documents and shareholder documents through the shared `useClassRights`
and `useMemberDocuments`, an issue's documents through the shared `useAllotmentRecordDownload`
and `useGrantRecordDownload`, a transfer's through `useTransferRecordDownload`, and a correction's, an
opening record's and a particulars change's through `useCorrectionRecordDownload`,
`useImportRecordDownload` and `useParticularsRecordDownload`, under their retained file names.
Documents' outputs, an award's documents, a class's documents, an issue's, transfer's or Corrections'
documents and the authority evidence, shared from their pages, go through `shareFile`: a
sheet that fails to open reports the failure, and one still open after 1.5 seconds counts as
delivered, because iOS never settles a cancelled Save to Files. Data and privacy's export instead
waits for its sheet to close (`Sharing.shareAsync`): the sheet is presented from the export's dialog,
a native modal that closes once the export succeeds and would dismiss the sheet with it, so on iOS a
cancelled Save to Files leaves that dialog busy.

A view is bound to the session current when tapped: its download carries that epoch
([session scope](#session-scope)), and a session change before the write stops it without an alert.
One view per session downloads and writes at a time, and an obsolete download never holds a
successor session's view. Each new view, and session retirement, first empties the directory, even
with a download pending, so the last document stays until the next view or sign-out, and a receiving
app still reading it then loses access. Neither platform says when a receiver has finished
(Android's chooser result does not wait, and the pinned iOS sharing module never settles a share
whose follow-up dialog is cancelled), so the guard ends before the share opens and one unsettled
share cannot block later views. Copies earlier builds wrote to the cache root are not found.

Next: [mobile releases](mobile-releases.md), [frontend](frontend.md) and
[authentication](security.md#authentication-and-sessions).
