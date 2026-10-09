# Clients and the shared package

[Architecture](README.md) · [Documentation](../README.md)

How dashboard and mobile consume shared TypeScript and design tokens, and the
conventions every signed-in page follows. The `company`/`investing` account
audience selects navigation, not company authority: company actions follow the
person's current appointments, backend checks remain authoritative, caches and
pending actions are scoped to the selected company and session, and controls
are withheld after a failed read. The delivered company workflows are listed in
the [implementation index](../plans/company-managed-registers/README.md); the
register runbook and each increment guide describe what their screens do.

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

Wherever this page says a list reads every page, it does so through
`readEveryPage` (`packages/shared/src/utils/pagination.ts`): it asks for page 1,
follows each `next` link by the page number the link names, and returns the rows
in page order. A read fails whole when a page fails or when a `next` link names
no later page, so a stalled or malformed link is never presented as the end of
the list. Lists that load further pages on request check each page's link the
same way with `assertNextPageAdvances`.

## Routes, roles and the sidebar

The dashboard's signed-in pages are listed once, in `DESTINATIONS`
(`packages/shared/src/constants/ui/destinations.ts`), each with its address,
title and audience. The dashboard builds its signed-in routes from a map keyed
by that table, so TypeScript refuses an entry without a page or a page the table
lacks, and each route hands its page the title from the same entry, detail
pages included. The audience is `everyone`, `investing` or `company`, and
`canOpen(role, audience)` says who may open it: an investor opens the pages for
everyone and for investing, a company those for everyone and for companies, and
a dual-role account all of them. A role outside the API's list opens only the
pages for everyone, on both clients, and lands on Holdings. Every signed-in route is guarded by
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
offers only pages the role can open, in groups:

- a company's own group first, named after the company, with Register, Offerings and
  Company.
- _Your shares_ for every account;
- _Invest_ for an investing account, with Market only while trading is on;
- then Wallets, Profile and Settings.

Each item takes its name and address from its entry in `DESTINATIONS`, so a
menu label always matches the page's title. Activity keeps the `/transactions`
address. Holdings replaces the crypto home at the existing `/home`
address. Notices at `/publications` lists documents, resolutions and dividends
addressed to the person. Accounts without the company role reach Register from
Settings on the web and the drawer on mobile once they hold register access
through a current appointment.

`landingFor(role)` decides where a signed-in person lands: an investing account
on Holdings, and a company or dual-role account on Register. The front door,
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
Native stacks and sign-up routes remain declared separately; the native drawer
reuses titles from `DESTINATIONS`.

Signing in, and verifying an email, which also signs a new person in, clear
what the tab cached for whoever was signed in before, as signing out does, so a
new person is never guarded by, or signs up against, the previous person's
account. On mobile, reads and writes carry the captured session epoch through
the transport guard, so credential lookup, token refresh and late UI callbacks
cannot carry a result into a replacement session, and document copies, ballots
and drafts are bound to the account, company and session they opened under.

## What each page does

Every list follows the same rules: it reads every page or loads further pages
on request, a failed first read offers a retry rather than an empty list, a
failed later page keeps the known rows and labels the list incomplete, a failed
refresh withholds stale rows and their actions until a retry succeeds, and an
open form keeps its draft through a failed refresh while holding its write
until a read succeeds. Exact decimal strings are kept for share counts, prices
and amounts; a legacy count outside JavaScript's safe range is marked
unavailable rather than rounded. A failed file delivery is distinguished from
an unavailable stored document, and on mobile a company, account or session
change retires a pending document action. The paragraphs below say what is
specific to each page; the [register runbook](../operations/register-foundation.md)
holds each register command's rules and API.

