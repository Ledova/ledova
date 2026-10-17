# Frontend

[Engineering](README.md) · [Documentation](../README.md)

How the web dashboard, the public site and the shared TypeScript package are built, and the
conventions every signed-in page follows on web and mobile. The mobile app's own architecture is in
[mobile](mobile.md); what each page does is in the business section linked from [Pages](#pages).

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

`dashboard/` is the signed-in web app (React, React Router, TanStack Query, Vite and Tailwind CSS
v4), `mobile/` the Expo React Native app ([mobile](mobile.md)), and `site/` the public website
(React, TypeScript and Vite; static output, no API calls).

`packages/shared` is consumed from source: `main` and `types` in its `package.json` point at
`src/index.ts`, which re-exports `constants`, `types`, `utils`, `services` and `hooks`, with no
build step or `dist/`. The `hooks` barrel ships `ApiClientProvider`/`useApiClient` and the shared
hooks, so `react` and `@tanstack/react-query` are `peerDependencies` supplied by the importing
client. The dashboard resolves the package through the root npm workspace link
(`node_modules/@ledova/shared` to `packages/shared`), and Vite and `tsc -b` follow the symlink, so
the sources are transformed and type-checked as application code. Mobile resolves it through Metro
([shared package resolution](mobile.md#shared-package-resolution)). The site cannot import it,
because its Docker context is `site/`.

Clients import `from '@ledova/shared'`; inside a workspace package, imports are relative and never
go through the package's own barrel (`make check-self-imports` refuses them). The API call functions
in `packages/shared/src/services` take the caller's axios instance first, so each client keeps its
own interceptors.

The account audience (`company`, `investing` or both) selects navigation, not company authority
([company authority boundaries](README.md#company-authority-boundaries)). Clients scope caches and
pending actions to the selected company and the session.

## Routes, audiences and guards

`DESTINATIONS` (`packages/shared/src/constants/ui/destinations.ts`) lists the signed-in pages both
clients share with their address, title and audience. The dashboard builds its routes with
`signedInRoutes` from `PAGES` (`dashboard/src/routes/pages.tsx`), a map keyed by that table, so
TypeScript refuses an entry without a page or a page without an entry. Each route, detail pages
included, gets the entry's title through `PageTitle`; the web titles `home` Dashboard, native My
shares. `/member-records` is an alias of `/home`, and `companyRegisterSetup` and
`companyRegisterImport` render the same page. Outside the table sit the
[sign-up steps](#sign-up-routes) and `/company/dashboard` (`COMPANY_DASHBOARD_PATH` in
`dashboard/src/routes/companyDashboard.ts`, routed in `dashboard/src/App.tsx` under `ProtectedRoute`
with audience `everyone` and title Dashboard).

`canOpen(role, audience)` lets an investor open `everyone` and `investing` pages, a company
`everyone` and `company` pages, and a dual-role account all; a role outside the API's list opens
only `everyone` pages. `landingFor(role)` is `/company/register` for a company or dual-role account
and `/home` otherwise. It receives a refused address (replacing it), a signed-in visitor on the
create-account page, Market while `trading_enabled` is off (`TradingRoute`) and a finished
non-company account that opens a sign-up step.

`/` (`RootRedirect`) sends a signed-out visitor to sign in and an unfinished account into sign-up. A
finished account opens `/company/dashboard` when `useRegisterEntryAccess`
(`dashboard/src/pages/company/register/useCompanyRegister.ts`) confirms readable register access
(the first page of readable register classes is not empty, or the person may personally administer
one of their companies, read across every page) and `/home` otherwise; a failed check offers Try
again. Sign-in navigates to `/`.

`ProtectedRoute` (`dashboard/src/routes/ProtectedRoute.tsx`) guards each signed-in route with its
entry's audience:

- A signed-out visitor goes to sign in.
- The session check shows until the profile, and on an investing or company page the role, is known,
  so no page appears on the way.
- An unreadable profile (`AccountUnavailable`), or an unreadable role on an investing or company
  page, shows an error with Try again rather than a guess.
- A profile without `isSignupCompleted` returns to `SIGNUP_RESUMES_AT`, the account-type step,
  because email verification issues a full session before sign-up finishes; later steps refill their
  forms from what was saved.
- A person who cannot open the page goes to `landingFor(role)`.

The guard decides pages, not data: the API decides which rows a person sees, answering 404 for a
refused row.

The sidebar (`dashboard/src/components/Sidebar`) names items by `DESTINATIONS` key, or
`companyDashboard`, optionally with a hash (`/company/register#awards`, `#documents`,
`/home#documents`). Its company group follows `useRegisterEntry`, its investing group the investing
role and Market `trading_enabled`
([the app at a glance](../business/README.md#the-app-at-a-glance)). Settings opens `/settings` and
stays marked active on `/company`, `/company/team`, `/company/authority` and
`/company/register#access`, which the Settings page's Member access row opens. The register hashes switch the visible view
without unmounting register forms or their recovery ([page mechanics](#page-mechanics)). The sidebar
and phone drawer are 208 pixels wide (`lg:ml-52`), with page content beside them in a bounded grid.
Native navigation is declared separately ([navigation](mobile.md#navigation)).

### Sign-up routes

`SIGNUP_STEPS` (`dashboard/src/routes/signupRoutes.tsx`) lists the eight steps after the
create-account form: email confirmation, account type, pre-screening, identity verification, user
profile, financial profile, company registration and review. `signupRoutes` wraps each in
`SignupRoute`, which sends a finished company account to the company dashboard and other finished
accounts to `landingFor(role)`, lets an unfinished account or a signed-out visitor through, and
shows `AccountUnavailable` when the profile cannot be read. The create-account form (`/signup`) and
sign-in sit under `PublicOnlyRoute`, which sends a signed-in visitor to `landingFor(role)` and to
`/` respectively.

Email verification and sign-up completion issue the session and await the explicit authentication
refresh (sign-up completion a fresh profile too) before navigating, as sign-in does, so the steps
read the profile once, before any form, and a later recheck cannot take away a step being filled in.
A failed refresh keeps the review step open with its error and a retry
([company signup](../business/companies.md#company-signup)).

## The signed-in frame

The frame (`dashboard/src/components/Layout.tsx`) appears only for a signed-in account that has
finished sign-up (`useSignupFinished`); everything else uses the public layout, which has a footer.
The frame is only the sidebar, or the phone's top bar, with the notification bell.

The frame marks itself with `InSignedInFrame`, and a guarded page renders only inside it. The guard
can admit a page a moment before the frame appears (it hears the same queries separately and
re-renders when the role arrives), so the page shows the session check until then rather than
rendering once in the public layout. The not-found page waits the same way, then shows inside the
frame with a link to `landingFor(role)`, or in the public layout with a link to sign in or back into
sign-up. The public layout gives any signed-in visitor Sign out (`AuthLayoutAction`), so an account
still signing up can always leave.

The frame also mounts the Buy crypto and Send flows (`BuyCryptoProvider`, `SendTransferProvider`),
so an open flow survives Wallets reloading its list or being left.

## Client sessions and caches

The session itself is in [authentication](security.md#authentication-and-sessions);
`packages/shared/src/hooks/useAuth.ts` owns the authentication query (`AUTH_QUERY_KEY`).
`ApiClientProvider` supplies each client's API instance; the dashboard's `QueryClient` revalidates
on focus and reconnect, mobile's (`mobile/App.tsx`) only on reconnect. Authentication does not retry
a failed request automatically; a later mount may recheck. The hook exposes fetching separately from
the first session check, so a retry does not restore initial loading, and public forms keep their
nested authentication consumers mounted so a failure cannot create a remount loop. The protected
route hides protected content while a cached negative is rechecked and redirects after a negative
answer or failure.

On the web, signing in and verifying an email (which also signs a new person in) remove every cached
query except authentication; mobile clears the whole cache whenever the sign-in screen gains focus.
Signing out and account deletion clear the whole cache on both, so a new person is never guarded by,
or signs up against, the previous person's account. Mobile adds a session epoch to every read and
write ([session scope](mobile.md#session-scope)).

The shared `useUserPreferences` and `useCurrency` queries start only after authentication, and
cached preferences are hidden again when authentication is lost.

## Lists, figures and currency

Every list follows these rules:

- It reads every page, or loads further pages on request; a failed first read offers a retry, not an
  empty list.
- A failed later page keeps the known rows and labels the list incomplete (`useLaterPages`).
- A failed refresh withholds stale rows and their actions until a retry succeeds; a failed or
  inconsistent read withholds totals and charts.
- An open form keeps its draft through a failed refresh but holds its write until a read succeeds.
- A failed file delivery is distinguished from an unavailable stored document.

`readEveryPage` (`packages/shared/src/utils/pagination.ts`) asks for page 1, follows each `next`
link by the page number it names and returns the rows in page order. It fails whole when a page
fails or a `next` link names no later page, so a stalled or malformed link is never taken for the
end. Lists loaded on request check each link with `assertNextPageAdvances`.

Share counts, prices and amounts stay exact decimal strings; a legacy count outside JavaScript's
safe range is marked unavailable, not rounded. Share arithmetic uses whole integers (`wholeShares`,
`requestShares`), and a quantity or resulting cap above `MAX_REQUEST_SHARES` (2,147,483,647) is
refused. AUD prices and totals are computed in integer cents (`priceCents`), and market quantities
are exact integer strings within the signed 64-bit storage bound.

Market values are shown in AUD: `useCurrency` converts the API's US-dollar values at the current
rate, shows a dash while it is unknown and offers no other currency. Offering prices and application
amounts carry their offering's currency
([offerings](../business/issuing-shares.md#creating-and-submitting-an-offering)), and every amount
names its currency (`formatMoney`). Charts use no chart library; do not add one.

## Recovering a submitted company request

Any company-run request (register command, award, vesting event, grant, external allotment or issue
decision) may reach the server though its reply is lost. Forms on both clients recover the same way,
so an uncertain reply never becomes a second effect:

- A form keeps its original command, operation identifier, appointment and, for a decision, its
  preview and decision key after an interrupted response or a failed refresh. Its inputs and the
  company selector stay held until that command is recovered.
- A successful write followed by a failed refresh never causes another upload or submission; a form
  that takes an upload keeps its retry key and confirmed receipt.
- A form reuses its operation only for an identical request and takes a new one after a conflict.
- A failed read, a refresh or a lost company appointment removes private fields, record contents,
  evidence actions and decision controls without discarding the unfinished command.
- Once current read access is confirmed again, recovery first looks up the exact original outcome,
  then resends the original request with its original appointment; it never prepares a new one, so
  it works after preparation authority has ended.
- If the original is absent, its unchanged request receives a definite refusal and a second current
  scoped read still finds it absent, the form releases its hold with a not-recorded message so it
  can be closed and reopened under current authority. A network failure or an unavailable read keeps
  the original request.
- Recovery lasts while the page stays open; leaving discards the local form. A refusal shows the
  server's words; a refusal as not found shows that the appointment has gone, and the form gives way
  to the read-only note.

The server side, including how identical and changed retries are answered, is the
[company workflow API](backend.md#company-workflow-api).

## The shared register client layer

`packages/shared` holds the client layer for every company-run register command:

- a service for each list, preview, decision, preparation and document download;
- a check of each prepared proposal against every field of its request (`isPreparedRegisterOpening`,
  `isPreparedRegisterParticularsChange`, `isPreparedRegisterLink` and siblings for imports,
  corrections, grants, transfers, issues, paid issues, capital increases, pause changes, deployments
  and allotments), narrowing an opening's or link's mapping at runtime and comparing a link's
  address and member pairs in any order and letter case;
- the decision families for `useRegisterDecision` (`REGISTER_*_DECISIONS` and
  `COMPANY_WALLET_DECISIONS` in `packages/shared/src/hooks/useRegisterDecision.ts`) with the generic
  receipt check;
- copy with a sentence for every requirement a decision can leave unmet.

Each preparation is a page of its own (on mobile, in the same stack), a `companyRegister*` entry in
`DESTINATIONS`: `/company/register/setup`; import, correction, opening, grant and transfer under
`/company/register/:uuid/` (`import`, `correct/:entry`, `open`, `grant`, `transfer`); particulars
changes at `/company/register/members/:member/particulars`; and wallet links at
`/company/register/companies/:company/links`. Setup is the import page without a class in its
address: it chooses or creates a share class, then prepares the mirror import.

The helpers order an opening's holdings largest first by exact share count, check that every count
is whole, label each mapped member once (by name, or numbered as an unnamed or new member;
`registerLinkMemberLabels` for links) so the page, the record and the preview agree, and recognise a
holdings-moved refusal by its `opening_holdings_moved` code
(`REGISTER_OPENING_HOLDINGS_MOVED_CODE`). A wallet's proof is worded as the holder's own proof on
Ledova, never as a verification by Ledova.

Every decision opens the preview-first dialog, `useRegisterDecision`. It previews the exact
decision, its unmet requirements in words and what applying records, takes a rejection reason
([how a company decision works](../business/README.md#how-a-company-decision-works)), and confirms
with a retry key reused only for the same preview while the step's appointment is still the one
previewed; on mobile it closes when a refresh withdraws its step. `useDiscrepancyAcknowledgement`
takes the reason for
[acknowledging a discrepancy](../business/register.md#acknowledging-a-discrepancy), keeps the
appointment it opened with and holds confirmation if a refresh changes it. Form inputs are described
with each procedure in [the register of members](../business/register.md).

## Signed-in page conventions

Every signed-in page, and the guard's waiting and failure states, render in `Page`
(`dashboard/src/components/Page.tsx`, `mobile/src/components/Page.tsx`) under the page's title. Web
forms use `FIELD_CLASS` and `LABEL` (`dashboard/src/components/fieldClass.ts`). `Page narrow` bounds
task forms, settings and detailed records, including compact tables; ownership dashboards and wide
tables take the standard workspace width, and tables scroll within their card on small screens.
Section spacing is scoped to the frame; sign-up keeps its own presentation.

The title row holds the title and the page's actions, with a one-sentence muted lede under it only
where it adds to the titles. The first section follows at the same gap as between sections (`Page`
is one flex column with a single gap; add no margin under the title). On mobile `Page` is a scroll view on the page ground: the title
(Newsreader, `theme.fontSize.xxxxl`), the lede, then the actions as one wrapping row, since a
phone's large title leaves no room beside it; the stack header holds only the menu or back button
and, on a top-level screen, the bell. Mobile screens framed differently: Help & Support keeps its
stack title; Send, Transfer, Verify Wallet and Recovery Phrase are titled inside their `Panel` card
(`mobile/src/components/panel`); Buy crypto is its dialog over the bare page ground, then the
provider's web view.

The ledger blocks (`dashboard/src/components/Ledger.tsx`, `mobile/src/components/Ledger.tsx`) each
enforce one rule:

- `Section`: a raised card on the page ground (`bg-surface-raised`, a `border-border` hairline,
  `rounded-2xl` in the frame, `rounded-xl` outside it) with its Newsreader title inside. Forms and
  things to act on are cards too; a group inside a card gets a rule or a small heading, never a
  nested card. An empty section keeps its real title, one muted sentence ("No activity yet.") and at
  most one action; a state is never a title.
- `Rows`: ruled label and value pairs, figures right-aligned in tabular numerals.
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
- `Status` (web) is words after a small mark, read as words only; `Timeline` (web) dates each event;
  `Choice` (mobile) is an outlined choice marked selected.

A dialog (`Modal` in `dashboard/src/components/Modal`; `CustomModal` in
`mobile/src/components/modal`) is the same card over the dimmed page, labelled by its Newsreader
title (on mobile a header with `accessibilityViewIsModal`, since React Native cannot make it the
accessible name). Its body scrolls inside, and `ModalActions` ends it with one right-aligned,
wrapping row of content-width actions: a plain Cancel, Close or Back, then the one primary action.
On mobile the backdrop closes it; a busy dialog holds the backdrop, Android Back and Cancel.

Inside cards and dialogs nothing is boxed: fields share the card's surface with a hairline border
(`rounded-lg border border-border bg-surface-raised`; `useDialogStyles` on mobile), steps are
numbered lines, and warnings (beside an icon) and errors are coloured text, not tinted boxes. The
exceptions are the tinted extraction-status pill beside a saved payslip on Profile, the dashed
upload area, and sign-in, the sign-up steps and the identity check's outcomes, which keep tinted
fields and boxed outcomes within the same cards and titles. Addresses, hashes and signing summaries
use the monospaced face (`font-mono`; `theme.fontFamily.mono`).

Show ownership, status and one primary next action directly, with labels beside their values and
balanced field groups; keep full audit identifiers and optional detail behind detail controls; never
repeat titles or general explanations or show read and edit views together. Action-specific
authority, privacy, incomplete-data and recovery guidance stays visible where relevant, and a
presentation change must not reset pending work, hide uncertainty or change what a confirmation
authorises.

## Design tokens and themes

`packages/shared/src/constants/ui/design-tokens.ts` is the single source of design tokens.
`buildColors()` turns a palette into the semantic colours the dashboard, the site and mobile all use
(`surface`, `text`, `brand`, `border` and the status colours), building both themes with the same
names: `THEMES.paper` (from a private paper palette) and `THEMES.dark`. Components need no per-theme
classes, and every colour must read in both Paper and Dark.

On the web a `-light` colour (`text-brand-light`, `text-error-light`) is text on a surface, while
the bare name and `-mid` (`bg-brand`, `border-brand-mid`, `ring-brand-mid`) are solid fills under
white text, borders and rings; translucent washes and outlines use either. `brand-subtle` is the
text hover and the text on `brand-tint`, and `brand-hover` the fill hover. Mobile uses the same
roles ([mobile theme](mobile.md#theme-and-appearance)).

`make generate-tokens` runs `packages/scripts/generate-css-tokens.mjs` with `tsx` and writes
`dashboard/src/styles/tokens.css` and `site/src/tokens.css` (raw output, prettier-ignored). Their
`@theme` block holds the Paper semantic colours, spacing steps and `lg` and `xl` shadows, from which
Tailwind v4 derives the utilities; web radii, type sizes and font weights are Tailwind's defaults. A
following `:root[data-theme='dark']` block sets `color-scheme: dark` and each colour variable's Dark
value; the generator fails if the themes would emit different variables. The site also uses
`border-border-faint` and `brand-tint`. Never edit either file: `make check`, which CI runs, fails
when they differ from the generator's `--check` output.

Before the first paint, a script in each `index.html` applies Dark (`data-theme="dark"` on `<html>`,
with its `theme-color`) only when `ledova.theme` (`THEME_STORAGE_KEY`) in browser storage is exactly
`dark`; anything else means Paper, the default (`parseTheme`), and the `ledova-theme` key of an
earlier, removed switch is not read. The choice is written only when someone picks a theme and stays
in that browser, not on the account, through reloads and sign-out.

The dashboard's switches (Settings > Appearance > Dark theme, and the `ThemeToggle` icon in the
signed-out and sign-up header, the desktop sidebar's account footer and the small-screen signed-in
header) use `dashboard/src/hooks/useTheme.ts`. The site's navbar toggle uses `site/src/theme.ts`,
which repeats the key, parsing rule and theme colours because the site cannot import
`@ledova/shared`. Storage is per origin, so one choice serves both where they share one, as on
ledova.io, and each keeps its own on separate origins, such as local development.

Both web stylesheets define a `dark:` variant that follows `data-theme`, never the operating-system
setting, for theme-specific adjustments: `QRCodeFrame`'s white quiet zone around QR codes, the
active sidebar item's `bg-brand-tint`, and signed-out primary buttons without their green glow. The
identity check's widget opens in its dark theme on Dark. Both web clients bundle Newsreader for
display text and Instrument Sans for everything else (`@fontsource-variable`).

## TypeScript conventions

Types and interfaces use PascalCase and properties camelCase; query parameters follow the API's
snake_case names. Compose pagination, ordering and date-range types from shared API types. Entities
use their bare name, queries `{Entity}QueryParams`, and non-CRUD calls `{Action}Request` /
`{Action}Response`. The shared ESLint rules (`packages/shared/eslint-naming-rules.js`) enforce these
names, the snake_case query-parameter fields and the utility-type preferences as errors on the
shared `src/types/` files.

Consumers type-check against the generated contracts in `packages/shared/src/generated/api.ts`
([principles](README.md#principles), [the API type drift gate](gates.md#the-api-type-drift-gate)).

## Pages

Each page links to its business section; the audience is the `DESTINATIONS` audience
([guards](#routes-audiences-and-guards)).

| Page and business section                                                                                | Routes                                                                          | Audience  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------- |
| [Company dashboard](../business/README.md#the-app-at-a-glance)                                           | `/company/dashboard` (web only)                                                 | everyone  |
| [Personal dashboard](../business/member-records.md#what-a-member-can-read)                               | `/home`, `/home#documents`, alias `/member-records`                             | everyone  |
| [Register, Employee awards, Documents, Member access](../business/register.md#the-register-page)         | `/company/register` and `#awards`, `#documents`, `#access`; preparation routes  | everyone  |
| [Share class](../business/register.md#the-share-class-page)                                              | `/company/register/:uuid`                                                       | everyone  |
| [Company, Representative authority, Company team, Activation](../business/companies.md#the-company-page) | `/company`, `/company/authority` (company), `/company/team`, `/company/listing` | everyone  |
| [Company eligibility](../business/participants.md#company-eligibility-decisions)                         | `/company/eligibility`                                                          | everyone  |
| [Offerings](../business/issuing-shares.md#the-offerings-page)                                            | `/company/offering`                                                             | company   |
| [Published to your members](../business/publications.md#the-published-page)                              | `/company/publications`                                                         | company   |
| [Notices](../business/publications.md#the-notices-page)                                                  | `/publications`                                                                 | everyone  |
| [Wallet shares](../business/member-records.md#the-wallet-shares-page)                                    | `/wallets/holdings`                                                             | everyone  |
| [Verification, Your company eligibility](../business/participants.md#the-verification-page)              | `/investor-eligibility`, `/eligibility-requests`                                | investing |
| [Directory, Applications](../business/participants.md#the-directory-page)                                | `/directory`, `/directory/:uuid`, `/subscriptions`, `/subscriptions/:uuid`      | investing |
| [Market](../business/trading.md#the-market-page)                                                         | `/trading`                                                                      | investing |
| [Wallets](../business/trading.md#the-wallets-page)                                                       | `/wallets`                                                                      | everyone  |
| [Activity](../business/trading.md#the-activity-page)                                                     | `/transactions`                                                                 | everyone  |
| [Profile, Settings](../business/participants.md#profile-and-settings)                                    | `/user-profile`, `/settings`                                                    | everyone  |

### Page mechanics

- Company dashboard: reads the scoped register API for the selected company (`useCompanyRegister`)
  and computes issued-share totals, holders deduplicated across classes and each class's shares with
  `BigInt` (`dashboard/src/pages/company/dashboard/summary.ts`); it draws each class's donut itself.
- Personal dashboard: reads the person's own member projection; the first own class's history loads
  when a member record opens, and choosing another class reads that class's own entries.
- Register on the web (`dashboard/src/pages/company/register/index.tsx`): one page renders the
  Register, Employee awards, Documents and Member access views by hash and keeps every class's
  controllers mounted, merely hidden, so changing view, task (`TASKS`) or class (the Task share
  class selector) keeps an unfinished request with its class, payload and retry key. Controllers
  report held work (an unfinished form, or a decision busy or awaiting recovery) under keys naming
  their task, class and any record (`allotments/`, `transfer/`, `history/`, `awards/`, `grants/`;
  member access separately). While anything is held, the page keeps its retained company and class
  scope, disables the company, task and class selectors and pins held task work to its task and
  class. A selection lasts one navigation (`location.key`); navigation state (`registerCompany`,
  `registerToken`, `registerHistory`) picks the company, class and task and focuses that class.
  History records are disclosures with a one-line summary, their detail and certificate control
  rendered on demand; a section whose read succeeded empty is omitted, while a failed read keeps its
  retry and an uncertain decision its recovery. Private content renders only while its view is
  visible, its reads have settled and `hasCurrentRegisterReadAuthority` confirms a current
  register-read appointment.
- Register on both clients: the web reads the person's appointments through Company team's
  account-bound cache; mobile reads them itself. Both reread them after a revocation on Company team
  or Representative authority, a refused decision, preview or acknowledgement, a waiting-wallets
  read refused as not found, a recorded decision other than an import's (which refreshes the
  imports, the register and its entries) and, on mobile, a pull to refresh. Entries load newest
  first, a page per Load more: an entry a later page repeats is listed once, a page with a non-whole
  share change fails, and a corrected or reversing entry reads as not loaded yet until its page
  arrives. A proposal of another company or class, an unreadable mapping or holding, and a
  correction lookup answering with entries it was not asked for fail the read. Each repeated control
  is named for screen readers after its visible label and its entry, proposal or discrepancy. Native
  section parameters switch the visible section, keeping the register mounted.
- Company: reads the selected company's complete detail and every page of its share classes and
  team; an edit sends only changed fields.
- Published to your members: reads every page of the selected company's publications with `issuer`
  set, so the card title carries the complete count.
- Wallet shares: reads every page of the person's wallets, names each asset from the API's current
  class and company names, adds whole share counts without floating-point conversion, and reads the
  applicant-filtered application list only for a known investing role.
- Verification: the claim history has its own cache, and every claim page loads before a submission
  is offered, so a pending claim on a later page still prevents a second one.
- Directory and Applications: a draft application reads every verified Base wallet page and computes
  its fixed-price total in integer cents with `BigInt`
  (`dashboard/src/pages/subscriptions/SubscribeForm.tsx`,
  `mobile/src/screens/applications/presentation.ts`); Applications shows the recorded values without
  recomputing them, and a copy failure keeps the value available.
- Market: owned order history reads independently of listed classes and wallets. Device-saved work
  ([create-order recovery](mobile.md#create-order-recovery),
  [order submissions](trading-protocols.md)) is read when Market loads and after each recovery.
- Wallets: reads every wallet page into a ledger of its own. Native balances are formatted by
  `formatCryptoBalance` (`packages/shared/src/utils/formatting.ts`) and ordered by decimal-string
  comparison (`sortWallets` in `packages/shared/src/hooks/useWalletSort.ts`). On the web every Sync
  waits while one runs. Imports run one address at a time, and mobile's software registration waits
  for the server after the authenticated local seed storage. Purchase-page errors are read with
  `readApiError` (`packages/shared/src/utils/errors.ts`), never a proxy's error page. Web Send
  counts the wallets last read even while re-reading; Buy crypto (`walletsSettled`) and mobile Send
  skip the wallet chooser only after a finished read, and mobile's Send forms keep Continue
  unavailable until the chosen wallet's balances are read.
- Activity: the history read does not depend on the wallet filter read; filters use only supported
  API fields.
- Profile and Settings: transaction alerts are the `transactionAlerts` field of the one preferences
  record (`useUserPreferences`, saved with a partial `POST` to `/api/user-preferences/`); mobile
  distinguishes an unavailable record from disabled alerts. Account deletion clears cached account
  data after the server confirms.

Next: [mobile](mobile.md), [authentication](security.md#authentication-and-sessions),
[company workflow API](backend.md#company-workflow-api) and [testing](testing.md).
