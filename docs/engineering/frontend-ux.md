# Frontend UX standards

[Engineering](README.md) · [Documentation](../README.md)

How signed-in screens look and behave on web and mobile: the conventions every page follows and the
one standard way to make each common choice. How the clients are built is in [frontend](frontend.md)
and [mobile](mobile.md); what each page does is in the business section.

- [Signed-in page conventions](#signed-in-page-conventions)
- [Actions](#actions)
- [Feedback](#feedback)
- [Copy](#copy)
- [Choosing a person](#choosing-a-person)
- [Choosing a company](#choosing-a-company)
- [Choosing a wallet or a paid subscription](#choosing-a-wallet-or-a-paid-subscription)
- [Choosing from a short fixed list](#choosing-from-a-short-fixed-list)
- [Choosing from a bounded list](#choosing-from-a-bounded-list)
- [How the choice rules are enforced](#how-the-choice-rules-are-enforced)
- [Lists, search, filters and paging](#lists-search-filters-and-paging)
- [Loading, empty and error states](#loading-empty-and-error-states)
- [Forms](#forms)
- [Validation](#validation)

## Signed-in page conventions

Every signed-in page renders in `Page` (`dashboard/src/components/Page.tsx`,
`mobile/src/components/Page.tsx`) under the page's title. Web form fields use `Field`
([forms](#forms)). `Page narrow` bounds
task forms, settings and detailed records, including compact tables; ownership dashboards and wide
tables take the standard workspace width, and tables scroll within their card on small screens.
Section spacing is scoped to the frame; sign-up keeps its own presentation.

The title row holds the title and the page's actions, with a one-sentence muted lede under it only
where it adds to the titles. The first section follows at the same gap as between sections (`Page`
is one flex column with a single gap; add no margin under the title). On mobile `Page` is a scroll
view on the page ground: the title (Newsreader, `theme.fontSize.xxxxl`), the lede, then the actions
as one wrapping row, since a phone's large title leaves no room beside it; the stack header holds
only the menu or back button and, on a top-level screen, the bell. A tap on a control acts at once,
even while the keyboard is up. Mobile screens framed
differently: Help & Support keeps its stack title; Send, Transfer, Verify Wallet and Recovery Phrase
are titled inside their `Panel` card (`mobile/src/components/panel`); Buy crypto is its dialog over
the bare page ground, then the provider's web view.

The ledger blocks (`dashboard/src/components/Ledger.tsx`, `mobile/src/components/Ledger.tsx`) and
`PageAction` (`dashboard/src/components/Page.tsx`) each enforce one rule:

- `Section`: a raised card on the page ground (`bg-surface-raised`, a `border-border` hairline,
  `rounded-2xl` in the frame, `rounded-xl` outside it) with its Newsreader title inside. Forms and
  things to act on are cards too; a group inside a card gets a rule or a small heading, never a
  nested card. An empty section keeps its real title, one muted sentence ("No activity yet.") and at
  most one action; a state is never a title.
- `Rows` and `Row`: ruled label and value pairs, figures right-aligned in tabular numerals.
- `LinkRow`: how a list of sub-pages or neighbours links to each; the whole row is the link, named
  after its destination, with optional detail lines and an aside. A title row never repeats a
  sidebar destination; an underlined link belongs to a sentence or opens an external resource.
- `PageAction` and `PageLink` (`Action` on mobile): a content-width action placed with what it acts
  on: the title row for the page (including the way back to the parent), a section for that section,
  a row for that row's record alone. Nothing is selected before acting, and no toolbar waits under a list.
- `Disclosure`: a button with `aria-expanded` (expanded or collapsed on mobile) and a leading caret
  that opens its detail in place under its row, held only while open; other open rows stay open
  (`useOpenRows` from `@ledova/shared`). Activity's filter and Wallets' sort (once a chain holds two
  wallets) are a `Disclosure` at the top of the card naming what it applies; applying or clearing
  closes it and every open entry and returns focus to its button. Dialogs are for work that sets the
  page aside: a form that creates or changes something, a signing step or a confirmation.
- `SwitchRow`: a setting that takes effect at once (Transaction alerts; Dark theme; Show this
  company to eligible investors), as an On/Off pill or native switch (`role="switch"`,
  `aria-checked` the saved value), disabled while saving; a refusal keeps the saved value and shows
  an alert in the card. A choice saved with a form stays a checkbox.
- `Status` is words after a small mark, read as words only; `Timeline` (web) dates each event;
  `Choice` (mobile) is an outlined choice marked selected. Each status family has its own
  tone map; shared subscription and resolution-result tones live in
  `dashboard/src/components/statusTones.ts`. Personal applications retain their moving fallback,
  company applications their waiting fallback, and an open offering retains its override.

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
exceptions are the tinted extraction-status pill beside a saved payslip on Profile, the dashed
upload area, and sign-in and the sign-up steps, which keep tinted fields and boxed outcomes within
the same cards and titles. Addresses, hashes and signing summaries
use the monospaced face (`font-mono`; `theme.fontFamily.mono`).

Show ownership, status and one primary next action directly, with labels beside their values and
balanced field groups; keep full audit identifiers and optional detail behind detail controls; never
repeat titles or general explanations or show read and edit views together. Action-specific
authority, privacy, incomplete-data and recovery guidance stays visible where relevant, and a
presentation change must not reset pending work, hide uncertainty or change what a confirmation
authorises.

## Actions

`PageAction` (`dashboard/src/components/Page.tsx`) is the standard action on a signed-in page. It
looks plain, primary (the one main action of its card or form), destructive (the confirm action of a
confirmation) or pressed, and comes in four forms:

- **A button** runs its action on click.
- **A submit button** (`type="submit"`) ends every page form, inside `FormActions`: a rule, then one
  right-aligned row with any plain actions first and the primary submit last. The form's own submit
  handler does the work, so Enter in a field submits the form unless the submit button is disabled.
- **A link** (`PageLink`, same looks, optional router state) is an action that only goes somewhere:
  the title row's way back, Add share class, a shareholder's Details, Issue shares to them.
- **A toggle** (`pressed`, which sets `aria-pressed`) marks the chosen option where pressing applies
  it at once: the open Register task, the shown eligibility request and Wallets' sort.

`busy` and `busyLabel` disable an action and name its work, such as "Preparing allotment…" or
"Saving…". Every page form's submit button uses them, and so does every action that starts a
request, on pages and in dialogs, including:

- downloads ("Downloading…", on the one document being fetched);
- previews and preparations;
- offering submissions and added offering documents;
- deployment;
- the wallet import and verification steps, and identity verification;
- establishing an appointment;
- member, particulars and certificate requests;
- register setup's review step (editing the records, loading and confirming the decision).

Where a shared hook only reports that some command is running, `useRunningAction`
(`dashboard/src/hooks`) names the action that was clicked. A few actions show their work another
way:

- Activation's review hides its action and shows "Checking activation…".
- A register decision's rejection preview shows "Loading the preview…".
- Submitting a wallet nomination replaces the form with its saved request.
- Signing flows, in Trading and wallet transfers, move to their own submitting step.

Refresh, retry and recovery actions keep their label while they run; a form's submit button that
also recovers an earlier attempt keeps its busy label. Icon buttons, register setup's Import
placeholder, the payslip upload area and Trading keep their own controls, and dialog footers use the
same order as `FormActions`. Mobile's `Action` has no busy or pressed form yet.

An action that deletes, withdraws or revokes something saved asks first, in a dialog that names the
consequence, with Cancel and a destructive action that repeats the verb, such as "Withdraw
offering" or "Revoke access". `Confirmation` (`dashboard/src/components/Modal.tsx`) is that dialog:
its text is the dialog's description, its action needs whatever enabled the action that opened it,
and it stays open and busy until the request ends. It confirms withdrawing an offering, an
application, a claim, a certificate request or a representative authority request; deleting a draft
offering or a profile document; revoking member access; and removing a saved order reminder.
Deleting a wallet, a company document or the account, and revoking a company appointment, use the
same destructive dialog with their own text. Company eligibility's request withdrawal and acceptance
revocation are confirmed in their own review step instead, which shows the exact record and needs a
confirming tick before its destructive action; Trading's order cancellation is confirmed by its
signing steps. Reversible actions, such as signing out, turning a switch off or removing a row from
an unsaved form, aren't confirmed. Dismissing a notification archives it at once. Register
decisions, such as rejecting a proposal, and evidence forms, such as ending unissued rights, are
confirmed by their own decision dialog or form. The dashboard uses no browser `confirm` or `alert`
(ESLint's `no-alert`). Mobile doesn't follow this yet: some of these actions run at once there, and others
confirm with native alerts.

## Feedback

`Outcome` (`dashboard/src/components/Ledger.tsx`) says what just happened in one line: a
`role="status"` sentence in the primary text colour, after the mark `Status` uses for done. It sits
under the change or on the record you land on, and stays until the next action replaces it; there
are no toasts. It names the record rather than its identifier; team invitations, appointments and
authority requests show their identifier in their own details. It reports:

- a changed password, saved personal details, and an offering submitted for review, withdrawn or
  deleted;
- the downloaded unsigned certificate, inspection copy and company pack;
- a recorded team invitation, an accepted invitation and a representative authority request;
- member access's recorded invitation, certificate fulfilment and particulars instruction;
- a placed or recovered order with its share class, above Trading's orders, until another order
  action or a class change starts.

Other signing flows and identity verification show their result in their own dialog, sign-in and
sign-up keep their boxed outcomes, and the payment instruction's copy buttons confirm with Copied
beside them. Register forms and preparations don't use it. Mobile still reports success with native alerts and its success
dialog.

## Copy

Text uses sentence case: titles, labels, buttons and options capitalise only their first word and
names, such as page names (Back to Shareholders), document names (Terms of Service) and
organisations. An ellipsis is one character, "…"; ESLint refuses three dots in the text of the
dashboard's and the shared package's source. Labels the backend supplies, such as company and
document types and some statuses ("Under Review", "Awaiting Payment"), keep its title case. Mobile's
own copy doesn't follow this yet (#1201); the shared strings it shows do.

## Choosing a person

No web flow lists people in a native select, because a dropdown of every person does not scale to a
large register. Each one uses a searchable list built on Headless UI's `Combobox`:

- **`PersonSelect`** (`dashboard/src/pages/company/register/shared/PersonPicker.tsx`) is used where a
  flow names one person:
  - register setup's shareholder, an investor or non-paid issue under Issue shares, a transfer's
    transferor and recipient, and an employee award's recipient. These read one validated list of
    the class's members and award recipients (`usePeople`).
  - member invitations, which list the company's current and former holders in every class and its
    award recipients (`invitationMembers`), without addresses.
- **`SearchSelect`** (`dashboard/src/components/SearchSelect.tsx`) is used directly for the
  share-class issue's member, read from the class's members alone.
- **Wallet links** offer, for each waiting wallet, the holders of every class in the company
  (`registerLinkMemberLabels`), then "A member not on the current register" and "New member N" where
  they apply.
- **Register opening** offers, for each unlinked holding, the members already linked in the class,
  by name or numbered (`openingMemberLabels`), and a "New member N" for each address.

Wallet links and register opening show one-line labels.

How the list behaves:

- **Opening and searching:**
  - The label sits above a text field, and the field, its toggle button and the list all carry it.
  - The list opens on focus, so a short list can be browsed.
  - Typing narrows it to the entries whose text contains every typed word, ignoring case and
    accents. The text is what the entry shows, apart from why it can't be chosen: a person's name,
    address, award marker and record reference, and the flow's own detail.
  - Focusing or clicking the field selects its text, so typing replaces it.
- **What each person shows:** the name, then a muted line with the address, "Award recipient without
  shares" and the flow's own detail, such as the shares held. A short record reference appears only
  when two people share a name and address. Assistive technology reads the option as one name
  joined by " · ".
- **The first entry:** **New person**, or the share-class issue's "Create a new member through the
  documentary link", comes first wherever a flow can add someone. It steps aside while a search
  finds someone and returns when the search finds nobody or is cleared.
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
  `packages/shared/src/utils/search.ts`, so both clients build, label and search the list the same
  way.

These rules are checked in review. The dashboard suite drives the list in register setup (typing a
name and pressing Enter), a transfer and member invitations.

On mobile, the register flows choose a person from the same kind of list, in a sheet opened from the
field. Most go through `PersonSelect` (`mobile/src/components/register/PersonPicker.tsx`), which
labels each person with the shared `personChoices`:

- investor and non-paid issues, employee awards and transfers read members and award recipients
  through `useTransferMembers` and the shared `peopleFrom`. Issues and awards send the shared
  `personRequest` (an award-linked grant sends its award's recipient), and a transfer applies the
  same award-recipient rule in its own request;
- register setup's **Add a shareholder** reads `useRegisterImportMembers` and offers award
  recipients and the members without a linked wallet whose name and address are retained, where the
  web offers every company member;
- the share-class issue's member uses `SearchSelect` directly, with the members from
  `useCompanyIssueInstructions`;
- member invitations offer the current and former holders and award recipients from
  `invitationMembers`.

The sheet works the same way in each:

- **The sheet:** `SearchSelect` (`mobile/src/components/SearchSelect.tsx`) shows the label above a
  field with the current choice and its detail. Tapping the field opens a sheet with an empty search
  box, a count of the matches once you type, and a list that renders only the rows on screen, so no
  cap is needed; dragging the list hides the keyboard.
- **Choosing:** each row is a radio button in a radio group, marked when chosen, and choosing closes
  the sheet. **New person** comes first as on the web, and an unavailable person stays listed,
  disabled, with the reason.

The mobile suite drives the sheet in register setup and member invitations. Wallet links and
register opening on mobile still list members row by row.

## Choosing a company

Every web page that asks which company to work on uses `CompanyPicker`
(`dashboard/src/components/CompanyPicker.tsx`): the same searchable list as
[choosing a person](#choosing-a-person), labelled **Company**, showing each company's name and, where
it helps, a muted detail such as a draft company's ACN, never an internal identifier.

- **Pages that keep their own choice:** Register, Dashboard, Company, Activation, Offerings, Published to
  your members and register setup each keep their own choice through `CompanySelection`. It hides the
  list when the account has one company and it is already chosen.
- **Your shares** shows it when the person holds records in more than one company.
- **Pages that always show it:** Company team, Representative authority (which lists only draft
  companies), Company eligibility and its wallet approvals show it whenever they ask for a company.
  Wallet approvals label theirs **Wallet approval company**, since the page has two.

These rules are checked in review. The dashboard suite drives the picker on Register and in the award
recovery case.

## Choosing a wallet or a paid subscription

Lists that grow with a company's shareholders use the same searchable list, named by what a person
recognises rather than an internal identifier:

- a share-class issue's nominated wallet, and a wallet nomination in Company eligibility's wallet
  approvals: the wallet address, with its proof date or whether its source is ready;
- a retained approval in the same section: the wallet address, with when the approval ends;
- a paid issue's recorded subscription: the investor's name, or "Name not recorded", with the shares
  and receiving address.

These lists are checked in review; no dashboard case drives them.

## Choosing from a short fixed list

A question with a few fixed answers shows them all as radio buttons, so nothing has to be opened to
see the choices. `Choices` (`dashboard/src/components/Choices.tsx`) is a fieldset whose legend is the
question, with one native radio button per answer on a wrapping row; the arrow keys move between
answers. It asks for:

- the authority for a correction, wallet link or register opening;
- whether a mirrored allotment is held for someone else;
- a new share class's type;
- the kind of issue on Register's Issue shares task, which opens that kind's form in place;
- the requested state of a pause change;
- the exemption an offering relies on;
- a company eligibility decision's outcome and a wallet instruction's action;
- the direction and network in Activity's filter, and the network for a new or imported wallet;
- the professional body behind an accountant's certificate;
- the type of a profile document, where answers not yet offered stay listed, disabled and marked
  "coming soon".

A question with no answer yet shows no button chosen. The answer takes effect with the form or
filter it belongs to. Wallets' sort is the exception: each sort applies as soon as it is chosen, so
its answers are a row of buttons marked pressed, since moving through radio buttons with the arrow
keys would re-sort the list at every step.

## Choosing from a bounded list

A list too long for radio buttons that still cannot grow with the company, such as a person's own
wallets, a company's share classes, its offerings or document types, or someone's appointments, is a
native select in `SelectField` (`dashboard/src/components/SelectField.tsx`): the label above the
field and options named in words:

- an appointment reads as its actions and the date it was made;
- an evidence source reads as its kind, status and date, and a classification claim as its kind and
  date;
- an offering reads as its class, status and date;
- a company ADD for a nominated wallet reads as when it was admitted and until when.

These lists add a short record reference only to options that would otherwise read the same,
as with people who share a name and address. Wallet options show the wallet's name or address.

Register setup offers a class already started as links in a sentence, and the new class's kind as
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
  with a hint naming what it searches, Clear while it holds text, and the list's filters beside it.
  It searches 300 ms after typing stops. The server matches every typed word, ignoring case. While
  a search or filter applies, a polite status line counts the matches, such as "3 applications match
  your search" or "No applications match".
- **The address:** `useListParams` (`dashboard/src/hooks/useListParams.ts`) keeps the search
  (`q`), the filters and the page in the URL, so Back, a refresh or a shared link keep them. Typing
  replaces the history entry, while a filter or page change adds one. Any change but the page
  returns to the first page. On a list paged by the server, a page that no longer exists is replaced
  by the first; a list searched in the browser shows its last page instead.
- **Tables:** `Table` is the markup for lists on these controls: a framed table that scrolls
  sideways within its card, with a screen-reader caption, a header row of `scope="col"` cells and
  each row named by its first cell as a row header. `Pager` under it gives the rows shown, such as
  "1–25 of 1,240 applications", and Previous, the page number and Next when there is more than one
  page. While new results load, the shown rows stay, dimmed and marked busy, and the pager says it
  is loading.
- **Feeds:** `LoadMore` ends a feed with "Load more notices" (or applications, activity,
  notifications and so on), which names its work while it runs. When a later page fails, the shown
  rows stay and a [load error](#loading-empty-and-error-states) says the list is incomplete.
- **Page size:** 25 rows. The API accepts `page_size` up to 100 on every paged list.

An offering's applications on Offerings are searched and paged by the server: search by investor
name, wallet address or payment reference, filter by status, with the chosen offering kept in the
address too. Company eligibility's request queue pages the same way, with no search box: its one
filter is the outcome, as radio buttons, which the server derives from each request's decision,
withdrawal, revocation and expiry. While another page or outcome loads, its rows stay dimmed and
their View buttons wait; mobile still reads every page of the queue. Shareholders searches and pages
the register the page has already read in full, since its ownership totals need every holding: the
same box and pager, matching every word ignoring case and accents (`searchRows` in
`packages/shared/src/utils/search.ts`), with the share class as its filter.

The feeds are Activity, an investor's Applications, Notices, the notification bell, Published to
your members, a class's register entries, a share class's issuance requests, authorised share
requests and issuances (`useRecordFeed`), and each class's former shareholders, shown 25 at a time
from the register already read. A list bounded by one person, such as their own documents,
classification claims or wallets, reads every page. Other lists still read every page
([frontend](frontend.md#lists-figures-and-currency)).

**The register's records are the one stated exception.** Each share class's allotments, transfers,
openings, imports, corrections, particulars changes, member links, deployments, awards and grants,
and company member access, read every page. Each record keeps its own recovery for an uncertain
reply, and a newer record shifting the pages would unmount the oldest loaded one and lose it; these
lists grow only with one company's register decisions. The owner chose this on 21 October 2026,
to revisit if registers grow large ([decision](../decisions.md#frontend-ux-standards)).

Every table uses `Table`, apart from the company dashboard's largest-shareholder legend beside its
chart, which keeps a compact layout with its own caption and header scopes. An import's member
snapshot opens each member's allotments in a dialog named Allotments, so Details always opens a
record's own page.

## Loading, empty and error states

A read that fails shows `LoadError` (`dashboard/src/components/Ledger.tsx`): one `role="alert"`
block with a sentence in the primary text colour and a Try again action. The sentence names what
failed, such as "Your wallets could not be loaded." or "The register or your appointments could
not be loaded.", and adds a second sentence only for what the block can't otherwise say: a
consequence, such as "Trading actions are unavailable." or "The list is incomplete.", or a likely
cause, such as "It may be unavailable to this account." Try again is described by that sentence, so
a screen reader says which read it retries, and it stays disabled while the read runs again. Shared
copy that both clients show passes through unchanged, such as an unreadable chain on a register
opening.

A failed read shows this block, not an empty state. The notification bell, profile documents,
classification claims and a class's deployments, which used to show an empty state, now show the
failure. On the company team page and in a class's employee awards and non-paid issues, the block
takes the place of the section's Refresh action while its read has failed; deployments do the same
while no records show.

Loading lines, refresh actions, a failed refresh and empty states are still to follow under
[#1180](https://github.com/Ledova/ledova/issues/1180). Until then:

- The company's eligibility queue, your company eligibility requests, member access and Home's
  member records report a failed read in their own sentence beside their Refresh action, and may
  show their empty line under it.
- A share class's capital, pause, paid issue and grant records, and the company's wallet
  instructions, report any failed read, the first included, in their own "could not be refreshed"
  sentence beside their Refresh action.
- The route guard's checks, an unreadable profile or role, keep their own message and Try again
  ([routes, audiences and guards](frontend.md#routes-audiences-and-guards)).
- Recoveries of an interrupted action, such as "Retry original member action", keep their own
  wording.
- Signing flows in Trading keep their own phases and recovery actions.

## Forms

- **Fields.** A web form field is `Field` (`dashboard/src/components/Field.tsx`): Headless UI's
  `Field`, `Label` and `Description` around a `TextInput` or `TextArea` with the `FIELD_CLASS` look,
  or around Headless UI's `Select` in `SelectField`, so the label, the hint and any error are linked
  to the control and an error sets `aria-invalid`. The label sits above the control, an optional
  field ends with "(optional)", a sentence about one field is that field's hint, and an action
  beside the label, such as Scan QR, is its `aside`. Choices, the searchable pickers, file inputs,
  checkboxes, the list search and Trading's order form keep their own controls, and sign-in and
  sign-up keep their own look on the same Headless parts.
- **Limits.** A text field's `maxLength` comes from `FIELD_LIMITS`
  (`packages/shared/src/constants/business/field-limits.ts`): one constant per kind of backend field,
  equal to its serializer or model limit, such as `NAME` (255), `REASON` (1000), `REGISTER_SHARES`
  (78 digits) and `AMOUNT` (21 characters). A field the backend leaves unbounded, such as an
  offering's summary or a profile's residential address, has none. Numbers are text inputs with
  `inputMode`, including Trading's order fields.
- **Date fields.** A date field is `type="date"`, bounded with `min` and `max` wherever the server
  has a rule, and its label or message names the time zone where it matters.
- **UTC dates.** Register and company dates are UTC calendar dates: `utcToday`
  (`packages/shared/src/utils/date.ts`) is their default and their `max`, so a date the server
  would refuse as in the future can't be picked. A team invitation's deadline and appointment
  expiry, and a representative authority request's expiry, are the end of the chosen UTC day; the
  deadline is bounded to the next 30 days. A certificate date is bounded to the two years an
  accountant's certificate stays current.
- **Other bases.** An inspection copy's request date is a Sydney date (`sydneyToday`). Offerings and
  company eligibility expiries are a local date and time (`datetime-local`), labelled so.
- **Helpers.** `isCalendarDate` checks a typed date, and `addCalendarDays` and `addCalendarYears`
  move a valid one. An ESLint rule in `dashboard/eslint.config.js` refuses `toISOString()` sliced or
  split into a date in the dashboard's source. Mobile keeps its own `utcToday`, and its deadlines are
  a local date and time, until [#1201](https://github.com/Ledova/ledova/issues/1201).

## Validation

This section covers what a page shows when a request fails. Checking forms before they are sent is
still to come ([#1179](https://github.com/Ledova/ledova/issues/1179)).

- **Request errors.** A failure reads as one `role="alert"` sentence from `failureSentence`
  (`packages/shared/src/utils/errors.ts`), never the transport's "Request failed with status code
  400". When the server answered, the sentence is its own words with each field error included
  (`apiErrorSentence`), or else the caller's fallback, which names what failed ("The wallet could
  not be saved. Try again."). A failure that never reached the server shows its own message, such as
  "Unable to connect to our servers…" or "Your signed-in account changed. Reopen company team.", or
  the fallback when it has none. Pages that still read with `apiErrorSentence`, such as the register
  preparation forms, documents and sign-up, show their fallback for such a failure instead; those
  that pass the fallback twice still show a message thrown with `createUserFriendlyError`.
  Sign-in and sign-up place field errors on their fields with `readApiError`; other forms show them
  in the one sentence.
- **Refusal codes.** The server names unmet requirements and refusals as codes. Each family's copy
  map in `packages/shared/src/constants/business/` turns them into sentences: `refusalSentences` for
  a preview's or record's list, and `refusalSentence` for a refused request, before any other
  reading. A code the map lacks reads as "Another requirement is not met. Refresh before
  continuing.", or as the caller's fallback for a refused register decision. `readApiError` never
  reads a code list as a sentence, so a code never reaches the screen.
- **Enforcement.** ESLint refuses `getErrorMessage` in the dashboard (`no-restricted-imports`) and in
  the shared package (`no-restricted-syntax`). Mobile still uses it, so a field error there can read
  "Request failed with status code 400" until [#1201](https://github.com/Ledova/ledova/issues/1201)
  moves it to these rules.

Next: [frontend](frontend.md), [mobile](mobile.md) and
[the register's person choice](../business/register.md#choosing-a-person).
