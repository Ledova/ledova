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
`hooks` barrel ships `ApiClientProvider`/`useApiClient` and shared hooks, so
`react` and `@tanstack/react-query` are `peerDependencies` supplied by the
importing client. Mobile must supply one copy of each: `metro.config.js`
reanchors both specifiers to `mobile/index.ts`, `jest.config.js` maps them to
`mobile/node_modules`, and `mobile/scripts/shared-peer-resolution.mjs` (the last
step of `check-resolution.mjs`) fails if a real Metro resolution from `App.tsx`
and one from a shared hook disagree. Run `npm --prefix mobile run
check:resolution` after dependency changes; `make check-self-imports` refuses
self-imports through the public barrel. The dashboard resolves the package
through the root npm workspace link (`node_modules/@ledova/shared` to
`packages/shared`); Vite and `tsc -b` follow the symlink to its real path, so
the sources are transformed and type-checked as application code.

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
pages for everyone. Personal accounts land on Dashboard on web and My shares
on native. Every signed-in route is guarded by `ProtectedRoute` with its entry's audience. A signed-out
visitor goes to sign in. Email verification issues a full session before
sign-up is finished, so a signed-in account whose profile does not say
`isSignupCompleted` goes back to the account-type step, the first after email
verification; the later steps fill their forms from what was saved. A signed-in
account whose profile cannot be read sees an error with a way to try again, not
a guess. A signed-in person who cannot open the page goes to `landingFor(role)`,
which replaces the refused address. Every page shows the session check until
the profile is known, and an investing or company page until the role is known
as well, so no page appears on the way. The web front door and successful sign-in check confirmed readable register
access before choosing a dashboard; a failed check offers retry instead of
assuming a personal account. Account preference alone does not select a company
workspace. The web-only `/company/dashboard` route uses the existing scoped
register API and the ordinary completed-signup guard. It shows exact issued-share
totals, current shareholders deduplicated across classes, and share-class counts.
The selected class has a compact shareholder table with quantity bars and
percentages of that class's issued shares. Multiple classes have an issued-count
chart; class rights may differ. Unopened classes make company totals incomplete,
and failed or inconsistent reads withhold totals and charts. Recent changes are
the selected class's recorded entries. Task links focus that class in its company
register, and history links open its recorded history. Personal member views use
their own projection, without company totals or other shareholders. New charts
need no chart library.

The compact web sidebar has Dashboard, Register, Employee awards and Documents
for readable company workspaces, with a separate Your shares link for personal
records. Other accounts have personal Dashboard and Documents at `/home#documents`.
Settings is a
separate configuration group: company details/classes, team appointments and
member access, plus personal profile/security and existing account settings.
Company setup remains reachable there even before a register exists. Optional
Notices, Activity, Wallets, investing routes and Offerings stay under More.
The page content starts beside the 208-pixel sidebar in a bounded aligned grid,
without the former centred gutter. The phone drawer uses the same width.

Native navigation remains the delivered four company destinations (Register,
Employee awards, Documents and Company), personal My shares/Profile/Settings,
and secondary More routes. Shared destination metadata and signup behavior are
unchanged by the web layout increment.

Personal Dashboard at `/home` on web and My shares in the native Home tab read the person's
associated member holdings and awards without a wallet. `/member-records` remains an alias.
The web dashboard uses compact panels for one selected company, with own issued
shares by class, awards when present, the latest three own changes for the
selected class, available certificates and visible request status. The first
own class's history loads when a member record opens; choosing another class
reads that class's own entries. A person can have both investor holdings and an
employee award. Award status bars use disjoint unvested, vested but unissued,
and issued quantities; issued award shares already belong to the holding.
Inconsistent award quantities withhold the chart. Personal Documents focuses
own certificates and receiving-entry requests without exposing company totals,
other shareholders or private company files. Particulars, longer history and
invitation acceptance stay reachable, with exact-request recovery and retained
certificate integrity checks unchanged. Wallet shares move
to `/wallets/holdings`, linked from Wallets. Employee awards and Documents use
`/company/register#awards` and `#documents`; these switch the visible section
without unmounting register forms or their original-request recovery. A failed
source read still withholds stale records and actions. Page-specific titles
reflect these views on both clients. Web member access uses
`/company/register#access`, reached from Settings or the register shortcut; it
keeps existing register submissions mounted and their recovery scope retained. Native register section parameters switch
the visible section while keeping the existing register subtree mounted.
Wallet shares remain available from Wallets.
Activity keeps `/transactions`, and Notices keeps `/publications`.

