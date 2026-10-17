# Frontend

[Engineering](README.md) · [Documentation](../README.md)

How the web dashboard, the public site and the shared TypeScript package are built, and the
conventions every signed-in page follows on web and mobile. For engineers changing client code; the
mobile app's own architecture is in [mobile](mobile.md), and what each page does
for the people using it is in the business section linked from
[Pages](#pages).

- [Clients and the shared package](#clients-and-the-shared-package)
- [Routes, audiences and guards](#routes-audiences-and-guards)
- [The signed-in frame](#the-signed-in-frame)
- [Client sessions and caches](#client-sessions-and-caches)
- [Lists, figures and currency](#lists-figures-and-currency)
- [Recovering a submitted company request](#recovering-a-submitted-company-request)
- [The shared register client layer](#the-shared-register-client-layer)
- [Signed-in page conventions](#signed-in-page-conventions)
- [Design tokens and themes](#design-tokens-and-themes)
- [TypeScript conventions](#typescript-conventions)
- [Pages](#pages)

## Clients and the shared package

There are three clients. `dashboard/` is the signed-in web app (React, React Router, TanStack Query,
Vite and Tailwind CSS v4). `mobile/` is the Expo React Native app
([mobile](mobile.md)). `site/` is the public website: React, TypeScript and Vite,
static output and no API calls.

`packages/shared` is consumed from source: `main` and `types` in its `package.json` point at
`src/index.ts`, which re-exports `constants`, `types`, `utils`, `services` and `hooks`; there is no
build step and no `dist/`. The `hooks` barrel ships `ApiClientProvider`/`useApiClient` and the shared
hooks, so `react` and `@tanstack/react-query` are `peerDependencies` supplied by the importing client.
The dashboard resolves the package through the root npm workspace link (`node_modules/@ledova/shared`
to `packages/shared`); Vite and `tsc -b` follow the symlink to its real path, so the sources are
transformed and type-checked as application code. Mobile resolves it through Metro with one copy of
each peer ([shared package resolution](mobile.md#shared-package-resolution)).
The public site cannot import the package, because its Docker context is `site/`.

Every client import is `from '@ledova/shared'`. Inside a workspace package, imports are relative and
never go through the package's own public barrel; `make check-self-imports` refuses such
self-imports. `packages/shared/src/services` holds the API call functions both clients share; each
takes the caller's axios instance as its first argument, so each client keeps its own interceptors.

The account audience (`company`, `investing` or both) selects navigation, not company authority.
Company actions follow the person's current appointments and the backend's checks remain
authoritative ([company authority boundaries](README.md#company-authority-boundaries)).
Clients scope caches and pending actions to the selected company and the session, and withhold
controls after a failed read.

## Routes, audiences and guards

The signed-in pages both clients share are listed once, in `DESTINATIONS`
(`packages/shared/src/constants/ui/destinations.ts`), each with its address, title and audience. The
dashboard builds its signed-in routes through `signedInRoutes` from `PAGES`
(`dashboard/src/routes/pages.tsx`), a map keyed by that table, so TypeScript refuses an entry without
a page or a page the table lacks. Each route hands its page the entry's title through `PageTitle`,
detail pages included; the web titles `home` Dashboard rather than the table's My shares, which
native uses. `/member-records` is an alias of `/home`, and `companyRegisterSetup` and
`companyRegisterImport` render the same page.

Two kinds of web route sit outside the table. The company dashboard, `/company/dashboard`, is
`COMPANY_DASHBOARD_PATH` in `dashboard/src/routes/companyDashboard.ts`, routed in
`dashboard/src/App.tsx` under `ProtectedRoute` with the `everyone` audience and the title Dashboard.
The sign-up steps are described [below](#sign-up-routes).

The audience is `everyone`, `investing` or `company`, and `canOpen(role, audience)` says who may open
a page: an investor opens the pages for everyone and for investing, a company those for everyone and
for companies, and a dual-role account all of them. A role outside the API's list opens only the
pages for everyone. `landingFor(role)` is Register (`/company/register`) for a company or dual-role
account and `/home` otherwise. The dashboard uses it for a refused address (replacing it), for a
signed-in visitor on the create-account page, when Market's `trading_enabled` flag is off
(`TradingRoute`), for a finished non-company account that opens a sign-up step, and for the
not-found page's link.

The web front door, `/` (`RootRedirect`), sends a signed-out visitor to sign in and an unfinished
account back into sign-up. For a finished account it confirms readable register access
(`useRegisterEntryAccess` in `dashboard/src/pages/company/register/useCompanyRegister.ts`: the first
page of readable register classes is not empty, or the person may personally administer one of their
companies, read across every page) and then opens `/company/dashboard` or `/home`. A failed check
offers Try again rather than assuming a personal account; account preference alone never selects a
company workspace. Successful sign-in navigates to `/`, so it makes the same choice.

Every signed-in route is guarded by `ProtectedRoute` (`dashboard/src/routes/ProtectedRoute.tsx`) with
its entry's audience:

- A signed-out visitor goes to sign in.
- Every page shows the session check until the profile is known, and an investing or company page
  until the role is known as well, so no page appears on the way.
- A signed-in account whose profile cannot be read sees an error with a way to try again
  (`AccountUnavailable`), not a guess. One whose role cannot be read, on an investing or company
  page, sees that the page cannot open yet, with Try again.
- Email verification issues a full session before sign-up is finished, so an account whose profile
  does not say `isSignupCompleted` goes back to `SIGNUP_RESUMES_AT`, the account-type step, the first
  after email verification; the later steps fill their forms from what was saved.
- A signed-in person who cannot open the page goes to `landingFor(role)`.

The guard decides pages, not data: the API still decides which rows a person sees, and answers 404
for a row it refuses.

The web sidebar (`dashboard/src/components/Sidebar`) names its items by `DESTINATIONS` key, or
`companyDashboard`, optionally with a section hash (`/company/register#awards`, `#documents`,
`/home#documents`). The company group appears only when `useRegisterEntry` confirms readable register
access, the investing group only for an investing account, and Market only while `trading_enabled`
is on. Register sections (`#awards`,
`#documents`, `#access`) switch the visible section without unmounting register forms or their
original-request recovery. The sidebar is 208 pixels wide (`lg:ml-52`), the phone drawer uses the
same width, and page content starts beside it in a bounded grid. What each item opens is described
in [the app at a glance](../business/README.md#the-app-at-a-glance).

Native stacks, tabs and sign-up screens are declared separately in `mobile/src/navigation`; the tab
bar and drawer reuse titles from `DESTINATIONS` ([navigation](mobile.md#navigation)).

### Sign-up routes

The eight steps after the create-account form are listed once, in `SIGNUP_STEPS`
(`dashboard/src/routes/signupRoutes.tsx`): email confirmation, account type, pre-screening, identity
verification, user profile, financial profile, company registration and review. `signupRoutes` places
every one inside `SignupRoute`: a company account that has finished sign-up goes to the company
dashboard and other finished accounts go to `landingFor(role)`, instead of reopening a step. An
account still signing up and a signed-out visitor move through them; a signed-in account whose
profile cannot be read sees `AccountUnavailable`. The create-account form (`/signup`) and sign-in sit
under `PublicOnlyRoute`, which sends a signed-in visitor to `landingFor(role)` and to `/`
respectively.

Email verification refreshes the session answer before it moves on, as sign-in does, so in the
in-app flow the steps read the profile once, before any form, and a later recheck of the session does
not take away a step being filled in. Email verification and sign-up completion issue the session and
await the explicit authentication refresh, and sign-up completion a fresh profile too, before
navigating; a failed refresh keeps the review step open with its error and a retry. The company
sign-up flow itself is described in
[company setup](../business/companies.md#company-signup).

## The signed-in frame

The signed-in frame (sidebar and phone bar, `dashboard/src/components/Layout.tsx`) appears only for a
signed-in account that has finished sign-up, which `useSignupFinished` decides; sign-in, sign-up and
everything else use the public layout, which has a footer. The frame marks itself with
`InSignedInFrame`, and a guarded page renders only inside it. The guard and the frame read the same
queries but hear about them separately, and the guard also re-renders when the role arrives, so it
can admit a page a moment before the frame appears. The page keeps showing the session check until
then, rather than rendering once in the public layout.

Since the sidebar's Sign out is not shown in the public layout, it gives any signed-in visitor a Sign
out button in its header through `AuthLayoutAction`, so an account still signing up can always leave.
The not-found page reads the same decision: inside the frame with a link to `landingFor(role)` for a
finished account, and otherwise in the public layout with a link to sign in or, for an account still
signing up, back into sign-up. It shows nothing until its own decision and the frame's agree, so,
like a guarded page, it never appears in the wrong layout for a moment.

The frame also mounts the Buy crypto and Send flows (`BuyCryptoProvider`, `SendTransferProvider`), so
an open flow survives Wallets reloading its wallet list and the person leaving Wallets.

## Client sessions and caches

The session itself (tokens, cookies, CSRF and revocation) is described in
[authentication](security.md#authentication-and-sessions).

`packages/shared/src/hooks/useAuth.ts` owns the authentication query and exports `AUTH_QUERY_KEY`.
`ApiClientProvider` supplies each client's API instance, and that client's `QueryClient` sets focus
and reconnect behaviour: the dashboard revalidates on both, mobile only on reconnect. Authentication
does not retry a failed request automatically; a later mount may recheck a previous failure. The hook
exposes fetching separately from the first session check, so a retry after a failure does not restore
initial loading, and public forms keep their nested authentication consumers mounted so a failure
cannot create a remount loop. The protected route hides protected content while a cached negative is
rechecked and redirects after a negative answer or failure.

Signing in, and verifying an email, which also signs a new person in, remove every cached query except
the authentication query; signing out and account deletion clear the whole cache. A new person is
therefore never guarded by, or signs up against, the previous person's account. Mobile adds a session
epoch that every read and write carries
([session scope](mobile.md#session-scope)).

Both clients use the shared `useUserPreferences` and `useCurrency` hooks. Preference and exchange-rate
queries start only after authentication, and cached preferences are hidden again when authentication
is lost.

## Lists, figures and currency

Every list follows the same rules:

- It reads every page, or loads further pages on request. A failed first read offers a retry rather
  than an empty list.
- A failed later page keeps the known rows and labels the list incomplete (`useLaterPages`).
- A failed refresh withholds stale rows and their actions until a retry succeeds, and a failed or
  inconsistent read withholds totals and charts rather than drawing a partial picture.
- An open form keeps its draft through a failed refresh while holding its write until a read
  succeeds.
- A failed file delivery is distinguished from an unavailable stored document. On mobile a company,
  account or session change retires a pending document action.

A list that reads every page does so through `readEveryPage`
(`packages/shared/src/utils/pagination.ts`): it asks for page 1, follows each `next` link by the page
number the link names, and returns the rows in page order. A read fails whole when a page fails or
when a `next` link names no later page, so a stalled or malformed link is never presented as the end
of the list. Lists that load further pages on request check each page's link the same way with
`assertNextPageAdvances`.

Exact decimal strings are kept for share counts, prices and amounts; a legacy count outside
JavaScript's safe range is marked unavailable rather than rounded. Share arithmetic uses whole
integers (`wholeShares`, `requestShares`), and a quantity or resulting cap above `MAX_REQUEST_SHARES`
(2,147,483,647) is refused rather than rounded. Prices and totals in AUD are computed in integer cents
(`priceCents`), and market quantities are exact integer strings within the signed 64-bit storage
bound.

Market values are shown in AUD: `useCurrency` converts the API's US-dollar values at the current
exchange rate, shows a dash while the rate is unknown, and neither client offers another currency. An
offering's prices and an application's amounts are in the offering's currency: a new offering is
priced in AUD, and one created before that rule keeps the currency it was given
([decision](../decisions.md#the-signed-in-app)). Every amount names its currency (`formatMoney`).
Charts are drawn without a chart library; do not add one.

## Recovering a submitted company request

A company-run request (a register command, an award, a vesting event, a grant, an external allotment
or an issue decision) may reach the server even when its reply is lost. Forms on both clients follow
the same recovery rules, so an uncertain reply never becomes a second effect:

- A form keeps its original command, operation identifier, appointment and, for a decision, its
  preview and decision key after an interrupted response or a failed refresh. Its inputs and the
  company selector stay held until that command is recovered.
- A successful write followed by a failed refresh never causes another upload or submission. A form
  that takes an upload keeps its retry key and confirmed receipt.
- A form reuses its operation only for an identical request; a changed retry is refused, and retrying
  the same applied decision creates no second effect. After a conflict it takes a new operation.
- A failed read, a refresh or a lost company appointment removes private fields, record contents,
  evidence actions and decision controls without discarding the unfinished command.
- Once current read access is confirmed again, recovery first looks up the exact original outcome,
  then resends the original request with its original appointment; it never prepares a new one. This
  works with a current register-read appointment even after preparation authority has ended, while
  fresh preparation still needs current preparation authority.
- If the original is absent, its unchanged request receives a definite refusal and a second current
  scoped read still finds it absent, the form releases its hold with a not-recorded message so it can
  be closed and reopened under current authority. A network failure or an unavailable read keeps the
  original request.
- Recovery lasts while the page stays open; leaving the page discards the local form. A refusal shows
  the server's words, and a refusal as not found shows that the appointment has gone, after which the
  form gives way to the read-only note.

The server side of this protocol is the
[company workflow API](backend.md#company-workflow-api).

## The shared register client layer

`packages/shared` holds the client layer for every company-run register command, on which both
clients' screens are built:

- a service for each list (with the company, share class, member and status filters each family
  takes), preview, decision, preparation and document download;
- a check of each prepared proposal against every field of its request (`isPreparedRegisterOpening`,
  `isPreparedRegisterParticularsChange`, `isPreparedRegisterLink` and their siblings for imports,
  corrections, grants, transfers, issues, paid issues, capital increases, pause changes, deployments
  and allotments), with an opening's or link's mapping narrowed at runtime and a link's address and
  member pairs compared in any order and letter case;
- the decision families that `useRegisterDecision` takes (`REGISTER_*_DECISIONS` and
  `COMPANY_WALLET_DECISIONS` in `packages/shared/src/hooks/useRegisterDecision.ts`) with the generic
  decision receipt check;
- copy with a sentence for every requirement a decision can leave unmet;
- the preparation destinations below.

| Command            | Preparation destination                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| Setup              | `/company/register/setup` (`companyRegisterSetup`)                             |
| Import             | `/company/register/:uuid/import` (`companyRegisterImport`)                     |
| Correction         | `/company/register/:uuid/correct/:entry` (`companyRegisterCorrection`)         |
| Opening            | `/company/register/:uuid/open` (`companyRegisterOpening`)                      |
| Grant              | `/company/register/:uuid/grant` (`companyRegisterGrant`)                       |
| Transfer           | `/company/register/:uuid/transfer` (`companyRegisterTransfer`)                 |
| Particulars change | `/company/register/members/:member/particulars` (`companyRegisterParticulars`) |
| Wallet links       | `/company/register/companies/:company/links` (`companyRegisterLinks`)          |

Setup is the import page without a class in its address: it chooses an existing share class or
creates a new one, then prepares the mirror import. Each preparation opens a page of its own; on
mobile it opens in the same stack.

Its helpers order an opening's holdings largest first by exact share count, check that every share
count is whole, label each mapped member once (by name, or numbered as an unnamed or a new member,
through `registerLinkMemberLabels` for links, so the page, the record and the preview give each
member the same label), and recognise a holdings-moved refusal by its `opening_holdings_moved` code
(`REGISTER_OPENING_HOLDINGS_MOVED_CODE`). Each wallet's proof is worded as the holder's own proof on
Ledova, never as a verification by Ledova.

Every decision opens the shared preview-first dialog, `useRegisterDecision`, which previews the exact
decision, its unmet requirements in words and what applying records, takes a reason of up to 1,000
characters for a rejection, and confirms it with a retry key reused only for the same preview while
the step's appointment is still the one previewed; on mobile the dialog closes when a refresh
withdraws its step. A discrepancy is acknowledged through `useDiscrepancyAcknowledgement` with a
reason of up to 1,000 characters; the dialog keeps the appointment it opened with and holds
confirmation if a refresh changes it. The forms each command takes are described on
[the Register page](../business/register.md#the-register-page).

## Signed-in page conventions

Every signed-in page renders in `Page` (`dashboard/src/components/Page.tsx`,
`mobile/src/components/Page.tsx`), and so do the route guard's waiting and failure states, so each
shows its page's title. On the web, use the existing `Page`, `Section`, `PageAction`, `Modal`,
`FIELD_CLASS` and `LABEL` (`dashboard/src/components/fieldClass.ts`). `Page narrow` bounds task forms,
settings and detailed records, including compact tables; ownership dashboards and wide tables use the
standard workspace width, and tables scroll within their card on small screens. Section spacing is
scoped to the signed-in frame; sign-up keeps its own presentation.

The title block is one title row holding the title and the page's actions, with the lede, one muted
sentence, directly under it when the page has one; a lede appears only where it says what the titles
do not. The first section follows at the same gap as between sections. On mobile `Page` is a scroll
view on the page ground whose header sets the title in Newsreader at `theme.fontSize.xxxxl`, then the
lede, then the screen actions as one wrapping row, because a phone's large title leaves no room
beside it; loading, access and failure states render under the same title, and the stack header above
carries no title of its own, only the menu or back button and, on a top-level screen, the bell.

The frame holds only the sidebar, or the phone's top bar, with the notification bell; it has no header
bar and no footer. The sidebar's list ends with Help & Support, and its foot names the person above
Sign out (`SignOutButton` in its sidebar variant); mobile's drawer has the same shape. The mobile
exceptions keep a frame of their own: Help & Support keeps its stack title; Send, Transfer, Verify
Wallet and Recovery Phrase are titled inside their `Panel` card (`mobile/src/components/panel`); Buy
crypto is its dialog over the bare page ground followed by the provider's web view.

Pages are built from the ledger blocks in `dashboard/src/components/Ledger.tsx` and
`mobile/src/components/Ledger.tsx`; each enforces one rule:

- `Section`: every section is its own raised card on the page ground (`bg-surface-raised`, a
  `border-border` hairline, `rounded-2xl` in the signed-in frame and `rounded-xl` outside it) with its
  Newsreader title inside. Forms and things to act on are cards too, and a group inside a card is set
  off by a rule or a small heading, never a nested card. An empty section keeps its real title with
  one muted sentence under it ("No activity yet.") and at most one action; a state is never a title.
- `Rows`: ruled label and value pairs, figures right-aligned in tabular numerals; every amount names
  its currency and share counts are whole numbers.
- `LinkRow`: the one place a page reaches each of its sub-pages and each neighbour a section points
  to; the whole row is the link, named after its destination, with optional detail lines and an
  aside. A destination the sidebar already reaches is not repeated in a title row; an underlined link
  is part of a sentence or opens an external resource.
- `PageAction` (`Action` on mobile): the button for whatever a page, section or row does,
  content-width wherever it sits: the title row for the page as a whole, including the way back to the
  parent page; inside a section for what that section does; in a row for what is done to that row's
  record alone. Nothing is selected before acting and no toolbar waits under a list.
- `Disclosure`: a row that opens in place, a button with `aria-expanded` (expanded or collapsed on
  mobile) and a leading caret controlling the detail directly under it, held only while open. Lists
  are read, filtered and sorted in place: an entry opens under its own row and leaves other open
  entries as they are. Activity's filter and Wallets' sort (shown once a chain holds two wallets) are
  a `Disclosure` at the top of the card that names what it applies and, applied or cleared, closes
  itself and every open entry and returns focus to its button. Open rows are kept with `useOpenRows`
  from `@ledova/shared`. A dialog is kept for work that sets the page aside: a form that creates or
  changes something, a signing step or a confirmation.
- `SwitchRow`: the one control for a setting that takes effect as soon as it changes (Transaction
  alerts; Dark theme; Show this company to eligible investors). The On/Off pill or native switch is
  the switch itself (`role="switch"`), its `aria-checked` is the saved value, it is disabled while
  saving, keeps the saved value when refused, and the refusal is an alert in the same card. A choice
  saved with a form stays a checkbox.
- `Status` (web): a status in words after a small mark; screen readers read only the words.
  `Timeline` (web): each event with its date.
- `Choice` (mobile): an outlined choice marked selected.

A dialog (`Modal` in `dashboard/src/components/Modal`; `CustomModal` in `mobile/src/components/modal`)
is the same card over the dimmed page: its Newsreader title labels it (on mobile marked as a header
and `accessibilityViewIsModal`, since React Native cannot make it the accessible name), its body
scrolls inside the card, and `ModalActions` ends it as one right-aligned row of content-width
actions, a plain Cancel, Close or Back before the one primary action, wrapping rather than
stretching. On mobile the backdrop closes the dialog, and a busy dialog holds the backdrop, Android
Back and Cancel.

Inside cards and dialogs nothing is boxed: fields share the card's surface with a hairline border
(`rounded-lg border border-border bg-surface-raised`; `useDialogStyles` on mobile), steps are numbered
lines, a choice is outlined and marked selected, and warnings and errors are text, warning-coloured
beside an icon or error-coloured, rather than tinted boxes. The exceptions are the tinted
extraction-status pill beside a saved payslip on Profile and the dashed upload area that marks where a
file goes. Addresses, hashes and signing summaries use the monospaced face (`font-mono`;
`theme.fontFamily.mono`). Sign-in and the sign-up steps hold their forms in the same card under the
same titles but keep their tinted fields and boxed outcomes, as the identity check's outcomes do.

Show core ownership, status and next actions directly, with one page heading, nearby labels and
values, readable wrapping, balanced field groups and one primary next action. Put full audit
identifiers and optional supporting detail behind the existing detail controls. Remove duplicated
titles, repeated general explanations and simultaneous read and edit views. Keep action-specific
authority, privacy, incomplete-data and original-request recovery guidance visible when relevant. A
presentation change must not reset pending work, hide uncertainty or change what a confirmation
authorises.

## Design tokens and themes

`packages/shared/src/constants/ui/design-tokens.ts` is the single source of design tokens.
`buildColors()` turns a palette into one semantic colour vocabulary that the dashboard, the public
site and mobile all use: `surface`, `text`, `brand`, `border` and the status colours. It builds both
themes with the same names, `THEMES.paper` (from a private paper palette) and `THEMES.dark`. Colours
come from these semantic tokens and their roles, so components need no per-theme classes, and every
colour must read in both Paper and Dark.

On the web, text utilities follow the suffix: a `-light` colour (`text-brand-light`,
`text-error-light`) is text on a surface, while the bare name and `-mid` (`bg-brand`,
`border-brand-mid`, `ring-brand-mid`) are solid fills under white text, borders and rings; translucent
washes and outlines use either. `brand-subtle` is the text hover and the text on `brand-tint`, and
`brand-hover` the fill hover. Mobile reads the same tokens with the same roles
([mobile theme](mobile.md#theme-and-appearance)).

`make generate-tokens` runs `packages/scripts/generate-css-tokens.mjs` with `tsx` and writes
`dashboard/src/styles/tokens.css` and `site/src/tokens.css`, raw generator output and
prettier-ignored. That `@theme` block carries the Paper semantic colours, the spacing steps and the
`lg` and `xl` shadows; Tailwind v4 derives the utility classes from it (`bg-surface-base`,
`text-text-body`, `border-border-subtle`), and web radii, type sizes and font weights come from
Tailwind's defaults. After it the generator writes a `:root[data-theme='dark']` block that sets
`color-scheme: dark` and gives every colour variable its Dark value, and it fails if the two themes
would emit different variables. The public site uses the same semantic names as the dashboard, plus
`border-border-faint` and `brand-tint`, which also marks the dashboard's active sidebar item in Dark.
Never edit either file: `make check`, which CI runs, compares them with the generator's `--check`
output and fails on any drift.

The web clients have two looks: Paper, the default, and Dark. Dark is the `data-theme="dark"`
attribute on `<html>`; without it a page is Paper. A short script in each `index.html` reads
`ledova.theme` (`THEME_STORAGE_KEY`) from the browser's storage before the first paint and applies
Dark, with its `theme-color`, only for the exact value `dark`; a missing, unknown or unreadable value
means Paper, as `parseTheme` decides, and the `ledova-theme` key of an earlier, removed switch is not
read. The choice is written only when someone picks a theme, stays in that browser through reloads
and sign-out, and is not stored on the account.

The dashboard's switches are Settings > Appearance > Dark theme and the `ThemeToggle` icon in the
signed-out and sign-up header, the signed-in desktop sidebar's account footer and the small-screen
signed-in header, all through `dashboard/src/hooks/useTheme.ts`. The public site's navbar toggle uses
`site/src/theme.ts`, which repeats the dashboard's key, parsing rule and theme colours because the
site cannot import `@ledova/shared`. Browser storage is per origin: where the site and the app are
served from one origin, as on ledova.io, one choice serves both; on separate origins, such as local
development, each keeps its own.

Both web stylesheets define a `dark:` variant that follows `data-theme`, never the operating-system
setting, and it is kept for theme-specific adjustments: `QRCodeFrame` gives QR codes a white quiet
zone, the active sidebar item uses `bg-brand-tint`, and the signed-out primary buttons drop their
green glow. The identity check's widget opens in its dark theme when the page is Dark. Both web
clients bundle Newsreader for display text and Instrument Sans for everything else
(`@fontsource-variable`).

## TypeScript conventions

Types and interfaces use PascalCase and properties camelCase; query parameters follow the API's
snake_case names. Compose pagination, ordering and date-range types from shared API types. Entities
use their bare name, queries `{Entity}QueryParams`, and non-CRUD calls `{Action}Request` /
`{Action}Response`. The shared ESLint rules (`packages/shared/eslint-naming-rules.js`) enforce the
naming rules, the snake_case query-parameter fields and the utility-type preferences as errors on the
shared `src/types/` files.

Clients and shared types are API consumers: their keys, statuses and URLs are contracts
([principles](README.md#principles)). The generated contracts in
`packages/shared/src/generated/api.ts` come from the committed OpenAPI document, and the shared,
dashboard and mobile compiler checks validate consumers against them
([the API type drift gate](gates.md#the-api-type-drift-gate)).

## Pages

Each page's purpose, audience and rules are in its business section. The audience column is the
`DESTINATIONS` audience; the API still decides which rows each person sees.

| Page                                                        | Routes                                                                                                    | Audience          | Business section                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| Company dashboard                                           | `/company/dashboard` (web only)                                                                           | everyone          | [The app at a glance](../business/README.md#the-app-at-a-glance)               |
| Personal dashboard (My shares on native)                    | `/home`, `/home#documents`, alias `/member-records`                                                       | everyone          | [The app at a glance](../business/README.md#the-app-at-a-glance)               |
| Register, Employee awards, Documents, member access         | `/company/register` and `#awards`, `#documents`, `#access`; `/company/register/:uuid`; preparation routes | everyone          | [The Register page](../business/register.md#the-register-page)                 |
| Company, Representative authority, Company team, Activation | `/company`, `/company/authority` (company), `/company/team`, `/company/listing`                           | everyone          | [The Company page](../business/companies.md#the-company-page)                  |
| Company eligibility                                         | `/company/eligibility`                                                                                    | everyone          | [The Verification page](../business/participants.md#the-verification-page)     |
| Offerings                                                   | `/company/offering`                                                                                       | company           | [The Offerings page](../business/issuing-shares.md#the-offerings-page)         |
| Published to your members, Notices                          | `/company/publications` (company), `/publications`                                                        | company, everyone | [The Published page](../business/publications.md#the-published-page)           |
| Wallet shares                                               | `/wallets/holdings`                                                                                       | everyone          | [The Wallet shares page](../business/member-records.md#the-wallet-shares-page) |
| Verification, Your company eligibility                      | `/investor-eligibility`, `/eligibility-requests`                                                          | investing         | [The Verification page](../business/participants.md#the-verification-page)     |
| Directory, Applications                                     | `/directory`, `/directory/:uuid`, `/subscriptions`, `/subscriptions/:uuid`                                | investing         | [The Directory page](../business/participants.md#the-directory-page)           |
| Market                                                      | `/trading`, while `trading_enabled` is on                                                                 | investing         | [The Market page](../business/trading.md#the-market-page)                      |
| Wallets                                                     | `/wallets`                                                                                                | everyone          | [The Wallets page](../business/trading.md#the-wallets-page)                    |
| Activity                                                    | `/transactions`                                                                                           | everyone          | [The Activity page](../business/trading.md#the-activity-page)                  |
| Profile, Settings                                           | `/user-profile`, `/settings`                                                                              | everyone          | [Profile and Settings](../business/participants.md#profile-and-settings)       |

### Page mechanics

Page-specific technical notes, beyond the conventions above:

- Company dashboard: reads the scoped register API for the selected company (`useCompanyRegister`)
  and computes issued-share totals, holders deduplicated across classes and each class's shares with
  `BigInt` arithmetic (`dashboard/src/pages/company/dashboard/summary.ts`); it draws each class's
  donut itself.
- Personal dashboard: reads the person's own member projection, never company totals or other
  shareholders; the first own class's history loads when a member record opens, and choosing another
  class reads that class's own entries.
- Register: the web reads the person's appointments through the same account-bound cache as Company
  team; mobile Register reads them itself and hides every register action while they cannot be read.
  Both read them again after a revocation on Company team or Representative authority, after a
  decision, preview or acknowledgement the server refuses, after a waiting-wallets read refused as not
  found, on mobile after a pull to refresh, and, for every command but imports, after a recorded
  decision; a recorded import decision refreshes the imports, the register and its entries. A class's
  entries load newest first a page at a time with Load more: an entry a later page repeats is listed
  once, a page with a share change that is not whole fails, and an entry's corrected or reversing
  entry reads as not loaded yet until its page arrives. A proposal of another company or class, a
  mapping or holding that cannot be read, and a correction lookup that answers with entries it was not
  asked for fail the read. Every read, upload, preview, decision, acknowledgement and preparation is
  bound to the signed-in account and the session the screen opened under, and each repeated control
  is named for screen readers after its visible label and the entry, proposal or discrepancy it
  concerns. Native register section parameters switch the visible section while keeping the register
  subtree mounted.
- Company: reads the selected company's complete detail and every page of its share classes and
  team; an edit sends only changed fields.
- Offerings: the create and edit forms check price, ordered bounds, dates and the available settlement
  choices before submission and set the window in the device's local time on mobile; Add documents
  sends only the new choices, and a dialog opened on an offering that has since changed state sends
  nothing.
- Published to your members: reads the selected company's publications with `issuer` set, every page,
  so the card title carries the complete count.
- Wallet shares: reads every page of the person's wallets and lists one row per asset across chains,
  using the API's current class and company names and the asset's combined name otherwise, so a
  missing class lookup never removes a holding; whole share counts are added without floating-point
  conversion. Only a known investing role reads the applicant-filtered application list.
- Verification: the claim history has a cache of its own, and every claim page loads before a
  submission is offered, so a pending claim on a later page still prevents a second one.
- Directory and Applications: a draft application reads every verified Base wallet page, computes its
  fixed-price total in integer cents and is scoped to the offering, so a replacement offering starts
  fresh; the server still selects the applicant and enforces quantity and eligibility. Applications
  shows the recorded values unaltered, independent of current Directory access, and a copy failure
  keeps the value available.
- Market: owned order history reads independently of listed classes and wallets. Saved orders,
  cancellations, changes, signatures and approvals are records on the device for the signed-in
  account ([create-order recovery](mobile.md#create-order-recovery),
  [order submissions](trading-protocols.md)), read when Market loads and after each
  recovery, with one refresh that reads all three again.
- Wallets: reads every wallet page into a ledger of its own. Native balances show at most eight
  decimal places (`formatCryptoBalance` in `packages/shared/src/utils/formatting.ts`), ordered by
  decimal-string comparison (`sortWallets` in `packages/shared/src/hooks/useWalletSort.ts`). On the
  web every Sync waits while one runs. Add, edit, derive and delete keep refused input and stay open
  until success; imports run one address at a time and remember confirmed additions for retry within
  the same import; mobile's software registration waits for the server after the authenticated local
  seed storage. A purchase page that cannot be opened shows the server's reason (`readApiError` in
  `packages/shared/src/utils/errors.ts`) or a fixed message, never a proxy's error page. When Send
  or Buy crypto decides whether to skip its wallet chooser, the web counts the wallets last read even
  while re-reading, and mobile asks which wallet until the read has finished; mobile's Send forms keep
  Continue unavailable until the chosen wallet's balances are read.
- Activity: the history read does not depend on the wallet filter read; filters use only supported API
  fields, with date bounds covering whole local days (block time on mobile, excluding records without
  one).
- Profile and Settings: the transaction-alerts switch is the `transactionAlerts` field of the one
  user preferences record, read through `useUserPreferences` and saved with a partial `POST` to
  `/api/user-preferences/`; mobile distinguishes an unavailable preferences record from disabled
  alerts. Account deletion clears the client's cached account data after the server confirms.

Next: [mobile](mobile.md), [authentication](security.md#authentication-and-sessions),
[company workflow API](backend.md#company-workflow-api) and
[testing](testing.md).
