# Frontend UX standards

[Engineering](README.md) · [Documentation](../README.md)

How signed-in screens look and behave on web and mobile: the conventions every page follows and the
one standard way to make each common choice. How the clients are built is in [frontend](frontend.md)
and [mobile](mobile.md); what each page does is in the business section.

- [Signed-in page conventions](#signed-in-page-conventions)
- [Choosing a person](#choosing-a-person)
- [Choosing a company](#choosing-a-company)
- [Choosing a wallet or a paid subscription](#choosing-a-wallet-or-a-paid-subscription)

## Signed-in page conventions

Every signed-in page renders in `Page` (`dashboard/src/components/Page.tsx`,
`mobile/src/components/Page.tsx`) under the page's title. Web
forms use `FIELD_CLASS` and `LABEL` (`dashboard/src/components/fieldClass.ts`). `Page narrow` bounds
task forms, settings and detailed records, including compact tables; ownership dashboards and wide
tables take the standard workspace width, and tables scroll within their card on small screens.
Section spacing is scoped to the frame; sign-up keeps its own presentation.

The title row holds the title and the page's actions, with a one-sentence muted lede under it only
where it adds to the titles. The first section follows at the same gap as between sections (`Page`
is one flex column with a single gap; add no margin under the title). On mobile `Page` is a scroll
view on the page ground: the title (Newsreader, `theme.fontSize.xxxxl`), the lede, then the actions
as one wrapping row, since a phone's large title leaves no room beside it; the stack header holds
only the menu or back button and, on a top-level screen, the bell. Mobile screens framed
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
- `LinkRow`: the one way a page reaches each sub-page or neighbour; the whole row is the link, named
  after its destination, with optional detail lines and an aside. A title row never repeats a
  sidebar destination; an underlined link belongs to a sentence or opens an external resource.
- `PageAction` (`Action` on mobile): a content-width button placed with what it acts on: the title
  row for the page (including the way back to the parent), a section for that section, a row for
  that row's record alone. Nothing is selected before acting, and no toolbar waits under a list.
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
wrapping row of content-width actions: a plain Cancel, Close or Back, then the one primary action.
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

## Choosing a person

No web flow lists people in a native select, because a dropdown of every person does not scale to a
large register. Each one uses a searchable list built on Headless UI's `Combobox`:

- **`PersonSelect`** (`dashboard/src/pages/company/register/shared/PersonPicker.tsx`) is used where a
  flow names one person:
  - register setup's shareholder, Record investor share issue, non-paid issues, a transfer's
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
    accents. The text is everything the entry shows: a person's name, address, award marker and
    record reference, and the flow's own detail.
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
- **Unavailable people:** someone who cannot be chosen, such as a person already added to a register
  setup draft, stays listed, disabled, with the reason.
- **Shared logic:** `peopleFrom`, `personChoices` and `personRequest` are in
  `packages/shared/src/utils/people.ts`, so both clients can use the same list and rules.

These rules are checked in review. The dashboard suite drives the list in register setup (typing a
name and pressing Enter), a transfer and member invitations.

The mobile app still chooses people from buttons; #1177 brings it to the same standard.

## Choosing a company

Every web page that asks which company to work on uses `CompanyPicker`
(`dashboard/src/pages/company/shared/CompanySelection.tsx`): the same searchable list as
[choosing a person](#choosing-a-person), labelled **Company**, showing each company's name and, where
it helps, a muted detail such as a draft company's ACN, never an internal identifier.

- Register, Dashboard, Company, Activation, Offerings, Published to your members and register setup
  follow the company chosen for the session through `CompanySelection`, which hides the list when
  the account has one company and it is already chosen.
- Your shares shows it when the person holds records in more than one company.
- Company team, Representative authority (offering draft companies only), Company eligibility and
  its wallet approvals show it whenever they ask for a company.

## Choosing a wallet or a paid subscription

Lists that grow with a company's shareholders use the same searchable list, named by what a person
recognises rather than an internal identifier:

- a share-class issue's nominated wallet, and the wallet nomination or retained approval in Company
  eligibility's wallet approvals: the wallet address, with its proof date or whether its source is
  ready;
- a paid issue's recorded subscription: the investor's name, with the shares and receiving address.

Next: [frontend](frontend.md), [mobile](mobile.md) and
[the register's person choice](../business/register.md#choosing-a-person).
