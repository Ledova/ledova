# Mobile

[Engineering](README.md) · [Documentation](../README.md)

How the Expo React Native app consumes the shared package, navigates, themes itself, reaches the
network and stores secrets, and how its temporary document copies respond to session changes. The
app began as a shareholder app ([decision](../decisions.md#mobile-app-for-shareholders)) and is
being rebuilt like the web at phone width
([decision](../decisions.md#mobile-app-like-the-web-at-phone-width)). Shared page conventions are in
[signed-in page conventions](frontend-ux.md#signed-in-page-conventions); builds, probes and device
checks in [mobile releases](mobile-releases.md). Use a Ledova native build; Expo Go lacks its
networking overrides.

- [Architecture](#architecture)
- [Theme and appearance](#theme-and-appearance)
- [Session scope](#session-scope)
- [Native transport](#native-transport)
- [Secret storage](#secret-storage)
- [Native dependencies and randomness](#native-dependencies-and-randomness)
- [Document view copies](#document-view-copies)
- [Picked evidence copies](#picked-evidence-copies)

## Architecture

Native projects are generated at prebuild
([toolchain](mobile-releases.md#toolchain-and-generated-projects)). The app maps onto the
[frontend layers](frontend.md#frontend-layers) and their
[dependency direction and placement](frontend.md#dependency-direction-and-placement) under its own
folder names, with relative imports and no path aliases:

| `mobile/src/`         | Dashboard counterpart   | Owns                                                                          |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `navigation/`         | `routes/` and the frame | The root stack, the sign-up gate and the signed-in frame                      |
| `screens/<area>/`     | `pages/`                | An area's screens with their hooks and helpers                                |
| `components/`         | `components/`           | `Page`, `Ledger` and groups such as `modal/` and `register/`                  |
| `hooks/`, `contexts/` | `hooks/`                | App-wide hooks; the app-lock and theme contexts                               |
| `services/`           | `services/`             | `apiClient`, the session scope, token storage, document copies, notifications |
| `config/`, `styles/`  |                         | Network policy and public links; the theme                                    |
| `testSupport/`        | `testSupport/`          | Test helpers                                                                  |

Shared register UI (fields and document sharing) lives in `components/register`, and its styles in
`hooks/`. Production screens import no other area's internals. Profile, operator, member,
publication-list and investor classification reads live in `packages/shared`, with native session,
result and transport policies kept in the client.

### Shared package resolution

The app imports `@ledova/shared` from source, like the dashboard
([clients and the shared package](frontend.md#clients-and-the-shared-package)), and supplies one
copy of each peer, `react` and `@tanstack/react-query`: `mobile/metro.config.js` resolves both as if
imported from `mobile/index.ts`, `mobile/jest.config.js` maps them to the mobile app’s `node_modules` directory, and
`mobile/scripts/shared-peer-resolution.mjs`, the last step of `check-resolution.mjs`, fails if real
Metro resolutions from `App.tsx` and from a shared hook disagree. Run
`npm --prefix mobile run check:resolution` after dependency changes; `make check` runs it too.

### Navigation

`mobile/src/navigation` declares the root stack with sign-in and sign-up (`AppNavigator`, which
always opens at sign-in: a stored session is never resumed without a typed or biometric sign-in, and
sign-in clears the query cache on focus) and `SignupCompletionGate`. The gate returns an unfinished
account to sign-up, or, for a company account, to a notice that the app is for shareholders with
only Sign out; once the app has opened, it stays mounted while the account and profile reread, so a
pull to refresh keeps the screen and any unfinished work. A failed profile refresh keeps them too
while a confirmed profile exists. Without one, or when the preferences recheck fails, the gate shows
its error, and a failed sign-in check returns to Sign in. Sign-up's first step sets
the individual role, then pre-screening, personal details, financial profile and review follow; the
dashboard's routes and guards do not apply.

The signed-in app (`SignedInNavigator`) is one stack with the web's phone frame. Every page shows
the web's phone top bar (`TopBar`), never a back button: the menu button, the page's title, its
action (such as Switch company or Filters) and the notifications bell. Inside the frame `Page` sets
the title and action as the screen's `title` and `action` options (`FrameOptions`) and starts with
its lede.
The menu (`AppMenu`) slides in from the left like the
web's phone drawer, 208 points wide: Dashboard and Documents, then Eligibility for an investing
account (the web's rule: a known account whose role opens investing pages) and Settings, and a footer
with the person's name, the selected company as on the web, and Sign out, which asks first, beside the
Dark theme switch. It closes when its screen
loses focus, and it marks the section the page belongs to: Documents for Certificates and Notices,
Eligibility for Verification, Settings for Profile, Account and Data and privacy, Dashboard for
Invitation. Choosing Dashboard returns to it. Documents opens Certificates, Eligibility opens
Verification and Settings opens Profile, and like the web's groups each caret
shows its pages beneath it, Certificates and Notices, or Profile, Account and Data and privacy, open
while one of them is shown. Every other choice opens
above Dashboard, so Android's Back returns there; iOS's swipe goes back too. Pages (`Page`) and their cards
(`Section`) use the web's phone sizes: 16-point margins and gaps, and cards with 16-point padding and
corners under a 20-point title; the page's own title is the top bar's. Dashboard
(`mobile/src/screens/holdings/DashboardScreen.tsx`) follows the web's per-company Dashboard. The
selected company is remembered per account under the web's key (`ledova.company.<user>.<account>`, in
AsyncStorage), and is otherwise the first by name; **Switch company** lists the member's companies
when there are several. Its Ownership overview comes from the shared `ownershipView`, read from the
member record's shared ownership, or from the member's own shares when the company does not share
its totals: your shares, issued shares, current shareholders and share classes, then each class,
ranked by the shared `rankOwnershipClasses`, with its issued count, percentage and your holding.
Choosing a class adds the web's trail and class card (share class, issued shares, your shares and
your share of the class) with **Certificates**, and the member's awards follow with the
web's award status and details. With no member records it shows Your companies and Accept an
invitation. The Invitation screen takes the
pasted invitation link or its code (the text after the last `#`, trimmed), previews the inviting
company, the recorded shareholder, the invited email and the deadline, and accepts it through the
member-records state, reporting acceptance only once the server does. Documents, and a class's
**Certificates**, open the selected company's Certificates page
(`mobile/src/screens/documents/CertificatesScreen.tsx`), the web's: the certificate records of one share class, newest first. Filters opens the web's panel
under its button (`FilterPopover`): Share class, Shareholder and Certificate status, then Clear and
Apply. Each record shows the shareholder and change, the entry, its date (and ledger date) and the
certificate status from the shared `certificateStatus`, with Request certificate, Withdraw request
(after the web's confirmation) and Share PDF, then any earlier requests. The company's other
certificate requests, including those the filters hide, open on demand. A class the member is not
recorded in says so, and a failed read offers Try again. Notices
(`NoticesScreen`), under Documents, is the web's Notices page: every company's notices, each opened
or voted on as on the web. Verification (`mobile/src/screens/eligibility/VerificationScreen.tsx`) is
the web's page without Supporting payslips, which the app does not have yet. Your claims lists each
classification claim with its status from the shared `investorClaimState`, its dates and any reason
given, and **Withdraw claim** on a submitted claim after the web's confirmation; the app has no Your
company eligibility page yet, so there is no link to it. How you qualify offers each category with
**Submit evidence**, or **Add evidence** once one of its claims is submitted, opening the web's claim
form (`ClaimModal`): the accountant's certificate fields where they apply, the basis, one evidence
file ([picked evidence copies](#picked-evidence-copies)) and the declaration, checked on Save with the
shared `investorClaimChecks` and their messages. A server refusal, such as a failed malware check,
shows above the fields. The claims come from the shared `useInvestorEligibility`, and the withdrawal
(`useInvestorWithdrawal`) and the upload carry the session epoch ([session scope](#session-scope)).
Settings has the web's three pages for a member
(`mobile/src/screens/settings/index.tsx`). Profile, the `Settings` route, keeps the web's two cards.
Personal information shows the person's details, each label above its value, and **Edit personal
details** opens their form in the card. The web's read-only card, titled with the company's name
(**How Example Pty Ltd records you**), shows the selected company's recorded name and residential
address with **Wrong? Contact the company.** Account (`Account`) shows the identity check status from the profile (the app has no
identity check flow, so there is no **Review identity check**) and Change password, then the app's
biometric sign-in and App lock switches; Manage account adds member since and last login and
**Accept an invitation** (the member Invitation page), and Rate the app and Share with friends end the
card. Data and privacy (`DataPrivacy`) has Export data, which saves or shares the file, and Delete
account. Each of these rows' actions carries the row's description, so a screen reader hears it once,
with the action. The theme is the menu's switch. The member pages share one member-records state
(`MemberRecordsProvider`), so a request whose outcome is uncertain stays recoverable, with its
original operation, after leaving the page, and the pages show a loading line rather than an
empty one while the list rereads. Only the focused page selects its record and class.
A notification, tapped in that list or as a push, opens its screen: a notice opens Notices, a
ready certificate Certificates for that company, vested
shares Dashboard on the award's company (with its class, where the overview lists it) and issued
shares Certificates for that class, each saying so when that company no longer records you.
Screens set their own titles inside the page.

## Theme and appearance

The app has the web's Paper and Dark looks from the same tokens
([design tokens and themes](frontend.md#design-tokens-and-themes)). `ThemeProvider`
(`mobile/src/contexts/ThemeContext.tsx`) reads `ledova.theme` from AsyncStorage once, through
`parseTheme`, rendering nothing until the read settles so the first frame has the stored look; a
missing, unknown or unreadable value, or a read pending after two seconds, means Paper, and an older
build's `ledova-theme` key is ignored. `useAppTheme()` returns one precomputed theme object per look
(`mode`, semantic colours, spacing, radius, type, layout and icon scales, font families),
`useThemedStyles` builds style sheets from it, and `useThemeChoice()` gives the menu's Dark theme
switch the mode and a setter. The choice is written only when picked and stays on the device,
not the account, through sign-out and restarts. One extra spacing step, `smd` (12), matches the
web's 12px.

Roles match the web: brand text, icons, spinners and pull-to-refresh tints on a surface use
`brand.light` (`interactive.active` equals it); fills under white text, selection borders and washes
use `brand.default` or `brand.mid` (`interactive.defaultSubtle`); error text uses
`status.error.text`, not the `error.default` fill.

With `userInterfaceStyle` `automatic` in `mobile/app.json`, the provider sets React Native's colour
scheme and the root view's background (the page ground) when the look is first known, before the
screens mount, and on every change, so alerts, switches, date pickers and, on iOS, the keyboard and
share sheet follow the in-app choice; the generated-project checks verify the Android `automatic`
resource and both iOS `Automatic` settings. The status bar is dark on Paper and light on Dark;
navigation uses React Navigation's light or dark theme with the token colours; the app-lock screen
draws the logo mark in `text.primary` and `brand.light`. Before JavaScript runs everything is Paper (splash
screen, Android adaptive-icon background, iOS dark launch status bar), and Android's navigation bar
buttons keep the launch style from the device setting.

Newsreader and Instrument Sans are bundled under `mobile/assets/fonts` and loaded by `AppFonts`
(`mobile/src/components/AppFonts.tsx`) behind a finite loading, error and retry gate.

## Session scope

`mobile/src/services/sessionScope.ts` keeps a session epoch: a fresh sign-in, biometric entry from
an absent session and sign-out advance it; token rotation keeps it, and conditional retirement from
an obsolete refresh does not invalidate a newer session. Work that must not outlive its session
passes the epoch captured at its start to the API client as `ledovaSessionEpoch`, optionally with a
`ledovaSubmissionGuard`; the request interceptor (`mobile/src/services/apiClient.ts`) checks both
before and after reading the stored access token, and refresh and replay check again. Credential
lookup, token refresh and late UI callbacks therefore cannot carry a result into a replacement
session, nor an old upload acquire a newer sign-in's credentials. Document copies, ballots and
drafts are bound to the account, company and session they opened under; a change of any retires a
pending document action.

## Native transport

Settings are in [client variables](../operations/configuration.md#clients); the app uses the bearer
transport ([authentication](security.md#authentication-and-sessions)).

Release builds require HTTPS for API requests. The shared URL
policy (`mobile/src/config/networkPolicy.ts`), which Axios absolute URLs and `baseURL` overrides
also pass, refuses credentials embedded in URLs, fragments, malformed URLs and any bearer
destination outside `EXPO_PUBLIC_API_URL`'s origin. With no stored session, an existing
Authorization header is removed before dispatch.

Native Debug allows exact `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` hosts, on any port. For a
physical development device, set `EXPO_PUBLIC_DEV_API_HOST` to one private LAN IPv4 and the API and
site URLs to that host before prebuild. A changed allowance needs regeneration and a rebuild, and a
Release build made from a Debug-configured prebuild still denies cleartext.

Android has separate main and Debug network security resources; iOS has separate Release and Debug
plists and a compile-time HTTP guard, numeric IP addresses included, in its request handler
(`LedovaHTTPRequestHandler`, installed by `mobile/plugins/withMobileSecurity.cjs`), since ATS alone
misses some local or numeric destinations on supported older Apple systems
([Android network security](https://developer.android.com/privacy-and-security/security-config),
[Apple ATS](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html)).

The API must serve requests directly: Android's React Native OkHttp client and an iOS subclass of
React Native's HTTP handler (registered through the new-architecture protocol provider) refuse
redirects, including 307 and 308 that could forward sign-in or refresh bodies; TLS validation,
cancellation and progress stay inherited.

## Secret storage

Access and refresh tokens share one `session.tokens.v2` SecureStore item
(`mobile/src/services/tokenStorage.ts`) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and no biometric
requirement. A healthy complete legacy pair migrates only after the replacement reads back and
removal of both originals is verified; an incomplete or failed migration exposes no credentials. A
serial queue orders session and biometric mutations, and a refresh response can update or retire
only the generation and refresh identity captured before its request, so a late one cannot recreate
a signed-out session or replace a newer sign-in.

Sign-out persists a non-secret retirement marker, removes the pair and verifies its absence without
an authentication prompt. A pair that native deletion silently leaves keeps reads refused after a
restart and makes sign-out report failure; an unwritable marker refuses reads in the running process
only, since durable retirement needs writable storage. A failed sign-out still clears cached account
data and returns to sign-in with a fixed-text warning, not the storage error; a server-accepted
account deletion is not reported as failed. Only a deliberate successful sign-in activates a new
pair.

Biometric sign-in stays optional, and its ready marker is retired and verified without prompting.
Expo's iOS native deletion ignores Keychain deletion status, so prompt-free sign-out cannot verify
erasure of the separately gated copy; the retired marker refuses its reads. The biometric read
applies the retirement marker and the in-process refusal before prompting, so a sign-out whose
retirement fails part-way cannot hand back the gated copy in that process, or after a restart once
the marker was written.

Earlier builds kept wallet seeds under their own gated SecureStore keys, and order and settlement
recovery records (identifiers only, no keys or signatures) in AsyncStorage; this app neither reads
nor deletes them.

Android keeps SecureStore's exclusions in the legacy backup XML and the Android 12+ cloud and
device-transfer rules, with non-secret preference backups still enabled. iOS device-only
accessibility keeps the selected secrets off other devices but does not stop backups of the app
container. SecureStore can survive an iOS uninstall and reinstall, and biometric enrolment or
passcode changes can invalidate gated items
([Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/),
[Android backup rules](https://developer.android.com/identity/data/autobackup)).

## Native dependencies and randomness

Operation keys come from Expo Crypto's native `randomUUID`, and nothing falls back to `Math.random`.
The app sets up no Node globals or shims; the wallet libraries that needed them went with the
screens that used them. `buffer` stays a runtime dependency because `react-native-svg` imports it
without declaring it, and `assert` and `util` arrive through `expo-notifications`. The resolution
check confirms that the app's own imports reach declared runtime dependencies; imports inside
`node_modules` are resolved by Metro when the app is bundled.

## Document view copies

Viewing a document downloads it into the app-owned `ledova-document-views-v1` cache directory and
hands the copy to the share sheet (`shareDocumentCopy`). Every document view works this way: a
member's own certificates and publication documents. Data and privacy shares the
[account-data export](records.md#account-data-export) the same way, as one JSON copy.

A view is bound to the session current when tapped: its download carries that epoch
([session scope](#session-scope)), and a session change before the write stops it without an alert.
One view per session downloads and writes at a time, and an obsolete download never holds a
successor session's view. Each new view, and session retirement, first empties the directory, even
with a download pending, so the last document stays until the next view or sign-out, and a receiving
app still reading it then loses access. Neither platform says when a receiver has finished
(Android's chooser result does not wait, and the pinned iOS sharing module never settles a share
whose follow-up dialog is cancelled), so the guard ends before the share opens and one unsettled
share cannot block later views. Copies earlier builds wrote to the cache root are not found.

## Picked evidence copies

A claim's evidence is chosen with Expo's document picker (`pickDocument` in
`mobile/src/services/documentCopies.ts`), offering PDF, PNG and JPEG files, and the shared
`uploadRefusal` checks it as it is chosen, as on the web. The app uploads a private copy as React
Native's `{ uri, name, type }`, with the session epoch of the pick: on Android the picker copies the
file into its `DocumentPicker` folder in the cache, and on iOS the app uses the copy the system
makes in its temporary folder. The app deletes only the copies the picker returned, never a
provider's original: when another file replaces one, when it is removed, refused or saved, when the
form or the page closes and on every session change. A session change also sweeps the picker's
UUID-named files from the `DocumentPicker` folder and the upload copies earlier builds left in the
cache. An iOS copy an earlier process left, after a crash, stays in the temporary folder until the
system clears it.

Test coverage of these lifetimes is in
[what automated checks do not establish](mobile-releases.md#what-automated-checks-do-not-establish).

Next: [mobile releases](mobile-releases.md), [frontend](frontend.md) and
[authentication](security.md#authentication-and-sessions).
