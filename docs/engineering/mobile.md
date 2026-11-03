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

Shared register UI (fields and document sharing) lives in `components/register`, and its styles in
`hooks/`. Production screens import no other area's internals. Profile, operator, member, company list,
appointment and company ownership reads, and Team's reads and forms, live in `packages/shared`, with
native session, result and transport policies kept in the client: the app passes its session to each
shared read and request.

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
its lede. The bell opens the web's notifications panel beneath it (`NotificationsPanel`), the same
anchored panel (`AnchoredPanel`) as `FilterPopover`. It has a Notifications header with **Mark all
as read** while any are unread, and the web's rows with an unread dot and a dismiss button. It also has
**Load more notifications** and the web's loading, failure and "No notifications yet." states
(owner, 3 November 2026).
The menu (`AppMenu`) slides in from the left like the
web's phone drawer, 208 points wide: Dashboard, Documents and Settings, and a footer
with the person's name, the selected company as on the web, and Sign out, which asks first, beside the
Dark theme switch. It closes when its screen
loses focus, and it marks the section the page belongs to: Documents for Certificates, Settings for
Profile, Account, Data and privacy and Team, Dashboard for Invitation. Choosing Dashboard returns to it.
Documents opens Certificates and Settings opens Profile. Documents is one link, as the web shows a
member, and like the web's groups Settings' caret shows its pages beneath it, Profile, Account and
Data and privacy, then Team when the selected company's `canManage` allows it, as on the web, open
while one of them is shown. On a Settings page the menu doesn't list,
such as Team opened from Account, Settings itself is marked. Every other choice opens
above Dashboard, so Android's Back returns there; iOS's swipe goes back too. Pages (`Page`) and their cards
(`Section`) use the web's phone sizes: 16-point margins and gaps, and cards with 16-point padding and
corners under a 20-point title; the page's own title is the top bar's. Dashboard
(`mobile/src/screens/holdings/DashboardScreen.tsx`) follows the web's per-company Dashboard. Its
companies are the web's list from the shared `useOwnershipCompanies` (owner, 3 November 2026): every
company the person administers, is appointed to or holds shares in, by name. The selected company is
remembered per account under the web's key (`ledova.company.<user>.<account>`, in AsyncStorage), and
is otherwise the first. With several companies, **Switch company** opens the web's company popover
beneath its icon (`FilterPopover` with `CompanyPicker`): a search field ("Type a company name") over
the companies, each with the web's detail (Company administrator or Company access, and Member), the
current one ticked on the left and highlighted (owner, 3 November 2026). For a company whose register
the person may read, Dashboard is the web's officer view, read through the shared
`useCompanyOwnership` with the class and holder page kept in the screen: Ownership overview with the
person's role, issued shares, current shareholders and share classes (your shares first for a member)
and the classes ranked by issued shares; choosing a class adds the trail and a class card with its
current shareholders, largest first, 25 to a page with the web's pager, and the member's own position
and awards where they hold shares. It has the web's loading, incomplete-total, unopened-class, no
shareholder and failure states with Try again, and the trail returns from a class the overview no
longer lists. The app does not yet have the web's Getting started card or the class card's **Class
details** row, whose pages it lacks. For a company where the person is only a member, the Ownership
overview comes from the shared `ownershipView`, read from the member record's shared ownership, or
from the member's own shares when the company does not share its totals: your shares, issued shares,
current shareholders and share classes, then each class, ranked by the shared `rankOwnershipClasses`,
with its issued count, percentage and your holding. Choosing a class adds the web's trail and class
card (share class, issued shares, your shares and your share of the class) with **Certificates**, and
the member's awards follow with the web's award status and details. Without any company it shows Your
companies and Accept an invitation. Pulling down rereads the member records and, unless the person is
only a member of the selected company, the company list and any register they may read. The
Invitation screen takes the
pasted invitation link or its code (the text after the last `#`, trimmed), previews the inviting
company, the recorded shareholder, the invited email and the deadline, and accepts it through the
member-records state, reporting acceptance only once the server does. Documents, and a class's
**Certificates**, open the selected company's Certificates page
(`mobile/src/screens/documents/CertificatesScreen.tsx`), the web's: the member's own entries in one
share class, newest first. For a member with more than one class, Filters opens the web's panel under its
button (`FilterPopover`) with Share class and Apply. Each record shows the shareholder and change,
the entry and its date (and ledger date), with no action. A class the member is not recorded in says
so, as does a company that has no member record for the person, whose company certificate records
stay on the web; a failed read offers Try again.
Settings has the web's three pages for everyone (`mobile/src/screens/settings/index.tsx`) and
Team. Profile, the `Settings` route, is the web's Personal
information card: the person's details, each label above its value, and **Edit** opens their form
in the card. Pulling down refreshes the profile. Account (`Account`) has the web's three cards. Security
shows the identity check status from the profile (the app has no identity check flow, so there is no
**Review**), **Change** for the password, and the app's biometric sign-in and App lock switches, with
**Biometric security is not available on this device.** beneath them only where that applies; Account
details shows member since and last login; and Invitations' **Shareholder invitation** row has
**Accept**, which opens the Member invitation page, and, as on the web, a **Company officer
invitation** row for anyone who can't manage the selected company has **Accept**, which opens Team.
Its rows follow the web's: the label on the left, and its status, one action
or switch on the right. Data and privacy (`DataPrivacy`) has the same rows: Export data, whose **Export** saves or shares the
file, and Delete account with **Delete**; a screen reader hears the row and then the action, named
Export data or Delete account. The theme is the menu's switch. The pages share one state
(`MemberRecordsProvider`) holding the company list, the selected company and the member records, so an
invitation acceptance whose outcome is uncertain stays recoverable,
with its original code, after leaving the page, and the pages show a loading line rather than an
empty one while the list rereads. Only the focused page selects its record and class.
Team (`mobile/src/screens/settings/TeamScreen.tsx`, its forms in `TeamForms.tsx`) is the web's Team
page at phone width, read and sent through the shared `useCompanyTeam`, `useAcceptInvitationForm`
and `useTeamInvitationForm` with the selected company: Your appointments, **Accept a company
invitation**, the company's Team, **Invite a company user** and Invitations you issued, with the
web's rows, wording, loading, empty and failure states. The Team list is read only with a current
own administration appointment for that company; otherwise it says that authority is required.
Accepting and inviting replace the page with the web's inline form, which keeps its draft when
closed; someone with no appointments who owns no company opens on accepting. The capabilities are
checkboxes, the invitation deadline and appointment expiry are typed as `YYYY-MM-DD` (UTC) with the
web's checks, and the one-time code shows once as selectable text to copy. **Revoke appointment**
asks first in the web's dialog. Pulling down rereads the page while no form or revocation is open.
The web's **Representative authority** is not in the app yet.
A notification, tapped in that list or as a push, opens its screen: vested shares open Dashboard on
the award's company (with its class, where the overview lists it) and issued shares Certificates for
that class, each saying so when that company no longer records you. A certificate-ready notice sent
before members' certificate requests were removed, and a publication notice sent before shareholder
publications were removed, opens nothing.
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
session, nor an old upload acquire a newer sign-in's credentials. Document copies and
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