**Register** is the company landing page on both clients and a page for every
signed-in account on the web, at `/company/register`; the API decides which
registers it shows, and with nothing readable the page says there is no company
register to show. It reads every page of the share classes the person may read,
as the company owner or through a current appointment holding administration
or a register capability, groups them by company and, where the person can
read more than one company, reads only the selected company's stored
registers: current members, linked wallets, exact issued and authorised shares,
the register CSV download and the inspection-copy preparation, with unopened
registers and unknown or positive waiting-effect counts stated. Each class then
lists its register entries, newest first a page at a time with Load more (an
entry a later page repeats is listed once, a page with a share change that is
not whole fails and offers a retry, and an entry's corrected or reversing entry
reads as not loaded yet until its page arrives), its
[imports](../operations/register-foundation.md#importing-an-existing-register),
[corrections](../operations/register-foundation.md#compensating-corrections),
[openings](../operations/register-foundation.md#opening-the-register-from-the-chain)
and latest [reconciliation](../operations/register-foundation.md#reconciling-with-the-chain);
the company's [particulars changes](../operations/register-foundation.md#changing-a-members-particulars)
and [wallet links](../operations/register-foundation.md#linking-wallets-after-the-opening)
follow in sections of their own. Each proposal shows its stage, preparer,
dates, terms, authority, decision trail, any rejection reason and its
document's download; one that predates its command being company-run says
whether platform staff verified the evidence, and a particulars change, which
was company-run from the start, notes that the company provided the document.
A proposal of another company or class, a mapping or holding that cannot be
read, and a correction lookup that answers with entries it was not asked for
fail the read. The reconciliation shows status, block, compared sequence, time,
any failure and each discrepancy in words with its acknowledgement; rows
needing attribution say so and offer nothing, and a class without a
reconciliation says so.

The person's own current appointments decide which steps a proposal offers:
approval and rejection need administration or `approve`, application
administration or `apply`, and preparation administration or `prepare`; only
an active appointment before its expiry counts, a retained staff-era proposal
offers only rejection, and a reader with none of these steps sees the history
with a read-only note. The web reads the appointments through the same
account-bound cache as Company team; mobile Register reads them itself and
hides every register action while they cannot be read. Both read them again
after a revocation on Company team or Representative authority, after a
decision, preview or acknowledgement the server refuses, after a
waiting-wallets read refused as not found, on mobile after a pull to refresh,
and, for every command but imports, after a recorded decision; a recorded
import decision refreshes the imports, the register and its entries. Every
decision opens the shared preview-first dialog, `useRegisterDecision`, which
previews the exact decision, its unmet requirements in words and what applying
records, and confirms it with a retry key reused only for the same preview
while the step's appointment is still the one previewed; on mobile the dialog
closes when a refresh withdraws its step. A discrepancy is acknowledged through
`useDiscrepancyAcknowledgement` with a reason of up to 1,000 characters; the
dialog keeps the appointment it opened with and holds confirmation if a refresh
changes it. Every read, upload, preview, decision, acknowledgement and
preparation is bound to the signed-in account and the session the screen
opened under, and each repeated control is named for screen readers after its
visible label and the entry, proposal or discrepancy it concerns.

### Register command screens

Each preparation opens a page of its own (routes in the
[shared client layer](#the-shared-client-layer)); on mobile it opens in the
same stack. Every form takes the company's upload, keeps the upload's retry
key and confirmed receipt, reuses its operation only for an identical request,
refreshes the proposals once the receipt is confirmed, takes a new operation
after a conflict, shows the server's words on a refusal, and gives way to the
read-only note once a refusal as not found shows the appointment is gone.

| Action                   | Offered to                                                                                                                 | What the form takes and does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prepare an import**    | Administration or `prepare`, while the class has no applied import                                                         | The company's current share register and ASIC extract, the register date, the authority, the member rows, former members and the stated ASIC figures. An opened class lists one row per current holder with member and shares fixed; a class whose register is not opened takes rows under new member IDs with editable shares. The stated figures must match the rows before preparation. The decision preview shows the comparison with the stored register, the stated and imported figures and, before an application that opens the register, the note that the class will not be on chain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Correct this entry**   | Administration or `prepare`, on each correctable entry                                                                     | Reads the entry by its ID and shows it with the exact inverse a correction records; takes the authority document, the authority, the approving director of a resolution, the reference, the reason and an effective date no later than today (UTC), defaulting to today. The preview adds the original and compensating changes and the register sequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Open this register**   | Administration or `prepare`, while a deployed or paused class's register is not opened                                     | Reads the class's holdings on chain at the current block, largest first, and refuses holdings that are not whole shares; a chain that cannot be read says so with a retry, and a class the server will not open shows its reason instead of the form. The holdings are read again only on request (Reload the holdings or Retry) or after a conflict, never on focus or reconnect, and Prepare is held while the holdings, the appointments or the class are being read again. An address already linked keeps its member; every other address is assigned on the page to a linked member or to a new member under a client-generated ID that several addresses may share, labelled as the Register will list them. Choices are kept by address, dropped only when the address no longer holds or is now linked or its member is no longer offered, and the page then says the choices were reset. A refusal with the holdings-moved code shows the reason and offers to reload the holdings, keeping the authority details and every choice that still applies. The preview adds the opening entry's effective date and shares by member, with the boundary note before approval and the holdings note before application; a staff-era opening whose boundary was never captured says so |
| **Change particulars**   | Administration or `prepare`, on each current member of an opened class                                                     | Finds the member among the current members of the companies where the person may prepare, names them as Register does or neutrally, and takes the company's supporting document, the new name and residential address, an as-at date no later than today (UTC), defaulting to today, and the reason. The preview shows the current particulars, or that none are recorded, beside the proposal, with the note that the latest as-at date wins between imports and changes while a live verified identity wins over both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Link waiting wallets** | Administration or `prepare`, once the company's waiting-wallets read returns a wallet; otherwise a note says nothing waits | Lists each waiting wallet in the order a link records it, with the number of effects waiting for it and, for information only, whether its holder proved control of it on Ledova and the holder's name, shown only for a wallet on the company's whitelist. Each wallet starts as its own new member and is never matched to a member by name; the person maps it to a current member of the class registers or to a new member under a client-generated ID that several wallets may share. Choices are kept by address and reset only when the wallet no longer waits or its member is no longer offered, which the page announces (on iOS and in a polite live region on mobile). Only waiting wallets are offered, although the API accepts any address. Takes the authority document, the authority, the approving director, the reference and the reason; the preview lists each address with its member and the application note                                                                                                                                                                                                                                                                                                                                                    |
| **Acknowledge**          | Administration or `approve`, on an acknowledgeable discrepancy                                                             | A reason of up to 1,000 characters, then reads the reconciliation again; a refusal also reads the appointments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

A class page at `/company/register/:uuid` shows class state, the stored
members and the history of its company-authorised deployment, chain grants,
paid issues, capital increases and pause changes, each prepared, approved and
applied under company authority with saved recovery of an uncertain reply
within the session ([implementation index](../plans/company-managed-registers/README.md)).
Certificates, notice figures and the company pack are still prepared by
platform staff on written instruction.

**Company** reads the selected company's complete detail and every page of
its share classes and team; administrators edit company information and
documents, sending only changed fields, activate the company and invite,
delegate and revoke appointments
([authority guide](../plans/company-managed-registers/authority-requests.md),
[company information](../plans/company-managed-registers/company-information.md),
[activation](../plans/company-managed-registers/company-activation.md)); the
old application submit, resubmit and withdraw actions are retired. Company
lists Application and Published to your members under its details and each
share class and the Register under its classes.

**Offerings** lists every offering of the selected company and every
subscription to the selected offering, followed by directory visibility.
Subscriptions show requested and allotted shares separately, including zero
allotments; payment recording stays a platform-staff workflow, and the
company's paid-issue panel prepares, approves and applies the original issue
under company authority. The create and edit forms check price, ordered
bounds, dates and the available settlement choices before submission, set the
window in the device's local time on mobile, require a removed settlement asset
to be removed from the draft explicitly, list the company's uploaded offer
documents to attach, keep an edited offering's attachments until one is
switched off, and refuse quantities above the 2,147,483,647 request limit; an
approved or closed offering has Add documents instead, whose attached documents
are ticked and disabled and which sends only the new choices, and a dialog
opened on an offering that has since left approved or closed says so and sends
nothing ([offerings](offerings.md)).

**Published to your members** opens from Company at `/company/publications`
and in the mobile app, reading the selected owned company's publications with
`issuer` set into one Publications card whose title carries the complete count;
[shareholder publications](shareholder-publications.md#in-the-members-everyday-views)
describes it and **Notices**. Loading and failed company or publication reads
block document actions, a retry never presents a partial list as complete, and
document delivery failures remain visible.

**Holdings** reads every page of the person's wallets and lists their
tokenised security holdings by company and class, one row per asset across
chains, using the API's current class and company names where available and
the asset's combined name otherwise, so a missing class lookup never removes a
holding; whole share counts are added without floating-point conversion and
expand into chain and wallet balances. Below the shares, _Needs you_ links to
draft applications and payment instructions and counts resolutions awaiting
the person's vote; _In progress_ lists applications under way and counts
dividends awaiting a company payment record, which is not proof of a bank
transfer; _Recently published to you_ lists the three latest notices, each
with its company, kind, date and until when its vote is open. These are
personal reads, and only a known investing role reads the applicant-filtered
application list. Actions open the application detail or Notices; nothing
submits, pays or votes from Holdings.

**Verification** shows the person's eligibility sources and complete claim
history in a cache of its own, and **Your company eligibility** (**Eligibility
requests** on mobile) lets them request a decision from one company or an
approved offering; **Company eligibility**, reachable from Holdings and
Company team, lets a current company approver read the queue and accept,
refuse or revoke
([company eligibility](../plans/company-managed-registers/company-eligibility.md)),
and holds the company's wallet nominations and instructions
([wallet approvals](../plans/company-managed-registers/company-wallet-approvals.md)).
Every claim page loads before a submission is offered, so a pending claim on a
later page still prevents a second one, and a failed background read keeps an
open claim's fields and selected file with a retry inside the modal.

**Directory** groups the accessible share classes under their company and
opens a class's current offering, with the documents attached to its approved
offerings; the first experience presents one fictional company and adds no
registry search. A draft application reads every verified Base wallet page,
computes its fixed-price total in integer cents, keeps its quantity and chosen
wallet through a failed refresh while hiding the application actions, and is
scoped to the offering, so a replacement offering starts fresh; a closed or
unavailable offering has no form, and the server still selects the applicant
and enforces quantity and eligibility. **Applications** presents the recorded
company, class, currency and payment instruction independently of current
Directory access, including the unaltered reference, leading zeroes, bank
details or raw settlement units, never falling back to generic payment rails;
a copy failure keeps the value available, and a recorded partial payment shows
the amount outstanding and asks the investor to confirm any further payment
with the operator.

**Market** presents For sale and Wanted lists with automatic matching; buyers
fund before placing an offer ([trading](trading.md)). Owned order history reads
independently of listed classes and wallets, the chosen wallet's allowlist
status gates creation, AUD totals use integer cents and new quantities use
exact integer strings within the signed 64-bit storage bound. Saved orders,
cancellations, changes, signatures and approvals are records on this device
for the signed-in account, read when Market loads and after each recovery (one
saved in another tab appears when Market is reopened on the web or pulled to
refresh on mobile), and sit in one Saved work section after Trades awaiting
signatures, shown only while something is saved or a message about them needs
showing, with one refresh that reads all three again.

**Wallets** reads every wallet page into a ledger of its own; each chain's card
lists its wallets with verification and signing preference as icons named for
screen readers, sync age, native balance to at most eight decimal places
(`formatCryptoBalance` in `packages/shared/src/utils/formatting.ts`) and AUD
value, labelled Value on the web and Estimated value on mobile, ordered by
decimal-string comparison (`sortWallets` in
`packages/shared/src/hooks/useWalletSort.ts`). On the web each row carries
Edit, Sync and Delete, with Verify and Derive address where they apply, a
failed sync is reported in its wallet's row, every Sync waits while one runs,
and Add wallet is a title action; on mobile each row opens the wallet's own
screen, which holds Verify address, Sync balances, Derive address and Delete
wallet, while Wallets' title row adds Sync balances for every wallet. Add,
edit, derive and delete keep refused input and stay open until success, and on
mobile a pending one cannot be dismissed or submitted twice; imports run one
address at a time and remember confirmed additions for retry within the same
import; mobile's software registration waits for the server after the
authenticated local seed storage. Buy crypto and Send are Wallets actions
rather than menu items. Buy crypto requires a personal `investor` or `both`
account and an owned receiving wallet, which the API checks again before
contacting the provider, and both clients refuse direct opening and late
responses after account or role loss
([#920](https://github.com/Ledova/ledova/issues/920)); when the purchase page
cannot be opened it gives the server's reason (`readApiError` in
`packages/shared/src/utils/errors.ts`) or "The purchase page could not be
opened. Try again.", never a proxy's error page. Send opens its form directly
when Wallets has read exactly one verified wallet on the networks it lists
(Ethereum, Bitcoin and Base), offering Cancel where Back would return to a
choice never made, and otherwise asks which wallet; the web counts the wallets
last read even while re-reading, mobile asks until the read has finished and
opens a lone Bitcoin wallet in the Bitcoin send form. Buy crypto goes straight
to the widget only when a finished read finds exactly one verified wallet on
the chosen asset's network. Every chooser reads every page, lists only the
networks Wallets lists, never says there are none before a read has answered,
and offers Try again without the request's error text; mobile's Send forms
wait for the chosen wallet's balances, say so with the server's reason when
they cannot be read, and keep Continue unavailable until they have been read.
Send offers crypto and payment tokens, including AUDY, and never shares.

**Activity** presents recorded wallet transfers read-only, with exact decimal
amounts, native fees and status; a share transfer's amount carries its class's
own symbol ([a share holding names its class](wallets-and-valuations.md#a-share-holding-names-its-class)).
Its history read does not depend on the wallet filter read, and a failed
selector page disables the selector without hiding history or clearing draft
filters; filters use only supported API fields, with date bounds covering
whole local days (block time on mobile, excluding records without one), and
each entry opens in place to its detail and explorer link.

**Profile and Settings** use the ledger sections for personal information,
identity status, security, notifications and data controls. Members edit their
own name, residential address and phone in Profile through Edit personal
details ([member profile](../plans/company-managed-registers/member-profile.md)).
The transaction-alerts switch is the `transactionAlerts` field of the one user
preferences record, read through `useUserPreferences` and saved with a partial
`POST` to `/api/user-preferences/`; mobile distinguishes an unavailable
preferences record from disabled alerts. Password changes, data export and
account deletion show failures and allow retry, and their mobile dialogs stay
open after a refusal and cannot close while a request is pending; deletion
keeps its confirmation dialog, states which records are retained, and clears
the tab's account data after the server confirms. Mobile Settings adds
biometric sign-in and app lock.

Where market values are shown, they are in AUD: the shared `useCurrency`
converts the API's US-dollar values at the current rate, shows a dash while the
rate is unknown, and neither client offers another currency. An offering's
prices and an application's amounts are in the offering's currency: a new
offering is priced in AUD, and one created before that rule keeps the currency
it was given ([decision](../decisions.md#the-signed-in-app)). The Buy step
shows each asset's current price, and no price while the exchange rate is
unknown. Both flows are mounted in the signed-in frame, so an open flow
survives Wallets reloading its wallet list and the person leaving Wallets. The
guard decides pages, not data: the API still decides which rows a person sees,
and answers 404 for one it refuses.

## The shared client layer

`packages/shared` holds the client layer for every company-run register
command, on which both clients' screens are built: a service for each list
(with the company, share class, member and status filters each family
takes), preview, decision, preparation and document download; a check of
each prepared proposal against every field of its request, with an opening's
or link's mapping narrowed at runtime and a link's address and member pairs
compared in any order and letter case (`isPreparedRegisterOpening`,
`isPreparedRegisterParticularsChange`, `isPreparedRegisterLink` and their
siblings); the decision families `useRegisterDecision` takes
(`REGISTER_OPENING_DECISIONS`, `REGISTER_PARTICULARS_DECISIONS`,
`REGISTER_LINK_DECISIONS` and the import and correction families) with the
generic decision receipt check; copy with a sentence for every requirement a
decision can leave unmet; and the preparation destinations.

| Command            | Preparation destination                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| Import             | `/company/register/:uuid/import`                                               |
| Correction         | `/company/register/:uuid/correct/:entry` (`companyRegisterCorrection`)         |
| Opening            | `/company/register/:uuid/open` (`companyRegisterOpening`)                      |
| Particulars change | `/company/register/members/:member/particulars` (`companyRegisterParticulars`) |
| Wallet links       | `/company/register/companies/:company/links` (`companyRegisterLinks`)          |

Its helpers order an opening's holdings largest first by exact share count,
check that every share count is whole, label each mapped member once (by name,
or numbered as an unnamed or a new member, through `registerLinkMemberLabels`
for links, so the page, the record and the preview give each member the same
label), and recognise a holdings-moved refusal by its `opening_holdings_moved`
code. Each wallet's proof is worded as the holder's own proof on Ledova, never
as a verification by Ledova.

## The page frame

Inside the frame, every signed-in page renders in `Page`
(`dashboard/src/components/Page.tsx`), and so do the route guard's own waiting
and failure states, so each shows its page's title.
`routes/every-page-titled.test.tsx` renders every real page with empty data and
checks its title. Each page opens with one title block on the content's own
edge, above the content or its loading state: the title row, 64 px high, where
the title and the page's actions share one row (on a phone too narrow for both,
the actions wrap under the title), and the page's lede directly under that row
when it has one. The first section follows the title block at the page's one
gap, the same gap as between sections (16 px on a phone, 20 px from 640 px and
24 px from 768 px), whether or not the page has a lede. The frame holds only the
sidebar, with the notification bell beside the logo, and on a phone a top bar
with the menu, the logo and the bell. It has no header bar and no footer; only
the public layout has a footer.

On mobile every signed-in screen renders in `Page`
(`mobile/src/components/Page.tsx`), except those named at the end of this
paragraph. `Page` is a scroll view on the paper that opens with one header
block: the screen's title in Newsreader at 36 (`fontSize.xxxxl`), marked as the
screen's header, then its lede directly under the title when it has one, then
its screen actions as one wrapping row of content-width `Action`s: a way back
such as Back to Directory, Back to Applications or Back to Company, Refresh on
Published to your members, New offering, Edit company, and
Wallets' Buy crypto, Send, Add wallet and Sync balances. Where the web
keeps the title and actions on one row, a phone's large title leaves no room, so
mobile keeps the lede with the title it describes and puts the actions after it.
The side padding is 24 (`spacing.lg`), and the first card follows the header
block at the same 24 as between cards, whether or not the screen has a lede or
actions. A screen's loading, access and failure states render in the same frame
under the same title; a company's share class is titled Share class until the
class is read, and then by the class. Each screen keeps its own pull to refresh
and keyboard handling, which `Page` hands to its scroll view. The stack header
above the page carries no title of its own, only the menu or back button and, on
a top-level screen, the bell, which in every stack opens the notifications and
shows the unread count. The exceptions keep a frame of their own: Help & Support,
the last row of the drawer's list, keeps its stack title and contact cards; the
Send, Transfer, Verify Wallet and Recovery Phrase screens are titled inside their
`Panel` card; and Buy crypto is its dialog over the plain paper, followed by the
provider's web view, both under a Buy Crypto stack title.

The sidebar's list holds its destinations and ends with Help & Support, a
footer-style link to the contact page that opens in a new tab. The list scrolls
on its own, so one too tall for the screen is cut at the rule above the foot. A
group label wraps rather than being cut short, so a long company name is shown
whole. The foot is one block: the person's full name, or the email when the
profile has no name, above Sign out, which keeps its icon and red hover and is
the public layout's `SignOutButton` in its sidebar variant. Mobile's drawer
follows the same rule: a company's group takes the company's name, wrapping
rather than cut short, and keeps Company until the name is read; its list ends
with Help & Support, which opens the Help screen, and a foot pinned below the
list names the person above Sign out.

## The ledger blocks

Pages rebuilt in the paper layout use the ledger blocks in
`dashboard/src/components/Ledger.tsx`:

- `Section`: a white card on the paper ground (`bg-surface-raised`, a
  `border-border` hairline, `rounded-xl`), with its Newsreader title inside at
  the top and no rule under it. The page's title row stays on the paper above
  the cards.
- `Rows`: ruled label and value pairs, with figures right-aligned in tabular
  numerals. Every amount names its currency (`formatMoney`), and share counts
  are whole numbers.
- `LinkRow`: a row that opens another page, named after its destination, with
  optional detail lines, an optional aside such as a status or a price, and a
  trailing chevron; the whole row is the link.
- `SwitchRow`: a row that turns a setting on or off, with its label, an
  optional muted sentence under it, and an On or Off pill at its end that is
  the switch itself (`role="switch"`), named by the label and described by the
  sentence.
- `Disclosure`: a row that opens in place: a button with `aria-expanded` and a
  leading caret that turns when open, controlling the detail directly under it,
  which it holds only while open. The detail is a landmark (`region`, labelled
  by the button) only when asked, as Activity's filter is; entries are not,
  since any number of them can be open. The page keeps whether it is open, so
  it can close it when what it shows changes; a list keeps its open rows with
  `useOpenRows` from `@ledova/shared`, as Activity, Holdings and the Register do.
- `Status`: a status in words after a small mark for waiting, moving, done or
  closed and, when it has one, a ✓ or ✗; screen readers read only the words.
- `Timeline`: each event with its date.

An empty section keeps its real title; the state is one muted sentence under
it, in the `text-sm text-text-muted` paragraph ("No activity yet.", "No
Ethereum wallets yet."), with at most one action, a `PageAction` or a
`LinkRow`, and no icon block. A state is never a section's title. Activity's
"Transfers" and each Wallets chain keep the same title whether or not they
hold anything; Directory, Applications and Notices list one section per
company, application or notice when they hold something, so their empty
section's title names what it would hold ("Share classes", "Your
applications", "Your notices"). Mobile's `Section` and `Action` follow the
same rule.

Actions use one language. `PageAction` is the button for whatever a page or a
section does, and it keeps its content width wherever it sits: in the title row
for the page as a whole (Edit company, Add wallet, Refresh, and the way back to the
parent page such as Back to Register, Back to Company, Back to Directory or Back
to Applications), inside a section for what that section does (Create share
class, Edit personal details, Change password beside its sentence), and in a row for what is
done to that row's record alone (each wallet's Edit, Sync and Delete on Wallets,
a submitted claim's Withdraw claim on Verification), so nothing is selected
before acting and no toolbar waits under a list. A page reaches each of
its own sub-pages, and each neighbour a section points to, from one place, a
`LinkRow` in that section, never also from a title action or an underlined
link: Company lists Application and Published to your members under its details
and each share class and the Register under its classes; Register lists a Share
class row inside each class; Settings lists Profile; Directory lists each share
class under its company, or a Verification row until the investor is verified;
Applications lists an Application row under each application, or a Directory
row when there are none; Verification lists a Directory row once the investor
is verified; and the apply form lists a Wallets row until there is a receiving
wallet. A destination the sidebar already reaches, such as Notices, is not
repeated in a title row. An underlined link is part of a sentence ("open
Notices") or opens an external resource such as a block explorer or a stored
document. Mobile's `LinkRow` and `Action` follow the same rule.

A list on a page is read and filtered in place rather than in a dialog. An entry opens
under its own row as a `Disclosure`, and the list's filter is a `Disclosure` at
the top of the list's card, above the entries or the empty sentence; closed, it
names the filters it applies. Opening an entry leaves any other open entry as it
is, so the row stays where it was pressed and two entries can be compared.
Applying or clearing the filter closes it and every open entry and returns focus
to the filter's button. Activity's Transfers works this way, so its title row has
no Filter action. Holdings and the Register have no filter, and their rows open
the same way, each a `Disclosure`: a holding to its shares by network and wallet,
a share class to its Share class row and stored register. Every row starts
closed. A dialog is kept for work that sets the page aside: a
form that creates or changes something, a signing step or a confirmation.
Wallets sorts each chain's list in place as Activity filters, on both clients:
a Sort `Disclosure` at the top of a chain's card, shown once the chain holds two
or more wallets, names the order it applies, and choosing one of its six orders
applies it at once, closes it and returns focus to its button, screen-reader
focus on mobile; each chain keeps its own order, so its title row has no Filter
action either. The bell's notifications belong to the frame rather than a page,
on both clients.

Mobile's Activity and Market follow the same rule with the `Disclosure` in
`mobile/src/components/Ledger.tsx`: a button marked expanded or collapsed, with
its caret on the summary's first line and its detail directly under it, indented
past the caret and held only while open. The detail is not announced when it
opens: as on the web, screen readers read the button's expanded state and then
the detail after it. Activity's Filter is the first row of the Transfers card,
closed at first and naming the filters it applies, so Activity has no screen
action, and its loading and failure states sit in the same card under the
filter, which stays at hand when a filtered read fails. Each entry is named by
its summary and opens its detail under its row, independently of the others;
applying or clearing the filter closes it and every open entry and moves the
screen reader's focus back to Filter. On Market, each of Your orders keeps its
rows and opens the rest of its details, from Total quantity to Order ID, under
them with Details, while changing or cancelling an order, signing and settling
stay dialogs. An order's Details, Modify and Cancel order name it as its row
shows it, by side, class, status, shares remaining (the order's own once none
remain) and price, never by its id. Both keep their open rows with the same
`useOpenRows` as the web's lists.

A setting that takes effect as soon as it changes has one control, a
`SwitchRow`: Transaction alerts on Settings and Show this company to eligible
investors on Offerings. Its `aria-checked` is the saved value; it is disabled
while a change is saving, keeps the saved value when the change is refused, and
the refusal is an alert in the same card. On the web a choice that is saved
with a form stays a checkbox, as the payment and document choices in the
offering editor and the declaration in a claim do. Mobile's `SwitchRow` puts the native switch at
the end of the same row, named by the label with the sentence as its hint, for
biometric sign-in, App lock and Transaction alerts on Settings and Show this
company to eligible investors on Offerings. The mobile offering editor's
payment and document choices are not in that row yet: each is still a bare
native switch under its own line of text.

A lede, the one muted sentence under a page's title, appears only where it says
what the titles do not: an instruction (Wallets, Activity) or a fact (Register,
Published to your members, the company of a Directory share class). `Page` sets
its `lede` in the title block, directly under the title row, as the heading's
description; a page whose titles
already say it, such as Directory, Applications, Verification or Notices, has
none. Other explanations stay in the section they explain, after the content
they serve: Market's Saved work follows Trades awaiting signatures, and Offerings
leads with Your offerings. Mobile's `Page` sets its `lede` directly under the
title, above the screen's actions.

Every section is its own card, including forms and things to act on such as a
payment instruction, and a dialog (`Modal` in `dashboard/src/components/Modal`)
is the same card over the dimmed page: its Newsreader title sits inside at the
top and labels it, its body scrolls inside the card when the screen is too short,
and its actions end the card as one right-aligned row of content-width
`PageAction`s (`ModalActions`), a plain Cancel, Close or Back before the primary
action. On a narrow phone the row wraps onto another line rather than
stretching. A group inside a card is set off by a rule or a small heading
rather than a card of its own, as the For sale and Wanted lists on Market, the
saved payslips on Profile, a vote's confirmation on Notices, the saved pause and
unpause requests on a share class and the steps of a signing dialog are
([decision](../decisions.md#the-signed-in-app)). On the signed-in pages and in
their dialogs a field is white with a hairline border (`rounded-lg border
border-border bg-surface-raised`), and warnings and errors are text rather than
tinted boxes: a warning is warning-coloured, usually beside its icon, and an
error is either error-coloured or in the plain or muted text around it. The one
exception is the extraction status beside each saved payslip on Profile, a small
tinted pill (Queued, Extracting, Extracted, or an error-tinted Failed) that labels
the file rather than holding a message. The one box a card keeps is a dashed
upload area, the payslip upload on Profile and the evidence file in a claim,
because its outline marks where a file goes.
Sign-in and the sign-up steps hold their forms in the same card on the public
layout, under the same Newsreader titles, and sign-up lists its password rules
as marked lines under the field rather than in a box. The rest of those forms
keeps its earlier look: their fields are tinted, the message at the top of a
form and the identity check's outcomes sit in tinted boxes, and a field's own
error is error-coloured text under it.

## Design tokens

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
that reads `PAPER_THEME` directly, render in paper. Both
clients bundle Newsreader for display text and Instrument Sans for everything
else. Mobile also uses fixed paper and bundles these fonts with a finite
loading/error/retry gate; the account stores no theme, and a theme an older
build saved on the device is not read. Shared tokens and the CSS generator contain only paper; the retired dark and light palettes are removed.

On mobile a dialog is `CustomModal` in `mobile/src/components/modal`, the same
card as `Section` (`useCardStyles` in `mobile/src/components/Ledger.tsx`) over
the dimmed screen and inside the safe area. Its Newsreader title is the card's
first element, marked as a header, and the card is marked
`accessibilityViewIsModal` for VoiceOver; React Native has no way to make the
title the dialog's accessible name as the web's `DialogTitle` does. Its body
scrolls inside the card, and its actions end the card as one right-aligned row
of content-width `Action`s (`ModalActions`), a plain Cancel, Close or Back before
the one primary action, wrapping onto another line rather than stretching. The
backdrop is a button that closes the dialog, and a busy dialog holds the
backdrop, Android Back and Cancel. The iOS date sheet in `DatePickerField` and
the Send, Transfer, Verify Wallet and Recovery Phrase screens (`Panel` in
`mobile/src/components/panel`) use the same card and action row; their stack
header has no title, so the card's title is the screen's only one. Inside them
nothing is boxed, as on the web: `Rows` draws a rule only between items and
`Row` and `LinkRow` draw none of their own, steps are numbered lines, fields
are white with a hairline border (`useDialogStyles`), a choice is an outlined
`Choice` marked selected rather than a second filled button, and warnings and
errors are text rather than tinted boxes: a warning is warning-coloured,
usually beside its icon, and an error is either error-coloured or in the plain
or muted text around it. Values set in monospace (the send review's addresses,
the signing summaries' values, a sent transaction's hash and the addresses in
the wallet dialogs) use the theme's `fontFamily.mono`, the system monospaced
face on iOS, as the web's `font-mono` does. The profile's identity dialog shows
the check's outcome as plain lines; the sign-up screens keep their tinted fields
and boxed outcomes, as on the web. Mobile's theme adds one spacing step, `smd`
(12), for the web's 12px spacing the shared scale lacks.

Mobile resolves the package through its Metro configuration and local workspace
link. Run `npm --prefix mobile run check:resolution` after dependency/resolution
changes. Internal shared imports are relative; `make check-self-imports` refuses
self-imports through the public barrel. These checks complement type checking.

Next: [authentication](authentication.md), [mobile security](mobile-security.md),
[mobile lifecycles](mobile-lifecycles.md), and [mobile builds](../development/mobile-builds.md).