`landingFor(role)` retains the shared/native destinations: an
investing account on `/home`, and a company or dual-role account on Register.
The web front door and sign-in use the confirmed-access dashboard choice above;
refused-route and trading fallback behavior remains unchanged. Company signup
keeps Company details → Review, with one visible workspace authority/Terms
statement beside the final button, explicit initial admission and completion
together. Choosing **Complete company setup** accepts that declaration; there
is no separate checkbox. Supporting
documents and team invitations are available afterwards from dashboard Settings;
signup has no file upload or delegation picker. The
[authority guide](../plans/company-managed-registers/authority-requests.md#company-signup)
describes this flow.
An unfinished signup can reuse any current personal administrator appointment
for its company, retaining the appointment's original scope and declaration.
The final action records current Terms acceptance when needed rather than
requiring a new bootstrap or wider permissions. Acceptance already recorded
on a fresh signup appointment is reused; stale or ineffective authority cannot
complete signup.
Native company accounts with readable register access start on Register; those
without access start on My shares and reach setup from More. The eight steps after the create-account form are listed once,
in `SIGNUP_STEPS` (`dashboard/src/routes/signupRoutes.tsx`), and `signupRoutes`
places every one inside `SignupRoute`: a company account that has finished
sign-up goes to the company dashboard, and other completed accounts go to
`landingFor(role)`, instead of reopening a step. An account still
signing up and a signed-out visitor move through them as before. Email
verification refreshes the session answer before it moves on, as sign-in does,
so in the in-app flow the steps read the profile once, before any form, and a
later recheck of the session does not take away a step being filled in.

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
always leave. The not-found page reads the same decision: inside the frame with
a link to `landingFor(role)` for a finished account, and otherwise in the public
layout with a link to sign in, or, for an account still signing up, back into
sign-up. It shows nothing until its own decision and the frame's agree, so,
like a guarded page, it never appears in the wrong layout for a moment. Native
stacks and sign-up routes remain declared separately; the native drawer reuses
titles from `DESTINATIONS`.

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

**Register** is the company's register workbench on web, the native company
landing page, and a page for every signed-in account on the web at
`/company/register`; the API decides which
registers it shows, and with nothing readable the page says there is no company
register to show. It reads the share classes the person may read, as the
company owner or through a current appointment holding administration or a
register capability, groups them by company and, where the person can read
more than one company, reads only the selected company's stored registers:
current members, linked wallets, exact issued shares and configured class limits, with unopened
registers and unknown or positive waiting-effect counts stated. On both clients,
ownership appears first, followed by external allotments and their actual pending
decisions. Employee awards and non-paid issues have their own destination;
Documents holds register CSV, inspection copies and the company pack. The web
dashboard
and Register link to the guided Share details → Shareholders → Review setup for an
existing ownership mirror. It accepts manual entry, resumes pending
confirmations and offers a bounded correction of the latest opening; the
company retains its legal records and access arrangements. Member
invitations use named company members or award recipients with exact IDs retained
internally. Invitations, particulars, wallet links, other changes and technical
history sit in secondary disclosures, which preserve their mounted recovery state.
Each named award shows promised, vested, issued and available quantities. On
web its chart separates unvested, vested but unissued, and issued shares,
with Record vesting and Issue vested shares in context. Preparing its issue
returns to the same company and expands the existing non-paid issue decisions;
Approve and Record issue remain separate. Award, vesting, preparation and issue
recovery stay mounted through a failed read, with private content withheld until
current access is restored. Native Company holds member access and links to
company information and team; particulars and wallet links remain secondary. Each class then
lists its register entries, newest first a page at a time with Load more (an
entry a later page repeats is listed once, a page with a share change that is
not whole fails, and an entry's corrected or reversing entry reads as not
loaded yet until its page arrives), its
[imports](../operations/register-foundation.md#importing-an-existing-register),
[corrections](../operations/register-foundation.md#compensating-corrections),
[openings](../operations/register-foundation.md#opening-the-register-from-the-chain)
and latest [reconciliation](../operations/register-foundation.md#reconciling-with-the-chain);
the company's [particulars changes](../operations/register-foundation.md#changing-a-members-particulars)
and [wallet links](../operations/register-foundation.md#linking-wallets-after-the-opening)
follow in sections of their own. Each class also lists its
[non-paid grants](../plans/company-managed-registers/register-grants.md),
[transfers](../plans/company-managed-registers/register-transfers.md),
[employee awards](../plans/company-managed-registers/employee-awards.md) and
[external allotments](../plans/company-managed-registers/external-allotments.md);
those guides own their rules. Each proposal shows its stage, preparer, dates,
terms, authority, decision trail, any rejection reason and its document's
download; one that predates its command being company-run says whether
platform staff verified the evidence, and a particulars change, which was
company-run from the start, notes that the company provided the document. A
proposal of another company or class, a mapping or holding that cannot be
read, and a correction lookup that answers with entries it was not asked for
fail the read. The reconciliation shows status, block, compared sequence, time,
any failure and each discrepancy in words with its acknowledgement (reason,
who gave it, when, and whether the company or, earlier, platform staff gave
it); rows needing attribution say so and offer nothing, and a class without a
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
records, takes a reason of up to 1,000 characters for a rejection, and
confirms it with a retry key reused only for the same preview while the step's
appointment is still the one previewed; on mobile the dialog closes when a
refresh withdraws its step. A discrepancy is acknowledged through
`useDiscrepancyAcknowledgement` with a reason of up to 1,000 characters; the
dialog keeps the appointment it opened with and holds confirmation if a refresh
changes it. Every read, upload, preview, decision, acknowledgement and
preparation is bound to the signed-in account and the session the screen
opened under, and each repeated control is named for screen readers after its
visible label and the entry, proposal or discrepancy it concerns.

### Register command screens

Each preparation opens a page of its own (routes in the
[shared client layer](#the-shared-client-layer)); on mobile it opens in the
same stack. A form that takes an upload keeps its retry key and confirmed
receipt; mirror imports allow company source references without a file. Each
form reuses its operation only for an identical request,
refreshes the proposals once the receipt is confirmed, takes a new operation
after a conflict, shows the server's words on a refusal, and gives way to the
read-only note once a refusal as not found shows the appointment is gone.

| Action                   | Offered to                                                                                                                 | What the form takes and does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prepare a mirror** | Administration or `prepare`, for an unopened class or eligible opening correction | Company source reference, record date and complete current holder/allotment rows. Original membership and allotment dates, quantities, paid/unpaid amounts, derived fully-paid status, beneficial ownership and any share/certificate references remain company-provided. Source copies and ASIC cross-checks are optional. Earlier imported fields stay unknown where absent. The latest eligible opening can be copied into a correction with a reason; the original remains retained. The preview compares imported and stored ownership before the existing approve/apply decisions. No member account, wallet, legal filing or new share issue is created by setup. |
| **Correct this entry**   | Administration or `prepare`, on each correctable entry                                                                     | Reads the entry by its ID and shows it with the exact inverse a correction records; takes the authority document, the authority, the approving director of a resolution, the reference, the reason and an effective date no later than today (UTC), defaulting to today. The preview adds the original and compensating changes and the register sequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Open this register**   | Administration or `prepare`, while a deployed or paused class's register is not opened                                     | Reads the class's holdings on chain at the current block, largest first, and refuses holdings that are not whole shares; a chain that cannot be read says so with a retry, and a class the server will not open shows its reason instead of the form. The holdings are read again only on request (Reload the holdings or Retry) or after a conflict, never on focus or reconnect, and Prepare is held while the holdings, the appointments or the class are being read again. An address already linked keeps its member; every other address is assigned on the page to a linked member or to a new member under a client-generated ID that several addresses may share, labelled as the Register will list them. Choices are kept by address, dropped only when the address no longer holds or is now linked or its member is no longer offered, and the page then says the choices were reset. A refusal with the holdings-moved code shows the reason and offers to reload the holdings, keeping the authority details and every choice that still applies. The preview adds the opening entry's effective date and shares by member, with the boundary note before approval and the holdings note before application; a staff-era opening whose boundary was never captured says so |
| **Change particulars**   | Administration or `prepare`, on each current member of an opened class                                                     | Finds the member among the current members of the companies where the person may prepare, names them as Register does or neutrally, and takes the company's supporting document, the new name and residential address, an as-at date no later than today (UTC), defaulting to today, and the reason. The preview shows the current particulars, or that none are recorded, beside the proposal, with the note that the latest as-at date wins between imports and changes while a live verified identity wins over both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Link waiting wallets** | Administration or `prepare`, once the company's waiting-wallets read returns a wallet; otherwise a note says nothing waits | Lists each waiting wallet in the order a link records it, with the number of effects waiting for it and, for information only, whether its holder proved control of it on Ledova and the holder's name, shown only for a wallet on the company's whitelist. Each wallet starts as its own new member and is never matched to a member by name; the person maps it to a current member of the class registers or to a new member under a client-generated ID that several wallets may share. Choices are kept by address and reset only when the wallet no longer waits or its member is no longer offered, which the page announces (on iOS and in a polite live region on mobile). Only waiting wallets are offered, although the API accepts any address. Takes the authority document, the authority, the approving director, the reference and the reason; the preview lists each address with its member, whether its holder proved control on Ledova and the holder's name or that the wallet is not on the company's whitelist, and the application note                                                                                                                                                                                                                           |
| **Acknowledge**          | Administration or `approve`, on an acknowledgeable discrepancy                                                             | A reason of up to 1,000 characters, then reads the reconciliation again; a refusal also reads the appointments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

A class page at `/company/register/:uuid` shows class state, the stored
members and the history of its company-authorised deployment, chain grants,
paid issues, capital increases and pause changes, each prepared, approved and
applied under company authority with saved recovery of an uncertain reply
within the session ([implementation index](../plans/company-managed-registers/README.md));
share arithmetic uses whole integers, and a quantity or resulting cap above the
2,147,483,647 request limit is refused rather than rounded
([register](register.md)).

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
describes it and **Notices**.

**Wallet shares** on both clients reads every page of the person's wallets and
lists their
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
submits, pays or votes from this wallet view.

**Verification** shows the person's eligibility sources and complete claim
history in a cache of its own, and **Your company eligibility** (**Eligibility
requests** on mobile) lets them request a decision from one company or an
approved offering; **Company eligibility**, reachable from Company and
Company team, lets a current company approver read the queue and accept,
refuse or revoke
([company eligibility](../plans/company-managed-registers/company-eligibility.md)),
and holds the company's wallet nominations and instructions
([wallet approvals](../plans/company-managed-registers/company-wallet-approvals.md)).
Every claim page loads before a submission is offered, so a pending claim on a
later page still prevents a second one.

**Directory** groups the accessible share classes under their company and
opens a class's current offering, with the documents attached to its approved
offerings; the first experience presents one fictional company and adds no
registry search. A draft application reads every verified Base wallet page,
computes its fixed-price total in integer cents and is scoped to the offering,
so a replacement offering starts fresh; a closed or unavailable offering has no
form, and the server still selects the applicant and enforces quantity and
eligibility. **Applications** presents the recorded company, class, currency
and payment instruction independently of current Directory access, including
the unaltered reference, leading zeroes, bank details or raw settlement units,
never falling back to generic payment rails; a copy failure keeps the value
available, and a recorded partial payment shows the amount outstanding and
asks the investor to confirm any further payment with the operator.

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
rather than menu items, mounted in the signed-in frame so an open flow survives
Wallets reloading its wallet list and the person leaving Wallets. Buy crypto
follows the [on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)
and [#920](https://github.com/Ledova/ledova/issues/920)'s account guard; when
the purchase page cannot be opened it gives the server's reason (`readApiError`
in `packages/shared/src/utils/errors.ts`) or "The purchase page could not be
opened. Try again.", never a proxy's error page. Send opens its form directly
when Wallets has read exactly one verified wallet on the networks it lists
(Ethereum, Bitcoin and Base), offering Cancel where Back would return to a
choice never made, and otherwise asks which wallet; the web counts the wallets
last read even while re-reading, mobile asks until the read has finished and
opens a lone Bitcoin wallet in the Bitcoin send form. Buy crypto goes straight
to the widget only when a finished read finds exactly one verified wallet on
the chosen asset's network. Every chooser lists only the networks Wallets
lists; mobile's Send forms wait for the chosen wallet's balances and keep
Continue unavailable until they have been read. Send offers crypto and payment
tokens, including AUDY, and never shares.

**Activity** presents recorded wallet transfers read-only, with exact decimal
amounts, native fees and status; a share transfer's amount carries its class's
own symbol ([a share holding names its class](wallets-and-valuations.md#a-share-holding-names-its-class)).
Its history read does not depend on the wallet filter read; filters use only
supported API fields, with date bounds covering whole local days (block time
on mobile, excluding records without one), and each entry opens in place to
its detail and explorer link.

**Profile and Settings** use the ledger sections for personal information,
identity status, security, notifications and data controls. Members edit their
own name, residential address and phone in Profile through Edit personal
details ([member profile](../plans/company-managed-registers/member-profile.md)).
The transaction-alerts switch is the `transactionAlerts` field of the one user
preferences record, read through `useUserPreferences` and saved with a partial
`POST` to `/api/user-preferences/`; mobile distinguishes an unavailable
preferences record from disabled alerts. Account deletion keeps its
confirmation dialog, states which records are retained, and clears the tab's
account data after the server confirms. Mobile Settings adds biometric sign-in
and app lock.

Where market values are shown, they are in AUD: the shared `useCurrency`
converts the API's US-dollar values at the current rate, shows a dash while the
rate is unknown, and neither client offers another currency. An offering's
prices and an application's amounts are in the offering's currency: a new
offering is priced in AUD, and one created before that rule keeps the currency
it was given ([decision](../decisions.md#the-signed-in-app)). The Buy step
shows each asset's current price, and no price while the exchange rate is
unknown. The guard decides pages, not data: the API still decides which rows a
person sees, and answers 404 for one it refuses.

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
| Import             | `/company/register/:uuid/import` (`companyRegisterImport`)                     |
| Correction         | `/company/register/:uuid/correct/:entry` (`companyRegisterCorrection`)         |
| Opening            | `/company/register/:uuid/open` (`companyRegisterOpening`)                      |
| Grant              | `/company/register/:uuid/grant` (`companyRegisterGrant`)                       |
| Transfer           | `/company/register/:uuid/transfer` (`companyRegisterTransfer`)                 |
| Particulars change | `/company/register/members/:member/particulars` (`companyRegisterParticulars`) |
| Wallet links       | `/company/register/companies/:company/links` (`companyRegisterLinks`)          |

Its helpers order an opening's holdings largest first by exact share count,
check that every share count is whole, label each mapped member once (by name,
or numbered as an unnamed or a new member, through `registerLinkMemberLabels`
for links, so the page, the record and the preview give each member the same
label), and recognise a holdings-moved refusal by its `opening_holdings_moved`
code. Each wallet's proof is worded as the holder's own proof on Ledova, never
as a verification by Ledova.

## Signed-in page conventions

Every signed-in page renders in `Page` (`dashboard/src/components/Page.tsx`,
`mobile/src/components/Page.tsx`), and so do the route guard's waiting and
failure states, so each shows its page's title. The title block is one title
row holding the title and the page's actions, with the lede, one muted
sentence, directly under it when the page has one; a lede appears only where it
says what the titles do not. The first section follows at the same gap as
between sections. On mobile `Page` is a scroll view on the paper whose header
sets the title in Newsreader at `theme.fontSize.xxxxl`, then the lede, then the
screen actions as one wrapping row, because a phone's large title leaves no
room beside it; loading, access and failure states render under the same title,
and the stack header above carries no title of its own, only the menu or back
button and, on a top-level screen, the bell. The frame holds only the sidebar,
or the phone's top bar, with the notification bell; it has no header bar and no
footer. The sidebar's list ends with Help & Support, and its foot names the
person above Sign out (the public layout's `SignOutButton` in its sidebar
variant); mobile's drawer has the same shape. The mobile exceptions keep a
frame of their own: Help & Support keeps its stack title; Send, Transfer, Verify
Wallet and Recovery Phrase are titled inside their `Panel` card
(`mobile/src/components/panel`); Buy crypto is its dialog over the plain paper
followed by the provider's web view.

Pages are built from the ledger blocks in `dashboard/src/components/Ledger.tsx`
and `mobile/src/components/Ledger.tsx`; each enforces one rule:

- `Section`: every section is its own white card on the paper
  (`bg-surface-raised`, a `border-border` hairline, `rounded-xl`) with its
  Newsreader title inside. Forms and things to act on are cards too, and a
  group inside a card is set off by a rule or a small heading, never a nested
  card. An empty section keeps its real title with one muted sentence under it
  ("No activity yet.") and at most one action; a state is never a title.
- `Rows`: ruled label and value pairs, figures right-aligned in tabular
  numerals; every amount names its currency (`formatMoney`) and share counts
  are whole numbers.
- `LinkRow`: the one place a page reaches each of its sub-pages and each
  neighbour a section points to; the whole row is the link, named after its
  destination, with optional detail lines and an aside. A destination the
  sidebar already reaches is not repeated in a title row; an underlined link
  is part of a sentence or opens an external resource.
- `PageAction` (`Action` on mobile): the button for whatever a page, section or
  row does, content-width wherever it sits: the title row for the page as a
  whole, including the way back to the parent page; inside a section for what
  that section does; in a row for what is done to that row's record alone.
  Nothing is selected before acting and no toolbar waits under a list.
- `Disclosure`: a row that opens in place, a button with `aria-expanded`
  (expanded or collapsed on mobile) and a leading caret controlling the detail
  directly under it, held only while open. Lists are read, filtered and sorted
  in place: an entry opens under its own row and leaves other open entries as
  they are; Activity's filter and Wallets' sort (shown once a chain holds two
  wallets) are a `Disclosure` at the top of the card that names what it
  applies and, applied or cleared, closes itself and every open entry and
  returns focus to its button. Open rows are kept with `useOpenRows` from
  `@ledova/shared`. A dialog is kept for work that sets the page aside: a form
  that creates or changes something, a signing step or a confirmation.
- `SwitchRow`: the one control for a setting that takes effect as soon as it
  changes (Transaction alerts; Show this company to eligible investors). The
  On/Off pill or native switch is the switch itself (`role="switch"`), its
  `aria-checked` is the saved value, it is disabled while saving, keeps the
  saved value when refused, and the refusal is an alert in the same card. A
  choice saved with a form stays a checkbox.
- `Status`: a status in words after a small mark; screen readers read only the
  words. `Timeline`: each event with its date.

A dialog (`Modal` in `dashboard/src/components/Modal`; `CustomModal` in
`mobile/src/components/modal`) is the same card over the dimmed page: its
Newsreader title labels it (on mobile marked as a header and
`accessibilityViewIsModal`, since React Native cannot make it the accessible
name), its body scrolls inside the card, and `ModalActions` ends it as one
right-aligned row of content-width actions, a plain Cancel, Close or Back
before the one primary action, wrapping rather than stretching. On mobile the
backdrop closes the dialog, and a busy dialog holds the backdrop, Android Back
and Cancel.

Inside cards and dialogs nothing is boxed: fields are white with a hairline
border (`rounded-lg border border-border bg-surface-raised`; `useDialogStyles`
on mobile), steps are numbered lines, a choice is an outlined `Choice` marked
selected, and warnings and errors are text, warning-coloured beside an icon or
error-coloured, rather than tinted boxes. The exceptions are the tinted
extraction-status pill beside a saved payslip on Profile and the dashed upload
area that marks where a file goes. Addresses, hashes and signing summaries use
the monospaced face (`font-mono`; `theme.fontFamily.mono`). Sign-in and the
sign-up steps hold their forms in the same card under the same titles but keep
their tinted fields and boxed outcomes, as the identity check's outcomes do.
Mobile's theme adds one spacing step, `smd` (12), for the web's 12px spacing
the shared scale lacks.

## Design tokens

The design tokens are the single source of colour, spacing and radius values.
`make generate-tokens` runs `packages/scripts/generate-css-tokens.mjs` with
`tsx` over `packages/shared/src/constants/ui/design-tokens.ts` and writes
`dashboard/src/styles/tokens.css` and `site/src/tokens.css`, raw generator
output and prettier-ignored. Tailwind v4 reads that `@theme` block and derives
the utility classes (`bg-surface-base`, `text-text-body`,
`border-border-subtle`). Never edit either file: CI regenerates them after `make
build` and fails on any drift. The web clients have one look, paper, and no
theme switch. `PAPER_COLORS` is the palette. The public site uses it
directly (`bg-paper`, `text-ink`, `border-rule`, `bg-ledger`). `PAPER_THEME`
maps it onto the theme tokens, which are the generated defaults, so the
dashboard's `bg-surface-*`, `text-text-*` and `brand` classes, and any code
that reads `PAPER_THEME` directly, render in paper. Both clients bundle
Newsreader for display text and Instrument Sans for everything else. Mobile
also uses fixed paper and bundles these fonts with a finite loading/error/retry
gate; the account stores no theme, and a theme an older build saved on the
device is not read. Shared tokens and the CSS generator contain only paper; the
retired dark and light palettes are removed.

Next: [authentication](authentication.md), [mobile security](mobile-security.md),
[mobile lifecycles](mobile-lifecycles.md), and [mobile builds](../development/mobile-builds.md).
