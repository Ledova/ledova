# Mobile

[Engineering](README.md) · [Documentation](../README.md)

How the Expo React Native app consumes the shared package, navigates, themes itself, reaches the
network and stores secrets, and how scanners, provider web views and temporary files respond to
focus, app lock and session changes. Shared page conventions are in
[signed-in page conventions](frontend-ux.md#signed-in-page-conventions); builds, probes and device
checks in [mobile releases](mobile-releases.md). Use a Ledova native build; Expo Go lacks its
networking overrides and scanner module.

- [Architecture](#architecture)
- [Theme and appearance](#theme-and-appearance)
- [Session scope](#session-scope)
- [Native transport](#native-transport)
- [Secret storage](#secret-storage)
- [Native dependencies and randomness](#native-dependencies-and-randomness)
- [Create-order recovery](#create-order-recovery)
- [QR scanner permission timing](#qr-scanner-permission-timing)
- [Android scanner sessions](#android-scanner-sessions)
- [Identity-provider WebView lifetime](#identity-provider-webview-lifetime)
- [Buy-crypto WebView lifetime](#buy-crypto-webview-lifetime)
- [Document upload copies](#document-upload-copies)
- [Document view copies](#document-view-copies)

## Architecture

Native projects are generated at prebuild
([toolchain](mobile-releases.md#toolchain-and-generated-projects)). The app maps onto the
[frontend layers](frontend.md#frontend-layers) and their
[dependency direction and placement](frontend.md#dependency-direction-and-placement) under its own
folder names, with relative imports and no path aliases:

| `mobile/src/`         | Dashboard counterpart   | Owns                                                                                                        |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `navigation/`         | `routes/` and the frame | The root stack, the sign-up gate, the drawer, the tabs and a stack per area                                 |
| `screens/<area>/`     | `pages/`                | An area's screens with their hooks and helpers, and the files several of its screens share                  |
| `components/`         | `components/`           | `Page`, `Ledger` and groups such as `modal/`, `panel/` and `qr/`                                            |
| `hooks/`, `contexts/` | `hooks/`                | App-wide hooks; the app-lock, theme and camera-access contexts                                              |
| `services/`           | `services/`             | `apiClient`, the session scope, secure and token storage, the device stores, document copies, notifications |
| `utils/`              | `utils/`                | Keystone UR coding, the software signer, crypto helpers, prepared transfers                                 |
| `config/`, `styles/`  |                         | Network policy and public links; the theme                                                                  |
| `testSupport/`        | `testSupport/`          | Test helpers                                                                                                |

Shared company, register, identity and transfer UI lives in `components/`; their styles and
cross-area reads live in `hooks/`. Production screens import no other area’s internals. Profile, trading,
operator and publication-list reads and shared register helpers live in `packages/shared`, with
native session, result and transport policies kept in the client. The native certifier labels live
in `mobile/src/config/investorEligibility.ts`; register reads remain per client.

`mobile/src/screens/company-register/CreateClassForm.tsx` creates a class from Ledger's **Add share
class** or Getting started's **Set up your ledger**, always with the internal quantity guard
(`TECHNICAL_SHARE_LIMIT`). Its controller,
`useCreateRegisterClass.ts` beside it, owns creation, captured appointment, company and session
guards, and read-only receipt recovery. An uncertain request stays held without another POST.
Empty-opening preparation checks current class and register metadata; the business rules are in
[register setup](../business/register.md#bringing-in-existing-records).

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
sign-in clears the query cache on focus),
`SignupCompletionGate` (which returns an unfinished account to sign-up), the drawer
(`DrawerNavigator`), the bottom tabs (`BottomTabNavigator`) and a stack per area; the dashboard's
routes and guards do not apply. Labels come from the `DESTINATIONS` titles, but screens set their
own titles, so a few differ from the web (Eligibility requests). A company account with readable
classes (`useRegisterAccess().hasClasses` in `mobile/src/hooks/useCompanyRegister.ts`) starts on the
Ledger tab, others on Home (My shares). Its `allowed` result also lets current personal company
administrators and preparers reach Ledger before their first class, without changing that landing.
The tab bar shows only Home, Ledger (with that access) and Wallets; other destinations are hidden tab
routes (`tabBarItemStyle: { display: 'none' }`) opened from the drawer, Market only for an investing
account while `trading_enabled` is on, under Invest. Routes and business sections are in
[Pages](frontend.md#pages).

The drawer's Company group mirrors the web sidebar ([navigation](frontend-ux.md#navigation)). Ledger
opens the share-class overview, and a separate caret shows Issue shares, Transfer shares, History
and Corrections; Shareholders, ESS (read aloud as Employee share scheme), Documents and Company
follow. Each opens a section of the one Ledger screen
(`mobile/src/screens/company-register/CompanyRegisterScreen.tsx`), which keeps the sections that can
hold unfinished work mounted, so the work survives switching; History's entries and Documents reload
with the screen's data. Issue shares, Transfer shares, History and Corrections show one class at a
time, chosen under **Share class**; Shareholders, ESS and Documents list every class, Documents
with each class's certificates, and Company holds member access. The drawer marks the current page.
While work is held, the screen publishes it through `mobile/src/navigation/LedgerNavigation.tsx`: as
on the web, the held task stays on screen whichever task or overview is opened, the class and
company choices lock, and the drawer disables the Ledger overview and the other tasks, leaving the
held task available from a sibling section. The Ledger tab then returns to the screen without
changing its section.

The overview gives each class a card titled with its name and code: issued shares, current
shareholders, authorised shares where set and whether its ledger is opened, with **Class details**
for the share class screen. As on the web, the cards wait until every class's figures agree
(`ownershipSummary` in `@ledova/shared`); otherwise the overview says the register couldn't be
loaded, with Retry. **Add share class** follows the cards, aligned right as on the web, for someone
who can prepare the register, and opens the class form. While work is held, Add share class is
hidden and Class details is disabled.

Issue shares (`ClassIssues.tsx`) lists both kinds of issue under Share issues, as on the web:
`useInvestorIssues.tsx` and `useNonPaidIssues.tsx` each give their status lines and records, and
each record (`AllotmentRecord.tsx`, `GrantRecord.tsx`) leads with the web's summary
(`IssueSummary.tsx`) and its Details and documents. Its decisions (`RegisterDecisions.tsx`) follow
the web's: Reject first and the primary action last, a review in place of the list (the card's
title becomes Review share issue, and the other records and any open preparation hide but stay
mounted, so their held work survives; an open review is held work), recovery
inside and outside the review and unmet requirements in words. An investor issue's Approve also
records the issue (`completeIssue` with the apply appointment); a non-paid issue keeps Approve, then
Record issue. There is no manual refresh: as on the web, it rereads authority, then its records,
on entry, when the app or the screen comes back into view, and every minute while it is on screen
(`useTaskFreshness.ts`, which treats another tab or a pushed screen as hidden), waiting while a
preparation or review is open. **Prepare issue** opens Prepare share
issue in place of the list, which stays mounted, and asks **What kind of issue?**: the investor form
(`AllotmentForm.tsx`) takes the web's three steps under a step indicator
(`mobile/src/components/FormSteps.tsx`), and the non-paid grant form (`GrantForm.tsx`) one.
Switching kind keeps each form's entries; Cancel is there until the chosen form shows, and in each
form after. An award's **Issue vested shares** opens the non-paid form for that award, and the
shareholder screen's **Issue shares to them** the investor form with that person chosen: the
screen's route carries an `issue` request, which selects the class. A started preparation is held
work. As on the web, an award's recipient must be a listed walletless person with retained
particulars, and both forms check their fields when submitted and word a refusal.

Transfer shares (`ClassTransfers.tsx`) lists the class's non-paid transfers under Share transfers,
each record (`TransferRecord.tsx`) leading with the web's From, To, Shares, Transfer date and Status
and its Details and documents. Review and approve opens the web's review (`TransferReview.tsx`) in
place of the list, titled Review share transfer, and its Approve records the transfer too
(`completeTransfer` with the apply appointment): an approved transfer still waiting for its entry
shows **Ready to complete**, and Approve finishes it. Reject transfer uses the same review. There is
no Refresh button: it rereads authority, then its transfers, on entry and when the app or the screen
comes back into view (`useTaskFreshness.ts`, without the minute's interval), waiting while a review
is open.
**Prepare a non-paid transfer** sits beneath the list and opens the separate preparation screen
(`PrepareRegisterTransferScreen.tsx`) with the web's three steps (`TransferForm.tsx`): People and
shares between existing company people only, Transfer documents, then Company authority and review.
It checks each step on Continue and the whole form on Prepare transfer, words a refusal, keeps an
interrupted request to resend unchanged, and returns to Transfer shares on that class, as Cancel
does.

Shareholders (`CompanyPeople.tsx` and `CompanyShareholders.tsx` beside the screen) follows the web
after the same figures check, and only while the person can still read the register: Current
shareholders across every opened class, with a name search, the share class as radio buttons, an
identity-review count and each person's shares and percentage by class, 25 more at a time; then
People without shares and Former shareholders by class. **Add person** opens an inline name and
residential address form; `usePersonRegistration.ts` keeps the web's original-save recovery, and an
unfinished save stays mounted while the other sections say so.

Details, beside each current shareholder and each former shareholder the register names, opens
`CompanyShareholderScreen.tsx`: the web's shareholder page. For someone who can prepare, each
holding with no linked wallet in an opened draft class offers **Transfer shares**, which opens the
preparation with the transferor chosen. It reads the company's registers with the Ledger's query key,
their recorded particulars, their entries and their awards, and shows any of it only with a current
company register appointment, holdings included. **Change particulars** stays for someone who can
prepare the register, and the particulars screen also finds a person without shares. Request and
invitation links open Company, where mobile keeps member access. Its Documents
(`MemberDocuments.tsx`) list the person's retained files with their category and class, share each
through the share sheet, and add one at a time: the upload reuses `useRegisterEvidence`, and an
interrupted save is recovered through its idempotency key before anything is sent again.

## Theme and appearance

The app has the web's Paper and Dark looks from the same tokens
([design tokens and themes](frontend.md#design-tokens-and-themes)). `ThemeProvider`
(`mobile/src/contexts/ThemeContext.tsx`) reads `ledova.theme` from AsyncStorage once, through
`parseTheme`, rendering nothing until the read settles so the first frame has the stored look; a
missing, unknown or unreadable value, or a read pending after two seconds, means Paper, and an older
build's `ledova-theme` key is ignored. `useAppTheme()` returns one precomputed theme object per look
(`mode`, semantic colours, spacing, radius, type, layout and icon scales, font families),
`useThemedStyles` builds style sheets from it, and `useThemeChoice()` gives Settings > Appearance >
Dark theme the mode and a setter. The choice is written only when picked and stays on the device,
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
navigation uses React Navigation's light or dark theme with the token colours; the identity check's
widget goes dark on Dark; the drawer and app-lock screen draw the logo mark in `text.primary` and
`brand.light`; QR codes stay black on white. Before JavaScript runs everything is Paper (splash
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

Release builds require HTTPS for API requests, trading SSE and provider WebViews. The shared URL
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
cancellation, progress, multipart uploads and SSE stay inherited. Provider WebViews reject insecure
initial URLs, insecure navigation and mixed content; the identity-provider views add origin rules
([identity-provider WebView lifetime](#identity-provider-webview-lifetime)), and the buy-crypto view
keeps its own navigation behaviour.

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

Wallet seeds (`mobile/src/services/secureKeyStorage.ts`) use a fresh gated key and service with
`WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` and `requireAuthentication`; reads do not trust the old secured
marker. A legacy migration authenticates, writes and reads back the new gated item, then verifies
removal of the original before returning the phrase; on failure it returns none and keeps whichever
recoverable copy exists, avoiding Expo's iOS preference for a surviving no-auth alias at the old
key. Cancellation, unavailable protection and failed storage never fall back to ungated seed access.

Android keeps SecureStore's exclusions in the legacy backup XML and the Android 12+ cloud and
device-transfer rules, with non-secret preference backups still enabled. iOS device-only
accessibility keeps the selected secrets off other devices but does not stop backups of the app
container. SecureStore can survive an iOS uninstall and reinstall, and biometric enrolment or
passcode changes can invalidate gated items, so the recovery phrase (shown on the Recovery Phrase
screen), kept outside the app, is the only way back to the wallet after a reinstall or an
invalidated item ([Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/),
[Android backup rules](https://developer.android.com/identity/data/autobackup)).

## Native dependencies and randomness

The RNG entry shim (`mobile/crypto-polyfill.js`) and mnemonic generation use Expo Crypto's native
`getRandomValues` directly and throw when it is unavailable; there is no `Math.random` fallback.
Temporary mnemonic entropy is overwritten after conversion, without claiming that JavaScript strings
or every native copy are securely erased. The remaining Buffer, process, crypto-browserify, stream,
events, assert and util shims support the wallet and Keystone dependency graph; the resolution check
and the manual native probe cover their use.

## Create-order recovery

Starting a buy or sell order saves a fresh submission identity in AsyncStorage before requesting a
signing challenge. Each record holds only the protocol version and the user, account, wallet and
submission UUIDs, never terms, challenges, signatures, seeds or bearer tokens; a read, write or
verification failure prevents the first signing request. Closing the draft or signing window,
changing account or retiring the session stops stale seed-read continuations, signing results and
authenticated HTTP replays; a request already sent can still finish on the server, its saved
identity available for authenticated recovery after closing or restarting. The saved-orders list
keeps several unresolved submissions for the current user and account. Recovery follows the
[create protocol](trading-protocols.md#creating-an-order).

## QR scanner permission timing

The shared modal, the animated wallet importer and the wallet-verification scanner share one camera
permission controller. A hidden scanner reads and requests nothing and mounts no preview. Opening
one checks permission and asks once if the platform still allows asking; concurrent openings share
that request. Denial and native getter or request failures do not loop; closing and reopening allows
another attempt.

Leaving the foreground removes the preview and invalidates its callbacks; returning refreshes
permission, settings changes included, without asking. A pending native response cannot restore an
old preview or override a newer refresh. Closing, unmounting or leaving the verification scan step
also retires callbacks, and verification pauses while another route covers it. A completed scan
retires its callback before delivering the result, drops its preview on the next render, stays
completed across foreground changes and shows "✓ Scanned!" (read aloud as "Scanned!") in the
preview's place.

The animated importer keeps its UR fragments through a permission refresh and clears them on a new
opening. Wallet verification asks for permission at the scan step, after the challenge;
software-wallet verification uses no camera. An unsupported signature QR shows guidance and leaves
scanning available.

The app-lock provider pauses camera admission during initialisation, backgrounding, a pending
foreground lock decision and the locked overlay; its synchronous admission snapshot blocks
permission work and retained callbacks before React removes the preview, whatever the listener
order. A newer background transition, or an authorised unlock or disable, retires an older lock
decision. Unlock refreshes permission without asking; an opening first made while locked stays
passive until closed and reopened. A lock pause keeps completed scans, accumulated UR parts and the
verification challenge and step, and changes no app-lock setting.

## Android scanner sessions

The three QR placements use the local Expo module in `mobile/modules/ledova-scanner` on Android and
Expo Camera on iOS. The native view stays mounted while permission is pending or the preview is
paused, so it can observe its own window's focus, attachment and visibility.

The Android view owns a CameraX lifecycle for each admitted scan. Window loss, hidden ancestors,
detachment, disposal or inactive preview props retire that session and unbind only its preview and
analysis use cases, so closing a modal's camera needs neither Activity blur nor JavaScript delivery.
Provider completion and decoded QR results recheck the current native session, including after
asynchronous work. The QR-only decoder uses the CameraX 1.5.0-rc01 and bundled ML Kit barcode
scanning 17.3.0 versions already resolved for Expo Camera; upstream package source is unchanged.

Every window transition advances a generation, and focus recovery needs fresh JavaScript admission
for it after the app-lock and permission checks, so an old `active` prop cannot reopen a camera
while JavaScript is stalled. Scan events carry an admission ID, so queued results from an earlier
preview cannot complete a new scan. Focus recovery reads permission without prompting and keeps
completed scans and partial UR decoding. Barcode delivery also has the native view validate the
generation and scan ID on the Android UI thread, then rechecks JavaScript admission after the reply,
refusing events that waited in the JavaScript queue after native focus loss even before the window
change reaches JavaScript
([Android scanner instrumentation](mobile-releases.md#android-scanner-instrumentation)).

## Identity-provider WebView lifetime

The identity verification form (`VerificationFormModal`, opened by `VerificationModal` on
Profile and at company review) mounts its provider WebView only while the owner is visible and
focused and app-lock admission allows the camera
([QR scanner permission timing](#qr-scanner-permission-timing)); the same synchronous admission and
session check rejects retained completion, navigation and load callbacks before React removes the
view. After a pause a fresh view mounts for the same form; a completed or closed form stays retired.

Closing, replacing credentials, leaving the owning screen or retiring the session invalidates
pending launches and old callbacks; a later explicit launch opens a new form. Submission and status
polling continue while the owner is hidden. Provider SDK and native page-load failures show fixed
messages, not raw errors; backend initialisation messages are still shown.

Sumsub access tokens embedded in the initial HTML have less-than characters escaped, so HTML parsing
cannot end the script or enter a script escape state, and the SDK receives the original token,
quotes, closing-script text and Unicode separators included.

KYCAID completion redirects must keep the configured site URL's scheme and port and match its
hostname or `www` alias; the shared navigation policy rejects credentials and fragments first, and
the same completion check admits the redirect as a navigation, so what may load and what completes
cannot drift apart.

Both views keep `originWhitelist` open, so no refused URL reaches the operating system. Their
synchronous navigation callback returns false on any exception and first requires the current form
lifecycle; a top-frame navigation must also pass the shared web navigation policy and be
`about:blank` or an exact scheme, host and port match from the view's list (KYCAID: the backend's
form URL origin and the completion origin; Sumsub: the site origin, the inline page's base URL).
Android requests carry `isTopFrame` absent or true, so all are top frames; iOS sends false when the
request URL differs from its main document URL, and such a navigation passes only the lifecycle and
shared policy checks. Configured hostnames are lower-cased before comparison, because the app's
`URL` global (Expo's WHATWG polyfill) keeps a hostname's case and would refuse a reported upper-case
host. Both views refuse new windows: `onOpenWindow` does nothing, multiple windows are disabled and
automatic JavaScript window opening is off.

On iOS, camera and microphone requests reach WebKit's own prompt, not a silent grant, and
`NSMicrophoneUsageDescription` stays. Android blocks `RECORD_AUDIO` app-wide although Expo Camera's
plugin and library manifest declare it; nothing in the app records audio. The config plugin declares
the `IMAGE_CAPTURE` and `GET_CONTENT` intent queries without a permission, and without
`expo-image-picker` iOS carries no `NSPhotoLibraryUsageDescription`.

Five expectations rest on documentation or library source, not a device run:

- Both engines report lower-case hosts, since they canonicalise a URL before offering it.
- An Android popup becomes a top-level navigation that the same callback decides
  (`setSupportMultipleWindows` documentation).
- A provider file input requesting capture starts `IMAGE_CAPTURE` only when `resolveActivity` finds
  a camera app, which Android package visibility is expected to hide without that query
  (react-native-webview source).
- A provider page's `<input type="file">` still offers the iOS photo library without
  `NSPhotoLibraryUsageDescription`, because WebKit's `WKFileUploadPanel.mm` uses
  `PHPickerViewController`, which requests no photo-library authorisation.
- iOS top frames: react-native-webview's URL-equality test has not met a main-frame redirect or a
  nil or differently normalised main document URL; such a top-frame request would be checked as a
  subframe, without the origin list.

Owner decisions on #13 accept these gaps:

- Android has no origin check for camera requests: any page or frame receives the camera once the
  app holds `CAMERA`, and can raise the system `CAMERA` prompt when it does not; a request for audio
  and video cannot receive audio
  ([5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982)).
- Android offers no HTTP(S) or `about:` iframe navigation to the callback; iframes with other
  schemes arrive as top frames and the shared policy refuses them. iOS offers iframe navigations but
  applies no origin list
  ([5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982) for Android,
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034) for iOS).
- Android allows a navigation when JavaScript has not answered its synchronous callback within 250
  ms ([5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982)).
- Android never offers POST navigations to the callback
  ([5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034)).
- Only WebKit's prompt governs a provider's microphone request on iOS
  ([5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034)).

The Sumsub SDK builder script loads from an unversioned URL, so its iframe host, token parsing and
frame permissions can change without a repository change; no owner decision covers that.

## Buy-crypto WebView lifetime

The buy-crypto view follows the
[on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments) and
[#920](https://github.com/Ledova/ledova/issues/920)'s account guard. A provider route carries its
requesting account UUID and the session epoch captured before its request, so account replacement,
lost investing authority, sign-out, cancellation, account change or owner unmount retires the URL
even if authority returns, and a late response cannot open the provider. Widget requests need
active, unlocked admission before they start.

Backgrounding or losing app-lock admission, even briefly before React renders, retires a pending
response; resuming requests afresh for the current selection, and the old response cannot navigate.
The native WebView wrapper is removed during app lock, backgrounding or navigation blur, and a blur
revision rejects queued callbacks across a quick blur and return before React commits a new view.
Completion and close are each delivered at most once, and a completed URL stays retired on refocus.
A purchase completion only refreshes wallet and dashboard queries and establishes no payment
settlement. Native load errors show a fixed message without the provider URL or details.

## Document upload copies

`useDocumentUpload` (`mobile/src/hooks/useDocumentUpload.ts`) is the one document picker, serialised
across the app, for investor eligibility evidence, company authority requests
(`AuthorityRequestForm.tsx`), register evidence (`useRegisterEvidence.ts`) and company documents
(`CompanyUpload.tsx`); `mobile/src/services/documentCopies.ts` manages the copies.

A returned file is accepted only when its URI names a generated UUID file directly inside Expo's
private `DocumentPicker` cache, so provider originals and unrelated cache files are never deletion
targets. Unexpected multiple results are refused, retiring each recognised private copy. Native and
provider errors are shown without raw diagnostics.

Before attachment the copied file must be non-empty, at most 10 MiB and, when the provider reports a
size, match it. The check follows native copying, so it cannot bound a cloud-provider download or a
temporary copy that has not reached JavaScript. The copy moves into one of 16 fixed private
`ledova-upload-copies-v1/slot-*` files, and the original URI's retirement is verified separately,
because Expo's move changes its object's URI and supported Android versions below API 26 can report
success without deleting the source.

A selection and its admitted upload consumers have separate lifetimes: replacement, abandonment,
screen or account changes and session retirement release the selection, but the bytes stay until
every admitted upload promise settles, refresh, replay and mutation completion included. A
successful submission retires its copy; a failed one keeps it for a retry. Register evidence also
keeps its idempotency key for the same file and appointment, dropping it after a refusal below 500
or an unconfirmed receipt. A late picker result or old success cannot replace or reset a newer
draft; requests already sent may still complete. Uploads carry the session epoch captured with their
selection ([session scope](#session-scope)).

Before another picker opens, cleanup checks the 16 managed paths, sparing active selections and
consumers, and retires copies a previous process left. Once each pick settles and its copy is
adopted or retired, cleanup lists the picker's own `DocumentPicker` cache directory and removes only
its UUID-named files: copies lost before adoption, partial copies that never returned and older app
versions' files. Session retirement sweeps at once, or when a still-open pick ends; a listing or
deletion failure only logs a warning and never blocks sign-out. A metadata or deletion failure
leaves a slot unusable rather than reporting verified erasure.

## Document view copies

Viewing a document downloads it into the app-owned `ledova-document-views-v1` cache directory and
hands the copy to the share sheet (`shareDocumentCopy`). Every document view works this way:
company, offering, authority-request and register evidence documents, certificates, inspection
copies, register CSV files, the company pack and publication documents. Settings shares the
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

Test coverage of these lifetimes is in
[what automated checks do not establish](mobile-releases.md#what-automated-checks-do-not-establish).

Next: [mobile releases](mobile-releases.md), [frontend](frontend.md) and
[authentication](security.md#authentication-and-sessions).
