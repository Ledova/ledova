# Frontend UX standards

[Engineering](README.md) · [Documentation](../README.md)

How signed-in screens look and behave on web and mobile: the conventions every page follows and the
one standard way to make each common choice. How the clients are built is in [frontend](frontend.md)
and [mobile](mobile.md); what each page does is in the business section.

- [Signed-in page conventions](#signed-in-page-conventions)
- [Navigation](#navigation)
- [Actions](#actions)
- [Feedback](#feedback)
- [Copy](#copy)
- [Choosing a person](#choosing-a-person)
- [Choosing a company](#choosing-a-company)
- [Choosing from a short fixed list](#choosing-from-a-short-fixed-list)
- [Choosing from a bounded list](#choosing-from-a-bounded-list)
- [How the choice rules are enforced](#how-the-choice-rules-are-enforced)
- [Lists, search, filters and paging](#lists-search-filters-and-paging)
- [Loading, empty and error states](#loading-empty-and-error-states)
- [Forms](#forms)
- [Validation](#validation)
- [Dates, numbers and identifiers](#dates-numbers-and-identifiers)

## Signed-in page conventions

Every signed-in page renders in `Page` (`dashboard/src/components/Page.tsx`,
`mobile/src/components/Page.tsx`) under the page's title. Web form fields use `Field`
([forms](#forms)). `Page narrow` bounds
simple task forms and most detailed records, including compact tables. Profile, ownership dashboards,
company shareholder records, top-level record and document collections, stepped Ledger preparation pages, signed-in member
invitation reviews, company-recorded member details and wide tables take the standard workspace width. Inline preparation, review
and result states retain their collection's frame. Tables scroll within their card on small screens,
except Shareholders, which lists each person with only the classes they hold below `md`.
A stepped preparation (register setup, an investor issue, a transfer) is one card: its title names the class or
the task, `FormSteps` sits at its top, each step has a small heading, and one primary action ends the step.
Register setup's card is titled with the class being set up, and a recorded ledger shows its state as a `Status`.
Company information, company documents, authority records and company team use this workspace frame too.
Team invitations and acceptance replace their collection with one focused inline task, a card titled
**Invite a company user** or **Accept a company invitation** that retains its mounted editors and
drafts; someone with no appointments, other than a company's owner, opens straight on accepting one. The invitation's appointment
choice starts each option with its appointment date. Team's appointment rows show the company or
person, actions, any delegation (**May delegate all of these** when it matches the actions), status
or revocation, expiry and source, with **Revoke appointment** at the row's end and an own
appointment's recorded declaration behind **Show the declaration**; issued invitations show their
acceptance or deadline and the appointment's expiry. Company documents (Eligibility → Supporting) has its own view, with Category and File in the inline upload.
The remaining publication and eligibility collections use this workspace frame, with
their creation and record actions in the same footer. Their short named/status summaries keep
secondary facts and copyable technical references on demand.
Ledger's share-class summaries stack as full-width `Section` cards, using the workspace's spacing
and the shared card heading and padding. For company readers, the register pages (Ledger, Shareholders,
Employee share scheme, Certificates and the register tasks) list share classes in the order they were created, oldest first, in their
cards, columns, class choices and default class (owner, 28 October 2026). Dashboard ranks its class
list by issued shares. Ownership dashboards put their overview and charts before
record-management details, with awards separate from issued shares. The selected company uses one
ownership ring beside a linked class list, with full class names before their secondary codes.
Names wrap without displacing the figures. Select a segment or class row to open an aligned class
details card beneath the overview, with the class heading and the card's own **Filters** popover
together. A muted trailing chevron identifies class rows that open this detail; holder rows keep their
highlight-only interaction. Show the relevant exact totals and own position, followed by the
ranked holder list only for company-authorised readers. The popover holds their **Search
shareholders** field and, for everyone, a **Share class** choice: picking another class switches the
card, and **All classes** returns to the overview, also from a class the overview no longer lists.
For company-authorised readers, **Class details** at the end of the card opens the class's Ledger page. Each
compact holder row aligns the shareholder's name, a
horizontal bar, exact shares and percentage of the class. Hover and keyboard focus emphasise the row
with short transitions that honour reduced motion; keep all figures visible without a tooltip.
Rows stack their name and figures above the bar on narrow screens. Hover and keyboard focus on the
class list highlight the matching segment
and its exact class quantity in the ring's centre; otherwise the centre shows the company total.
The ring uses a fuller band without changing segment proportions. Its highlighted segment has a soft
class-coloured glow and a short lift. Reduced motion keeps this emphasis static; no loading pulse or
entrance animation is needed.
Keep the ring aligned at the top beside its list, so a long list never pushes it below the overview.
Keep class colours consistent in both views and through list search and paging. Long class lists
use shared search and a 25-row pager; small and zero-share classes remain directly selectable.
**All classes** returns to the overview and restores focus to the class row or class search.
While company ownership loads, reserve the dashboard's summary and chart space with a static,
data-free placeholder. The same neutral ring covers the lazy chart import. Show confirmed data
directly when ready, without artificial waiting time, placeholder figures or entrance tracking.
Keep a modest minimum-height holder area, showing a static loading status instead of stale holder
figures while reading. Short results, empty states and errors retain that minimum area; preserve
the existing access clearing and retry controls.
Narrow screens show the linked list without squeezing the ring. A chart failure leaves the same
list usable. Percentages name their denominator; issued share counts do not imply voting power,
economic value or a fully diluted option pool. Preserve the sidebar for navigation to other pages
and keep record actions there.
The web Dashboard is one Ownership browser for a person's company relationships. With several
companies, **Switch company** in the page heading chooses one ([choosing a company](#choosing-a-company));
the overview uses the full workspace width. A single company opens directly. Show a company
once even when the person both administers it and holds shares. Use the same ownership ring, linked
class list and hover/focus treatment across relationships, with the person's own position beside the
company figures they may read: a member's overview starts with **Your shares**, and a class row adds
"You:" with their count only where they hold shares in it. Selection progresses from company to class
to permitted detail; keep a breadcrumb and browser Back/Forward, with company and class in the
address. On narrow screens, stack the levels rather than squeezing several columns together.

Company-authorised readers may open the class's paged holder breakdown. A member without that access
sees only their own position and, where the company enables sharing, aggregate company/class totals.
Other holders' identities and records stay private. Without shared figures, label the ring as the
person's own shares by class; unavailable company totals are not zero. Keep company selection
available after a selected-company read fails, while withholding that company's figures. Never
combine different companies' shares into a single ownership percentage or imply a valuation.

Awards remain in a separate card below the ownership panel. Member awards show the promise and
nonzero lifecycle quantities, with the full breakdown and terms under **Show award details**. Issued
award shares are already included in the holding. The Dashboard contains the overview and read-only
awards; requests, documents and record-management actions stay on their focused pages.
Profile holds Personal information alone, with **Edit** to open its form; it shows no company's
recorded particulars.
Share history and certificate tracking belong in Documents.
Section spacing is scoped to
the frame; sign-up keeps its own presentation.

The title row holds the title and contextual page actions, with a one-sentence muted lede under it
only where it adds to the titles. On web card collections, the primary creation action follows the
last card in one right-aligned, wrapping row, rather than the title row; keep its content width.
Ledger's Add share class follows this pattern for both empty and populated collections. The first
section follows at the same gap as between sections (`Page`
is one flex column with a single gap; add no margin under the title). On mobile `Page` is a scroll
view on the page ground with the web's phone sizes, starting with the lede. Every page's header is
the web's phone top bar: the menu button, the page's title (Newsreader, 20 points), its one contextual
action and the bell; no page has a back button. A tap on a control acts at once, even while the
keyboard is up.

The ledger blocks (`dashboard/src/components/Ledger.tsx`, `mobile/src/components/Ledger.tsx`) and
`PageAction` (`dashboard/src/components/Page.tsx`) each enforce one rule:

- `Section`: a raised card on the page ground (`bg-surface-raised`, a `border-border` hairline,
  `rounded-2xl` in the frame, `rounded-xl` outside it) with its Newsreader title inside. Forms and
  things to act on are cards too; a group inside a card, such as a form or a record, gets a hairline
  rule above it or a small heading, never a nested card. An empty section keeps its real title, one
  muted sentence ("No share classes yet.") and at most one action; a state is never a
  title. A card's title is a heading, such as each class's summary on Ledger. On the web, every
  paragraph in a card, including its forms' notes but not flex, right-aligned or truncated rows, and a page's
  lede keep a readable width (`max-w-prose`).
- `Rows` and `Row`: ruled label and value pairs for a record's labelled facts, such as a
  shareholder's holding or an import's supporting records. The web sets values in tabular numerals;
  mobile's `Row` right-aligns them, and its `Fact` puts the label above the value, as the web's rows
  do on a phone (Dashboard's class card and Profile). Breakdowns of figures (company ownership, a
  class's totals on the web, register setup's summary) and an award's chart legend keep their own
  layout, without tinted tiles.
- `LinkRow`: how a list of sub-pages or neighbours links to each; the whole row is the link, named
  with its destination's title, with optional detail lines and an aside. A step in a checklist, such
  as "Verify and activate your company", and a row that starts a task, such as "Prepare a non-paid
  transfer", are named for the step or the task; a record's row, such as a share class in Ledger,
  for the record; and a row that opens a section of a page, such as "Documents", for that
  section. A title row never repeats a sidebar destination; an underlined link belongs to a sentence
  or opens an external resource.
- `PageAction` and `PageLink` (`Action` on mobile): a content-width action placed with what it acts
  on: the title row for the page (including the way back to the parent), a section for that section,
  a row for that row's record alone. A web collection's primary creation action sits beneath its
  cards, aligned right. Actions do not wait for a row to be selected.
- `MoreToggle` (`dashboard/src/components/Ledger.tsx`): a plain text button with `aria-expanded`
  that shows or hides long optional content in place, such as **Show all 5 share changes**.
  `ShowMore` pairs it with the content it shows: a saved
  issue or transfer record and its review start with **Show details and documents** closed, and
  long lists sit behind **Show other shareholders (N)**, **Show former shareholders (N)** or **Show
  the shareholders (N)**. Corrections' corrections and particulars changes are titled records with
  their details shown, and people without shares show their address beneath their name.
  Certificates, Corrections' **Changes**, Member access and Team rows don't expand:
  each shows its facts and status, with its permitted action right-aligned at the row's end. On wide
  screens the action has its own fixed-width column (from `xl` for
  Certificates, Member access and Team); on narrower screens it sits beneath the row's
  facts, still at the right edge. The Account and Data and privacy rows, Verification's claim and
  evidence rows and an action that stands on its own follow the same edge on web and in the app: Try
  again after a failed read, **Retry original member action**, and in the app Notices' **Open** and the
  Invitation page's and empty Dashboard's actions. Load more and the app's voting choices keep their place.
  Representative authority requests are `LinkRow`s that open each request's own page.
- Optional content uses `ShowMore`, which keeps it mounted while hidden so unfinished input
  survives; the app's kit has the same `ShowMore`, a text toggle with its expanded state, used for
  a payslip's **Show extraction details**. The sidebar's group caret is a separate navigation
  button. Substantial record reviews use the main page; brief confirmations can use dialogs.
- `Popover`: compact secondary controls, such as filters and notifications, may open an anchored
  panel without moving page content. Filters use `FilterPopover`
  (`dashboard/src/components/FilterPopover.tsx`), which shares Headless UI's `Popover`,
  `PopoverButton` and `PopoverPanel` pattern with the notification bell and owns only the trigger,
  panel, focus and viewport bounds. Pages keep their fields, data, drafts and validation.
  The [filter rules](#lists-search-filters-and-paging) describe its interaction. Editing records,
  preparation and substantial reviews stay on the main page.
- `SwitchRow` (mobile): a setting that takes effect at once (biometric sign-in, App lock), as a native
  switch named by its label, disabled while saving; a refusal keeps the saved value and shows an alert
  in the card. The theme switch is the icon beside Sign out on web and in the app, not a row. A choice
  saved with a form stays a checkbox.
- `Status` is words after a small mark, read as words only; `Timeline` (web) dates each event. Each
  status family has its own tone map; shared resolution-result tones live in
  `dashboard/src/components/statusTones.ts`. A status always names what it describes, and where a
  column header is hidden at phone width, the row carries the label.

On workflow collections, show the saved records first, with class context once where needed.
The sidebar footer identifies the current company. Keep each recipient, status and key facts
together, its details on demand, and its next action in a right-aligned footer after secondary
actions.
A particulars change from before the one-step edit keeps its supporting-document download in a
right-aligned footer, with download errors beside it; a one-step change has no actions.
Name a preview-opening action for that review, such as **Review and approve**; opening it is not approval.
The collection's creation action opens
a focused preparation form in place of the list. Closing the form or successful preparation returns
to the records; keep their controllers mounted so pending requests and original-request recovery survive.
Issue shares, Transfer shares and Employee share scheme follow this pattern. Award preparation
keeps the selected class card and returns to its records after Cancel or a successful save. Employee share scheme uses the
Share class selection in the page heading's Filters popover and one creation action; disable class selection while award preparation
or its recovery is open, keeping every class controller mounted. Its preparation,
vesting and entitlement-change forms put Cancel beside the recording action in `FormActions`.
Award preparation groups the recipient and promised shares, with new-person details beneath. Agreement
and vesting use the existing responsive two-column grid, stacking on smaller screens, with short
contextual labels and one vesting explanation. Employee share scheme has no background refresh; keep draft controls,
selected-file display and focus stable through entry reads, explicit retries and post-save refreshes
([read policy](frontend.md#automatic-data-freshness)). Its award list uses `LinkRow`: Recipient and
agreement date, then Promised, Vested and Issued quantities and the trailing arrow; on small screens the
three quantities sit beneath the recipient as one line. Each row opens the award's own page, built like a
shareholder's page: the recipient as its title, the class and agreement date as its lede, **Back to
Employee share scheme** and **Recipient details** in the heading, then headed cards without chevrons:
**Entitlement** (the chart, whose legend keys each colour and lists only non-zero parts, and the
award's actions), **Agreement and vesting schedule**, **Vesting
history** (the latest three events, with **Show all**), **Entitlement changes** and **Non-paid issues
from this award**, each shown only when it has records, and one muted recorded line. Record vesting, End
unissued rights and Correct a vesting event open their form inside the Entitlement card, keeping the
agreement visible and hiding the other cards. While an action's outcome is uncertain the page reports
held work, so leaving it is blocked as on Ledger.
Inline vesting uses one named field group with the event quantity, date and document, short contextual
labels and the same responsive grid. While an award editor is open, its footer owns the actions;
hide unrelated record actions instead of leaving a disabled row above the form.
Non-paid issue preparation groups **Issue details** and **Company authority** in the same responsive
grid. Show an award recipient and available vested shares once; its retained agreement belongs
behind **Show award record details**, with read-only validation targets that open on error. Ordinary non-paid terms stay
editable fields. Keep the required fields and guards, without repeated descriptions or routine
upload hints, and show recovery guidance only while the original preparation is held.
Issue records align the recipient and issue type, shares, company issue date and status in the
same labelled summary grid (`Fact` in `dashboard/src/components/Ledger.tsx` for each plain label
and value), with the investor amount where relevant. Keep the issued or not-issued fact beside the
status and use the recipient as the record heading, without separate family headings.
Longer state explanations, compliance responsibilities, terms, history and downloads open under
**Show details and documents**.
Transfer records align From, To, Shares,
Transfer date and Status in a labelled summary grid that wraps on smaller screens, without another
subheading or a sentence repeating the stage. Full particulars, terms, history and downloads open under
**Show details and documents**. Emphasise the review for the current stage. Keep transfer preparation beside
the final record's decision actions in one right-aligned row, wrapping only when needed; an empty
collection keeps its own preparation row.
Hide a successfully read empty family when another has records,
and use one empty state when both are confirmed empty; loading or failure is never an empty state.

Web Corrections starts with one full-width `Section` titled **Changes**, with compact ruled rows aligned under
**Change**, **Date** and **Share movements**, and **Correct** at the end of a row the account may correct.
Rows don't expand; on smaller screens, kind and date sit above the movements. Each row shows the kind
and any correction or reversal, named by kind and date; the company date for an issue or transfer
(ledger effective date for other kinds), with the ledger date beneath when it differs; and the first
two signed movements, with **Show all N share changes** for the rest. Entries stay immutable; current register readers can
inspect retained supporting records and permitted downloads. The same view holds capability-guarded
correction, copied-opening and particulars workflows. Certificate
preparation belongs in Documents. Keep maintenance controllers mounted so unfinished work and original-request recovery
survive navigation. Documents has one **Certificates** page for company and member records, plus
**Inspection copies** and **Company pack** where company access permits them. Inspection
copies shows one selected class, with **Share class** in the page heading's Filters popover when there is more than one.
Certificates keeps the class visible in each record and in its filter panel. An icon button named
**Filters**, with a tooltip, opens the popover in the page heading's top-right actions: class
selection, shareholder search and certificate status for a register reader, and class selection
alone for a member with more than one class. The collection heading has no repeated filter summary
or match-count line. Fields are drafts until **Apply** updates the URL; **Clear** removes search and
status while keeping the class. Filter the complete permitted history, not just loaded rows.
Company pack stays at company scope. Each uses the existing workspace frame, cards, responsive
field grid and action footer, opening one focused main-page preparation at a time. Certificate
preparation uses the existing labelled summary rows for share movements, company date, entry number,
ledger date, recording time and PDF page count after preview. No manual certificate reference is
needed: the server records the exact-entry request when the file is generated. Keep one
right-aligned Cancel/Preview or Cancel/Download PDF row. Do not offer Edit when nothing is editable.
Inspection copy and Company pack open from their preparation actions; privacy and source guidance stays with the opened form
or download. Inspection copy shows editable request fields before preview and captured summary rows afterwards.
Correction and particulars forms use the same
responsive field grid; their records group document and decision actions in one wrapping footer, left out when no action applies. Keep current source and appointment validation and error retries, without routine
refresh controls.

Certificates uses one list for the selected company and class. Register readers see the company's
issue and transfer entries; a member who is not one sees only their own history. Each aligned row shows the shareholder or change, shares, kind, class and entry
number, and the date (with the ledger date beneath when it differs). A register reader's row adds
the certificate's status, **Can prepare** or **None due, the entry was reversed**, labelled
**Certificate:** at phone width, and **Prepare certificate** at the row's end. A member's empty
class reads **No register entries for this class yet.** Rows don't expand.

The Shareholders parent opens the people and holdings list, with **Add person** beneath it.
Its **Member access** submenu uses **People** and **Invitations** `Section` cards, in that order,
with compact rows aligned under Person, Linked or Invited, and Status. People retains current and
revoked access records; invitations remain separate records. The view uses the standard
workspace width and Ledger's aligned change-row pattern;
headers match the row columns and summaries stack on smaller screens. Show names, secondary emails
or class context and genuine dates in the row, without repeating the page title inside a card.
A current person's Member access row ends with **Revoke access**, which opens the reason form beneath the
row; its confirmation says what revocation does. A pending or expired invitation shows its acceptance deadline.
Access and invitation records show no internal references, fingerprints or file sizes; these
remain in the audit records. Keep unavailable reads and their retries distinct
from confirmed empty collections.
Invite a member sits in a right-aligned row beneath the Invitations card. Invitation preparation replaces
the collection with a focused view across the workspace, with member and email fields in the existing
responsive grid and Cancel and Send invitation together at the bottom right. Keep invitation tokens
out of visible fields: the email link opens one focused Member invitation page, continuing through sign-in or
signup in the same tab. Show company, shareholder, intended email and expiry before an explicit
Accept invitation action; opening the link must never accept it. The company sees acceptance status
and an honest sending result, with a retry on failure; provider acceptance is not inbox delivery.
Show an action reason only for a selected revocation. Preserve drafts, current authority,
failed-read retries and original-action recovery; there is no routine refresh control.

For a substantial record review, replace the collection and its creation action with a focused review
on the same page. Keep the class and exact decision target clear, then the issue or transfer summary, ownership
impact and supporting facts. Agreement and receipt, or the transfer instrument, sit beside company
authority on wider screens and stack on
smaller screens; long terms, documents and audit references open on demand. Keep Cancel and the
confirming action together at the bottom right, without another confirmation dialog. Opening the
review focuses its heading; cancelling returns to its record's opener. Keep the record controllers
mounted, and preserve current authority, exact preview binding, loading, errors and original-request
recovery. For web investor allotments and non-paid transfers, a green **Review and approve** action
opens this read-only review; its green **Approve** confirmation records approval and the ledger
effect together. Require current approval and application capabilities and their appointments, bind
the reviewed ownership, class, dates and evidence, and reuse a current earlier approval. A transfer
already approved but awaiting its entry shows **Ready to complete**. Success shows **Approved** and
the recorded outcome, without a separate Record issue or Apply action. Keep approval and entry as
distinct retained facts, with atomic failure and same-request recovery that cannot duplicate the
effect. Non-paid and employee-award issues use the same page review, with award quantities, ownership
impact and company authority grouped, and terms and documents on demand. Their approval remains separate from
**Record issue**; approval alone changes no holding. Rejection also uses page review.
A web particulars change has no review: it applies in one step, and its record shows the name,
address and as-at date before and after in equal columns on wide screens, stacked on smaller
screens, with any reason beneath.
Other decision families and separate API decisions keep their existing workflow.

On the web, prefer editing a record's details in its existing card: replace the read view with the
fields under the same heading, with Cancel and Save together at the bottom right. Focus the first
field when editing opens and return focus to Edit when it ends, if that action is still available.
Company information and personal Profile details follow this pattern. Activation reviews its current
company and declaration on the main page before explicit confirmation. Supporting payslips use
document records that show their claim, or the form to attach one, directly, with **Show extraction
details** and visible warnings; uploading opens an inline form.
Class rights follows this pattern: Edit replaces its read view and previous versions with six
compact rights groups, one full-width Additional terms field, the known effective date and Documents
in the same form. Keep one Class rights heading and focus the first field. Put relevant structured
details beside their choice; combine conditions, exceptions and custom rights in Additional terms
rather than repeating a Conditions field in each group. Groups start Not recorded; show further
fields only for the selected terms. Do not infer values from a class label or treat an unanswered
choice as No.
Attachments use the existing document controls with concise labels; they do not open another editor
or repeat optional markers. Validation, pending-request holds,
stale-record handling and original-save recovery still apply. Other existing dialogs keep their
own workflow until separately refined.

A dialog (`Modal` in `dashboard/src/components/Modal.tsx`; `CustomModal` in
`mobile/src/components/modal`) is the same card over the dimmed page, labelled by its Newsreader
title (on mobile a header with `accessibilityViewIsModal`, since React Native cannot make it the
accessible name). Its body scrolls inside, and `ModalActions` ends it with one right-aligned,
wrapping row of content-width actions: a plain Cancel, Close or Back, then the one primary action,
which is destructive in a confirmation. On the web Escape and the backdrop close it. A dialog whose
confirm action starts a request passes `busy` and `busyLabel`, so the action names its work while
Escape, the backdrop and Cancel wait for the request to end. A form in its body can use the confirm
action as its submit button (`formId`, as Change password does), so Enter in a field submits it.
On mobile the backdrop closes it; a busy dialog holds the backdrop, Android Back and Cancel.

Inside cards and dialogs nothing is boxed: fields share the card's surface with a hairline border
(`rounded-lg border border-border bg-surface-raised`; `useDialogStyles` on mobile), steps are
numbered lines, and warnings (beside an icon) and errors are coloured text, not tinted boxes. The
exceptions are the dashed upload area for a claim's evidence, and sign-in and the sign-up steps, which keep
tinted fields and boxed outcomes within the same cards and titles. Addresses and hashes
use the monospaced face (`font-mono`; `theme.fontFamily.mono`).

Show ownership, status and one primary next action directly, with labels beside their values and
balanced field groups; keep audit references and optional detail behind detail controls; never
repeat titles or general explanations or show read and edit views together. Action-specific
authority, privacy, incomplete-data and recovery guidance stays visible where relevant, and a
presentation change must not reset pending work, hide uncertainty or change what a confirmation
authorises.

## Navigation

The web sidebar (`dashboard/src/components/Sidebar.tsx`) is a `<nav>` labelled "Main" whose items
are links, and the current page's item carries `aria-current="page"`; a page that isn't an item
marks its nearest parent that is. Below 1024 pixels the header's menu button opens the same sidebar
as a Headless UI `Dialog`: the button reports `aria-expanded`, focus stays inside the drawer while it
is open, and Escape or a choice closes it. The first Tab on a signed-in page reaches "Skip to main
content", which moves focus to the page's heading.

The Dashboard selects company context; there is no workspace or role selector. Keep the selected
company below the person's name in the sidebar footer and preserve its context in task links. Both
names use small text (`text-xs`), retain stored capitalization and stay on one truncated line with
the full name in a title. Below `lg`, where the sidebar is a drawer, the top bar holds the menu
button, the page's title and its actions, then the bell (`PhoneBar`); the page keeps its `h1` for
screen readers and starts with its back link, any `links` (such as an award's Recipient details) and its
lede. The bar names no company. Dark theme sits beside Sign out in
the sidebar's footer at every width. The navigation scrolls between the fixed
brand header and footer.
Do not repeat the current company name as a passive heading, subtitle or card label in signed-in
content. Keep it where it identifies a functional company picker, a company Profile field, a record
in a multi-company list or asset holding, or the exact legal, declaration, snapshot or recovery target.
One person uses one account:
company appointments and actual member associations independently determine the available tasks and
records. Company context never grants authority or links someone to a same-named shareholder.
The common Certificates page must identify whose records and actions each row permits. Preserve authorised
direct links and invitations without forcing a visit through Dashboard. Protect edited forms before
changing the company selection, and block those changes during held execution.
Recheck the account and current location before confirming navigation.

The sidebar owns navigation between sections. A related group has one level of children: its label
opens a meaningful overview or the default child, and a separate caret expands the children, without
an extra Overview page or item.
Ledger groups **Issue shares**, **Transfer shares** and **Corrections** this way.
Shareholders uses the same web pattern for **Employee scheme** and **Member access**, with its parent
opening the people list. Documents uses the same pattern for **Certificates** (the default),
**Published**, **Inspection copies** and **Company pack** where permitted, and **Notices** for a member of the
selected company, with its label opening Certificates at `/documents/certificates`. Do not add a separate Your certificates item or workspace switch. Settings uses the same
one-level group for **Profile** (the default), **Account** and **Data and privacy**, for everyone, then
**Team** and **Activation** where permitted, without an extra overview page. A group with only one
permitted page, such as Documents with only Certificates, is a plain link to that page, marked current
there. Profile always holds personal information. Company documents, Team, Activation and
Company details follow current company access; Profile's company-recorded name and address follow an
actual member association. Personal edits never change company-recorded particulars.
Use one compact Account card for relevant identity status, password and Manage account (member since
and last login); keep export and deletion on Data and privacy, with their existing confirmations. The
theme switch sits beside Sign out in the sidebar's footer, not in Settings. Payslip evidence
belongs alongside investor classification claims, not on Profile. Show company
and member destinations from current access and context; Team stays available for accepting a company
invitation. Company-recorded particulars are a Profile card for a member of the selected company.
**Company eligibility** follows Documents for an administrator or a prepare or approve appointee,
labelled **Eligibility**; for an administrator it uses
the same pattern, its label opening its own page and its caret showing **Supporting** (Company
documents).
An investing account's **Eligibility** opens Verification, stays marked on Your company eligibility
and sits above Settings; beside the company's own Eligibility item it reads **Your eligibility**.
**Settings** comes last whatever company is selected.
Each group opens on its routes and marks the current destination. Ledger, Shareholders and Documents
remain siblings, and every web group appears in the small-screen drawer; native navigation is documented
[separately](mobile.md#navigation). The sidebar has no More group or Help & Support link. Removing
these links changes no underlying route, audience or permission. Representative authority remains
a contextual task in Team.
Page controls start or complete work for that page or record: Add person, Invite a member,
Add share class, Class details, Edit, Save, Confirm and contextual issue or transfer
actions remain beside their records. Keep section navigation in the sidebar rather than repeating it
in page headers or a Company administration link card.

`DESTINATIONS` (`packages/shared/src/constants/ui/destinations.ts`) names the signed-in pages,
including Ledger, its views (Shareholders, Employee share scheme, Documents) and tasks
(Issue shares, Transfer shares, History, Corrections), Set up your ledger, Home's Documents
view, Certificates and Company documents. Old Dashboard and Ledger certificate links redirect to
Certificates with their company and class. The web exposes
only Issue shares, Transfer shares and Corrections,
replacing an incoming `#history` with `#corrections` while retaining company/class context. The web sidebar,
page titles and parent links use `pageTitle`
(`dashboard/src/utils/destinations.ts`), which titles Home as Dashboard on the web. Dashboard is one
company-centred explorer for all relationships, without a separate Your shares navigation mode.
Sidebar items stay on one line (owner, 29 October 2026): Employee share scheme shows as Employee
scheme, Company eligibility and Verification as Eligibility, Company documents as Supporting and
Published to your members as Published, each with the full name as the link's `title`. `DESTINATION_PARENTS`
and the web parent overrides give each contextual task its parent. Direct Settings children omit
Back to Settings because their sidebar links already provide navigation. `Page` puts one useful parent
link in the title row for a contextual task: Back to Team on Representative authority, Back to
Representative authority on an authority request's page, Back to Shareholders on a shareholder's
page, Back to Employee share scheme on an award's page, and Back to Corrections for ledger
maintenance.
Once a particulars change has found its shareholder, its contextual link goes back to that shareholder
by name. Register setup has none, on purpose
([decisions](../decisions.md#manual-register-setup-shares-before-shareholders)).

A way back to a Ledger class or task carries the place it means, built by `registerPlace`
(`dashboard/src/pages/company/ledger/shared/registerPlace.ts`): a correction returns to that
class's Corrections view, a class's own page to Ledger and a non-paid transfer to that class's
Transfer shares. A shareholder's page links back to Shareholders with its company through `Page`'s
parent link, and a transfer started there links back to them by name. Preparing a correction or
making a particulars change lands on its new record under Corrections; a non-paid transfer lands under
Transfer shares. Each keeps its class and task, with focus and one line naming what was prepared
([feedback](#feedback)). A preparation started from a shareholder's page also lands on its record in
Ledger, since a shareholder's page doesn't list prepared records.

Each page's title is also the browser tab's title, "<page title> · Ledova", set by `Page`; a
shareholder's page says "Shareholder" there, so their name stays out of the browser's history. After
a route change, including a Ledger view, focus moves to the page's heading once any closing dialog
has handed focus back, unless the page has already focused something of its own, such as the
register class it opens at. Focus stays where it is when a dialog stays open, after a redirect such
as from `/` to your dashboard, and after a change to the search, filter or page in the address.

Focus outlines come in one style: two pixels in the focus colour (`--color-border-focus`), set once
for `:focus-visible` in `dashboard/src/styles/index.css`. Text fields, and the sign-in and sign-up
fields and action buttons, keep their own focus rings.

## Actions

`PageAction` (`dashboard/src/components/Page.tsx`) is the standard action on a signed-in page. It
looks plain, primary (the one main action of its card or form), destructive (the confirm action of a
confirmation) or pressed, and comes in four forms:

- **A button** runs its action on click.
- **A submit button** (`type="submit"`) ends every page form, inside `FormActions`: a rule, then one
  right-aligned row with any plain actions first and the primary submit last. The form's own submit
  handler does the work, so Enter in a field submits the form unless the submit button is disabled.
  Mobile's `FormActions` draws the same rule and row; its `Actions` is that row without the rule, for
  an action that stands on its own.
- **A link** (`PageLink`, same looks, optional router state) is an action that only goes somewhere:
  the title row's way back, Add share class, a shareholder's Details, Issue shares to them. While a
  held Ledger action blocks leaving, `disabled` shows it as a disabled action instead.
- **A toggle** (`pressed`, which sets `aria-pressed`) marks the chosen option where pressing applies
  it at once, such as the shown eligibility request.

All four are at least 44 px tall below `sm`, so they are easy to tap on a phone; wider screens keep
the compact size. `MoreToggle`'s "Show …" text links get a 44 px tap area from an `after:` overlay,
which moves nothing.

`busy` and `busyLabel` disable an action and name its work, such as "Preparing allotment…" or
"Saving…". Every page form's submit button uses them, and so does every action that starts a
request, on pages and in dialogs, including:

- downloads ("Downloading…", on the one document being fetched);
- previews and preparations;
- identity verification;
- establishing an appointment;
- member invitations and access;
- register setup's review step (editing the records, loading and confirming the decision).

Read on entry and after relevant actions under the [freshness standard](frontend.md#automatic-data-freshness),
without idle, focus or reconnect page refreshes.
Do not add a routine Refresh action; Try again belongs to a failed read.

Where a shared hook only reports that some command is running, `useRunningAction`
(`dashboard/src/hooks`) names the action that was clicked. A few actions show their work another
way:

- Activation's review hides its action and shows "Checking activation…".
- A register decision's rejection preview shows "Loading the preview…".

A load error's Try again and recovery actions keep their label while they run; a form's submit
button that also recovers an earlier attempt keeps its busy label. Icon buttons and register setup's
Import placeholder keep their own controls, and dialog footers use the
same order as `FormActions`. Mobile's `Action` has no busy, pressed or destructive form.

An action that deletes, withdraws or revokes something saved asks first, in a dialog that names the
consequence, with Cancel and a destructive action that repeats the verb, such as "Withdraw
claim" or "Revoke access". `Confirmation` (`dashboard/src/components/Modal.tsx`) is that dialog:
its text is the dialog's description, its action needs whatever enabled the action that opened it,
and it stays open and busy until the request ends. It confirms withdrawing a claim or a
representative authority request; deleting a profile document; and revoking member access.
Deleting a company document or the account, and revoking a company appointment, use the
same destructive dialog with their own text. Company eligibility's request withdrawal and acceptance
revocation are confirmed in their own review step instead, which shows the exact record and needs a
confirming tick before its destructive action. Reversible actions, such as signing out, turning a switch off or removing a row from
an unsaved form, aren't confirmed. Dismissing a notification archives it at once. Register
decisions, such as rejecting a proposal, and evidence forms, such as ending unissued rights, are
confirmed by their own review, dialog or form. The dashboard uses no browser `confirm` or `alert`
(ESLint's `no-alert`). Mobile asks first before deleting the account, and also before signing out
and, in a native alert, before turning off biometric sign-in.

## Feedback

`Outcome` (`dashboard/src/components/Ledger.tsx`) says what just happened in one line: a
`role="status"` sentence in the primary text colour, after the mark `Status` uses for done. It sits
under the change or on the record you land on, and stays until the next action replaces it; there
are no toasts. Its status region stays in place, empty and visually hidden, before there is anything
to report, so a screen reader announces the sentence when it arrives; a preparation's line arrives
with the record it lands on and is read because focus moves to that record. It names the record
rather than its identifier. It reports:

- a changed password and saved personal details;
- the downloaded unsigned certificate, inspection copy and company pack;
- a recorded team invitation, an accepted invitation and a representative authority request;
- member access's recorded invitation;
- a prepared correction or non-paid transfer, or a made particulars change, on the record you land
  on in Ledger.

Identity verification shows its result in its own dialog, sign-in and sign-up keep their boxed
outcomes, and `CopyButton` (a company's request link) confirms a copy with Copied beside the button.
When it hides the value, a failed copy shows it to copy by hand.
Ledger's other forms don't use `Outcome`. Mobile reports saved personal details as the web does, and
a changed password, some failures and a few warnings in native alerts.

## Copy

Text uses sentence case: titles, labels, buttons and options capitalise only their first word and
names, such as page names (Back to Shareholders), document names (Terms of Service) and
organisations. An ellipsis is one character, "…"; ESLint refuses three dots in the text of the
dashboard's and the shared package's source. Labels the backend supplies, such as company and
document types and some statuses ("Under Review", "Awaiting Payment"), keep its title case. Parts of
mobile's own copy, such as sign-up and its native alerts, use title case or three dots; the shared
strings it shows follow this.

Copy and tone maps meant for both clients live in `packages/shared`. The web also reads the identity
verification outcomes (`IDENTITY_OUTCOME_COPY`) and their tones (`VERIFICATION_TONES`) there.

## Choosing a person

No web flow lists people in a native select, because a dropdown of every person does not scale to a
large register. Each one uses a searchable list built on Headless UI's `Combobox`:

Selecting an existing record and creating one are separate choices. The shared search control
keeps the same appearance and keyboard behaviour; each workflow explicitly decides whether it
offers **New person**. Typing a name never creates or identifies a record by itself: a selection
keeps the company's stored member ID. Company scope, current authority and eligibility remain
server checks. A person need not have a login or shares in the selected class.

On the web, both transfer parties are existing company people. A transferor holds shares in the
class; a recipient may hold another class, be a former holder, have an award or have no shares yet.
**Add person** on Shareholders records only a name and residential address, before or after the first
class is added. It uses the existing inline form and right-aligned collection action. People without
shares are distinguished from current shareholders, with no invented holding or award. Initial
ledger setup, investor and non-paid issues and employee awards keep their explicit new-person
paths; invitations select existing records. A named director in external authority evidence is
not automatically a shareholder or a Ledova user and remains a documentary field.

- **`PersonSelect`** (`dashboard/src/pages/company/ledger/shared/PersonPicker.tsx`) is used where a
  flow names one person:
  - register setup's shareholder, an investor or non-paid issue under Issue shares, a transfer's
    transferor and recipient, and an employee award's recipient. These read one validated list of
    the class's members and award recipients (`usePeople`).
  - member invitations, which list the company's current and former holders in every class and its
    award recipients (`invitationMembers`), without addresses.
- **`SearchSelect`** (`dashboard/src/components/SearchSelect.tsx`) is used directly by a share
  class's **Shareholder documents**, to choose the holder a new document belongs to from the
  class's holders alone.

How the list behaves:

- **Opening and searching:**
  - The label sits above a text field, and the field, its toggle button and the list all carry it.
  - The list opens on focus, so a short list can be browsed.
  - Typing narrows it to the entries whose text contains every typed word, ignoring case and
    accents. The text is what the entry shows, apart from why it can't be chosen: a person's name,
    address, award marker and record reference, and the flow's own detail.
  - Focusing or clicking the field selects its text, so typing replaces it.
- **What each person shows:** the name, then a muted line with the address, "Award recipient without
  shares" or "No shares yet" where applicable, and the flow's own detail, such as the shares held. A short record reference appears only
  when two people share a name and address. Assistive technology reads the option as one name
  joined by " · ".
- **The first entry:** **New person** comes first wherever a flow can add someone. It steps aside
  while a search finds someone and returns when the search finds nobody or is cleared.
- **Long lists:** at most 50 matches are listed, with a note giving the total. Someone further down
  is reached by typing more of their name; the full list of people is on Shareholders.
- **Announcements:** while the list is open, a polite status region announces the number of
  matches, or "No people match …".
- **Choosing with the keyboard:**
  - Enter chooses the highlighted entry. After typing, that is the current choice if it still
    matches, otherwise the top match; or it is the entry reached with the arrow keys. Tab with a
    match leaves the field on the highlighted entry in the same way.
  - Enter or Tab with no match and no arrow-key move keeps the current choice, and so do Escape and
    clearing the text before leaving the field.
  - A choice can be replaced but not emptied, since every flow starts with **New person** or needs
    someone.
- **Choosing again:** picking the entry already chosen changes nothing.
- **Unavailable people:** someone who cannot be chosen, such as a person already added to a register
  setup draft, stays listed, disabled, with the reason.
- **Shared logic:** `peopleFrom`, `personChoices` and `personRequest` are in
  `packages/shared/src/utils/people.ts`, and the matching is `searchEntries` and `searchMatches` in
  `packages/shared/src/utils/search.ts`.

The 50-match rendering limit bounds the displayed list, not the download. Search currently runs
over the people already read. The owner's recorded switch to server search is at about 2,000
company people, or earlier if measured loading or typing costs warrant it. Keep the same selector
when switching: delay requests while typing, cap results, discard replies for superseded queries
or account/company scopes, retain the selected record, and show loading, no-match and failure
states distinctly. Do not present a failed search as an empty result or create a duplicate person
after an uncertain save. Follow the same owner and original-request guards as other register writes.

These rules are checked in review. The dashboard suite drives the list in register setup (typing a
name and pressing Enter), a transfer and member invitations.

## Choosing a company

On web, Dashboard is the only place to change company context. With several companies, a company
icon named and titled **Switch company** opens the compact popover in the page heading's top-right
actions. Inside it, `CompanyPicker` (`dashboard/src/components/CompanyPicker.tsx`) uses the same
searchable list as [choosing a person](#choosing-a-person), showing company names and useful muted
details, never internal identifiers. The list sits in the panel beneath its search field, without
a toggle and without opening on focus (`SearchSelect`'s `inline`), so opening the popover lists the
companies with the current one ticked. Its label remains accessible but visually hidden. An accepted
switch request closes the panel and returns focus to its icon; the existing form confirmation and
held-work guards still decide navigation. Company selection has no separate row above the ownership
view; class exploration keeps its breadcrumb.

A single company opens directly and hides the switcher. With several companies, an address that names
no company, including sign-in, opens the company the person used last in this browser (remembered per
account by `dashboard/src/utils/lastCompany.ts`), or the first company in their list when that one is
no longer available or none was chosen yet (owner, 28 October 2026). If an explicit address names an
unavailable company, Dashboard offers **Open your company** when only one company remains, without
silently replacing the address's scope. Other company-related pages inherit the selection through their
address and task links; the sidebar footer identifies it without another company picker or passive
page label. When the selected company is unavailable, `CompanyContextNotice`
(`dashboard/src/components/CompanyContextNotice.tsx`) links to Dashboard. An explicit company link is
never silently replaced with a different company. Valid company and record links still open directly.
Account-wide Profile, own appointments and invitation acceptance do not depend on the selected company.

Share-class, person and other record choices stay with their tasks. These rules and the
company-change safeguards are checked in review and the existing dashboard journeys.

## Choosing from a short fixed list

A question with a few fixed answers shows them all as radio buttons, so nothing has to be opened to
see the choices. `Choices` (`dashboard/src/components/Choices.tsx`) is a fieldset whose legend is the
question, with one native radio button per answer on a wrapping row; the arrow keys move between
answers. It asks for:

- the authority for a correction;
- whether a mirrored allotment is held for someone else;
- a new share class's type;
- the kind of issue on Ledger's Issue shares task, which opens that kind's form in place;
- a company eligibility decision's outcome;
- the professional body behind an accountant's certificate;
- the type of a profile document, where answers not yet offered stay listed, disabled and marked
  "coming soon".

A question with no answer yet shows no button chosen. The answer takes effect with the form or
filter it belongs to. [Compact filters](#lists-search-filters-and-paging) use labelled selectors to
keep their secondary panels small.

## Choosing from a bounded list

A list too long for radio buttons that still cannot grow with the company, such as a company's
share classes or document types, or someone's appointments, is a
native select in `SelectField` (`dashboard/src/components/SelectField.tsx`): the label above the
field and options named in words:

- an appointment reads as the date it was made, then its actions, so a phone keeps the date in view;
- an evidence source reads as its kind, status and date, and a classification claim as its kind and
  date.

These lists add a short record reference only to options that would otherwise read the same,
as with people who share a name and address; a delegating appointment adds the time it was made
instead.

Register setup offers a class already started but not yet opened (its ledger has no recorded entry) as links in a sentence, and the new class's kind as
radio buttons, so choosing never moves the page by itself. Sign-up keeps its own presentation: its
company type is Headless UI's `Select` inside the field so the label names it, and the phone number's
country code is a native select named "Country code" beside the number. The select is transparent
over the flag and dialling code, so the field keeps its width while the open list names each
country.

## How the choice rules are enforced

An ESLint rule in `dashboard/eslint.config.js` refuses a `select` element written in the dashboard's
source, apart from `SelectField` and the sign-up country code, and names the three controls. It
does not see Headless UI's `Select`, which only sign-up's company type uses, or test files. Which
control fits which list is checked in review against this page.

## Lists, search, filters and paging

Browsing records is a list or table, never a picker. Tables page by number and feeds load more, and
a list that grows with a company reads one page at a time, with its search and filters run by the
server:

- **Search box:** `ListSearch` (`dashboard/src/components/List.tsx`) is a labelled search field
  with a hint naming what it searches and Clear while it holds text.
  It searches 300 ms after typing stops. The server matches every typed word, ignoring case. While
  a search or filter applies, a polite status line counts the matches, such as "3 shareholders match
  your search" or "No shareholders match".
- **Compact filters:** secondary filters use `FilterPopover`: an icon button named **Filters** with
  a tooltip, opening an anchored panel. Place its icon in the page heading's top-right actions on
  every filtered page, without a separate row or another control in a card heading. The one
  exception, at the owner's request on 28 October 2026, is Dashboard's class details card: its own
  Filters icon in the card heading holds the holder search and the **Share class** choice with
  **All classes**, since the page heading holds **Switch company** and both apply only to the
  selected class. Page owners use
  `Page.actions`; deeper owners contribute through `PageActions` in
  `dashboard/src/components/Page.tsx`. Keep filter state with its owner and explicitly omit header
  controls for hidden retained views; a header contribution escapes its original hidden container.
  Keep the
  selected class visible in the task or class heading. Class changes close the panel and retain
  the existing editor and unfinished-work locks.
  Shareholders puts Search people inside the panel above Share class, keeping
  its 300 ms debounce, Clear and match counts. The controls and record rows can identify the applied
  scope without repeating it in a header summary or badge. Certificates keeps labelled
  draft fields and one Clear/Apply row: incidental dismissal retains drafts without changing results;
  Apply and Clear close the panel and return focus to its button. Shareholders' class filter
  and company eligibility's Outcome apply
  immediately, closing the panel on selection. Escape and an outside click dismiss
  it, and all controls remain keyboard
  accessible. Fit the panel within the viewport, scrolling inside when needed rather than
  overflowing or shifting the table. Preserve each page's URL, paging, full-history matching and
  loading/error rules; opening the panel or editing a draft does not start a new results read.
- **The address:** `useListParams` (`dashboard/src/hooks/useListParams.ts`) keeps the search
  (`q`), the filters and the page in the URL, so Back, a refresh or a shared link keep them. Typing
  replaces the history entry, while a filter or page change adds one. Any change but the page
  returns to the first page. On a list paged by the server, a page that no longer exists is replaced
  by the first; a list searched in the browser shows its last page instead.
- **Tables:** `Table` is the markup for lists on these controls: a flat table that scrolls
  sideways within its card, with a screen-reader caption, a header row of `scope="col"` cells and
  each row named by its first cell as a row header. Aligned record lists, such as
  Certificates, reuse `TABLE_SCROLL_CLASS` and `TABLE_HEADER_CLASS` from
  `dashboard/src/components/List.tsx` for overflow and small muted headers on the card's own surface.
  Use one outer `Section`, subtle row dividers and right-aligned tabular quantities, without an
  inner rounded border or shaded header. Native table cells keep their padding; aligned lists
  keep their column grid, with dates and status in muted text.
  Keep their list semantics and editor lifetimes;
  focused editors remain unboxed. `Pager` under a paged table gives the rows shown, such as
  "1–25 of 1,240 requests", and Previous, the page number and Next when there is more than one
  page. While new results load, the shown rows stay, dimmed and marked busy, and the pager says it
  is loading.
- **Feeds:** `LoadMore` ends a feed with "Load more notices" (or
  notifications and so on), which names its work while it runs. When a later page fails, the shown
  rows stay and a [load error](#loading-empty-and-error-states) says the list is incomplete.
- **Page size:** 25 rows. The API accepts `page_size` up to 100 on every paged list.

Company eligibility's request queue is paged by the server, with no search box: its one
filter is the outcome, selected in the compact filter panel, which the server derives from each
request's decision, withdrawal, revocation and expiry. While another page or outcome loads, its rows stay dimmed and
their View buttons wait. Shareholders searches and pages the register the page has already read in
full, since its ownership totals need every holding: Search people and the class filter share the
popover, with the same search timing and pager. Search matches every word, ignoring case and accents
(`searchRows` in `packages/shared/src/utils/search.ts`); selecting a class applies it immediately and
closes the panel.

The feeds are Notices, the notification bell, Published to
your members, a class's register entries and each class's former shareholders, shown 25 at a time
from the register already read. A list bounded by one person, such as their own documents or
classification claims, reads every page. Other lists still read every page
([frontend](frontend.md#lists-figures-and-currency)).

**The register's records are the one stated exception.** Each share class's allotments, transfers,
imports, corrections, particulars changes, awards and grants, and company member access, read every
page. Each record keeps its own recovery for an uncertain reply, and a newer record shifting the
pages would unmount the oldest loaded one and lose it; these lists grow only with one company's
register decisions. The owner chose this on 21 October 2026,
to revisit if registers grow large ([decision](../decisions.md#frontend-ux-standards)).

Every table uses `Table`, apart from dashboard chart legends, which keep a compact layout with
their own captions and header scopes. The company ring compares issued share counts across classes;
its selected-class bar list keeps server search and a 25-row pager, showing percentages of the full
class even when only some holders are visible. A member's own-only chart shows the composition of
their holdings; a company-enabled overview adds aggregate class totals and their own position.
Neither chart implies voting power or value. An import's member snapshot opens each member's allotments in a dialog named Allotments, so Details always opens a
record's own page.

## Loading, empty and error states

A page that shows nothing until its first read renders `<Page loading>`. A section that is still
loading shows `Loading` (`dashboard/src/components/Ledger.tsx`): one muted `role="status"` line
that names what it loads, such as "Loading imports…" or "Loading the register…". A spinner
that stands for a whole step carries a status role with its words, such as the session check and
sign-up's steps.

A read that fails shows `LoadError` (`dashboard/src/components/Ledger.tsx`): one `role="alert"`
block with a sentence in the primary text colour and a Try again action at its right edge. The sentence names what
failed, such as "Imports could not be loaded." or "The register or your appointments could
not be loaded.", and adds a second sentence only for what the block can't otherwise say: a
consequence, such as "The list is incomplete.", or a likely cause, such as "It may be unavailable
to this account." Try again is described by that sentence, so a screen reader says which read it
retries, and it stays disabled while the read runs again. Shared copy passes through unchanged,
such as Notices' "What has been published to you could not be loaded." A page that waits for the
signed-in account shows `AccountCheck` (`dashboard/src/components/AccountCheck.tsx`): "Loading your
account…" while preferences load or refresh, then "Your account could not be loaded." with Try
again.

A failed read shows this block, not an empty state. The notification bell, profile documents and
classification claims, which used to show an empty state, now show the failure. A failed refresh
shows the same block. Its sentence says what could not be loaded or refreshed. The block provides the retry
where the affected records would appear; a separate Refresh action is unnecessary. Automatic reads
and their recovery follow the [freshness standard](frontend.md#automatic-data-freshness).

Both eligibility pages, member access and Home's member records read through shared hooks that also
keep a reason of their own. While a read fails they show the block, with any such reason under it,
such as "Your award records could not be confirmed. Refresh before continuing.", and no empty line.

An empty list says it has none yet in one muted sentence, such as "No requests yet." or "No
notices yet.", sometimes followed by where to add or find them, and an empty section keeps at
most one action ([signed-in page conventions](#signed-in-page-conventions)). An
empty class import instead invites bringing in the company's existing records. A list narrowed by
a search or filter says what matched instead, such as "No shareholders match your search." or "No
requests match."

A class's awards, imports and non-paid transfers, and notices, take their empty sentence from
shared copy in `packages/shared/src/constants/business/`. On the web, a section with no corrections,
register entries or particulars changes is hidden instead. Other empty sentences are each client's
own. A sentence that reports a state rather than an empty list keeps its own words, such as "No
current holding." A class's awards, grants, allotments and non-paid transfers, and an award's
vesting and entitlement changes, can't be made on every class or award, so theirs says none has
been recorded or prepared for it, such as "No employee award has been recorded for this share
class."

Some messages keep their own form:

- Sign-up keeps its own presentation, including its error blocks with Try again and its actions'
  labels; these standards cover signed-in pages.
- The route guard's checks, an unreadable profile or role, keep their own message and Try again
  ([routes, audiences and guards](frontend.md#routes-audiences-and-guards)).
- Recoveries of an interrupted action, such as "Retry original member action", keep their own
  wording.

## Forms

- **Fields.** A web form field is `Field` (`dashboard/src/components/Field.tsx`): Headless UI's
  `Field`, `Label` and `Description` around a `TextInput` or `TextArea` with the `FIELD_CLASS` look,
  or around Headless UI's `Select` in `SelectField`, so the label, the hint and any error are linked
  to the control and an error sets `aria-invalid`. The label sits above the control. In the app, a multiline
  `Field` starts at the web textarea's height: two rows unless the web sets more, such as three for a
  claim's basis. A standalone optional
  field ends with "(optional)"; an optional group declares this once in its heading, without repeating it
  on each field. Repeatable sections added on demand use plain headings, such as
  **Allocation history** and **Documents** in ledger setup; an empty section requires no entry.
  Labels use the group's context instead of repeating its name: **Documents** contains **Category**
  and **File**, with a numbered accessible group name distinguishing each attachment.
  Omitting a repeated optional marker does not make the field required. A sentence about one field is that field's hint, and an action
  beside the label is its `aside`. Choices, the searchable pickers, the list search
  and checkboxes that need no check keep their own controls, and sign-in and sign-up keep their own
  look on the same Headless parts.
- **Limits.** A text field's `maxLength` comes from `FIELD_LIMITS`
  (`packages/shared/src/constants/business/field-limits.ts`): one constant per kind of backend field,
  equal to its serializer or model limit, such as `NAME` (255), `REASON` (1000), `REGISTER_SHARES`
  (78 digits) and `AMOUNT` (21 characters). A field the backend leaves unbounded, such as a
  profile's residential address, has none. Numbers are text inputs with `inputMode`.
- **Files.** A web upload is `FileField`, a `Field` around a file input. It applies `UPLOAD_RULE`
  (`field-limits.ts`), the server's rule: a PDF, PNG or JPEG whose type matches its extension, up to
  10 MB. Its empty control reads **Choose file**, showing the filename after selection while keeping
  the native picker, keyboard focus and accessible label. Most forms omit the routine hint; one that
  shows it passes `showUploadHint`, and its hint then starts with "PDF, PNG or JPEG, up to 10 MB."
  (class rights, bringing records, award adjustments and document attachments). Validation stays
  visible: `uploadRefusal` turns away any other file as it is chosen, with "Choose a PDF, PNG or JPEG
  of up to 10 MB." on the field. The evidence in an eligibility claim keeps its dashed
  area but applies the same rule. In the app, that evidence comes from the phone's document picker,
  and `uploadRefusal` checks it as it is chosen.
- **Date fields.** A date field is `type="date"`, bounded with `min` and `max` wherever the server
  has a rule, and its label or message names the time zone where it matters.
- **Stepped forms.** Long workflows use the existing Ledger setup step indicator through
  `FormSteps` (`dashboard/src/components/FormSteps.tsx`), with one step visible at a time.
  Show class context once above the form; the footer identifies the current company. Keep exact
  company names in declarations or captured review targets, without a duplicate information card or
  routine technical and upload descriptions. Transfer preparation follows the investor pattern:
  People and shares, Transfer documents, then Company authority and review.
  Keep the same fields, card, typography and `FormActions`: Back and Continue for local
  navigation, with the actual save or preparation action on the final step. Continue checks only
  the current step and performs no upload or write. Keep inactive fields mounted so values and
  selected files survive Back; final validation opens the first step needing attention. A short
  review uses the existing `Rows` and `Row`, not another card style. A submitted request stays
  held for its original recovery rather than allowing edits or backward navigation.
  Related groups within a step use named fieldsets and the existing responsive grid, side by side
  when there is room and stacked in reading order otherwise. Use short contextual labels instead
  of repeating each group's name; keep their validation messages specific to the affected record.
  Keep the issue summary beside its company-authority fields in the review step, using `Rows` and
  the same grid without nested cards or a visible heading that repeats the step indicator.
- **Repeated allocations.** Web ledger setup separates **Current shares held** from **Allocation
  history**, which starts empty. **Add allocation** beside the section heading opens its first entry. It keeps
  one editor expanded. Adding another
  validates the current entry, folds it into a compact date, shares, paid and unpaid summary with
  **Edit** and **Remove**, then opens an unfinished entry or a new blank one. Actions use descriptive
  text buttons with contextual accessible names. Open allocation and document fields share the full-width
  grid, with **Remove** beneath the entry, aligned right; section add actions sit beside their headings.
  Fields never collapse on
  blur or simply because they look complete. Editing or switching entries preserves unfinished input;
  validation opens the entry needing attention. **Add shareholder**, or **Save changes** when editing,
  completes the shareholder and their optional history, with Cancel beside it. These main actions
  share the same button typography and spacing, with the main action alone emphasised. Historical quantities never set or limit current
  holdings; there is no remaining-share counter or equality requirement. New paid/unpaid fields
  default to zero, including when cleared; stored unknown amounts are not rewritten.
- **UTC dates.** Register and company dates are UTC calendar dates: `utcToday`
  (`packages/shared/src/utils/date.ts`) is their default and their `max`, so a date the server
  would refuse as in the future can't be picked. A team invitation's deadline and appointment
  expiry, and a representative authority request's expiry, are the end of the chosen UTC day; the
  deadline is bounded to the next 30 days. A certificate date is bounded to the two years an
  accountant's certificate stays current.
- **Other bases.** An inspection copy's request date is a Sydney date (`sydneyToday`). Company
  eligibility expiries are a local date and time (`datetime-local`), labelled so.
- **Helpers.** `isCalendarDate` checks a typed date, and `addCalendarDays` and `addCalendarYears`
  move a valid one. An ESLint rule in `dashboard/eslint.config.js` refuses `toISOString()` sliced or
  split into a date in the dashboard's source.

## Validation

This section covers how a form reports a problem: when it is submitted, and when its request fails.

- **Checking on submit.** Web forms check their fields when submitted. Filters that only narrow a
  list keep their own rules.
  - **Summary and fields.** A problem shows twice. `ErrorSummary` (`dashboard/src/components/`)
    lists each problem at the top of the form as `role="alert"` and takes focus, each item linking
    to its field. The field shows the same sentence as its error and turns `aria-invalid`; on
    sign-up, a registered email's error there also links to sign-in.
    `useErrorSummary` (`packages/shared/src/hooks/useErrorSummary.ts`)
    reads the form's problems, keyed by field, and forms that share one summary, such as Member
    access's invitation, revocation and certificate instruction, check only the fields their action
    needs. A box that must be ticked is a `CheckboxField`,
    except the eligibility claim's long declaration and sign-up pre-screening's four declarations,
    which keep their own layout with the same checks. The app's `CheckboxField`
    (`mobile/src/components/register/RegisterFields.tsx`), a box ticked beside its label, serves
    the claim's declaration. The app's `ErrorSummary` (`mobile/src/components/ErrorSummary.tsx`)
    gives the claim form the same summary, without links, at the top of its scroll content: a
    refused Save scrolls to it and moves the screen reader's focus there. Register import names each shareholder and allotment in its summary instead of linking
    to a field, and lists the problems current at the time. Its shareholder editor lists the problems
    with the shareholder being edited. A summary link focuses the control the field's label points
    to, or else the field's first control, including Headless UI checkboxes and radios.
  - **Sign-in and sign-up** keep the rules in their hooks: sign-up's in `packages/shared`, which
    mobile shares, and sign-in's in the dashboard's own `useSignIn`
    (`dashboard/src/pages/signin/useSignIn.ts`). The hook reports its field errors when the form
    is submitted, and the server's come back the same way.
    `useFieldErrorSummary` lists them in the same summary, which takes focus after each submit.
    Pre-screening's four declarations are checked by the page, since its hook reports only one
    sentence.
  - **In these forms submit stays enabled** unless the form is busy or the action is unavailable,
    such as without company authority or with nothing changed, and the page says why. An unchanged
    retry of an interrupted request is not checked again.
  - **Shared wording.** A rule both clients apply has one sentence in `packages/shared`: a new
    password (`PASSWORD_PROBLEMS`, which sign-up's shared hook gives both) and an invitation code
    (`INVITATION_CODE_PROBLEM`, used by the web's team invitations and mobile's Invitation screen).
    A pasted code is trimmed before its length limit applies; web member invitations use email links
    instead of a code field. The web's new-person fields take their
    sentences from `NEW_PERSON_PROBLEMS`.
  - **The summary keeps the last press.** It lists the problems found when submit was last pressed
    that still fail, so it shrinks as they are fixed, and it clears when a check passes or the form
    is reset. It takes focus only on a new press.
  - **Incomplete dates.** Without browser validation, a date or date-time typed only in part reads
    as empty, so an optional one would be dropped silently. `useIncompleteDates`
    (`dashboard/src/hooks/useIncompleteDates.ts`) notes the browser's `badInput` on each keystroke,
    input and blur, and the form treats it as a problem: the team invitation's deadline and
    appointment expiry and a representative authority request's expiry.

- **Request errors.** A failure reads as one `role="alert"` sentence, `Failure`
  (`dashboard/src/components/Ledger.tsx`, which renders nothing without a sentence), from
  `failureSentence` (`packages/shared/src/utils/errors.ts`), never the transport's "Request failed
  with status code 400". When the server answered, the sentence is its own words with each field
  error included (`apiErrorSentence`), or else the caller's fallback, which names what failed ("Your
  personal details could not be saved. Try again."). A failure that never reached the server shows
  its own message, such as "Unable to connect to our servers…" or "Your signed-in account changed.
  Reopen company team.", or the fallback when it has none. Pages that still read with
  `apiErrorSentence`, such as the register preparation forms, documents and sign-up, show their
  fallback for such a failure instead; those that pass the fallback twice still show a message
  thrown with `createUserFriendlyError`. Sign-in, sign-up, company details and change password place
  the server's field errors on their fields with `readApiError`; other forms show them in the one
  sentence.
- **Refusal codes.** The server names unmet requirements and refusals as codes. Each family's copy
  map in `packages/shared/src/constants/business/` turns them into sentences: `refusalSentences` for
  a preview's or record's list, and `refusalSentence` for a refused request, before any other
  reading. A code the map lacks reads as "Another requirement is not met. Refresh before
  continuing.", or as the caller's fallback for a refused register decision. `readApiError` never
  reads a code list as a sentence, so a code never reaches the screen.

## Dates, numbers and identifiers

Figures, amounts and dates are formatted only by the shared formatters in `packages/shared`, never
by a local helper or a browser `toLocale…` call:

- **Dates** use `formatDate`: "20 October 2026". A calendar date is read in UTC, so it shows the day
  the server recorded.
- **Date-times** use `formatDateTime`: "20 Oct 2026, 02:30 pm", in the viewer's local time. A
  calendar date passed to it shows as a date, never with an invented time.
- **Share counts** use `formatShareCount`, a count with its noun uses `shareCount` ("1 share",
  "1,315 shares", or with a qualifier, "1 issued share") and a signed change uses `shareChange`
  ("+1,000"). Gathered in `packages/shared/src/utils/formatting.ts` with `sharePercentage`.
- **Percentages of a class** use `sharePercentage`, rounded half-up to two places, "<0.01%" for a
  holding too small to show and "Not recorded" without issued shares.
- **Amounts** use `formatMoney`, which names its currency: "AUD 1,234.50".
- **On screen** the dashboard's records format their dates, share counts and amounts: register
  records, eligibility history and shared summaries, team invitations and confirmations. A
  register's amounts paid and unpaid show as recorded, without `formatMoney`, because the
  register cannot name a single currency for them
  ([amount paid](../business/register.md#amount-paid-and-date-entered)).
  Mobile's signed-in screens format their dates the same way.
- **Status codes** read as words, never as the code or a code with its underscores replaced: the
  server's `statusDisplay` where a record carries one (companies), else a
  shared label map (`packages/shared/src/constants/business/labels.ts` for eligibility outcomes,
  member invitations, and appointments; `investor-eligibility.ts`
  for investor categories and certifier bodies; and `REGISTER_CORRECTION_COPY.ENTRY_KINDS` for
  register entry kinds). Mobile shows no status codes and uses the same shared maps.
- **Identifiers.** Records show names, dates and amounts. Issue, transfer, award, import and
  correction records, former shareholders, certificates, inspection copies, member access, Team,
  representative authority and Profile show no internal references, register
  sequences, block numbers, gas or fingerprints, and have no **Record details** or **Technical
  details** section; an award shows who recorded it and when as one muted line. Where only an
  identifier tells records apart, such as two shareholders with one name or two options that read
  the same, the screen shows `shortReference` (`packages/shared/src/utils/formatting.ts`, the first
  eight characters), never the full UUID, including in choices and screen-reader context. Internal
  user numbers are not shown. Corrections names each change by its kind and date, with no register
  sequence: a correction reads **Corrects the issue of …**, a reversed change **Reversed on …**, and
  the copied opening sits in its own **Opening records** card, its decisions reading **Review** and
  **Confirm**, its history **Reviewed** and **Confirmed**, and its shareholders behind **Show the
  shareholders**.
  The eligibility pages list requests by category, outcome and submission time, the company's list
  leading with the investor's name when the request shared one, and show their
  history without request keys, digests or appointment references, and name a company from the
  person's own companies (`Company` and its
  `shortReference` when it is not among them). A request's shared summary shows its readable values,
  and the investor's view names the company when it is one of theirs. Its references to the chosen
  evidence source, the investor's account and the company are not shown: a request is sent only when
  they match the chosen source and company and the signed-in account. Wallet addresses, such as an
  import's Wallets row or a former shareholder's recorded wallet, stay exact. No page shows a
  company's ID. An eligibility request takes its company from
  the person's own companies or from the company's request link (`?to=`), which **Copy request
  link** on Company eligibility copies, and the preview names the company. A link opened signed out
  is kept for the session (`dashboard/src/utils/requestLink.ts`) and reopened after sign-in.
- **Enforcement.** An ESLint rule in `dashboard/eslint.config.js` refuses `toLocaleString`,
  `toLocaleDateString` and `toLocaleTimeString` in the dashboard's source, beside the rule that
  refuses inline ISO date slicing ([forms](#forms)). Mobile's ESLint configuration has neither
  rule.

Next: [frontend](frontend.md), [mobile](mobile.md) and
[the register's person choice](../business/register.md#choosing-a-person).
