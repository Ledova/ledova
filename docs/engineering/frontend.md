# Frontend

[Engineering](README.md) · [Documentation](../README.md)

How the web dashboard, the public site and the shared TypeScript package are organised and built,
and the rules frontend code follows. The conventions every signed-in page follows on web and mobile,
and the standard way to make each common choice, are in [frontend UX standards](frontend-ux.md). The
mobile app's own architecture is in [mobile](mobile.md); what each page does is in the business
section linked from [Pages](#pages).

- [Clients and the shared package](#clients-and-the-shared-package)
- [Frontend layout](#frontend-layout)
- [Frontend layers](#frontend-layers)
- [Frontend rules](#frontend-rules)
- [Adding a page or feature](#adding-a-page-or-feature)
- [Routes, audiences and guards](#routes-audiences-and-guards)
- [The signed-in frame](#the-signed-in-frame)
- [Client sessions and caches](#client-sessions-and-caches)
- [Lists, figures and currency](#lists-figures-and-currency)
- [Recovering a submitted company request](#recovering-a-submitted-company-request)
- [The shared register client layer](#the-shared-register-client-layer)
- [Design tokens and themes](#design-tokens-and-themes)
- [Pages](#pages)

## Clients and the shared package

`dashboard/` is the signed-in web app (React, React Router, TanStack Query, Vite and Tailwind CSS
v4), `mobile/` the Expo React Native app ([mobile](mobile.md)), and `site/` the public website
(React, TypeScript and Vite; static output, no API calls).

`packages/shared` is consumed from source: `main` and `types` in its `package.json` point at
`src/index.ts`, with no build step or `dist/`, and `react` and `@tanstack/react-query` are
`peerDependencies` supplied by the importing client. The dashboard resolves the package through the
root npm workspace link (`node_modules/@ledova/shared` to `packages/shared`), and Vite and `tsc -b`
follow the symlink, so the sources are transformed and type-checked as application code. Mobile
resolves it through Metro ([shared package resolution](mobile.md#shared-package-resolution)). The
site cannot import it, because its Docker context is `site/`.

Clients import the package as `@ledova/shared`, never by a deep path; inside a workspace package,
imports are relative and never use the package's own name (`make check-self-imports` refuses that).

The account audience (`company`, `investing` or both) selects navigation, not company authority
([company authority boundaries](README.md#company-authority-boundaries)). Clients scope caches and
pending actions to the selected company and the session.

## Frontend layout

The dashboard is organised by page. Each page has a folder under `dashboard/src/pages/`, named and
nested by its address, holding everything only that page uses; a top-level folder of `pages/` is an
area. The tables below are the standard; where today's code differs, the gap is listed after them
with the issue that closes it. The other folders hold what several areas, the route table or the
frame share, and `packages/shared` holds what both clients share.

| `dashboard/src/`      | Owns                                                                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`, `App.tsx` | `main.tsx` mounts the providers (`QueryClientProvider`, `ApiClientProvider` with the `apiClient` singleton, `BrowserRouter`), fonts and stylesheets; `App.tsx` renders `Layout` around the route table                                                                                                                           |
| `routes/`             | The whole route table (`PAGES` with `signedInRoutes`, the sign-up and public routes) and the guards (`ProtectedRoute`, `SignupRoute`, `TradingRoute`, `RootRedirect`, `PublicOnlyRoute`) with their waiting and failure states                                                                                                   |
| `pages/`              | One folder per page with its `index.tsx` entry and its own files, sub-pages nested inside it, and a `shared/` folder for files several pages under one folder use                                                                                                                                                                |
| `components/`         | The UI kit (`Page` and `PageAction`, `Ledger`, `Modal`, `Field`, `iconSizes`), the signed-in frame (`Layout`, `Sidebar`, `MobileHeader`, `NotificationBell`) and public layout (`AuthLayout`, `Footer`) with their parts and contexts, group folders such as `qr/`, and single components several areas show (`AwardStatus.tsx`) |
| `hooks/`              | App-wide hooks with no JSX: profile, role and sign-up state, register access, sign-out, theme, identity verification                                                                                                                                                                                                             |
| `services/`           | Browser bindings, whatever their users: the axios instance with its interceptors (`apiClient.ts`) and the device stores built from the shared store factories                                                                                                                                                                    |
| `utils/`              | Browser and pure helpers used by more than one area or the frame (the software signer, `siteUrl.ts`, Keystone UR coding, which each client builds on its own registry libraries) and the web-only paths (`paths.ts`)                                                                                                             |
| `styles/`             | `index.css` and the generated `tokens.css` ([design tokens](#design-tokens-and-themes))                                                                                                                                                                                                                                          |
| `testSupport/`        | Render helpers for tests in more than one folder, and the one import path to `packages/shared/tests/fixtures`                                                                                                                                                                                                                    |

| `packages/shared/src/` | Owns                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants/`           | Endpoints and cache timing (`api.ts`), `DESTINATIONS` and the design tokens (`ui/`), copy and business constants (`business/`)                  |
| `generated/`           | `api.ts`, generated from the OpenAPI schema and never edited                                                                                    |
| `types/`               | Domain types derived from the generated contracts (`domain/`) and request, contract and validation types                                        |
| `services/`            | One function per API operation, taking the caller's axios instance first                                                                        |
| `utils/`               | Pure logic both clients run: pagination, proposal checks, share arithmetic, formatting, error reading, store factories over an injected storage |
| `hooks/`               | TanStack Query hooks both clients use, and `ApiClientProvider` with `useApiClient`                                                              |

Where today's code differs from these standards:

- Existing unscoped account-bound keys stay unchanged; broader account scoping needs the owner
  decision on [#1065](https://github.com/Ledova/ledova/issues/1065).

Mobile maps onto the same layers, direction and placement, with `navigation/` for `routes/` and
`screens/<area>/` for page folders. Its component data calls beyond the reads extracted for key
ownership remain recorded on [#1072](https://github.com/Ledova/ledova/issues/1072). Shared native UI
and cross-area reads live outside screen internals ([mobile architecture](mobile.md#architecture)).
Profile, trading, operator and publication-list reads, invitation recipients, eligibility copy and
application arithmetic live once in `packages/shared`; client adapters retain their current session,
cache, labels and result policies. Register reads remain per client pending the naming decision on
[#1065](https://github.com/Ledova/ledova/issues/1065). `site/src` is a separate flat app (one file per page in
`pages/`, `components/`, `styles.ts`, `theme.ts`) that cannot import the shared package; only the
file-naming rules apply to it.

## Frontend layers

Each layer owns one kind of code and imports only the layers below it; code moves up only when a
second user needs it, as on the [backend](backend.md#backend-layers). `pages/publications/` is the
reference page. Where a rule and a file disagree, the rule wins and the file is the backlog;
existing code is being brought in line under [#1065](https://github.com/Ledova/ledova/issues/1065).

| Layer                                  | Owns                                                                                                                                         | Never contains                                                                                | Reference                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Route table and guards (`routes/`)     | `PAGES` keyed by `DESTINATIONS`, the sign-up and public routes, guards with their waiting and failure states, where an account lands         | A page's files other than its entry; page content; reads beyond the session and access checks | `dashboard/src/routes/pages.tsx`                                                                      |
| Page entry (`index.tsx`)               | One route: its parameters, hash and navigation state, the owner boundary, and `Page` with its title row and sections fed by hooks            | `useQuery`, `useMutation`, `apiClient` or a service call; another page's files                | `dashboard/src/pages/publications/index.tsx`                                                          |
| Page files (beside the entry)          | The page's sections and dialogs, its hooks and its pure helpers, told apart by file name                                                     | `components/` or `hooks/` subfolders; a file a second page imports                            | `dashboard/src/pages/publications/Resolution.tsx`, `dashboard/src/pages/transactions/presentation.ts` |
| Shared page code (`shared/`)           | Files that two or more pages under that page folder import                                                                                   | Route entries; a file one page alone uses                                                     | `dashboard/src/pages/company/shared/CompanyState.tsx`                                                 |
| UI kit and frame (`components/`)       | The kit, the frame and public layout with their contexts, and group folders or single components for UI that several areas or the frame show | Imports of `pages/` or `routes/`; in kit files, queries or domain rules                       | `dashboard/src/components/Ledger.tsx`, `dashboard/src/components/qr/`                                 |
| Data hooks (`use<Thing>.ts`)           | `useQuery` and `useMutation`, the exported key factory, the owner guard, cache timing and invalidation; values and actions ready to render   | JSX; another module's key written out; raw error text                                         | `packages/shared/src/hooks/useSubscriptions.ts`                                                       |
| Services (`services/`)                 | `apiClient` (CSRF retry, the submission guard, friendly network errors) and the browser device stores                                        | API call functions; React                                                                     | `dashboard/src/services/apiClient.ts`                                                                 |
| Utils (`utils/`)                       | Client-only helpers and web-only paths used by more than one area or the frame                                                               | React; API calls; logic mobile also needs on the same libraries                               | `dashboard/src/utils/siteUrl.ts`                                                                      |
| Types                                  | A type beside its only user; API-derived and cross-client types in `packages/shared/src/types`                                               | Hand-written API shapes; a dashboard `types/` folder; client prop types in the shared package | `packages/shared/src/types/domain/subscription.ts`                                                    |
| Shared package (`packages/shared/src`) | What both clients need (query hooks, pure utils, constants, contract types) and every API call function, even one only one client calls      | JSX beyond `ApiClientProvider`; DOM or native APIs (stores take an injected storage)          | `packages/shared/src/services/publications.ts`                                                        |

### Dependency direction and placement

Imports point down this chain, never up or sideways: `App.tsx` → `routes/` → page entries → page
files → `shared/` folders → `components/` → `hooks/` → `services/` and `utils/` →
`@ledova/shared`. Only `App.tsx` imports `routes/`; `routes/` imports a page by its folder, never
its other files; nothing outside `pages/` and `routes/` imports `pages/`. A page file imports its
own folder and the `shared/` folders of its own and enclosing page folders, never another page's
files, its parent's included. In `components/`, the frame may use groups and the kit, groups may use
the kit, and kit files use neither.

To place a file, ask in order and stop at the first yes:

1. Is it an API call function or an API-derived type? `packages/shared` (`services/`, `types/`).
2. Is it logic both clients need, built on the same libraries, and not UI? `packages/shared`,
   deleting the client copies. (Logic each client builds on its own platform libraries, such as
   Keystone UR coding, stays per client.)
3. Is it a route element, a guard, or a state only guards render? `routes/` (path constants go in
   `utils/paths.ts`).
4. Is it a browser binding (the axios instance, a device store)? `services/`.
5. Does one page use it? That page's folder, beside its entry.
6. Do several pages under one page folder use it? The `shared/` folder of the lowest page folder
   holding them all (`pages/company/shared/`, `pages/company/ledger/shared/`).
7. Otherwise (two areas or the frame): `components/` for UI, as a group folder when it has parts,
   hooks or a provider that renders it; `hooks/` for a hook without JSX; `utils/` for any other
   helper or a web-only path.

Move a file in the change that gives it a second user, and back down when one user remains, as a
move with no behaviour change that repoints its importers, `vi.mock` paths and cited document
paths.

### When not to add a folder or layer

The [principles](README.md#principles) apply; in particular, do not add:

- a `components/` or `hooks/` subfolder in a page, or a folder for one component: file names
  already tell sections, hooks and helpers apart;
- a `shared/` folder before two pages import the same file, or a top-level file before a second
  area, a guard or the frame needs it;
- an `index.ts` barrel in the dashboard, except the entry of a `components/` group;
- a hook or service that only passes `apiClient` to a shared one, or a dashboard API module (add the
  call to the shared services);
- a context for state one page owns, or a provider in the frame unless its flow must outlive the
  page;
- a new top-level folder (`features/`, `contexts/`, `types/`), or shared-package code only one
  client uses other than an API call or a contract type.

## Frontend rules

- **Data access.** Components render and call actions. Each query and mutation, with its key,
  owner guard and invalidation, lives in a `use<Thing>.ts` hook, and only `main.tsx`, hooks and
  `services/` import `apiClient`. A hook that shapes its result names the fields `isLoading`,
  `hasError`, `isRefreshing` and `retry` (`packages/shared/src/hooks/useSubscriptions.ts`).
- **Account boundary.** Work bound to the signed-in account takes its owner from
  `useSubmissionOwner`, and the page renders it in an inner component keyed by the owner, so pending
  work never crosses accounts. Its query keys carry the owner and every request passes
  `ledovaSubmissionGuard`, which `apiClient` checks, so a late reply cannot reach another account
  (the owner key in `dashboard/src/pages/company/dashboard/index.tsx`, the guard in
  `dashboard/src/pages/company/ledger/shared/useRegisterGrants.ts`). Mobile adds the session epoch
  ([session scope](mobile.md#session-scope)).
- **API client.** Shared services take the axios instance first. Shared hooks read it with
  `useApiClient()` and never take it as an argument; dashboard hooks import the `apiClient`
  singleton, which `main.tsx` also gives `ApiClientProvider`. Every endpoint has its function in
  `packages/shared/src/services`; [the API type drift gate](gates.md#the-api-type-drift-gate)
  accounts for each operation, not for where it is called.
- **Query keys.** The module that owns a query exports its key or key factory, and every other
  reader and invalidation imports it; a key both clients use is exported from the shared hook, as
  `AUTH_QUERY_KEY` is. A key is its resource's root (kebab-case for a new root), then the owner for
  account-bound data (anything read or written for the signed-in account), then parameters. It never
  starts with another resource's root, and an invalidation names the narrowest prefix that covers
  the change.
- **Paths and titles.** Link and navigate with `DESTINATIONS` paths, filling parameters with React
  Router's `generatePath`, or with the web-only paths in `utils/paths.ts` (the company dashboard,
  sign-in, sign-up and `SIGNUP_STEPS`); source writes no literal path. Titles come from
  the web `pageTitle` mapping used by `signedInRoutes`
  ([routes, audiences and guards](#routes-audiences-and-guards)); a page sets `PageTitle` only for a
  hash view.
- **Errors and waiting.** A failed request reads as a `role="alert"` sentence
  ([validation](frontend-ux.md#validation)). Read a status with `failureStatus`, never an inline
  cast. A page's first read renders `<Page loading>`; a failed read shows `LoadError` with Try again
  ([loading, empty and error states](frontend-ux.md#loading-empty-and-error-states)).
- **Formatting.** Figures, amounts and dates use the shared formatters (`formatMoney`,
  `formatShareCount`, `shareCount`, `shareChange`, `sharePercentage`, `marketQuantity`,
  `marketShares`, `formatCryptoBalance`, `formatDate`, `formatDateTime`;
  [dates, numbers and identifiers](frontend-ux.md#dates-numbers-and-identifiers)).
  Never define a local formatter or pass a displayed amount through `Number` or `parseFloat`. The
  exception is a market value `useCurrency` converts to AUD, because its rate is a number.
- **Naming and exports.** A page folder takes the last fixed segment of its address and sits in the
  folder of the nearest page whose fixed address begins its own: `/company/ledger/:uuid/transfer`
  is `pages/company/ledger/transfer/`. An address that only adds a parameter to that page is `detail/`
  (`/directory/:uuid` is `pages/directory/detail/`), and a `detail/` folder never holds sub-pages;
  an address that renders another's page (`/member-records`, `/company/ledger/setup`) has no
  folder, and the not-found page is `pages/not-found/`. Page folders and `components/` groups are
  kebab-case (`eligibility-requests/`, `qr/`). A file is named after its main export, or after what
  small siblings share (`fieldClass.ts`): `PascalCase.tsx` for a component, `use<Thing>.ts` for a
  hook without JSX, `<Thing>Provider.tsx` for a provider, `PascalCase.ts` for a React context,
  camelCase `.ts` for a module without React. Components and hooks are function declarations. A page
  entry default-exports its page and nothing else; other exports are named, and only when another
  file imports them.
- **Types.** Types and interfaces use PascalCase and properties camelCase; query parameters keep the
  API's snake_case names. Entities use their bare name, queries `{Entity}QueryParams` and non-CRUD
  calls `{Action}Request` and `{Action}Response`, composed from the shared pagination, ordering and
  date-range types; `packages/shared/eslint-naming-rules.js` enforces these names, the snake_case
  query-parameter fields and the utility-type preferences on `packages/shared/src/types/`. Clients
  type-check against the generated contracts ([the API type drift
  gate](gates.md#the-api-type-drift-gate)).
- **Imports.** Relative paths never climb: import your own folder with `./` and everything else
  through an alias in `dashboard/tsconfig.app.json` (`@components`, `@hooks`, `@pages`,
  `@services`, `@utils`) or as `@ledova/shared`
  ([shared package imports](#clients-and-the-shared-package)). The only `../` paths are tests
  reaching `testSupport/` and `testSupport/` reaching `packages/shared/tests/fixtures`.
- **Tests.** A test sits beside the file it covers and takes its name (`index.test.tsx` for a page
  journey); helpers for tests in more than one folder live in `testSupport/`, as in
  `mobile/src/testSupport/`. A move updates `vi.mock` paths in the same change, because a mock whose
  module no longer holds the export stops mocking without failing, and keeps every case
  ([minimum-test policy](testing.md#minimum-test-policy)).

Enforced today: ESLint and Prettier (`make lint`, with the shared type naming rules),
[the type-check gate](gates.md#the-type-check-gate) with the typed `PAGES` and sign-up maps,
[the comment gate](gates.md#the-comment-gate),
[the logging privacy gate](gates.md#the-logging-privacy-gate), the self-import gate,
[the frontend import gate](gates.md#the-frontend-import-gate) and
[the API type drift gate](gates.md#the-api-type-drift-gate). The frontend gate covers `routes/`
and `pages/` import direction, climbing relative paths and `apiClient` placement, with existing
debt pinned by file and rule. Other placement rules, data access, query keys, paths, naming and
test placement remain review checks. Moves remove the corresponding debt in the same change.

## Adding a page or feature

1. Add the page to `DESTINATIONS` (`packages/shared/src/constants/ui/destinations.ts`) with its
   address, title and audience; mobile reads the same entry.
2. Create its folder by the [naming rule](#frontend-rules) with an `index.tsx` that default-exports
   the page rendered in `Page`.
3. Add it to `PAGES` (`dashboard/src/routes/pages.tsx`); TypeScript refuses the table until both
   exist, and `signedInRoutes` adds the title and `ProtectedRoute`.
4. Read and write through a `use<Thing>.ts` beside the entry over shared services. A new endpoint
   gets its service and contract types in `packages/shared` first; add a shared hook when mobile
   needs the same logic.
5. Build it from `Page`, the ledger blocks, `Modal` and `Field`
   ([signed-in page conventions](frontend-ux.md#signed-in-page-conventions)), one `PascalCase.tsx` per section or
   dialog, and link it from its parent with `LinkRow` or from the sidebar by its `DESTINATIONS` key.
6. When a second page needs one of its files, move the file by the placement rule in the same
   change.
7. Describe the page in its business section, add its [Pages](#pages) row and add the mobile screen
   ([navigation](mobile.md#navigation)).
8. Add a test only for a core journey and within the caps, then run `make preflight`.

A feature inside an existing page follows steps 4 to 6 in that page's folder. A sign-up step is a
folder under `pages/signup/`, added to `SIGNUP_STEPS` and to the step map in `routes/`.

## Routes, audiences and guards

`DESTINATIONS` (`packages/shared/src/constants/ui/destinations.ts`) lists the signed-in pages both
clients share with their address, title and audience. The whole dashboard route table is in
`dashboard/src/routes/AppRoutes.tsx`, using `signedInRoutes` from `PAGES`
(`dashboard/src/routes/pages.tsx`), a map keyed by that table, so
TypeScript refuses an entry without a page or a page without an entry. Each route, detail pages
included, gets the entry's title through `PageTitle`. The web-only `pageTitle` mapping
(`dashboard/src/utils/destinations.ts`) titles `home` Dashboard, `companyRegister` Ledger,
`companyRegisterSetup` and `companyRegisterImport` Set up your ledger, and `companyRegisterOpening`
Ledger opening; native keeps its existing titles. `/member-records` is an alias of `/home`, and `companyRegisterSetup` and
`companyRegisterImport` render the same page. Outside the table sit the
[sign-up steps](#sign-up-routes) and `/company/dashboard` (`COMPANY_DASHBOARD_PATH` in
`dashboard/src/utils/paths.ts`, routed in `dashboard/src/routes/AppRoutes.tsx` under `ProtectedRoute`
with audience `everyone` and title Dashboard).

`canOpen(role, audience)` lets an investor open `everyone` and `investing` pages, a company
`everyone` and `company` pages, and a dual-role account all; a role outside the API's list opens
only `everyone` pages. `landingFor(role)` is `/company/ledger` for a company or dual-role account
and `/home` otherwise. It receives a refused address (replacing it), a signed-in visitor on the
create-account page, Market while `trading_enabled` is off (`TradingRoute`) and a finished
non-company account that opens a sign-up step.

`/` (`RootRedirect`) sends a signed-out visitor to sign in and an unfinished account into sign-up:
to `/signup/company-registration` when the account may open company pages and its full name has more
than one word, otherwise to `SIGNUP_RESUMES_AT`. A finished account opens `/company/dashboard` when
`useRegisterEntryAccess` (`dashboard/src/hooks/useRegisterAccess.ts`) confirms
readable register access (the first page of readable register classes is not empty, or the person
may personally administer one of their companies, read across every page) and `/home` otherwise; a
failed check offers Try again. Sign-in navigates to `/`.

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

The sidebar (`dashboard/src/components/Sidebar.tsx`) names items by `DESTINATIONS` key, or
`companyDashboard`, optionally with a view (`/company/ledger#shareholders`, `#awards`,
`#documents`, `/home#documents`). Its company group follows `useRegisterEntry`, its investing group the investing
role and Market `trading_enabled` ([the app at a
glance](../business/README.md#the-app-at-a-glance)). A page that isn't an item marks its nearest
parent that is ([navigation](frontend-ux.md#navigation)): Settings on the Company pages, Activation
and Profile, Shareholders on a shareholder's page. The register hashes switch the visible view without
unmounting register forms or their recovery ([page mechanics](#page-mechanics)). The sidebar and
phone drawer are 208 pixels wide (`lg:ml-52`), with page content beside them in a bounded grid. Its
items are links, and below `lg` the drawer is a dialog ([navigation](frontend-ux.md#navigation)).
Native navigation is declared separately ([navigation](mobile.md#navigation)).

### Sign-up routes

`SIGNUP_STEPS` (`dashboard/src/utils/paths.ts`) lists the steps after the create-account form:
email confirmation, account type, pre-screening, user profile, financial profile, company
registration and review. Identity verification is not a step: when `useSignupReview` reports
`identityRequired`, company review offers **Verify your identity**, which opens the
`IdentityVerificationModal` that Profile uses (native: `VerificationModal`). The step map in
`dashboard/src/routes/AppRoutes.tsx` uses the named `SIGNUP_PATHS`, and `signupRoutes` wraps each,
with `/signup`, in `SignupRoute`, which sends a finished company account to the company dashboard
and other finished accounts to `landingFor(role)`, lets an unfinished account or a signed-out
visitor through, and shows `AccountUnavailable` when the profile cannot be read. `/signup` shows
the create-account form when signed out and **Your account** (`useSignupRestart`) when signed in.
Verified accounts never return to email confirmation: account type goes back to `/signup`,
pre-screening to account type, and the confirmation step sends a signed-in visitor to `/`. Sign-in
sits under `PublicOnlyRoute`, which sends a signed-in visitor to `/`.

Email verification and sign-up completion issue the session and await the explicit authentication
refresh (sign-up completion a fresh profile too) before navigating, as sign-in does, so the steps
read the profile once, before any form, and a later recheck cannot take away a step being filled in.
A failed refresh keeps the review step open with its error and a retry
([company signup](../business/companies.md#company-signup)). Sign-in and sign-up share the
header, card, divider, input and field styles in `dashboard/src/components/auth/`, retaining the
review header's spacing and each form's existing field variants.

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

Browser blob downloads use `dashboard/src/utils/saveFile.ts`: it clicks one temporary link, removes
that link and revokes the object URL after 60 seconds. Each caller keeps its own filename, MIME type
and authority checks.

The session itself is in [authentication](security.md#authentication-and-sessions);
`packages/shared/src/hooks/useAuth.ts` owns the authentication query (`AUTH_QUERY_KEY`).
`ApiClientProvider` gives the shared hooks the client's API instance ([API
client](#frontend-rules)); the dashboard's `QueryClient` revalidates on focus and reconnect,
mobile's (`mobile/App.tsx`) only on reconnect. Authentication does not retry a failed request
automatically; a later mount may recheck. The hook exposes fetching separately from the first
session check, so a retry does not restore initial loading, and public forms keep their nested
authentication consumers mounted so a failure cannot create a remount loop. The protected route
hides protected content while a cached negative is rechecked and redirects after a negative answer
or failure.

On the web, signing in and verifying an email (which also signs a new person in) remove every cached
query except the authentication root, then await an exact authentication refetch. Signing out and
account deletion mark authentication invalid before clearing the whole cache. These two reset
sequences share `dashboard/src/utils/session.ts`. The four device stores share the synchronous
`dashboard/src/services/browserStorage.ts` adapter, resolving browser storage when each operation
runs. Mobile clears the whole cache whenever the sign-in screen gains focus, and on sign-out and
account deletion. A new person is never guarded by, or signs up against, the previous person's
account. Mobile adds a session epoch to every read and write ([session scope](mobile.md#session-scope)).

The shared `useUserPreferences` and `useCurrency` queries start only after authentication, and
cached preferences are hidden again when authentication is lost.

## Lists, figures and currency

Every list follows these rules:

- It pages as [lists, search, filters and paging](frontend-ux.md#lists-search-filters-and-paging)
  describes. A failed first read offers a retry, not an empty list.
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

The web's base class and holder reads in `dashboard/src/pages/company/shared/useCompanyRegister.ts`
receive the controller's original owner guard from `dashboard/src/pages/company/shared/ownerGuard.ts`.
They check it before and after each request and pass it as `ledovaSubmissionGuard`, so a late reply
after an account change or reauthentication is discarded. Query keys and cache timing stay unchanged.

Each preparation is a page of its own (on mobile, in the same stack), a `companyRegister*` entry in
`DESTINATIONS`: `/company/ledger/setup`; import, correction, opening, grant and transfer under
`/company/ledger/:uuid/` (`import`, `correct/:entry`, `open`, `grant`, `transfer`); particulars
changes at `/company/ledger/members/:member/particulars`; and wallet links at
`/company/ledger/companies/:company/links`. Setup is the import page without a class in its
address: it chooses or creates a share class, then prepares the mirror import.

On the web, setup's shareholder editor and later shareholder/class pages share
`dashboard/src/pages/company/ledger/shared/DocumentAttachments.tsx` for optional categorised
files. Setup uploads supporting evidence before preparation and includes it in that member's
proposal; company source copies stay at opening scope. The shared register-member-documents service
validates each returned company, member and class against the query. Later attachment lists and
downloads use these retained links, not a public storage URL
([attachment rules](../business/register.md#shareholder-documents)). Mobile keeps its existing setup.

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

The web register's repeated row wrappers, stage rows and download failures use
`dashboard/src/pages/company/ledger/RecordShell.tsx`; `shared/DecisionTrail.tsx` serves both
the Ledger and share-class detail page. Six records use `useRegisterTaskGuard.ts` for their existing visible-task
check, while grant, allotment and award keep their distinct guards and wrappers. The preparation
pages share `PreparationShell.tsx` for Back, preference fallback and read-only paragraphs, and
`useRegisterPreparationOwner.ts` for the same account boundary and preferences reads. Page and form
keys, held work, specialised refusal states and the import title remain with their pages.

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

## Pages

Each page links to its business section; the audience is the `DESTINATIONS` audience
([guards](#routes-audiences-and-guards)).

| Page and business section                                                                                | Routes                                                                             | Audience  |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| [Company dashboard](../business/README.md#the-app-at-a-glance)                                           | `/company/dashboard` (web only)                                                    | everyone  |
| [Personal dashboard](../business/member-records.md#what-a-member-can-read)                               | `/home`, `/home#documents`, alias `/member-records`                                | everyone  |
| [Ledger, Shareholders, Employee share scheme, Documents](../business/register.md#the-register-page)      | `/company/ledger` and `#shareholders`, `#awards`, `#documents`; preparation routes | everyone  |
| [A shareholder's page](../business/register.md#a-shareholders-page)                                      | `/company/ledger/members/:member?company=`                                         | everyone  |
| [Share class](../business/register.md#the-share-class-page)                                              | `/company/ledger/:uuid`                                                            | everyone  |
| [Company, Representative authority, Company team, Activation](../business/companies.md#the-company-page) | `/company`, `/company/authority` (company), `/company/team`, `/company/listing`    | everyone  |
| [Company eligibility](../business/participants.md#company-eligibility-decisions)                         | `/company/eligibility`                                                             | everyone  |
| [Offerings](../business/issuing-shares.md#the-offerings-page)                                            | `/company/offering`                                                                | company   |
| [Published to your members](../business/publications.md#the-published-page)                              | `/company/publications`                                                            | company   |
| [Notices](../business/publications.md#the-notices-page)                                                  | `/publications`                                                                    | everyone  |
| [Wallet shares](../business/member-records.md#the-wallet-shares-page)                                    | `/wallets/holdings`                                                                | everyone  |
| [Verification, Your company eligibility](../business/participants.md#the-verification-page)              | `/investor-eligibility`, `/eligibility-requests`                                   | investing |
| [Directory, Applications](../business/participants.md#the-directory-page)                                | `/directory`, `/directory/:uuid`, `/subscriptions`, `/subscriptions/:uuid`         | investing |
| [Market](../business/trading.md#the-market-page)                                                         | `/trading`                                                                         | investing |
| [Wallets](../business/trading.md#the-wallets-page)                                                       | `/wallets`                                                                         | everyone  |
| [Activity](../business/trading.md#the-activity-page)                                                     | `/transactions`                                                                    | everyone  |
| [Profile, Settings](../business/participants.md#profile-and-settings)                                    | `/user-profile`, `/settings`                                                       | everyone  |

### Page mechanics

- Company dashboard: reads the scoped register API for the selected company (`useCompanyRegister`)
  and computes issued-share totals, holders deduplicated across classes and each class's shares with
  `BigInt` (`dashboard/src/pages/company/shared/summary.ts`); it draws each class's donut itself. The
  person's own appointments (`useOwnAppointments`) give the status line and Getting started, which
  reads the register step from the selected company's opened registers. Mobile's Register tab
  gives the same line and, for an administrator of the company shown, the same list, judging the
  register step by that company's registers alone.
- Personal dashboard: reads the person's own member projection; the first own class's history loads
  when a member record opens, and choosing another class reads that class's own entries.
- Ledger on the web (`dashboard/src/pages/company/ledger/index.tsx`): one page renders the
  Ledger, Shareholders (with member access), Employee share scheme (ESS) and Documents views by hash and keeps every class's
  controllers mounted, merely hidden, so changing view, task (`TASKS`) or class (the Task share
  class selector) keeps an unfinished request with its class, payload and retry key. Controllers
  report held work (an unfinished form, or a decision busy or awaiting recovery) under keys naming
  their task, class and any record (`allotments/`, `transfer/`, `history/`, `awards/`, `grants/`;
  member access separately). While anything is held, the page keeps its retained company and class
  scope, disables the company, task and class selectors and pins held task work to its task and
  class. A selection lasts one navigation (`location.key`). Navigation state built by
  `registerPlace` (`dashboard/src/pages/company/ledger/shared/registerPlace.ts`) picks the company
  (or the class's company), class and task and focuses that class; with a record it focuses that
  record instead and shows its outcome line. `inviteMember` chooses the invitation's recipient on
  Shareholders.
  History records are disclosures with a one-line summary, their detail and certificate control
  shown on demand; a section whose read succeeded empty is omitted, while a failed read keeps its
  retry and an uncertain decision its recovery. Private content renders only while its view is
  visible, its reads have settled and `hasCurrentRegisterReadAuthority` confirms a current
  register-read appointment.
- Choosing a person on the web: register setup, investor and non-paid issues, transfers and employee
  awards read one people list (`dashboard/src/pages/company/ledger/shared/usePeople.ts`, the
  `register/members/` read validated by `isRegisterImportMembers`) and render `PersonSelect` and
  `PersonFields` (`shared/PersonPicker.tsx`), the searchable list in
  [choosing a person](frontend-ux.md#choosing-a-person).
  - Member invitations give `PersonSelect` the company's holders and award recipients from
    `invitationMembers`.
  - The share-class issue's member choice reads `register/members/` through
    `useCompanyIssueInstructions`, which leaves out award recipients without shares on web and
    mobile.
  - Wallet links label the holders of every class with `registerLinkMemberLabels`, and register
    opening labels its linked members with `openingMemberLabels`.

  The list includes award recipients without shares, whose first award gave them a person record;
  `on_register` false marks them. `personRequest` (`packages/shared/src/utils/people.ts`) sends a
  chosen person under their member ID as an existing member, award recipients included, and a grant
  from an award names the award's recipient the same way; each flow filters the list by its own
  rule. On Ledger, navigation state `issueMember` opens Issue shares
  with Investor issue and that person chosen, `issueAward` opens it with Non-paid issue for that
  award, and `registerRecord` focuses a listed non-paid issue. `fromMember` chooses a transfer's
  transferor.

- A shareholder's page on the web (`dashboard/src/pages/company/ledger/member`): reads the named
  company's classes and holders through the same queries as Ledger, the company's recorded
  particulars (`register/members/` of its first class), every page of the member's entries in each
  class (`register/entries/` with `member`) and their awards (`register-awards/` with `member`). It
  renders the person only while the account, classes and holders are current; particulars, history
  and awards also need `hasCurrentRegisterReadAuthority` on settled appointments and their own settled
  read. Documents reads the person's retained attachments across classes; class details reads the
  same links for its class. **Change particulars** and adding documents recheck current preparation
  authority, and attachment downloads require current register-read authority. While register work
  is held, Shareholders' Details links are disabled.
- Register reads on both clients (Ledger on the web): the web reads the person's appointments through Company team's
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
- Company: reads the selected company's complete detail; an edit sends only changed fields.
- Published to your members: reads the selected company's publications with `issuer` set, newest
  first, a page at a time with Load more; the card title carries the server's complete count. A
  document opens only while every loaded page is current.
- Wallet shares: reads every page of the person's wallets, names each asset from the API's current
  class and company names, adds whole share counts without floating-point conversion, and reads the
  applicant-filtered application list only for a known investing role.
- Verification: the claim history has its own cache, and every claim page loads before a submission
  is offered, so a pending claim on a later page still prevents a second one.
- Directory and Applications: a draft application reads every verified Base wallet page and computes
  its fixed-price total in integer cents with `BigInt`
  (`packages/shared/src/utils/applicationAmount.ts`); Applications shows the recorded values without
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

Next: [frontend UX standards](frontend-ux.md), [mobile](mobile.md), [authentication](security.md#authentication-and-sessions),
[company workflow API](backend.md#company-workflow-api) and [testing](testing.md).
