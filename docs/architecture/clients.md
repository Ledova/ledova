# Clients and the shared package

[Architecture](README.md) · [Documentation](../README.md)

How dashboard and mobile consume shared TypeScript and design tokens.

## Company-managed client work

The [product priority](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)
is the private-company share register and share issuance, management, transfers
and purchases. Crypto on-ramp purchases are optional personal investor actions;
companies must not buy cryptocurrency through the on-ramp. Company share-wallet
operations remain distinct from buying cryptocurrency. AUD is a required share
payment option, with its payment and settlement design still to be decided.

This page describes the current clients, including their company selection and
read-only staff decision records. Register access follows current appointments
as well as ownership, and the register import steps in both clients follow
current appointments alone; most other company selection remains owner or
administrator scoped. The
[accepted company-managed plan](company-managed-registers.md#required-self-service-workflows)
requires web and mobile forms for company appointments and the supported
prepare, preview, approve and apply workflows. Company activation and offering
publication must show actual required checks and company decisions. Register
opening/import, links, corrections, exact issues/allotment, payment evidence and
shareholder administration must not depend on undocumented owner API calls or
routine admin screens.

The current `company`/`investing` account audience selects navigation, not company
authority. Add explicit company selection and capability-aware actions for
appointed users; backend checks remain authoritative. Scope caches and pending
actions to the selected company and session, retire revoked appointments and
withhold stale controls after failed reads. Preserve personal Holdings/Notices
for shareholders and employees independently of eligibility for other offers.
Wallet signing stays with its holder; no wallet is required for a workflow with
no chain action.

Regenerate shared API types and release both clients with the removal of the
legacy deployment-mode field and evidence-visibility branch. Supporting evidence
keeps private access, retention and review safeguards in the one product; an
absent field must not hide it. Apart from the register imports, openings,
particulars changes, wallet links, register history, corrections and discrepancy
acknowledgement in both clients, the detailed current screen descriptions below
do not claim these company-managed controls are shipped.

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
  The company's application sits under Company, opened from a row on the
  Company page, rather than as a menu item.
- _Your shares_ for every account;
- _Invest_ for an investing account, with Market only while trading is on;
- then Wallets, Profile and Settings.

Each item takes its name and address from its entry in `DESTINATIONS`, so a
menu label always matches the page's title. Activity keeps the `/transactions`
address. Holdings replaces the crypto home at the existing `/home`
address. Notices at `/publications` lists documents, resolutions and dividends
addressed to the person.
The mobile shell uses Holdings, Notices, Activity and the securities Market.
Register is the native Company landing page. It reads every class the person may
read (as the company owner or through a current register appointment), grouped by
company with a company choice when there is more than one, and the stored
register of each class of the chosen company, with exact share quantities and
complete-read failure states.
Showing a class's members also shows, for a deployed or paused class, its
[openings](../operations/register-foundation.md#opening-the-register-from-the-chain),
read on every page with the class's `token` filter, newest first and each once:
stage, the boundary block and its date, preparer, dates, each holding at the
boundary, largest first, with its shares and address and the member it maps
to: an existing member by name, or numbered as an unnamed member when it has
none, and a member the opening creates numbered as a new member; then the
authority, approving director, reference and reason, whether the company
provided the authority document or staff verified it before openings were
company-run, the decision trail, any rejection reason and the document's
download. An opening without a captured boundary says so. An opening's step and
download labels name its block and when it was prepared, and openings of
another company or class, with a mapping that cannot be read or with a holding
that is not a whole number of shares, fail the read.
Its [register imports](../operations/register-foundation.md#importing-an-existing-register)
follow with the history, steps and checks of the dashboard's Register, described below,
except where the person's appointments are read. On mobile, each decision opens
in a dialog, which closes when a refresh withdraws its step; Prepare an import
opens a form in the same stack; and the retained register document and ASIC
extract open through the session-bound document copy.
The class's register entries follow, newest first, one page from the server at a
time with Load more: each entry's kind, sequence, effective date and signed share
changes with member names, and the entry it corrects and the entry that reversed
it, named as not loaded yet until its page is loaded. An entry a later page
repeats is listed once, as is a repeated import or correction; a page with a
share change that is not whole fails and offers a retry, and a later page that
fails keeps the loaded entries and offers to try again. Then come its
[corrections](../operations/register-foundation.md#compensating-corrections),
read on every page with the class's `token` filter and newest first, each page
with the entries it corrects looked up by their IDs: stage, the corrected entry's
sequence and kind, preparer, dates, the inverse changes with the corrected entry's
member names, the authority, approving director, reference and reason, whether
the company provided the authority document or staff verified it before
corrections were company-run, the decision trail, any rejection reason and the
document's download. A correction's heading and step labels name its entry and
effective date, and the step and download labels of a correction or an import
also say when it was prepared. Corrections of another company or of more than
one register, a corrected entry the lookup does not return, or a lookup
answering with entries it was not asked for fail the read. Last comes the
class's latest [reconciliation](../operations/register-foundation.md#reconciling-with-the-chain):
status, chain block, compared register sequence and time, any failure text, and
each discrepancy in words with its details and acknowledgement (reason, who,
when, and whether the company or, earlier, staff gave it); rows needing
attribution say so, and a class without a reconciliation says that plainly.
Administration or `prepare` adds **Correct this entry** to a correctable entry. It
opens a form in the same stack that looks up the entry by its ID, shows it with
the exact inverse it records and takes the authority document, the authority, the
approving director of a resolution, the reference, the reason and an effective
date no later than today (UTC), defaulting to today. The upload keeps its own retry key and confirmed
receipt, preparation reuses its operation only for an identical request, and the
corrections are refreshed once the receipt is confirmed; a conflict reads the
entry and appointments again and takes a new operation. Approval and rejection
(administration or `approve`) and application (administration or `apply`) of a
correction use the same preview-first dialog as imports, showing the original and
inverse changes and the register sequence; a retained staff-era correction offers
only rejection. A recorded or refused correction decision reads the
corrections, entries, holders and appointments again. Administration or `approve`
adds **Acknowledge** to an acknowledgeable discrepancy, which
[acknowledges](../operations/register-foundation.md#acknowledging-a-discrepancy)
it with a reason of up to 1,000 characters and reads the reconciliation again; a
refusal also reads the appointments. Its dialog keeps the appointment it opened
with and holds confirmation if a refresh changes it.
Administration or `prepare` gets **Open this register** while a deployed or
paused class's register is not opened. It opens a form in the same stack that
reads the class's holdings on chain at the current block, largest first,
saying when the chain can't be read now and refusing holdings that are not
whole numbers of shares. The holdings are read again only on request (Reload
the holdings or Retry) or after a conflict, never on focus, on reconnect or with
the other register reads, and preparation is held while the holdings, the
appointments or the class are being read again. The form maps each holding
address to its linked member, which stays fixed, or to a member chosen on the
page: a linked member, a new member under a new ID that several addresses may
share, or another new member. Members are labelled as the Register will list
them, by first appearance with the largest holding first: by name, or numbered
as an unnamed member or a new member. Choices are kept by address: a re-read
drops a choice only when its address no longer holds or is now linked, or its
linked member no longer holds, and the page then says the choices were reset
until a choice changes or the opening is prepared. It takes the authority
document, the authority, the approving director of a resolution, the reference
and the reason. The upload keeps its own retry key and confirmed receipt,
preparation reuses its operation only for an identical request, and the
openings are refreshed once the receipt is confirmed; a conflict reads the
holdings and appointments again and takes a new operation, a 404 from the
holdings read or from preparation reads the appointments again, so the form
gives way to the read-only note once the appointment is gone, and a refusal
with the holdings-moved code shows the server's reason, says the holdings moved
and offers to reload them, keeping the choices that still apply.
Approval and rejection (administration or `approve`) and application
(administration or `apply`) of an opening use the same preview-first dialog,
showing the effective date and the register's first entry with member names,
with the boundary note before approval or application and the holdings note
before application; a retained staff-era opening offers only rejection. A
recorded or refused opening decision reads the openings, entries, holders and
appointments again.
After the share classes, Register lists the chosen company's
[particulars changes](../operations/register-foundation.md#changing-a-members-particulars),
read on every page with the company filter, newest first and each once: the
member by their current register name, or as a member not named on the current
register, the proposed name, residential address and as-at date, the reason,
preparer and dates, that the company provided the supporting document, the
decision trail, any rejection reason and the document's download. Changes of
another company fail the read, and a change's step and download labels name its
member, as-at date and when it was prepared. Approval and rejection
(administration or `approve`) and application (administration or `apply`) use
the same preview-first dialog, showing the member's current particulars, or that
none are recorded, beside the proposal, with the note that the latest as-at date
wins between imports and changes and live verified identity wins over both
before approval or application. A recorded or refused particulars decision reads
the changes, holders, any open register entries and appointments again.
Administration or `prepare` adds **Change particulars** to each current member
of an opened class. It opens a form in the same stack that reads the class
register to name the member as Register does, or neutrally, and takes the name,
residential address, an as-at date no later than today (UTC), defaulting to
today, the reason and the company's supporting document. The upload keeps its
own retry key and confirmed receipt, preparation reuses its operation only for
an identical request, and the changes are refreshed once the receipt is
confirmed; a conflict reads the class register and appointments again and takes
a new operation, a refusal shows the server's words, and a 404 reads the
appointments again, so the form gives way to the read-only note once the
appointment is gone.
After the particulars changes, Register lists the chosen company's
[wallet links](../operations/register-foundation.md#linking-wallets-after-the-opening),
read on every page with the company filter, newest first and each once: stage
and number of wallets, whether the company provided the authority document or
staff verified it before wallet links were company-run, preparer and dates, the
decision trail, any rejection reason, the authority, approving director,
reference and reason, then each wallet address in the order the link records it
with its member, labelled as the link form labels it: a current member of the
class registers by its name when no other current member shares it, and
otherwise as an unnamed member or by the shared name with its first wallet
shortened, or its first holding when it has no wallet, numbered in register
order if two would still read alike; an existing member no longer on the
registers neutrally; and a member the link creates numbered as a new member, so
wallets that share a member read alike; and last the document's download. Links
of another company fail the read, and a link's step and download labels name its
stage, number of wallets and when it was prepared. Approval and rejection
(administration or `approve`) and application (administration or `apply`) use
the same preview-first dialog, listing each address with its member, labelled
the same way, and, for information only, whether the holder proved control of
the wallet on Ledova and the holder's name on Ledova, or that the wallet is not
on the company's whitelist, with the application note before application; a
retained staff-era link offers only rejection. A recorded or refused link
decision reads the links, the waiting wallets, the class registers with their
waiting counts, any open register entries and the appointments again.
Administration or `prepare` gets **Link waiting wallets**, enabled once the
company's waiting wallets are read and at least one waits; when none waits, a
note says so. A 404 from that read reads the appointments again, so the action
gives way to the read-only note once the appointment is gone. It opens a form in
the same stack that reads the waiting wallets, the company's class registers and
the appointments, and lists each waiting wallet, in the order a link records
them, with the number of issues and transfers waiting for it and its statuses.
The form maps each wallet to a current member of the class registers or to a new
member under a new ID that several wallets may share, each labelled as the
link's record and preview will label it, with the current members first in
register order; a current member's label never changes with the choices. No
wallet has a member until the person chooses one, never by matching names.
Choices are kept by address: a re-read drops a choice only when its wallet no
longer waits or its member is no longer on the class registers, and the page
then says the choices were reset, announcing it on iOS and in a polite live
region, until a choice changes or the link is prepared. It takes the authority
document, the authority, the approving director of a resolution, the reference
and the reason. The upload keeps its own retry key and confirmed receipt,
preparation reuses its operation only for an identical request, and the links
are refreshed once the receipt is confirmed; a conflict reads the waiting
wallets, class registers and appointments again and takes a new operation, a
refusal shows the server's words and reads the waiting wallets and class
registers again, keeping each choice that still applies, and a 404 from the
waiting-wallets read or from preparation reads the appointments again, so the
form gives way to the read-only note once the appointment is gone.
Register reads the person's appointments itself rather than through Company
team's cache, and hides every register action while they cannot be read. It
reads them again after a revocation on Company team or
Representative authority, a pull to refresh, an opening, correction,
particulars or wallet link decision, a waiting-wallets read refused as not
found, or a decision, preview or acknowledgement the server refuses. Every
register read and every
upload, preview, decision, acknowledgement and preparation is bound to the
session the screen opened under.
Accounts without the company role reach it from the drawer only when they have
register access. A class
opens its register and request histories, deployment and share request actions.
Deployed and paused native classes also expose pause and recovery. Before a POST,
the app saves and reads back the original request identity and direction in
AsyncStorage, scoped to the user, account and class. Unresolved requests block
new requests and remain available after reopening the page; checking or retrying
keeps the same identity. A completed outcome can be dismissed without changing
the class. The outcome describes the original request, not the current class
state. Class refreshes block new requests, and captured session guards fence
storage waits, transport retries and delayed responses.
Company details reads the complete selected company and every share-class page,
with exact quantities. Application retains every supplied document and the
review timeline; failed reads block actions while edit, upload and withdrawal
drafts remain available for retry. Uploads and document sharing retain the
session-bound managed-copy lifecycle. Native Verification uses the paper ledger and
reads every claim page into its own cache, independently of the Documents page.
Failed eligibility or history reads suppress status and actions, while an open
evidence form retains its fields and private file copy. Submission waits for
current reads and is blocked by an existing pending claim; withdrawal failures
remain visible for retry. The existing session-scoped upload lifecycle owns
temporary files throughout these refreshes. Native Directory is an investing-role
stack that reads every eligible share-class page. Failed eligibility or catalogue
reads suppress cached classes; detail failures suppress cached offering terms,
and unavailable classes remain distinct from read failures. Authorised shares
retain their exact integer strings, while issued counts outside the API's safe
numeric range are marked unavailable. Native Applications reads recorded company,
share-class and price snapshots independently of Directory eligibility. Failed
history/detail refreshes suppress cached terms and actions; a later-page failure
marks the history incomplete. Directory draft creation reads every verified Base
wallet, preserves quantity and selection across failed refreshes, and blocks writes
until current prerequisites recover. A native class page lists its offer documents
as the dashboard does, and pulling the page to refresh reads them again with the
class; opening one fetches it with the bearer client into a
session-scoped temporary copy for the share sheet, and a failed open keeps no
copy. Native application writes carry the captured
session epoch through the existing transport guard and ignore retired-session
results. Payment details come only from the application's issued instruction,
including exact references, leading zeroes and raw settlement units. Partial
payments retain the original instruction and require operator confirmation before
paying again; no native payment/signing action is added here. Mobile Activity reads history independently of its complete wallet selector. It
keeps recorded decimal amounts exact, distinguishes failed refreshes from empty
history, and marks failed older pages as incomplete. Pull to refresh reads current
records; an open detail follows its current row. Supported wallet, network,
direction and local-day filters replace sorting only the loaded subset. Date
filters use block time and exclude records without one.

Market presents For sale and Wanted lists with automatic matching. Buyers fund
before placing an offer. Owned order history reads independently of listed share
classes and wallet availability, retaining recorded class labels or an explicit
unavailable label. Wallet, class, owned-order and pending-trade reads follow every
page; read failures expose retry and suppress stale actions. Saved orders,
cancellations and changes, and trade signatures and approvals are records on this
device for the signed-in account. Market reads them when it loads and after each
recovery; one saved elsewhere later, such as in another browser tab, appears when
Market is reopened on the web or pulled to refresh on mobile, whose Market tab
stays loaded. They sit in one Saved work section after Trades awaiting signatures,
shown only while something is saved or a message about them, such as a failed
read, needs showing, with one refresh that reads all three again. AUD totals use
integer cents; unsafe numeric quantities returned by legacy list APIs are marked
unavailable. New quantities use exact integer strings above JavaScript's safe
number range, within the existing signed 64-bit storage bound. The chosen wallet's
allowlist status gates creation, and drafts survive failed prerequisite refreshes.
Published to your members reads every publication page for the
selected owned company with an explicit issuer filter. It shows stored documents,
exact resolution results and distribution rates/dates without member actions or
entitlements. Company and publication read failures hide stale records; refresh
blocks document actions. Native document copies remain bound to the selected
company, current role and starting session. Your shares Notices separately
requests only publications addressed to the person and retains member voting.

Signing in, and verifying an email, which also signs a new person in, clear
what the tab cached for whoever was signed in before, as signing out does, so a
new person is never guarded by, or signs up against, the previous person's
account. Buy crypto on Wallets requires an actual `investor` or `both` personal
account, with unknown and company-only accounts refused. The API also reads the
current investing account before contacting the provider
([#920](https://github.com/Ledova/ledova/issues/920)). Both clients reject direct
opening and late responses after account or role loss; an open provider is
removed and its URL retired. Buying crypto and sending
are Wallets actions rather than menu items, and the dashboard has no coin-price
page or favourites. On both clients, Send opens its form directly when Wallets
has read exactly one verified wallet on the networks it lists (Ethereum, Bitcoin and Base), and otherwise asks
which wallet to send from: when several are verified, when none is, and when
Wallets could not read them. A form opened directly, mobile's Bitcoin form
included, offers Cancel where Back would return to a choice never made. The web
counts the wallets Wallets last read, even while it reads them again; mobile
asks until that read has finished, and while it waits for the connection, and
opens a lone Bitcoin wallet in the Bitcoin send form, as choosing one does.
Buy crypto goes straight to the widget only when a read that has finished finds
exactly one verified wallet on the chosen asset's network, and asks which one
receives it when there are several; while a read is running, or waiting for the
connection to come back, it opens nothing by itself and its chooser's wallets
cannot be chosen. When the purchase page cannot be opened, Buy crypto gives the
server's reason for refusing it (`readApiError` in
`packages/shared/src/utils/errors.ts`) and otherwise says "The purchase page
could not be opened. Try again.", never a proxy's error page or a bare status
line. Every chooser, on both clients, reads every page, so a
verified wallet on a later page is offered and counted, lists and counts only
the networks Wallets lists, and shows each wallet as a Wallets row reads:
its name or short address, its verification and signing preference named for
screen readers, its sync age, and its balance and value labelled. None says
there are none before a read has answered, even offline, and one that cannot
read the wallets says so and offers Try again, hiding any it listed before,
without the request's error text. Mobile's Send chooser says the same when the
account's preferences cannot be read, and its Try again reads them first.
Both of mobile's Send forms then read the chosen wallet's balances the same
way: each waits for them, even offline, and when they cannot be read it says
so, with the server's reason when there is one, holds Try again while it reads
them again, and keeps Continue unavailable until they have been read.
The retired portfolio screen's chart, allocation and snapshot helpers are removed
from both clients and the shared package. The asset list remains in use by Buy
crypto for current prices, and Wallets and Send still use the AUD exchange rate.
Unused asset detail, asset/portfolio snapshot and favourite-assets HTTP routes
are [retired](../operations/upgrades.md#retired-asset-and-portfolio-http-routes),
and the favourites table, holding snapshots and value-series service behind them
are [dropped](../operations/upgrades.md#database-migrations). Portfolio CRUD and
the add/remove-wallet operator actions remain; the selected-portfolio preference
is [dropped](../operations/upgrades.md#theme-and-selected-portfolio-preferences).
Holdings reads every page of the person's wallets and lists their tokenized
security holdings by company and class, with one row per asset across chains.
It uses the API's current class and company names when available and the asset's
combined name otherwise; a missing class lookup does not remove the holding.
Whole share counts are added without floating-point conversion and can be
expanded into chain and wallet balances. Crypto balances, allocation charts,
coin prices and market valuations are absent from this share ledger. If any
wallet page or holdings read fails, the page offers a retry instead of presenting
partial counts as complete.

Below the shares, _Needs you_ links to the person's draft applications and
payment instructions, and counts resolutions awaiting their vote. _In progress_
lists applications under review, accepted but awaiting an instruction, or with
payment received, and counts dividends awaiting a company payment record.
That record is not proof of whether a bank transfer happened. _Recently
published to you_ lists the three latest notices addressed to the person, each
with its company, kind and date, and until when its vote is open. These are
personal reads: every role gets the recipient-only publication summary and
latest notices; only a known investing role reads the applicant-filtered
application list. All its
pages must succeed before application work is shown. Each source has its own
loading, failure and retry state, and unavailable data is never called empty.
Application changes invalidate the work summary, and notice counts refresh at
the next voting deadline and periodically, as they do on mobile. Actions open
the existing application detail or Notices page; they do not submit, pay or vote
from Holdings. The application list retains applications whose company or class
has become hidden, using their stored names and currency.

Verification shows the investor's current eligibility and complete claim history
in the same ledger layout. Every claim page must load before qualification actions
are offered, so a pending claim on a later page still prevents a second submission.
Read failures hide stale eligibility and claims behind an explicit retry; they do
not imply that the investor is ineligible or has no evidence. Submission and
withdrawal keep the API's existing authority checks, show failures, and refresh
eligibility, claim history and Directory reads after success. Verification uses
its own complete-history cache under the shared classification key, preserving
the Documents page's first-page response shape. A failed background read retains
an open claim's fields and selected evidence file, with a retry inside the modal.
Submission waits for reliable reads and remains blocked if a refreshed history
contains another pending claim.

Mobile Holdings uses the same _Needs you_ and _In progress_ grouping and opens
the native Applications detail or Notices destination. It reads every application
page only for a known investing account, keeps the query scoped to the account
and session, and refreshes work after application changes or a page pull refresh.
Applications and notices retain independent failures and retries. Personal
Notices distinguishes a failed refresh, which hides stale actions, from a failed
earlier page, which keeps loaded rows with an incomplete-list warning. The native
issuer list requires every page to succeed before showing records; a failed page
or refresh hides the list and offers retry. Every personal page retains the
addressed filter, and ballot settlement invalidates the list and personal summary
together. Native document copies and ballots retain their session boundaries.

Directory groups the accessible share classes under their company and opens a
class's current offering in the ledger layout. The first experience targets one
fictional issuer; it adds no registry search. Every directory page must load
before entries are shown, and a read error offers a retry rather than an empty
directory. An unavailable class and a failed read have different states. The
authorised share count stays a decimal string; an issued count outside the API's
safe numeric range is unavailable rather than rounded. A draft application reads
every verified Base wallet page, requires a safe whole-share quantity and computes
the displayed fixed-price total in integer cents. Its quantity and chosen wallet
survive a failed class or wallet refresh, while the retry screen hides application
actions. Those inputs are scoped to the offering, so a replacement offering starts
with a fresh quantity. A closed or unavailable offering has no application form.
Below the offering, Offer documents lists what the company attached to the
class's approved offerings, open or not, with each document's type, size and
upload date and a link that opens it in a new tab with the session cookie. A
failed read has its own retry and stays distinct from having none, and an
unavailable class reads none.
The server still selects the
applicant and enforces quantity and eligibility rules. Payment details remain on
the accepted application, which supplies its exact amount and reference.

Applications presents the recorded company, class and currency independently of
current Directory access. Further pages load on request; an unsuccessful later
page keeps known records visible and labels the list incomplete. Initial and
refresh failures offer a retry and suppress stale records or detail actions. A
real missing detail has its own unavailable state. Submission and withdrawal
wait for the resulting read before offering another action.

The application supplies its payment instruction, including the unaltered
reference, bank details or settlement asset units. Copy failures keep the value
available for manual copying. When a payment is already recorded, the detail shows
the amount outstanding separately and asks the investor to confirm any further
payment with the operator; it does not recalculate the original instruction or
stablecoin units. An absent instruction never falls back to generic payment rails.

Profile and Settings use the ledger sections for personal information, identity
status, security, notifications and data controls. The transaction-alerts switch
is the `transactionAlerts` field of the one user preferences record: both
clients read it through the shared `useUserPreferences` hook and save it with a
partial `POST` to `/api/user-preferences/`; the switch has no route, model or
admin page of its own. Failed profile and preference reads hide stale values
and offer retry. Phone edits remain open with their entered values after a
refused save; the switch retains the confirmed value until refresh succeeds.
Password changes, data export and account deletion
show request failures and allow retry. Deletion still requires its confirmation
dialog, states which records are retained, and clears the tab's account data
after the server confirms success. Identity checks and supporting payslips retain
their existing provider and deployment boundaries.

On both clients Wallets reads every wallet page into a ledger cache of its
own, and a failed read hides incomplete or stale rows and offers retry. Mobile's
ledger is scoped to the account and the session: wallet reads and writes carry
the captured session epoch, and a wallet's own screen shows the ledger's current
row rather than the one it was opened with. Each chain's card lists its wallets,
and each row shows the wallet's verification and self-declared signing
preference, named for screen readers, its sync age, its balance in the chain's
native unit and its value in AUD, each labelled (the value is Value on the web
and Estimated value on mobile). Verification and signing preference are icons,
as on the web: a mobile row no longer spells out Verification in a line of
text, so sighted people read the status from the badge's check or clock, and a
wallet's own screen still states both in words. A balance shows at most eight
decimal places, rounded from its decimal string rather than through a float
(`formatCryptoBalance` in `packages/shared/src/utils/formatting.ts`), and both
clients' value and balance orders compare the decimal strings (`sortWallets`
in `packages/shared/src/hooks/useWalletSort.ts`). The clients differ in where
a wallet's actions sit. On the web each row carries its own: Edit, Sync and
Delete, with Verify while the wallet awaits verification and Derive address
where the next hardware address can be derived. Nothing is selected first. A
failed sync is reported in the row of the wallet it belongs to, and every Sync
waits while one is running. Add wallet is a title action, since the add form
chooses the network. On mobile each row has one Open wallet action, to the
wallet's own screen, which holds its name and its actions: Verify address, Sync
balances for that wallet alone, Derive address and Delete wallet; Wallets'
title row adds Sync balances for every wallet. Add, edit, derive and delete keep
refused input and stay open until success, and on mobile a pending one cannot be
dismissed or submitted twice; background read failures keep the draft but block
further submission until recovery. Imports run one address at a time and
remember confirmed additions for retry within the same import; a partial failure
leaves the remaining selection available, and on the web explains the number
added. Mobile's software registration waits for the server after the existing
authenticated local seed storage. These controls do not change
wallet verification or signing authority, and QR parsing, key derivation,
verification, Buy and Send keep their existing boundaries.

Activity presents recorded wallet transfers in a read-only ledger, with exact
decimal amounts, native network fees and the current recorded status. A share
transfer's amount carries its class's own symbol ([a share holding names its
class](wallets-and-valuations.md#a-share-holding-names-its-class)). Send offers
crypto and payment tokens, including AUDY, and excludes share assets even when
their class details are unavailable. Shares move through allotment and the
market; direct wallet-transfer requests remain refused. A
confirmed or failed status shows a ✓ or ✗ before its word, which screen readers
skip, in the entry's name and in its detail. Its history
read does not depend on the wallet filter read succeeding. The wallet selector
loads every page in its own cache; a failed page disables that selector and offers
a retry without hiding history or clearing draft filters. History loads further
pages on request, marks failed later reads as incomplete, and suppresses stale
rows and details after a failed refresh. Filters use only supported API fields,
with date bounds covering the whole selected days in the person's local time.
Each entry opens in place to its detail, which preserves full wallet, address and
transaction identities and links to the existing explorer; Activity adds no
buying, sending or signing action.

Mobile Company Offerings reads every offering and share-class page, filters to
classes of the selected owned company, and reads every page of the selected
offering's subscriptions. It keeps Directory visibility separate from offering
review. Current successful company, class, operator and offering reads govern
actions; an open editor retains its draft when a read or save fails. Native date
and time controls set the offering window in the device's local time. Price
strings remain exact, request share quantities retain the API bounds, and a
removed settlement asset must be explicitly removed from the draft before save.
The form lists the company's uploaded offer documents to attach for investors and
keeps an edited offering's attachments until one is switched off. An approved or
closed offering has Add documents instead, a dialog whose attached documents are
switched on and disabled; it sends only the new choices under the captured
session epoch, keeps a refusal in the dialog and refreshes Offerings.
Subscription facts remain separate from the stored share register and allotment.
Offering writes and Directory visibility changes capture the native session epoch;
credential lookup, token refresh and late UI callbacks cannot carry them into a
replacement session.

Mobile Profile and Settings use the same paper ledger as Holdings and Notices.
Profile reads only the personal profile and retains an open phone draft through
refresh and save failures; saving requires a current successful read. Settings
keeps native biometric sign-in and app lock, reads and saves the
transaction-alerts switch through the same user preferences record as the
dashboard, and distinguishes an unavailable preferences record from disabled
alerts. Password, private JSON export
and account deletion use bounded confirmation dialogs that stay open after
refusal and cannot close while their request is pending. Successful deletion
retains the existing session retirement and private-cache cleanup boundary.

Native Market uses the same For sale and Wanted ledger, automatic matching and
buyer-funds-before-offer order. Class, wallet and trade lists read every page;
account-owned order history remains available when classes or wallets disappear.
Share counts and AUD totals use exact integer arithmetic, with unavailable labels
for legacy numeric counts outside the safe range. An open order draft keeps its
fields during failed refreshes, while current class, eligibility, wallet, holdings
and allowlist checks gate submission. Existing signing, cancellation and settlement
recovery retain their saved identities and session boundaries, in the same Saved
work section.

Where market values are shown elsewhere, they are in AUD: the shared
`useCurrency` converts the API's US-dollar values at the current rate, shows a
dash while the rate is unknown, and neither client offers
another currency. An offering's prices and an application's amounts are in the
offering's currency: a new offering is priced in AUD, and one created before
that rule keeps the currency it was given
([decision](../decisions.md#the-signed-in-app)). The Buy step shows each
asset's current price, and no price while the exchange rate is unknown. Both
flows are mounted in the signed-in frame, so an open flow survives
Wallets reloading its wallet list and the person leaving Wallets. The guard
decides pages, not data: the API still decides which rows a person sees, and
answers 404 for one it refuses.

The Company Register at `/company/register` is a page for every signed-in
account; the API decides which registers it shows. It reads every page of the
share classes the person may read, as the company owner or through a current
company appointment holding administration or a register capability, and groups
them by company. A person who can read more than one company selects one first,
and only that company's stored registers are read. Each class shows current
members, linked wallets, exact issued and authorised shares and the logged
register CSV download. Unopened registers and unknown or positive waiting-effect
counts stay explicit. A failed class or register read hides the incomplete
result and offers retry, including after a failed refresh. With nothing
readable, the page says there is no company register to show. Its reads are
keyed to the signed-in account, and an account change starts the page again.
Company accounts reach Register from the sidebar; other accounts get a Settings
entry only once the first page of readable classes is not empty.
For company accounts, Register and Company open a class at
`/company/register/:uuid`, whose class reads remain owner-bound. Its ledger shows
class state, exact issued and authorised shares, the stored members, and every
page of issuance and authorised-share request history. Failed history reads hide
stale rows and offer retry. The class page replaces the old Company modal; it
retains deployment, logged register CSV export, saved pause recovery and staff
reviewed issuance and **Raise authorised shares** requests. Share arithmetic uses
whole integers; submission refuses quantities or a resulting authorised cap above
the current request limit of 2,147,483,647 instead of rounding them. Staff still
prepare outputs on written instruction.

Each class on the dashboard's Register also lists its
[register imports](../operations/register-foundation.md#importing-an-existing-register),
newest first across every page: stage, preparer, dates, the ASIC figures the
company stated beside the rows' totals, whether the company provided the
evidence or staff verified it before imports were company-run, the decision
trail and any rejection reason, with downloads of the import's register document
and, where kept, its ASIC extract; a decided staff-era import shows when it was
decided. The person's own current appointments, read through the same
account-bound cache as Company team, decide which steps a prepared import
offers. Only an active, effective appointment before its expiry counts:
approval and rejection need administration or `approve`, and application
administration or `apply`. A retained staff-era import offers only rejection,
and a reader with none of these steps sees the history with a read-only note.
Each decision opens a dialog driven by the shared `useRegisterDecision` for imports:
it previews the decision and shows the comparison with the stored register,
unmet requirements in words, the stated and imported figures and, before an
application that opens the register, the note that the class will not be on
chain. A rejection is previewed again with its reason. Confirming records
exactly the previewed decision, with a retry key reused only for the same
preview, and only while the step's current appointment is still the one it was
previewed with. A recorded decision refreshes the imports, the register and its
entries; a decision or preview the server refuses also refreshes the person's
appointments. Holders of administration or `prepare` get **Prepare an
import** while the class has no applied import. It opens
`/company/register/:uuid/import`, a page for every signed-in account like
Register, which shows the class and its company and takes the company's current
share register and ASIC extract, the register date, the authority, the member
rows, former members and the stated ASIC figures. An opened class lists one row
per current holder with its member and shares fixed; a class whose register is
not opened takes rows under new member IDs with editable shares. The stated
figures must match the rows before preparation. Each upload keeps its own retry
key and its confirmed receipt for an unchanged file, preparation reuses its
operation only for an identical request, and every receipt is checked before the
imports are refreshed and the page returns to Register. Every read, decision,
download and preparation is bound to the signed-in account, and a failed refresh
keeps an open draft but holds preparation until a retry succeeds.

Each class on the dashboard's Register also shows its register entries, its
[corrections](../operations/register-foundation.md#compensating-corrections) and
its latest [reconciliation](../operations/register-foundation.md#reconciling-with-the-chain).
Entries list newest first, a page at a time with Load more, each once: kind,
number, effective and recorded dates, the changes as signed whole-share counts
beside each member's name, the entry an entry corrects and the entry that
reversed it. Holders of administration or `prepare` get **Correct this entry**
on each correctable entry. Corrections list every page of the class's
corrections, newest first and each once, and each page's corrected entries are
read by their UUIDs in one request, which fails if it returns an entry not asked
for. Each shows its stage, preparer, dates, the entry being corrected and the
compensating changes, the authority, reference and reason, whether the company
provided the authority document or staff verified it before corrections were
company-run, the decision trail and any rejection reason, with a download of the
authority document. Approve, Apply and Reject follow the import dialog through
`useRegisterDecision`, whose preview adds the original and compensating changes
and the register sequence; a retained staff-era correction offers only
rejection, and a decision or refusal refreshes the corrections, entries,
register and appointments. The reconciliation shows the latest record's status,
block, compared register sequence and time, any failure, and each discrepancy as
a sentence with its particulars and any acknowledgement: its reason, who made
it, when, and whether the company or staff provided it. An appointment holding
administration or `approve` acknowledges an acknowledgeable row with a reason of
up to 1,000 characters through `useDiscrepancyAcknowledgement`; rows that need
attribution say so and offer nothing, and an open acknowledgement holds when its
record, row or appointment changes or cannot be read. **Correct this entry**
opens `/company/register/:uuid/correct/:entry`, a page for every signed-in
account like Register, which reads that entry of the class by its UUID, shows it
and the exact inverse a correction records, and takes the authority document,
the authority, an approving director for a resolution, the reference, the reason
and an effective date no later than today in UTC. The upload keeps its own retry
key and confirmed receipt, preparation reuses its operation only for an
identical request, and both receipts are checked before the corrections are
refreshed and the page returns to Register; a conflict refreshes the entry and
appointments and takes a new operation. Each repeated Correct this entry,
decision, download and Acknowledge control is named for screen readers after its
visible label with the entry, correction or discrepancy it concerns. Readers see
all of this read-only, a refresh that shows an appointment gone withdraws its
controls, and every read, decision, acknowledgement, download and preparation is
bound to the signed-in account.

Each deployed or paused class on the dashboard's Register also lists its
[openings](../operations/register-foundation.md#opening-the-register-from-the-chain),
newest first across every page and each once: stage, preparer, dates, the
boundary block and its date, each address holding shares at the boundary,
largest first, with its shares and the member it maps to: an existing member by
its name, or numbered as an unnamed member when it has none, and a member the
opening creates numbered as a new member; then the authority, reference and
reason, whether the company provided the authority
document or staff verified it before openings were company-run, the decision
trail and any rejection reason, with a download of the authority document. A
staff-era opening whose boundary was never captured says so. Approve, Apply and
Reject use the decision dialog imports and corrections share, through
`useRegisterDecision` with the opening family: its preview adds the opening
entry's effective date and shares by member, an application notes that the
holdings become the register's first entry, a retained staff-era opening offers
only rejection, and a decision or refusal refreshes the openings, the register,
its entries and the person's appointments, so an applied opening shows the
opened register at once. Holders of administration or `prepare` get **Open this
register** while the class's register is not opened. It opens
`/company/register/:uuid/open`, a page for every signed-in account like
Register, which reads the class's holdings on chain and shows the block read,
with notes that preparation captures its own boundary and records the holdings
at that block. The holdings are read again only on request (Try again or Reload
the holdings) or after a conflict, never on window focus or reconnect, and
Prepare is held while the holdings, the appointments or the class are being read
again. A chain that cannot be read says so and offers a retry, a class the
server will not open shows the server's reason instead of the form, and a 404
from the holdings read or from preparation reads the appointments again, so the
form is withdrawn once the appointment is gone. The form takes the authority
document, the authority, an approving director for a resolution, the reference
and the reason, and maps every holding address: an address already linked to a
member keeps that member, and any other is assigned to a member on the page,
either a linked member or a new member, which several addresses may share and
which takes a client-generated ID at preparation. Members are labelled as the
Register will list them, by first appearance with the largest holding first, and
choices are kept by address: a re-read drops a choice only when its address no
longer holds or is now linked, or its member is no longer offered, and then says
the choices were reset until a choice changes or the opening is prepared. The
upload keeps its own retry key and confirmed receipt, preparation reuses its
operation only for an identical request, and both receipts are checked before
the openings are refreshed and the page returns to Register. A conflict
refreshes the holdings and appointments and takes a new operation; a refusal
with the holdings-moved code shows the server's reason and offers to reload the
holdings, keeping the authority details and every choice that still applies. Each repeated
download and decision control is named for screen readers after its visible
label and when its opening was prepared, and every read, decision, download and
preparation is bound to the signed-in account.

Once the selected company's registers are read, the dashboard's Register also
lists that company's
[particulars changes](../operations/register-foundation.md#changing-a-members-particulars)
in a section of their own, read on every page with the company filter, newest
first and each once: the member, by their name on the company's current register
or as a member not named on it, the stage, preparer and dates, the proposed name,
residential address and as-at date, the reason, the decision trail and any
rejection reason, with the note that the company provided the supporting
document and its download. Approve, Apply and Reject use the decision dialog the
other register commands share, through `useRegisterDecision` with the
particulars family: its preview shows the member's current particulars, or that
none are recorded, beside the proposed ones, and before approval or application
notes that the latest as-at date wins between imports and changes while a
member's live verified identity wins over both. Confirming needs the step's
current appointment to be the one previewed, a rejection takes a reason of up to
1,000 characters, and a decision or refusal refreshes the changes, the registers
that name the members, their entries and the person's appointments. Readers with
none of these steps see the changes read-only. Holders of administration or
`prepare` get **Change particulars** on each current member a class lists. It
opens `/company/register/members/:member/particulars`, a page for every
signed-in account like Register, which finds the member among the current
members of the companies where the person may prepare, shows their current
register name and company with the same precedence note, and takes the
company's supporting document, the new name and residential address, an as-at
date no later than today in UTC, defaulting to today, and the reason. The upload
keeps its own retry key and confirmed receipt, preparation reuses its operation
only for an identical request, and both receipts are checked before the changes
are refreshed and the page returns to Register. A conflict reads the member's
register and the appointments again and takes a new operation, a refusal shows
the server's words, and a refusal as not found reads the appointments again, so
the form is withdrawn once the appointment is gone. Each repeated download and
decision control is named for screen readers after its visible label, the member
and when the change was prepared, and each **Change particulars** after the
member; every read, decision, download and preparation is bound to the signed-in
account.

Beside the particulars changes, the dashboard's Register lists the selected
company's [wallet links](../operations/register-foundation.md#linking-wallets-after-the-opening)
in a section of their own, read on every page with the company filter, newest
first and each once: the stage, preparer and dates, each wallet address in the
order the link records it with its member, labelled as the link page labels it:
a current member of the class registers by its name when no other current
member shares it, and otherwise as an unnamed member or by the shared name with
its first wallet shortened, or its first holding when it has no wallet, numbered
in register order if two would still read alike; an existing member no longer on
the registers neutrally; and a member the link creates numbered as a new member,
so wallets that share a member read alike; then the authority,
approving director, reference and reason, the decision trail and any rejection
reason, whether the company provided the authority document or staff verified
it before wallet links were company-run,
and the document's download. Links of another company fail the read. Approve,
Apply and Reject use the decision dialog the other register commands share,
through `useRegisterDecision` with the link family: its preview lists each
wallet with its member, labelled the same way, and, for a wallet on the
company's whitelist, whether its holder proved control of it on Ledova and the
holder's name, for information
only, and before application notes what applying records. A retained staff-era
link offers only rejection. Confirming needs the step's current appointment to
be the one previewed, a rejection takes a reason of up to 1,000 characters, and a
decision or refusal refreshes the links, the waiting wallets, the registers,
their entries and the person's appointments. Readers with none of these steps
see the links read-only. Holders of administration or `prepare` get **Link
waiting wallets** once the company's waiting-wallets read returns a wallet, and
otherwise the note that nothing waits. It opens
`/company/register/companies/:company/links`, a page for every signed-in account
like Register, which reads the wallets that completed issues and transfers wait
for, each with the number of effects waiting for it and its proof and holder for
information, in the order a link records them, and maps every one of them to a
member chosen on the page: a current member of the company's class registers, or
a new member under a client-generated ID that several wallets may share, each
labelled as the link's record and preview will label it, and a current member's
label never changes with the choices. Each wallet starts as its own new member
and is never matched to a member by name. Choices are kept by address: a re-read
drops a choice only when its wallet no longer waits or its member is no longer
offered, returning that wallet to its own new member, and then says the choices
were reset until a choice changes or the link is prepared. The page offers only
waiting wallets, although
the API accepts any address. It takes the authority document, the authority, an
approving director for a resolution, the reference and the reason. The upload
keeps its own retry key and confirmed receipt, preparation reuses its operation
only for an identical request, and both receipts are checked before the links
are refreshed and the page returns to Register. A conflict reads the waiting
wallets, the registers and the appointments again and takes a new operation, a
refusal shows the server's words and reads the waiting wallets and the registers
again, and a refusal as not found, of preparation or
of the waiting-wallets read, reads the appointments again, so the form is
withdrawn once the appointment is gone. Each repeated download and decision
control is named for screen readers after its visible label and when its link
was prepared; every read, decision, download and preparation is bound to the
signed-in account.

`packages/shared` also holds the client layer for the company-run
[corrections](../operations/register-foundation.md#compensating-corrections) and
[discrepancy acknowledgements](../operations/register-foundation.md#acknowledging-a-discrepancy)
the API delivers: services for a class's register entries, its corrections and
its reconciliations, a check of each receipt against its request, their copy,
the `companyRegisterCorrection` destination at
`/company/register/:uuid/correct/:entry` and `useDiscrepancyAcknowledgement`.
`useRegisterDecision` decides corrections as it decides imports. The dashboard
and mobile Register screens described above are built on this layer.

`packages/shared` also holds the client layer for company-run
[openings](../operations/register-foundation.md#opening-the-register-from-the-chain):
services for a class's opening holders and for openings (list with the company,
share class and status filters, prepare, decision preview, decide and the
authority document download), an opening's mapping narrowed at runtime,
`isPreparedRegisterOpening`, which checks a prepared opening against every field
of its request and its mapping row by row, `REGISTER_OPENING_DECISIONS` for
`useRegisterDecision` with the generic decision receipt check, the opening copy
with a sentence for every requirement an opening decision can leave unmet, and the
`companyRegisterOpening` destination at `/company/register/:uuid/open`. Its
helpers order an opening's holdings largest first by exact share count, check
that every share count is whole, label each mapped member once (by name, or
numbered as an unnamed or a new member) and recognise a holdings-moved refusal by
its `opening_holdings_moved` code. The dashboard and mobile opening screens
described above are built on this layer.

`packages/shared` also holds the client layer for company-run
[particulars changes](../operations/register-foundation.md#changing-a-members-particulars):
services for particulars changes (list with the company, member and status
filters, prepare, decision preview, decide and the supporting document
download), `isPreparedRegisterParticularsChange`, which checks a prepared change
against every field of its request, `REGISTER_PARTICULARS_DECISIONS` for
`useRegisterDecision` with the generic decision receipt check, the particulars
copy with a sentence for every requirement a particulars decision can leave
unmet and a note that the latest as-at date wins between imports and changes
while a member's live verified identity wins over both, and the
`companyRegisterParticulars` destination at
`/company/register/members/:member/particulars`. The dashboard and mobile
particulars screens described above are built on this layer.

`packages/shared` also holds the client layer for company-run
[wallet links](../operations/register-foundation.md#linking-wallets-after-the-opening):
services for links (every page of a list with the company and status filters,
the company's waiting wallets, prepare, decision preview, decide and the
authority document download), a link's mapping narrowed at runtime,
`isPreparedRegisterLink`, which checks a prepared link against every field of
its request and its mapping as address and member pairs in any order and letter
case, `registerLinkMemberLabels`, which labels each member a link page offers or
a link maps from the mapping in recorded order and the company's current
members, so the page, the record and the preview always agree,
`REGISTER_LINK_DECISIONS` for `useRegisterDecision` with the generic
decision receipt check, the link copy with a sentence for every requirement a
link decision can leave unmet and each wallet's proof worded as the holder's own
proof on Ledova, never as a verification by Ledova, and the
`companyRegisterLinks` destination at
`/company/register/companies/:company/links`. The dashboard and mobile wallet
link screens described above are built on this layer.

Company details and Company › Application use the same ledger blocks. Company
keeps the existing first-owned-company selection, reads its complete detail and
lists every page of its share classes, filtered to that company. Profile edits
send only changed fields; registered-name edits stay limited to draft or
information-requested applications. New class quantities stay exact strings.
The Application page takes every uploaded document from the complete company
detail, including multiple records of a type, and preserves the recorded review
reasons, responses and dates. It submits, resubmits, withdraws and changes documents
only through the existing owner endpoints and the existing page status rules.
Failed reads hide stale actions and offer retry. Open profile, class, upload and
withdrawal drafts survive read failures; mutations wait for a successful refresh,
and pending requests keep their forms open until completion. Upload, removal and
action refusals remain visible for retry. These pages add no staff approval or
execution controls.

Offerings uses ledger sections for every offering of the selected company and
every subscription to the selected offering, followed by directory visibility and
what happens next. Class and
offering lists follow every page before presenting issuer actions; subscriptions
show requested and allotted shares separately, including zero allotments. AUD
amounts stay exact decimal strings. Payment confirmation and allotment remain
read-only operator records. The existing draft/rejected edit, submission,
withdrawal and draft deletion rules are unchanged. Create and edit forms retain
their drafts through failed or refreshing prerequisite reads and pending writes;
an unavailable edit never becomes a new offering. Quantities are whole integers
within the existing 2,147,483,647 request limit before JSON number conversion.
Price, ordered bounds, dates and available settlement choices are checked before
submission. Operator details failing to load do not imply bank-transfer-only
settlement. The forms list the company's uploaded offer documents to attach for
investors, who can open them once the operator approves the offering; editing
keeps the attached ones, listed even when of another type, until the issuer
unticks one, and saving leaves out an attachment that is not one of the
company's documents. An approved or closed offering has Add documents instead:
its dialog lists the offer documents with the attached ones ticked and
disabled, sends only the new choices, keeps a refusal in the dialog and
refreshes the page on success. Nothing offers to untick an attached document
there, and a dialog opened on an offering that has since left approved or
closed says so and sends nothing.

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

Published to your members opens from Company at `/company/publications`, under
company and dual-role guards. It reads every publication page with the selected
owned company's UUID as `issuer`, separately from the personal Notices cache.
It shows stored documents, frozen company/class names, resolution windows and
exact share/member tallies, and dividend rates and dates, in one Publications
card whose title carries the complete count, with each publication set off by a
rule; with none, the same card says that nothing has been published yet. Both
clients show it this way. It has no personal
ballot or entitlement controls, including when the owner is also a member.
Loading and failed company/publication reads block document actions; retry never
presents a partial list as complete. Document delivery failures remain visible.
Staff still prepare and publish on written instruction; this page adds no
publication creation, approval, payment or execution endpoint.

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
class, Edit phone, Change password beside its sentence), and in a row for what is
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
