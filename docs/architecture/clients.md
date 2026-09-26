# Clients and the shared package

[Architecture](README.md) · [Documentation](../README.md)

How dashboard and mobile consume shared TypeScript and design tokens.

`packages/shared` is consumed from source: `main` and `types` in its
`package.json` point at `src/index.ts`, which re-exports `constants`, `types`,
`services`, `utils` and `hooks`; there is no build step and no `dist/`. The
`hooks` barrel ships `ApiClientProvider`/`useApiClient` and shared hooks, so `react` and `@tanstack/react-query` are
`peerDependencies` supplied by the importing client. Mobile must supply one copy
of each: `metro.config.js` reanchors both specifiers to `mobile/index.ts`,
`jest.config.js` maps them to `mobile/node_modules`, and
`mobile/scripts/shared-peer-resolution.mjs` (the last step of
`check-resolution.mjs`) fails if a real Metro resolution from `App.tsx` and one
from a shared hook disagree.

- The dashboard resolves it through the root npm workspace link
  (`node_modules/@ledova/shared` to `packages/shared`); Vite and `tsc -b` follow
  the symlink to its real path outside `node_modules`, so the sources are
  transformed and type-checked as application code.

Every client import is `from '@ledova/shared'`. `packages/shared/src/services`
holds the API call functions both clients share; each takes the caller's axios
instance as its first argument, so each client keeps its own interceptors.

The dashboard's signed-in pages are listed once, in `DESTINATIONS`
(`packages/shared/src/constants/ui/destinations.ts`), each with its address,
title and audience. The dashboard builds its signed-in routes from a map keyed
by that table, so TypeScript refuses an entry without a page or a page the table
lacks, and each route hands its page the title from the same entry, detail
pages included. The audience is `everyone`, `investing` or `company`, and
`canOpen(role, audience)` says who may open it: an investor opens the pages for
everyone and for investing, a company those for everyone and for companies, and
a dual-role account all of them. Every signed-in route is guarded by
`ProtectedRoute` with its entry's audience. A signed-out visitor goes to sign
in. Email verification issues a full session before sign-up is finished, so a
signed-in account whose profile does not say `isSignupCompleted` goes back to
the account-type step, the first after email verification; the later steps
fill their forms from what was saved. A signed-in account whose profile cannot
be read sees an error with a way to try again, not a guess. A signed-in person
who cannot open the page goes to `landingFor(role)`, which replaces the refused
address. Every page shows the session check until the profile is known, and an
investing or company page until the role is known as well, so no page appears
on the way. If the account cannot be read, it says so and offers Try again
instead of deciding with a guessed role. Once the role is known, the sidebar
offers only pages the role can open. Signing in, and verifying an email, which
also signs a new person in, clear what the tab cached for whoever was signed in
before, as signing out does, so a new person is never guarded by, or signs up
against, the previous person's account. Buying crypto and sending are actions on
Wallets for every account, not menu items, and the dashboard has no coin-price
page or favourites; Home's market card still lists coin prices until Holdings
replaces it. The Buy step shows each asset's current price in the display
currency, and no price while the exchange rate is unknown. Both flows are
mounted in the signed-in frame, so an open flow survives
Wallets reloading its wallet list and the person leaving Wallets. The guard
decides pages, not data: the API still decides which rows a person sees, and
answers 404 for one it refuses.
`landingFor(role)` decides where a signed-in person lands: an investing account
on its home, and a company or dual-role account on its company. The front door,
sign-in, the end of sign-up, the signed-out pages and the trading fallback all
use it; the front door and the signed-out pages wait for the role before
choosing, and the trading fallback runs behind the guard, which has already
waited for it. The eight steps after the create-account form are listed once,
in `SIGNUP_STEPS` (`dashboard/src/routes/signupRoutes.tsx`), and `signupRoutes`
places every one inside `SignupRoute`: an account that has finished sign-up
goes to `landingFor(role)` instead of reopening one, while an account still
signing up and a signed-out visitor move through them as before. Email
verification refreshes the session answer before it moves on, as sign-in does,
so in the in-app flow the steps read the profile once, before any form, and a
later recheck of the session does not take away a step being filled in. One case
remains: if the session check itself fails as a step loads and succeeds on a
later recheck, the step is replaced while the profile loads, and what was typed
into it is lost.
The signed-in frame (sidebar and phone bar) appears only for a signed-in account
that has finished sign-up, which `useSignupFinished` decides; sign-in, sign-up
and everything else use the public layout. The frame marks itself with
`InSignedInFrame`, and a guarded page renders only inside it. The guard and the
frame read the same queries but hear about them separately, and the guard also
re-renders when the role arrives, so it can admit a page a moment before the
frame appears. The page keeps showing the session check until then, rather
than rendering once in the public layout. Since the sidebar's Sign out is not
shown there, the public layout gives any signed-in visitor a Sign out button in
its header, through `AuthLayoutAction`, so an account still signing up can
always leave. The not-found page reads the same
decision: inside the frame with a link to `landingFor(role)` for a finished
account, and otherwise in the public layout with a link to sign in, or, for an
account still signing up, back into sign-up. It shows nothing until its own
decision and the frame's agree, so, like a guarded page, it never appears in
the wrong layout for a moment.
The mobile app does not read the table yet.

Inside the frame, every signed-in page renders in `Page`
(`dashboard/src/components/Page.tsx`), and so do the route guard's own waiting
and failure states, so each shows its page's title.
`routes/every-page-titled.test.tsx` renders every real page with empty data and
checks its title. The title and the page's actions share one row on the
content's own edge, above the content or its loading state; on a phone too
narrow for both, the actions wrap under the title. The frame holds only the
sidebar, with the notification bell beside the logo, and on a phone a top bar
with the menu, the logo and the bell. It has no header bar and no footer; only
the public layout has a footer.

The design tokens are the single source of colour, spacing and radius values.
`make generate-tokens` runs `packages/scripts/generate-css-tokens.mjs` with
`tsx` over `packages/shared/src/constants/ui/design-tokens.ts` and writes
`dashboard/src/styles/tokens.css` and `marketing/src/tokens.css`, raw generator
output and prettier-ignored. Tailwind v4 reads that `@theme` block and derives
the utility classes (`bg-surface-base`, `text-text-body`,
`border-border-subtle`). Never edit either file: CI regenerates them after `make
build` and fails on any drift. The web clients have one look, paper, and no
theme switch. `PAPER_COLORS` is the palette. The marketing site uses it
directly (`bg-paper`, `text-ink`, `border-rule`, `bg-ledger`). `PAPER_THEME`
maps it onto the theme tokens, which are the generated defaults, so the
dashboard's `bg-surface-*`, `text-text-*` and `brand` classes, and any code
that reads `PAPER_THEME` for colours such as charts, render in paper. Both
clients bundle Newsreader for display text and Instrument Sans for everything
else. The mobile app still reads the dark and light palettes, and moves to
paper in its own change.

Mobile resolves the package through its Metro configuration and local workspace
link. Run `npm --prefix mobile run check:resolution` after dependency/resolution
changes. Internal shared imports are relative; `make check-self-imports` refuses
self-imports through the public barrel. These checks complement type checking.

Next: [authentication](authentication.md), [mobile security](mobile-security.md),
[mobile lifecycles](mobile-lifecycles.md), and [mobile builds](../development/mobile-builds.md).
