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
- [Automatic data freshness](#automatic-data-freshness)
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
site cannot import it, because its Docker context is `site/`. The package declares
`"sideEffects": false`, so the dashboard's bundler drops shared code no page imports.

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

| `dashboard/src/`      | Owns                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`, `App.tsx` | `main.tsx` mounts the providers (`QueryClientProvider`, `ApiClientProvider` with the `apiClient` singleton, `RouterProvider` from `createBrowserRouter`, whose `LoadFailure` error page offers Try again), fonts and stylesheets; `App.tsx` keeps the member-record provider around `Layout` and the route table                   |
| `routes/`             | The whole route table (`PAGES` with `signedInRoutes`, the sign-up and public routes, each page loaded on demand from `lazyPages.ts` under one `Suspense` with `RouteLoading`) and the guards (`ProtectedRoute`, `SignupRoute`, `RootRedirect`, `PublicOnlyRoute`) with their waiting and failure states                            |
| `pages/`              | One folder per page with its `index.tsx` entry and its own files, sub-pages nested inside it, and a `shared/` folder for files several pages under one folder use                                                                                                                                                                  |
| `components/`         | The UI kit (`Page` and `PageAction`, `Ledger`, `Modal`, `Field`, `iconSizes`), the signed-in frame (`Layout`, `Sidebar`, `MobileHeader`, `NotificationBell`) and public layout (`AuthLayout`, `Footer`) with their parts and contexts, group folders such as `auth/`, and single components several areas show (`AwardStatus.tsx`) |
| `hooks/`              | App-wide hooks with no JSX: profile, role and sign-up state, register access, sign-out, theme, identity verification                                                                                                                                                                                                               |
| `services/`           | Browser bindings, whatever their users: the axios instance with its interceptors (`apiClient.ts`) and the device stores built from the shared store factories                                                                                                                                                                      |
| `utils/`              | Browser and pure helpers used by more than one area or the frame (`siteUrl.ts`, `saveFile.ts`, the session resets) and the web-only paths (`paths.ts`)                                                                                                                                                                             |
| `styles/`             | `index.css` and the generated `tokens.css` ([design tokens](#design-tokens-and-themes))                                                                                                                                                                                                                                            |
| `testSupport/`        | Render helpers for tests in more than one folder, and the one import path to `packages/shared/tests/fixtures`                                                                                                                                                                                                                      |

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
Profile, operator and publication-list reads live once in `packages/shared`; client adapters retain
their current session, cache, labels and result policies. `site/src` is a separate flat app (one
file per page in `pages/`, `components/`, `styles.ts`) that cannot import the shared
package; only the file-naming rules apply to it.

## Frontend layers

Each layer owns one kind of code and imports only the layers below it; code moves up only when a
second user needs it, as on the [backend](backend.md#backend-layers). `pages/publications/` is the
reference page. Where a rule and a file disagree, the rule wins and the file is the backlog;
existing code is being brought in line under [#1065](https://github.com/Ledova/ledova/issues/1065).

| Layer                                  | Owns                                                                                                                                         | Never contains                                                                                | Reference                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Route table and guards (`routes/`)     | `PAGES` keyed by `DESTINATIONS`, the sign-up and public routes, guards with their waiting and failure states, where an account lands         | A page's files other than its entry; page content; reads beyond the session and access checks | `dashboard/src/routes/pages.tsx`                                                               |
| Page entry (`index.tsx`)               | One route: its parameters, hash and navigation state, the owner boundary, and `Page` with its title row and sections fed by hooks            | `useQuery`, `useMutation`, `apiClient` or a service call; another page's files                | `dashboard/src/pages/publications/index.tsx`                                                   |
| Page files (beside the entry)          | The page's sections and dialogs, its hooks and its pure helpers, told apart by file name                                                     | `components/` or `hooks/` subfolders; a file a second page imports                            | `dashboard/src/pages/publications/Resolution.tsx`, `dashboard/src/pages/home/ownershipView.ts` |
| Shared page code (`shared/`)           | Files that two or more pages under that page folder import                                                                                   | Route entries; a file one page alone uses                                                     | `dashboard/src/pages/company/shared/RegisterDecisions.tsx`                                     |
| UI kit and frame (`components/`)       | The kit, the frame and public layout with their contexts, and group folders or single components for UI that several areas or the frame show | Imports of `pages/` or `routes/`; in kit files, queries or domain rules                       | `dashboard/src/components/Ledger.tsx`, `dashboard/src/components/auth/`                        |
| Data hooks (`use<Thing>.ts`)           | `useQuery` and `useMutation`, the exported key factory, the owner guard, cache timing and invalidation; values and actions ready to render   | JSX; another module's key written out; raw error text                                         | `dashboard/src/hooks/useOwnershipCompanies.ts`                                                 |
| Services (`services/`)                 | `apiClient` (CSRF retry, the submission guard, friendly network errors) and the browser device stores                                        | API call functions; React                                                                     | `dashboard/src/services/apiClient.ts`                                                          |
| Utils (`utils/`)                       | Client-only helpers and web-only paths used by more than one area or the frame                                                               | React; API calls; logic mobile also needs on the same libraries                               | `dashboard/src/utils/siteUrl.ts`                                                               |
| Types                                  | A type beside its only user; API-derived and cross-client types in `packages/shared/src/types`                                               | Hand-written API shapes; a dashboard `types/` folder; client prop types in the shared package | `packages/shared/src/types/domain/publication.ts`                                              |
| Shared package (`packages/shared/src`) | What both clients need (query hooks, pure utils, constants, contract types) and every API call function, even one only one client calls      | JSX beyond `ApiClientProvider`; DOM or native APIs (stores take an injected storage)          | `packages/shared/src/services/publications.ts`                                                 |

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
   deleting the client copies. (Logic each client builds on its own platform libraries stays per
   client.)
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
  `hasError`, `isRefreshing` and `retry` (`dashboard/src/hooks/useOwnershipCompanies.ts`).
- **Account boundary.** Work bound to the signed-in account takes its owner from
  `useSubmissionOwner`, and the page renders it in an inner component keyed by the owner, so pending
  work never crosses accounts. Its query keys carry the owner and every request passes
  `ledovaSubmissionGuard`, which `apiClient` checks, so a late reply cannot reach another account
  (the owner key in `dashboard/src/pages/home/OwnershipBrowser.tsx`, the guard in
  `dashboard/src/pages/company/ledger/shared/useRegisterGrants.ts`). Mobile adds the session epoch
  ([session scope](mobile.md#session-scope)).
- **API client.** Shared services take the axios instance first. Shared hooks read it with
  `useApiClient()` and never take it as an argument; dashboard hooks import the `apiClient`
  singleton, which `main.tsx` also gives `ApiClientProvider`. Every endpoint a client calls has its
  function in `packages/shared/src/services`;
  [the API type drift gate](gates.md#the-api-type-drift-gate) accounts for each operation, not for
  where it is called.
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
- **Errors and waiting.** A failed request reads as a `role="alert"` sentence, the kit's `Failure`
  ([validation](frontend-ux.md#validation)). Read a status with `failureStatus`, never an inline
  cast. A page's first read renders `<Page loading>`; a failed read shows `LoadError` with Try again
  ([loading, empty and error states](frontend-ux.md#loading-empty-and-error-states)).
- **Formatting.** Figures, amounts and dates use the shared formatters (`formatMoney`,
  `formatShareCount`, `shareCount`, `shareChange`, `sharePercentage`, `formatCryptoBalance`,
  `formatDate`, `formatDateTime`;
  [dates, numbers and identifiers](frontend-ux.md#dates-numbers-and-identifiers)).
  Never define a local formatter or pass a displayed amount through `Number` or `parseFloat`.
- **Naming and exports.** A page folder takes the last fixed segment of its address and sits in the
  folder of the nearest page whose fixed address begins its own: `/company/ledger/:uuid/transfer`
  is `pages/company/ledger/transfer/`. An address that only adds a parameter to that page is `detail/`
  (`/company/ledger/:uuid` is `pages/company/ledger/detail/`), and a `detail/` folder never holds sub-pages;
  an address that renders another's page (`/member-records`, `/company/ledger/setup`) has no
  folder, and the not-found page is `pages/not-found/`. Page folders and `components/` groups are
  kebab-case (`eligibility-requests/`, `member-records/`). A file is named after its main export, or after what
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
   address, title and audience.
2. Create its folder by the [naming rule](#frontend-rules) with an `index.tsx` that default-exports
   the page rendered in `Page`.
3. Declare it in `dashboard/src/routes/lazyPages.ts`, so it loads on demand, and add it to `PAGES`
   (`dashboard/src/routes/pages.tsx`); TypeScript refuses the table until both exist, and
   `signedInRoutes` adds the title and `ProtectedRoute`.
4. Read and write through a `use<Thing>.ts` beside the entry over shared services. A new endpoint
   gets its service and contract types in `packages/shared` first; add a shared hook when mobile
   needs the same logic.
5. Build it from `Page`, the ledger blocks, `Modal` and `Field`
   ([signed-in page conventions](frontend-ux.md#signed-in-page-conventions)), one `PascalCase.tsx` per section or
   dialog. Put section navigation in the sidebar by its `DESTINATIONS` key; use `LinkRow` or a
   contextual action for an individual record or task.
6. When a second page needs one of its files, move the file by the placement rule in the same
   change.
7. Describe the page in its business section and add its [Pages](#pages) row.
8. Add a test only for a core journey and within the caps, then run `make preflight`.

A feature inside an existing page follows steps 4 to 6 in that page's folder. A sign-up step is a
folder under `pages/signup/`, added to `SIGNUP_STEPS` and to the step map in `routes/`.

## Routes, audiences and guards

`DESTINATIONS` (`packages/shared/src/constants/ui/destinations.ts`) lists the signed-in pages with
their address, title and audience. The whole dashboard route table is in
`dashboard/src/routes/AppRoutes.tsx`, using `signedInRoutes` from `PAGES`
(`dashboard/src/routes/pages.tsx`), a map keyed by that table, so
TypeScript refuses an entry without a page or a page without an entry. Every page is a
`React.lazy` import in `dashboard/src/routes/lazyPages.ts`, so the browser downloads only the
pages it opens. The routes share one `Suspense` whose fallback, `RouteLoading`, shows a spinner
without a heading on a first load. Every signed-in route, the Certificates, Company documents and
company dashboard routes included, renders through `signedInPage`, so a navigation between them keeps
the same guard and the current page until the next one is ready, and focus then moves to its heading.
An error while rendering a page, such as an old file that no longer downloads after a release, shows
`LoadFailure` with Try again, which reloads. Each route, detail pages included, gets the entry's title through
`PageTitle`. The web-only `pageTitle` mapping
(`dashboard/src/utils/destinations.ts`) titles `home` Dashboard; the other titles, Ledger and its
tasks included, are the shared ones. `/member-records` is an alias of `/home`, and `companyRegisterSetup` and
`companyRegisterImport` render the same page. Outside the table sit the
[sign-up steps](#sign-up-routes) and `/company/dashboard` (`COMPANY_DASHBOARD_PATH` in
`dashboard/src/utils/paths.ts`, routed in `dashboard/src/routes/AppRoutes.tsx` under `ProtectedRoute`
with audience `everyone` and title Dashboard).

`canOpen(role, audience)` lets an investor open `everyone` and `investing` pages, a company
`everyone` and `company` pages, and a dual-role account all; a role outside the API's list opens
only `everyone` pages. `landingFor(role)` is `/company/ledger` for a company or dual-role account
and `/home` otherwise. It receives a refused address (replacing it), a signed-in visitor on the
create-account page and a finished non-company account that opens a sign-up step.

`/` (`RootRedirect`) sends a signed-out visitor to sign in and an unfinished account into sign-up:
to `/signup/company-registration` when the account may open company pages and its full name has more
than one word, otherwise to `SIGNUP_RESUMES_AT`. A finished account opens the unified Dashboard.
Pending member invitations take precedence, then an eligibility request link kept through sign-in
(`dashboard/src/utils/requestLink.ts`). Sign-in navigates to `/`.

`ProtectedRoute` (`dashboard/src/routes/ProtectedRoute.tsx`) guards each signed-in route with its
entry's audience:

- A signed-out visitor goes to sign in. On the eligibility request page, a company's request link
  (`?to=`) is kept for the session first; an account that can't open that page drops it.
- A session check that fails is not a sign-out. `/auth/verify` answers `valid: false` to anyone
  signed out; that answer, or a 401, means signed out. `useAuth`
  (`packages/shared/src/hooks/useAuth.ts`) retries any other failure once, then reports
  `isUnavailable`, and this guard and `RootRedirect` show `SessionUnavailable` ("We could not
  check your session") with Try again, keeping the address. A failed re-check of a confirmed
  session shows the same message, and a check paused offline or in a hidden tab still counts as
  checking. Mobile doesn't read `isUnavailable`: a failed check still returns it to Sign in.
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

The web frame has no workspace selector or personal mode; it remembers only each account's last
company in the browser ([choosing a company](frontend-ux.md#choosing-a-company)).
`CompanyContextProvider` (`dashboard/src/components/CompanyContextProvider.tsx`) and
`useCompanyContext` (`dashboard/src/hooks/useCompanyContext.ts`) share the selected company with the
Dashboard and task navigation. Dashboard is the only company switcher; task pages inherit its
selection without another picker. The address's `company` query identifies it; an explicit record's
company context takes precedence. An address that names no company opens the remembered company, or
the first in the person's list. When the named company is unavailable, company-specific content uses
`CompanyContextNotice` (`dashboard/src/components/CompanyContextNotice.tsx`) to link to Dashboard.
Account-wide Profile, own appointments and invitation acceptance stay available. Company
relationships come from current company access, appointments and real member associations,
including draft companies with no classes. Selection changes neither account audience nor authority.
Company changes confirm before discarding an edited, still-open form, including browser Back and
Forward through React Router’s `useBlocker`; held Ledger or member work prevents those changes. The confirmation is bound to the current account
and location. Authorised deep links and invitations remain usable without visiting Dashboard first.
Class details and Ledger preparations use `dashboard/src/pages/company/ledger/shared/useRecordCompany.ts`
to add the resolved record's company to an address that has none. A conflicting explicit company
withholds that record and its form.

The sidebar (`dashboard/src/components/Sidebar.tsx`) names shared destinations by `DESTINATIONS` key
and web-only destinations by their address. Ledger's label opens its overview; a separate caret
expands Issue shares (`#issue`), Transfer shares (`#transfer`) and Corrections (`#corrections`),
marking the active child and opening the group on Ledger routes. The web replaces an incoming
`#history` with `#corrections` without dropping company/class context; shared task names retain
History. Shareholders' label opens its people list, with the same caret pattern for Employee scheme,
Member access and Member requests.
Documents opens one Certificates page (`/documents/certificates`), with Published (Published to
your members, `/company/publications`, for the company's own account), Inspection copies and Company
pack where company access permits them. There is no separate Your certificates item. Legacy
Dashboard `#documents` and company Ledger `#certificates` or `#documents` links redirect to Certificates,
preserving company, class and navigation state. A group without a meaningful overview opens its
default child, without an extra Overview page or duplicate navigation.
Company eligibility (`/company/eligibility`) follows Documents for an administrator or a prepare or
approve appointee (`canReviewEligibility`). Its sidebar label is Eligibility. A company administrator (`canManage`) also
gets its caret, with Supporting (Company documents, `/documents/company`) beneath it.
Settings uses the same one-level pattern: Profile, Team and Activation where permitted; a group with
one permitted page, such as a member's Documents or Settings, is a plain link to it. Its default
is Profile (`/settings#profile`), combining personal details, permitted company information, a
linked member's Company-recorded details and one compact Account card for identity status,
password, appearance and notifications. These sections keep their separate records, editors and authority checks. Existing
`/user-profile`, `/company`, `/settings#account` and `/settings#company-recorded-details` links redirect
to Profile, and `/company#documents` redirects to Company documents.
`useSettingsNavigation` (`dashboard/src/hooks/useSettingsNavigation.ts`) supplies current access;
Team remains available for company-invitation acceptance; Profile keeps an acceptance
entry under Manage account before company access is granted. The sidebar has no More group or Help & Support link;
pages without a sidebar item retain their existing audience and permission checks. Team keeps Representative
authority as a contextual task, with its existing owner and audience checks.
Each group opens on its routes and marks the active destination. Ledger, Shareholders and Documents
stay siblings where the selected company's current access permits them. Certificates combines the
permitted company records and the person's own linked records in one list; company output actions
still require register access, and member actions require a current association.
Direct Settings children have their own active item
and omit Back to Settings; a contextual page marks its nearest sidebar parent, such as Team
on Representative authority and Shareholders on a shareholder's page. The register hashes switch the
visible view without unmounting register forms or their recovery ([page mechanics](#page-mechanics)).
The sidebar and phone drawer are 208 pixels wide (`lg:ml-52`), with page content beside them in a
bounded grid. Its navigation scrolls between the brand header and footer. The footer shows the
person's name and, below it, the selected company, both as small single-line text with ellipsis and
full-name titles, retaining their stored capitalization. Its items are links, and below `lg` the
drawer is a dialog
([navigation](frontend-ux.md#navigation)). Native navigation is declared separately
([navigation](mobile.md#navigation)).
The footer owns the passive current-company label across signed-in pages. Functional pickers,
company fields, multi-company records and exact legal or retained targets keep meaningful identities;
page headings and collection wrappers do not repeat the context name.

### Sign-up routes

`SIGNUP_STEPS` (`dashboard/src/utils/paths.ts`) lists the steps after the create-account form:
email confirmation, account type, pre-screening, user profile, financial profile, company
registration and review. Identity verification is not a step: when `useSignupReview` reports
`identityRequired`, company review offers **Verify your identity**, which opens the
`IdentityVerificationModal` that Profile uses. The step map in
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

## Client sessions and caches

Browser blob downloads use `dashboard/src/utils/saveFile.ts`: it clicks one temporary link, removes
that link and revokes the object URL after 60 seconds. Each caller keeps its own filename, MIME type
and authority checks.

The session itself is in [authentication](security.md#authentication-and-sessions);
`packages/shared/src/hooks/useAuth.ts` owns the authentication query (`AUTH_QUERY_KEY`).
`ApiClientProvider` gives the shared hooks the client's API instance ([API
client](#frontend-rules)); the web authentication and user-preferences identity queries revalidate on focus and reconnect,
separately from page-data reads, while mobile's `QueryClient` (`mobile/App.tsx`) turns off focus revalidation and wires no online manager. Authentication retries a failed request once,
except a 401; a later mount may recheck. The hook exposes fetching, including a paused check,
separately from the first session check, so a retry does not restore initial loading, and public
forms keep their nested authentication consumers mounted so a failure cannot create a remount loop.
The protected route hides protected content while a cached negative is rechecked, redirects after a
negative answer or a 401, and otherwise shows `SessionUnavailable`.

On the web, signing in and verifying an email (which also signs a new person in) remove every cached
query except the authentication root, then await an exact authentication refetch. Signing out and
account deletion mark authentication invalid before clearing the whole cache. These two reset
sequences share `dashboard/src/utils/session.ts`. Mobile clears the whole cache whenever the sign-in screen gains focus, and on sign-out and
account deletion. A new person is never guarded by, or signs up against, the previous person's
account. Mobile adds a session epoch to every read and write ([session scope](mobile.md#session-scope)).

The shared `useUserPreferences` query starts only after authentication, and cached preferences are
hidden again when authentication is lost.

## Automatic data freshness

Pages have no routine Refresh or Sync button for their lists. Read on entry and when the person
selects another company, class or record. Invalidate the narrowest related query keys after a
successful change, using existing TanStack Query hooks and cache timings. Do not clear the whole
cache, refetch unrelated resources or introduce a second store or event system. Session resets
remain the exception described above.

Signed-in web pages do not poll while idle or refetch because of window focus, visibility or
reconnection. Web query defaults enforce that page-data policy. Another person's changes appear on a later
entry read or browser reload; the interface does not promise live synchronisation. Keep loaded
content stable until a relevant read is needed, without mounting another workflow's reads behind
an overview. Certificates re-reads the member list on entry; Profile's Company-recorded details reads only the
selected record and its requests, using the member list the company directory already holds, so opening Profile
never empties the company context. Both read only while open, retaining
unfinished drafts and original-request recovery across navigation.

`dashboard/src/hooks/useEntryReads.ts` and
`dashboard/src/pages/company/ledger/useIssueEntryRead.ts` retain ordered entry reads:
confirm current authority or association before dependent records, and defer a read while an editor,
decision review or original-request recovery is open.

Authentication and user-preferences identity checks, token renewal and checks of a genuinely running
operation are separate from idle page freshness. Authentication verification alone confirms validity,
so user preferences still recheck the signed-in identity on focus and reconnect; unconfirmed identity
continues to withhold private content, including after an account changes in another tab. Keep bounded status checks for a submitted upload, extraction or identity
verification, stopping when the operation finishes or its view closes. A status read must never
repeat a write, upload or share issue.

Every read and command retains its account, company, association, appointment and source guards.
Cached client authority never replaces the server's check. A failed or inconsistent read withholds
private records, decision controls and ownership totals. Preserve drafts and original submitted
commands during revalidation, following [request recovery](#recovering-a-submitted-company-request).

A failed read offers Try again through `LoadError`; this is error recovery, not routine freshness.
Keep bounded request retries and genuine failures visible. An intentionally cancelled Axios request
is still rejected unchanged but is not logged as an API failure; never hide network, server or
authorisation failures or turn a cancelled read into an empty successful result.

## Lists, figures and currency

Every list follows these rules:

- Web list filters use the UI-only `FilterPopover`
  (`dashboard/src/components/FilterPopover.tsx`); pages retain their data and field state. Certificates
  keeps Apply/Clear drafts, while Shareholders' class and company eligibility's outcome
  retain immediate selection. Member requests uses debounced person
  search and immediate request-type selection inside its panel. Shareholders keeps Search people inside
  its panel above the class selector, with its existing debounce, Clear and match counts.
  Every filter icon sits in the page heading's top-right actions, without a separate row or
  card-specific placement, apart from Dashboard's class details card
  ([UX](frontend-ux.md#lists-search-filters-and-paging)). Page-level owners pass `Page.actions`;
  deeper owners use `PageActions`
  (`dashboard/src/components/Page.tsx`), a UI-only portal to the stable header target supplied by
  `PageActionsTarget` (`dashboard/src/components/PageTitle.ts`). Filter state stays under its owner.
  Hidden retained views explicitly omit their header contribution; their controllers remain mounted.
- `Table` and aligned collections share `TABLE_SCROLL_CLASS` and `TABLE_HEADER_CLASS`
  from `dashboard/src/components/List.tsx` for horizontal overflow and muted, transparent headers.
  Keep collections flat within their outer `Section`, with subtle row dividers and no inner rounded
  border or shaded header. Native table cells retain their padding; aligned lists retain their
  column grid. Preserve numeric alignment, semantics, detail lifetimes and unboxed editors.
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
safe range is marked unavailable, not rounded. Share arithmetic uses whole integers
(`wholeShares`).

Every amount names its currency (`formatMoney`).

The company ownership ring uses Apache ECharts, with only its pie chart and SVG renderer
loaded when the desktop overview is visible. Use one ring and a linked class list, with the existing
design tokens and a bounded chart area. Hover or keyboard focus links each list row to its segment;
the centre shows the exact total or highlighted class quantity. Keep class colours consistent across
the ring and the list, including search and paging. Use a small segment lift and short hover/focus
transitions, without an entrance animation that could replay during fresh reads.
Keep hover feedback in the centre and linked list rather than a duplicate floating tooltip; honour
reduced motion, including changes while the page is open. Every class remains selectable in the list,
including classes with no issued shares; do not merge small classes into an artificial Other class.
Long class lists use the shared search and 25-row pager. Narrow screens and a failed chart load keep
the same list without the ring. Other delivered charts retain their existing SVG implementation.
Do not add a second chart library or a general chart framework. Visible quantities and percentages
use exact share arithmetic; only normalised drawing coordinates use JavaScript numbers. The ring
represents issued share counts, not voting power or economic value.

Company-authorised ownership overviews read company-scoped aggregates, then fetch the selected class's holders with
server-side search and paging. The selected class uses one ranked horizontal bar list in the server's
largest-first order, with exact quantities and within-class percentages always visible. Bars use the
full class's issued shares on a shared 0–100% scale through search and paging; do not renormalise the
visible subset, inflate tiny holdings or introduce an Other group. Do not fetch every shareholder in
every class to draw an overview.
Bind detail reads to the overview's register sequence; a changed sequence rereads the overview.
Account, company and appointment guards and incomplete-read states remain in force; ownership reads
share the owner-scoped holdings query family so ordinary register changes invalidate them together.
Do not introduce periodic dashboard polling. Unopened classes withhold company
totals and the ring; an inconsistent read withholds the overview. These rules are checked in review
and the existing Ownership browser journey, within the dashboard suite cap.

The member Dashboard receives an optional aggregate ownership summary within its existing
association-bound record read. Sharing is off by default and changed only through current company
administration; the server retains the latest actor and time. It exposes class totals and that
member's own class quantities, with no other holder identity, position, private terms or documents.
The web uses the same ring renderer and a page-owned class list; selecting a class highlights the
member's position without reading other holders. Company holder endpoints remain company-authorised. Clear the shared view with
the rest of the member record during revalidation, account/company changes and failed reads, and
remove it when a fresh read reports sharing off. Reuse the existing member read lifecycle; add no
timer or manual refresh control.

## Recovering a submitted company request

Any company-run request (register command, award, vesting event, grant, external allotment or issue
decision) may reach the server though its reply is lost. Forms recover the same way, so an uncertain
reply never becomes a second effect:

- A form keeps its original command, operation identifier, appointment and, for a decision, its
  preview and decision key after an interrupted response or a failed refresh. Its inputs and company
  context stay held until that command is recovered.
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

`packages/shared` holds the client layer for the company-run register commands the web app runs
(imports, corrections, particulars changes, grants, transfers and allotments); the chain and wallet
commands' client layer went with their pages under
[#1452](https://github.com/Ledova/ledova/issues/1452). It has:

- a service for each list, preview, decision, preparation and document download;
- a check of each prepared proposal against every field of its request
  (`isPreparedRegisterImport`, `isPreparedRegisterParticularsChange` and siblings for corrections,
  grants, transfers and allotments);
- the decision families for `useRegisterDecision` (`REGISTER_*_DECISIONS` in
  `packages/shared/src/hooks/useRegisterDecision.ts`) with the generic receipt check;
- copy with a sentence for every requirement a decision can leave unmet.

The web's base class read in `dashboard/src/hooks/useRegisterClasses.ts` and holder reads in
`dashboard/src/pages/company/shared/useCompanyRegister.ts` receive their caller's original owner
guard. Company register controllers use `dashboard/src/pages/company/shared/ownerGuard.ts`.
The reads check the guard before and after each request and pass it as `ledovaSubmissionGuard`, so
a late reply after an account change or reauthentication is discarded. Query keys and cache timing
stay unchanged.

The standalone preparations are `companyRegister*` entries in `DESTINATIONS`:
`/company/ledger/setup`; import, correction and transfer under `/company/ledger/:uuid/`
(`import`, `correct/:entry`, `transfer`); and particulars changes at
`/company/ledger/members/:member/particulars`. Setup is the import page without a class in its
address: it chooses or creates a share class, then prepares the mirror import.
Non-paid and employee-award grants are prepared inline in Issue shares.

On the web, setup's shareholder editor and later shareholder/class pages share
`dashboard/src/pages/company/ledger/shared/DocumentAttachments.tsx` for optional categorised
files. Setup uploads supporting evidence before preparation and includes it in that member's
proposal; company source copies stay at opening scope. The shared register-member-documents service
validates each returned company, member and class against the query. Later attachment lists and
downloads use these retained links, not a public storage URL
([attachment rules](../business/register.md#shareholder-documents)).

The web setup's **Allocation history** is independent of **Current shares held** and starts empty.
Its **Add allocation** heading action keeps one editor open, retains unfinished input when switching
and folds checked entries into compact summaries. Allocation, document and draft-row actions use
the existing descriptive text buttons. Full-width entry fields have **Remove** beneath them;
collapsed summaries have **Edit** and **Remove** together. **Add shareholder** or **Save changes**
finishes the shareholder. Historical quantities
neither set nor limit the current holding; new paid/unpaid blanks normalize to zero
([form conventions](frontend-ux.md#forms)).

Every decision uses the preview-first `useRegisterDecision`, in a dialog or the web's main-page
issue, transfer and particulars reviews. It previews the exact decision, its unmet requirements in
words and its register effect, takes a rejection reason
([how a company decision works](../business/README.md#how-a-company-decision-works)), and confirms
with a retry key reused only for the same preview while the step's appointment is still the one
previewed. The investor's final Approve and a transfer's Approve each send one combined command
(approval with the issue, or approval with the transfer), never an approval followed by a
client-side application request. A review in place stays open when a refresh withdraws its step,
saying so with its confirmation disabled. Form inputs are described with each procedure in
[the register of members](../business/register.md).

The web register's repeated row wrappers, stage rows and download failures use
`dashboard/src/pages/company/ledger/shared/RecordShell.tsx`, and the Ledger's records show their
decisions through `dashboard/src/pages/company/ledger/DecisionTrail.tsx`. Four records (import, correction, particulars change and transfer) use
`useRegisterTaskGuard.ts` for their existing visible-task check, while grant, allotment and award
keep their distinct guards and wrappers. The preparation pages share `PreparationShell.tsx` for
Back and read-only paragraphs, and
`useRegisterPreparationOwner.ts` for the same account boundary and preferences reads. Page and form
keys, held work, specialised refusal states and the import title remain with their pages.

## Design tokens and themes

`packages/shared/src/constants/ui/design-tokens.ts` is the single source of design tokens.
`buildColors()` turns a palette into the semantic colours the dashboard, the site and mobile all use
(`surface`, `text`, `brand`, `border`, chart and status colours), building both themes with the same
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
Tailwind v4 derives the utilities; web radii, type sizes and font weights are Tailwind's defaults.
A separate `@theme static` block retains the six chart colours selected dynamically by chart code.
The following `:root[data-theme='dark']` block sets `color-scheme: dark` and each colour variable's Dark
value; the generator fails if the themes would emit different variables. The site also uses
`border-border-faint` and `brand-tint`. Never edit either file: `make check`, which CI runs, fails
when they differ from the generator's `--check` output.

Before the first paint, a script in `dashboard/index.html` applies Dark (`data-theme="dark"` on `<html>`,
with its `theme-color`) only when `ledova.theme` (`THEME_STORAGE_KEY`) in browser storage is exactly
`dark`; anything else means Paper, the default (`parseTheme`), and the `ledova-theme` key of an
earlier, removed switch is not read. The choice is written only when someone picks a theme and stays
in that browser, not on the account, through reloads and sign-out.

The dashboard's switches (Settings > Profile > Account > Dark theme, and the `ThemeToggle` icon in the
signed-out and sign-up header, the desktop sidebar's account footer and the small-screen signed-in
header) use `dashboard/src/hooks/useTheme.ts`. The public site's navbar has its own theme toggle
and `ledova.site.theme` preference, applied before the first paint in `site/index.html`. Only an
exact saved `dark` value enables Dark; Paper is the default, including when storage is unavailable.
The site neither reads nor writes the dashboard's preference, even when both share an origin.
Its screenshot provenance and update procedure are in the
[site guide](../../site/README.md#product-screenshots).

The dashboard stylesheet defines a `dark:` variant that follows `data-theme`, never the operating-system
setting, for theme-specific adjustments: the
active sidebar item's `bg-brand-tint`, and signed-out primary buttons without their green glow. The
identity check's widget opens in its dark theme on Dark. Both web clients bundle Newsreader for
display text and Instrument Sans for everything else (`@fontsource-variable`).

## Pages

Each page links to its business section. Shared destinations use their `DESTINATIONS` audience;
web-only routes declare the same guard beside their address ([guards](#routes-audiences-and-guards)).

| Page and business section                                                                                    | Routes                                                                                                                                                                       | Audience  |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| [Dashboard](../business/README.md#the-app-at-a-glance)                                                       | `/home`, `/company/dashboard` and `/member-records` (web aliases); company/class query context                                                                               | everyone  |
| [Certificates](../business/member-records.md#certificates)                                                   | `/documents/certificates`; legacy Dashboard `#documents` and `/company/ledger#certificates` or `#documents` redirect with company/class context                              | everyone  |
| [Ledger, Shareholders, Employee share scheme and company outputs](../business/register.md#the-register-page) | `/company/ledger` and `#shareholders`, `#member-access`, `#member-requests`, `#awards`, `#inspection-copies` (legacy `#ledger-exports`), `#company-pack`; preparation routes | everyone  |
| [A shareholder's page](../business/register.md#a-shareholders-page)                                          | `/company/ledger/members/:member?company=`                                                                                                                                   | everyone  |
| [An employee award's page](../business/issuing-shares.md#employee-awards-and-vesting)                        | `/company/ledger/:uuid/awards/:award?company=`                                                                                                                               | everyone  |
| [Share class](../business/register.md#the-share-class-page)                                                  | `/company/ledger/:uuid?company=`                                                                                                                                             | everyone  |
| [Company information, Team, Activation](../business/companies.md#the-company-page)                           | `/settings#profile`, `/company/authority` and `/company/authority/requests/:uuid` (company), `/company/team`, `/company/listing`                                             | everyone  |
| [Company documents](../business/companies.md#company-information-and-documents)                              | `/documents/company`; legacy `/company#documents` redirects with company context                                                                                             | everyone  |
| [Company eligibility](../business/participants.md#company-eligibility-decisions)                             | `/company/eligibility`                                                                                                                                                       | everyone  |
| [Published to your members](../business/publications.md#the-published-page)                                  | `/company/publications`                                                                                                                                                      | company   |
| [Notices](../business/publications.md#the-notices-page)                                                      | `/publications`                                                                                                                                                              | everyone  |
| [Verification, Your company eligibility](../business/participants.md#the-verification-page)                  | `/investor-eligibility`, `/eligibility-requests`                                                                                                                             | investing |
| [Profile and member settings](../business/participants.md#profile-and-settings)                              | `/settings#profile` (default); aliases `/user-profile`, `/company`, `/settings#account`, `/settings#company-recorded-details`                                                | everyone  |

### Page mechanics

- Dashboard: `dashboard/src/pages/home/OwnershipBrowser.tsx` combines current company relationships,
  opening the company last used in this browser (or the first in the person's list) and changing it
  through `CompanyPicker` inside the page heading's top-right **Switch company** popover. It reuses
  `FilterPopover` with a company icon and label, and lists the companies in the panel; the shared
  presentation owns no company state. The switcher
  hides for single-company accounts. The class details card holds its own **Filters** popover for
  the server-searched holder list and the **Share class** choice, whose **All classes** returns to
  the overview.
  An unavailable explicit company address keeps its refusal and offers **Open your company** when
  only one company remains. Selection still uses `CompanyContextProvider` and its navigation guards.
  Company and class context belong in the address, so browser Back/Forward and task links retain the
  selected scope.
  `dashboard/src/pages/home/useCompanyOwnership.ts` owns company aggregates and sequence-bound
  holder reads. `dashboard/src/pages/home/useOwnershipMember.ts` reads only the selected member
  association. `dashboard/src/hooks/useOwnershipCompanies.ts` merges company and member indexes with
  current appointments for the directory. The overview keeps its ownership ring
  (`dashboard/src/pages/home/OwnershipRing.tsx`), linked class list and exact metrics in the page folder. Company-authorised readers obtain sequence-bound, server-paged holder details;
  members obtain only their own position and the optional shared aggregates from the existing
  association-bound read. A real member link, not a matching name or company appointment, supplies
  the personal position. No full-register reads are needed just to list companies.
  Static, data-free placeholders reserve loading space, and confirmed figures appear directly.
  Getting started lists only incomplete company-administrator tasks and disappears once they are
  complete. Read-only awards remain separate entitlements, with the promise and nonzero lifecycle
  quantities above their full breakdown and terms in **Show award details**.
- The Certificates page (`dashboard/src/pages/documents/certificates/index.tsx`) combines company-authorised
  certificate preparation and association-bound member tracking in one class-selected list. Company
  reads mount only with confirmed register access; member-only access never reads the full company register.
  `CertificateRecords.tsx` merges matching company and own entries without duplicate rows. Aligned
  rows show the shareholder or change, shares, entry, date and status, with permitted actions at the
  row's end and earlier requests beneath; rows don't expand. Each record keeps its class visible; the page heading's
  top-right icon button with the accessible name and tooltip Filters opens `FilterPopover` for draft class,
  shareholder search and certificate status. The heading has no repeated filter summary or match
  count; dismissing the panel preserves the unapplied draft.
  Apply writes `class`, `q` and `certificate_status` to the URL; Clear preserves the class and removes search and
  status. Company entries are filtered on the server before paging; own-member history is read
  fully and filtered locally. Other certificate requests remain outside the entry filters. Request
  status always comes from the person's own readable requests, separately from company certificate
  eligibility. Preparation opens a focused main-page form. The existing
  preparation, request, withdrawal and recipient-download controllers retain their separate guards;
  preparing a company PDF does not fulfil a member request.
- Certificates and Profile's Company-recorded details share an owner-bound member-records controller.
  Profile groups current particulars and update-request records in one card, side by side on
  desktop and stacked on smaller screens, with one shared action footer. Request update opens a
  focused inline form; successful submission closes it and clears consent, while pending requests
  keep the requested particulars and status visible together. The controller retains an unfinished
  particulars draft in memory across navigation within the same account and company, without browser
  storage. Choosing a class on Certificates reads that class's own entries. Active web reads follow
  [automatic data freshness](#automatic-data-freshness); they never replay a member action.
- Ledger on the web (`dashboard/src/pages/company/ledger/index.tsx`): one page renders the
  Ledger overview, Issue shares, Transfer shares, Corrections, Shareholders, Member access,
  Member requests, Employee share scheme, Inspection copies and Company pack views by hash.
  Legacy certificate hashes redirect to the dedicated Certificates page.
  Ledger stacks its share-class summaries as full-workspace-width `Section` cards, with the shared
  card heading, padding and page spacing. Add share class sits in a right-aligned row below the
  cards, including the empty collection card. The default internal quantity ceiling is omitted from
  these summaries; finite class limits remain visible. Task views show their selected workflow rather than the
  ownership overview or header task switches. It keeps every class's controllers for register
  decisions mounted, merely hidden, so changing view, task or class (the Share class selector)
  keeps an unfinished request with its class, payload and retry key. People and member controllers
  also stay mounted across the three Shareholders views. Member requests keeps the full permitted
  particulars and certificate request arrays for selected requests and
  recovery. Member requests stores `q` and `request_type` in the URL; `searchRows` matches every
  name word, ignoring case and accents, before unmatched rows are hidden. Held work disables its
  controls and bypasses filtering for the active workflow, without changing any request's status.
  Controllers
  report held work (an unfinished form, or a decision busy or awaiting recovery) under keys naming
  their task, class and any record (`allotments/`, `transfer/`, `corrections/`, `awards/`, `grants/`;
  member access separately). While anything is held, the page keeps its retained company and class
  scope, prevents company changes, disables class selection and other sidebar tasks, and pins held task
  work to its task and class. The held task's sidebar link remains available from a sibling view
  so its original request can be resumed. `dashboard/src/components/LedgerNavigation.ts` carries
  this scope and navigation readiness between the page and frame, including `shareholderView` for
  held person saves and member actions. Direct navigation elsewhere offers a link back to the
  original form or action. A selection lasts one navigation
  (`location.key`). Links built by
  `registerPlace` (`dashboard/src/pages/company/ledger/shared/registerPlace.ts`) pick the company
  (or the class's company), class and task hash and focuses that class; with a record it focuses that
  record instead and shows its outcome line. `inviteMember` chooses the invitation's recipient on
  Member access.
  Corrections shows immutable recorded entries in rows that don't expand, and retained supporting records
  as titled records with their details and permitted downloads, alongside their capability-guarded append-only maintenance workflows. Register-read
  access alone grants no mutation. Inspection copies keeps class inspection-copy preparation;
  Company pack stays at company scope. `documentTask` isolates one focused output form in the existing
  frame. Its keyed forms retire previews when their context or source readiness changes; draft
  retention depends on each form's lifetime. Current appointment and exact-source validation still
  apply. Supporting attachments stay with their person, class or company Settings; member-request
  fulfilment stays under Shareholders. Employee share scheme uses the
  shared class-card spacing and shows only the selected class, with one preparation action below its records.
  Share class selection lives in the page heading's Filters popover and locks while award preparation or its recovery is open; all class controllers stay
  mounted. Preparation replaces that class's award list while preserving its controllers. Each award row
  links to `pages/company/ledger/award`, which reads the award, its class register, grants and appointments,
  hosts `AwardRecord`'s vesting and entitlement-change forms, and publishes its held state through
  `LedgerNavigation` so `CompanyContextProvider` blocks leaving while an outcome is uncertain. A section whose
  read succeeded empty is omitted, while a failed read keeps its
  retry and an uncertain decision its recovery. Private content renders only while its view is
  visible, its reads have settled and `hasCurrentRegisterReadAuthority` confirms a current
  register-read appointment.
- Choosing a person on the web: register setup, investor and non-paid issues, transfers and employee
  awards read one people list (`dashboard/src/pages/company/ledger/shared/usePeople.ts`, the
  `register/members/` read validated by `isRegisterImportMembers`) and render `PersonSelect` and
  `PersonFields` (`shared/PersonPicker.tsx`), the searchable list in
  [choosing a person](frontend-ux.md#choosing-a-person).
  Member invitations give `PersonSelect` the company's holders and award recipients from
  `invitationMembers`.

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
- Register reads: the web reads the person's appointments through Team's account-bound cache and
  rereads them after a revocation on Team or Representative authority, a refused decision or
  preview and a recorded decision other than an import's (which refreshes the imports, the register
  and its entries). Entries load newest first, a page per Load more: an entry a later page repeats
  is listed once, a page with a non-whole share change fails, and a corrected or reversing entry
  reads as not loaded yet until its page arrives. A proposal of another company or class, an
  unreadable holding and a correction lookup answering with entries it was not asked for fail the
  read. Each repeated control is named for screen readers after its visible label and its entry or
  proposal.
- Company: reads the selected company's complete detail; an edit sends only changed fields.
- Published to your members: reads the selected company's publications with `issuer` set, newest
  first, a page at a time with Load more; the card title carries the server's complete count. A
  document opens only while every loaded page is current.
- Verification: the claim history has its own cache, and every claim page loads before a submission
  is offered, so a pending claim on a later page still prevents a second one.
- Settings on web: the sidebar owns its destinations. Profile uses one standard workspace for
  personal, company and account sections, keeping each editor's data and authority separate. One Account
  card holds relevant identity status, password, appearance and notifications; Manage account contains
  export and deletion. Payslip evidence lives with investor classification claims. Documents and Team
  stay focused pages; Activation keeps its existing company workflow. Signup and the mobile
  Account tab keep their own navigation.
- Profile on web: account deletion clears cached account data after the server confirms.

Next: [frontend UX standards](frontend-ux.md), [mobile](mobile.md), [authentication](security.md#authentication-and-sessions),
[company workflow API](backend.md#company-workflow-api) and [testing](testing.md).