The document picker (`expo-document-picker`) went with the eligibility screens on 2 November 2026;
the next native build drops its module, and a development app built with it still runs the current
JavaScript. Make release builds from a fresh prebuild
([building from a clean checkout](mobile-releases.md#building-from-a-clean-checkout)).

For one release, each app start and session change still delete the copies an earlier build's
picker and uploads left behind (`sweepEarlierUploadCopies` in
`mobile/src/services/documentCopies.ts`): the picker's UUID-named files in the cache's
`DocumentPicker` folder, the old `ledova-upload-copies-v1` copies and, on iOS, the files in the
temporary folder's `-Inbox` folders. It deletes only files inside the app's own cache or, on iOS,
temporary folder, and needs only `expo-file-system`. The release after that removes it.

## Document view copies

Viewing a document downloads it into the app-owned `ledova-document-views-v1` cache directory and
hands the copy to the share sheet (`shareDocumentCopy`). Data and privacy shares the
[account-data export](records.md#account-data-export) this way, as one JSON copy.

A view is bound to the session current when tapped: its download carries that epoch
([session scope](#session-scope)), and a session change before the write stops it without an alert.
One view per session downloads and writes at a time, and an obsolete download never holds a
successor session's view. Each new view, and session retirement, first empties the directory, even
with a download pending, so the last document stays until the next view or sign-out, and a receiving
app still reading it then loses access. Neither platform says when a receiver has finished
(Android's chooser result does not wait, and the pinned iOS sharing module never settles a share
whose follow-up dialog is cancelled), so the guard ends before the share opens and one unsettled
share cannot block later views. Copies earlier builds wrote to the cache root are not found.

Next: [mobile releases](mobile-releases.md), [frontend](frontend.md) and
[authentication](security.md#authentication-and-sessions).
