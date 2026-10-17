# Mobile

[Engineering](README.md) · [Documentation](../README.md)

How the Expo React Native app is put together: how it consumes the shared package, its navigation
and theme, its network transport and secret storage, and how scanners, provider web views and
temporary files respond to focus, app lock and session changes. For engineers changing `mobile/`.
Page conventions shared with the web are in
[signed-in page conventions](frontend.md#signed-in-page-conventions); builds,
probes and device checks are in [mobile releases](mobile-releases.md). Use a
Ledova native build to exercise anything on this page: Expo Go lacks Ledova's native networking
overrides and scanner module.

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

The app uses the versions resolved by `mobile/package-lock.json`, currently Expo SDK 54 on React
Native 0.81. Its native projects are generated at prebuild and never committed
([toolchain](mobile-releases.md#toolchain-and-generated-projects)). Screens live in
`mobile/src/screens`, shared components in `mobile/src/components`, and the network, storage and
session services in `mobile/src/services`. Its `QueryClient` (`mobile/App.tsx`) revalidates on
reconnect but not on focus.

### Shared package resolution

The app imports `@ledova/shared` from source, like the dashboard
([clients and the shared package](frontend.md#clients-and-the-shared-package)).
The package's `react` and `@tanstack/react-query` are peer dependencies, and mobile must supply one
copy of each: `mobile/metro.config.js` resolves both specifiers as if imported from `mobile/index.ts`,
`mobile/jest.config.js` maps them to `mobile/node_modules`, and
`mobile/scripts/shared-peer-resolution.mjs` (the last step of `check-resolution.mjs`) fails if a real
Metro resolution from `App.tsx` and one from a shared hook disagree. Run
`npm --prefix mobile run check:resolution` after dependency changes; `make check` runs it too.

### Navigation

Navigation is declared in `mobile/src/navigation`: the root stack with sign-in and the sign-up
screens (`AppNavigator`), a gate that sends an unfinished account back into sign-up
(`SignupCompletionGate`), the drawer (`DrawerNavigator`), the bottom tabs (`BottomTabNavigator`) and
a stack per area. The tab bar and drawer take their titles from the shared
`DESTINATIONS` table, so a page has one name on both clients. The dashboard's routes and guards do not
apply here: the tab navigator starts a company account with readable register access
(`useRegisterAccess`) on its Register tab and every other account on Home (My shares), and the Market
tab appears only for an investing account while `trading_enabled` is on. What each destination holds
is described in [the app at a glance](../business/README.md#the-app-at-a-glance).

## Theme and appearance

The app has the web's two looks, Paper and Dark, from the same semantic tokens
([design tokens and themes](frontend.md#design-tokens-and-themes)).
`ThemeProvider` (`mobile/src/contexts/ThemeContext.tsx`) reads `ledova.theme` from the device's
AsyncStorage once, through `parseTheme`, and renders nothing until that read settles, so the first
frame already has the stored look. A missing, unknown or unreadable value, or a read still pending
after two seconds, means Paper, and the `ledova-theme` key an older build used is not read.
`useAppTheme()` returns one precomputed theme object per look with its `mode`, the semantic colours,
the spacing, radius, type, layout and icon scales, and the font families; `useThemedStyles` builds a
style sheet from it, and `useThemeChoice()` gives Settings > Appearance > Dark theme the mode and a
setter. The choice is written only when someone picks a theme, stays on the device through sign-out
and restarts, and is not stored on the account. The theme adds one spacing step, `smd` (12), for the
web's 12px spacing that the shared scale lacks.

Roles match the web: brand-coloured text, icons, spinners and pull-to-refresh tints on a surface use
`brand.light` (`interactive.active` equals it), while solid fills under white text, selection borders
and washes use `brand.default` or `brand.mid` (`interactive.defaultSubtle`), and error text uses
`status.error.text` rather than the `error.default` fill.

`mobile/app.json` sets `userInterfaceStyle` to `automatic`. When the look is first known, before the
app's screens mount, and whenever it changes, the provider sets React Native's colour scheme to light
or dark and the root view's background to the page ground, so alerts, switches and date pickers, and
on iOS the keyboard and share sheet, follow the in-app choice rather than the device setting. The
generated-project checks verify the Android `automatic` resource and both iOS `Automatic` appearance
settings. The status bar is dark on Paper and light on Dark, navigation starts from React Navigation's
light or dark theme with the token colours, the identity check's widget opens in its dark theme on
Dark, and the drawer and app-lock screen draw the logo mark in `text.primary` and `brand.light`. QR
codes keep a white tile with black modules in both looks.

What shows before JavaScript runs stays Paper: the splash screen, the Android adaptive-icon background
and, on iOS, the dark launch status bar. Android's navigation bar buttons keep the style React Native
gives them at launch from the device setting.

The app bundles Newsreader and Instrument Sans as font files under `mobile/assets/fonts`, loaded by
`AppFonts` (`mobile/src/components/AppFonts.tsx`) behind a finite loading, error and retry gate.

## Session scope

`mobile/src/services/sessionScope.ts` keeps a session epoch. A fresh sign-in, biometric entry from an
absent session and sign-out advance it; ordinary token rotation preserves it, and conditional
retirement from an obsolete refresh does not invalidate a newer session. Work that must not outlive
its session captures the epoch when it starts and passes it to the API client as
`ledovaSessionEpoch`, with an optional `ledovaSubmissionGuard`; the client's request interceptor
(`mobile/src/services/apiClient.ts`) checks both before and after reading the stored access token,
and refresh and replay check them again. Credential lookup, token refresh and late UI callbacks
therefore cannot carry a result into a replacement session, and an old upload cannot acquire a newer
sign-in's credentials. Document copies, ballots and drafts are bound to the account, company and
session they opened under, and a company, account or session change retires a pending document
action.

The web side of the client session (the shared authentication query and cache clearing) is in
[client sessions and caches](frontend.md#client-sessions-and-caches); tokens and
revocation are in [authentication](security.md#authentication-and-sessions).

## Native transport

This is the single home for the app's network policy; the related settings are listed in
[configuration](../operations/configuration.md).

Release builds require HTTPS for API requests, trading SSE and provider WebViews. The shared URL
policy (`mobile/src/config/networkPolicy.ts`) refuses credentials embedded in URLs, fragments,
malformed URLs and any bearer destination outside `EXPO_PUBLIC_API_URL`'s origin. Axios absolute URLs
and `baseURL` overrides pass through the same check. An absent stored session removes an existing
Authorization header before dispatch. The app sends `X-Auth-Transport: bearer`, so the API returns
tokens in the body rather than setting cookies.

Native Debug allows exact `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` hosts. For a physical
development device, set `EXPO_PUBLIC_DEV_API_HOST` to one private LAN IPv4 and set the API and site
URLs to that host before prebuild. Ports are not restricted by the native allowlist. Do not put
credentials in `EXPO_PUBLIC_` variables; Expo embeds them in the bundle. Changing the native allowance
requires regeneration and rebuilding. A Release build made from a Debug-configured prebuild still
denies cleartext.

Android uses separate main and Debug network security resources. iOS uses separate Release and Debug
plists and a compile-time HTTP guard in its request handler (`LedovaHTTPRequestHandler`, installed by
`mobile/plugins/withMobileSecurity.cjs`), including numeric IP addresses. This matters on supported
older Apple systems where ATS alone does not cover every local or numeric destination.
[Android network security configuration](https://developer.android.com/privacy-and-security/security-config)
and
[Apple's ATS reference](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html)
describe the platform behaviour.

The API must serve requests directly. Android's existing React Native OkHttp client and an iOS
subclass of React Native's existing HTTP handler refuse redirects, including 307 and 308 requests that
could otherwise forward sign-in or refresh bodies. The iOS handler is registered through React
Native's new-architecture protocol provider. Normal platform TLS validation, request cancellation,
progress, multipart uploads and SSE remain in the inherited networking implementation. Provider
WebViews reject insecure initial URLs, insecure navigation and mixed content; the identity-provider
WebViews add their own origin rules
([identity-provider WebView lifetime](#identity-provider-webview-lifetime)),
and the buy-crypto WebView keeps its own navigation behaviour.

## Secret storage

Ordinary access and refresh tokens share a fresh `session.tokens.v2` SecureStore item
(`mobile/src/services/tokenStorage.ts`) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, without requiring
biometric authentication. A healthy complete legacy pair migrates only after replacement read-back
and verified removal of both originals. Incomplete or failed migration exposes no credentials. A
serial queue orders session and biometric mutations. Refresh responses can update or retire only the
generation and refresh identity captured before their request, so late responses cannot recreate a
signed-out session or replace a newer sign-in.

Sign-out persists a non-secret retirement marker, removes the ordinary pair and verifies its absence
without an authentication prompt. If native deletion silently leaves the pair behind, reads remain
refused after an app restart and sign-out reports failure. An unavailable retirement-marker write
refuses reads in the running process; durable retirement cannot be guaranteed while the storage
provider itself cannot write. When sign-out reports failure, the app still clears cached account data
and returns to sign-in with a fixed-text warning instead of the storage error; an account deletion the
server accepted is not reported as failed. A deliberate successful sign-in activates a new pair.

Optional biometric sign-in stays optional: its ready marker is retired and verified without
prompting. Expo's iOS native deletion ignores Keychain deletion status, so physical erasure of the
separately gated copy is not verified by prompt-free sign-out; the app refuses reads through its
retired marker. The biometric read also applies the session retirement marker and the in-process
refusal before it prompts, so a sign-out whose retirement fails part-way cannot hand back the gated
copy in that process, or after a restart once the retirement marker was written.

Wallet seeds (`mobile/src/services/secureKeyStorage.ts`) use a fresh gated key and service with
`WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` and `requireAuthentication`. Reads do not trust the old secured
marker. A legacy migration authenticates, writes and reads back the new gated item, then verifies
removal of the original before returning the phrase. Failure returns no phrase and preserves whichever
recoverable copy already exists. This avoids Expo's iOS preference for a surviving no-auth alias at
the old key. Cancellation, unavailable protection and failed storage do not fall back to ungated seed
access.

Android retains SecureStore's exclusions in both legacy backup XML and Android 12+ cloud and
device-transfer rules. Existing non-secret preference backups remain enabled. iOS device-only
accessibility prevents transfer of the selected secret items to another device; it does not disable
backups of the entire app container. SecureStore can persist across iOS uninstall and reinstall, and
biometric enrolment or passcode changes can invalidate gated items. Keep a recovery phrase outside
the app under the wallet recovery procedure. These platform semantics are documented by
[Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/) and
[Android backup rules](https://developer.android.com/identity/data/autobackup).

## Native dependencies and randomness

The RNG entry shim (`mobile/crypto-polyfill.js`) and mnemonic generation use Expo Crypto's native
`getRandomValues` directly and throw when it is unavailable; there is no `Math.random` fallback.
Temporary mnemonic entropy is overwritten after conversion; that is not a claim that JavaScript
strings or all native copies can be securely erased. The remaining Buffer, process,
crypto-browserify, stream, events, assert and util shims support the wallet and Keystone dependency
graph. The resolution check (`npm --prefix mobile run check:resolution`) and the manual native probe
cover their use.

## Create-order recovery

Starting a new buy or sell order saves a fresh submission identity in AsyncStorage before requesting
a signing challenge. Each record contains only the protocol version and user, account, wallet and
submission UUIDs; terms, challenges, signatures, seeds and bearer tokens are never saved with it. A
read, write or verification failure prevents the first signing request. Closing the draft or signing
window, changing account, or retiring the session prevents stale seed-read continuations, signing
results and authenticated HTTP replays; an already sent request can still finish on the server, and
its saved identity remains available for authenticated recovery after closing or restarting. The
saved-orders list retains multiple unresolved submissions for the current user and account. Recovery
follows the [create protocol](trading-protocols.md#creating-an-order).

## QR scanner permission timing

The shared modal, animated wallet importer and wallet-verification scanner use one camera permission
controller. Hidden scanners do not read or request permission or mount a preview. Opening a scanner
checks the current permission and makes one request when the platform allows asking again.
Concurrent openings share an outstanding request. Denial and native getter or request failures do not
loop; closing and opening the scanner again permits another attempt.

Leaving the foreground removes the preview and invalidates its callbacks. Returning refreshes
permission, including changes made in settings, without asking again. A pending native response
cannot restore an old preview or override a newer refresh. Closing, unmounting or leaving the
verification scan step also retires callbacks. Verification pauses while another navigation route
covers it. A completed scan retires its callback before delivering the result, removes its preview on
the next render and stays completed across foreground changes. In the preview's place it shows
"✓ Scanned!", which screen readers read as "Scanned!".

The animated importer retains its UR fragments during a permission refresh and clears them on a new
opening. Wallet verification requests permission at the scan step, after the challenge;
software-wallet verification does not use the camera. An unsupported signature QR displays guidance
and leaves scanning available.

The app-lock provider also pauses camera admission during initialisation, backgrounding, a pending
foreground lock decision and the locked overlay. Its synchronous admission snapshot blocks permission
work and retained callbacks before React removes the preview, regardless of provider and scanner
listener order. A newer background transition or an authorised unlock or disable retires an older
lock decision. Unlock refreshes permission without requesting it again; an opening first made while
locked is passive until a later explicit close and reopen. A lock pause preserves completed scans,
accumulated UR parts and the verification challenge and step. The optional lock setting, the session
criterion, the absence threshold and the biometric or passcode fallback are unchanged by the pause.

## Android scanner sessions

The three QR placements use the local Expo module in `mobile/modules/ledova-scanner`. Its native view
stays mounted while permission is pending or the preview is paused, so it can observe its own
window's focus, attachment and visibility. The iOS placements use Expo Camera. Android requires a
rebuilt Ledova app; Expo Go does not contain the local module and cannot open these scanners.

The Android view owns a CameraX lifecycle for each admitted scan. Window loss, hidden ancestors,
detachment, disposal or inactive preview props retire that session and unbind only its preview and
analysis use cases. Neither Activity blur nor JavaScript delivery is needed to close a modal's camera.
Provider completion and decoded QR results recheck the current native session, including after
asynchronous work. The QR-only decoder uses the same CameraX 1.5.0-rc01 and bundled ML Kit barcode
scanning 17.3.0 versions already resolved for Expo Camera; upstream package source is unchanged.

Every window transition advances a generation. Focus recovery needs fresh JavaScript admission for
that generation, after the app-lock and permission checks. An old `active` prop cannot reopen a camera
while JavaScript is stalled. Scan events also carry an admission ID, so queued results from an earlier
preview cannot complete a new scan. Focus recovery reads permission without prompting again and
preserves completed scans and partial UR decoding. Barcode delivery also asks the native view to
validate the generation and scan ID on the Android UI thread, then rechecks JavaScript admission after
the reply. This refuses events that waited in the JavaScript queue after native focus loss, even when
the window-change notification has not reached JavaScript yet. The instrumentation that verifies this
ownership is in
[Android scanner instrumentation](mobile-releases.md#android-scanner-instrumentation).

## Identity-provider WebView lifetime

The sign-up and profile verification forms mount their provider WebView only while their owner is
visible and focused, the app is active, and the app-lock provider admits camera use. Initialisation,
foreground lock evaluation and the locked overlay remove the WebView. A synchronous admission and
session check also rejects retained completion, navigation and load callbacks before React removes the
native view. Returning from a lock or foreground pause mounts a fresh view for the same form; a
completed or closed form stays retired.

Closing, replacing credentials, leaving the owning screen or retiring the session invalidates pending
form launches and old callbacks. A later explicit launch can open a new form. Normal successful
submission and its status polling continue; hiding the owner alone does not stop submitted-status
polling. Provider SDK failures and native page-load failures use fixed messages instead of raw
provider or WebView error payloads. Backend initialisation error messages are still shown.

Sumsub access tokens remain opaque strings when embedded in the initial HTML. The serialised value
escapes less-than characters so HTML parsing cannot end the script or enter a script escape state
inside a token, so the SDK receives the original token, including quotes, closing-script text and
Unicode separators.

KYCAID completion redirects must retain the configured site URL's scheme and port and match its
hostname or its `www` alias. The shared navigation policy also rejects credentials and fragments
before a redirect can retire the form. The same completion check admits the redirect as a navigation,
so what may load and what completes cannot drift apart.

Both verification WebViews keep `originWhitelist` open, so a refused URL is never handed to the
operating system. Their navigation callback is synchronous, returns false on any exception and first
requires the current form lifecycle. A top-frame navigation must also pass the shared web navigation
policy and be `about:blank` or an exact scheme, host and port match from the view's list:

- KYCAID: the origin of the form URL the backend returned, plus the completion origin above.
- Sumsub: the site origin, which is the inline page's base URL.

Android requests carry `isTopFrame` absent or true, so every one is a top frame. iOS sends
`isTopFrame` false when the request URL differs from its main document URL; such a navigation passes
only the lifecycle and shared web navigation checks. Configured hostnames are lower-cased before
comparison, because the app's `URL` global, Expo's WHATWG polyfill, keeps a hostname's case; a
reported upper-case host would be refused. Both views refuse new windows: `onOpenWindow` does
nothing, multiple windows are disabled and automatic JavaScript window opening stays off.

On iOS, camera and microphone requests reach WebKit's own prompt instead of a silent grant, and
`NSMicrophoneUsageDescription` stays. On Android a page gets the camera without an origin check once
the app holds `CAMERA`. Android blocks `RECORD_AUDIO` app-wide, although Expo Camera's plugin and
library manifest declare it; nothing in the app records audio. The app's config plugin declares the
`IMAGE_CAPTURE` and `GET_CONTENT` intent queries, and no permission with them. Without
`expo-image-picker`, iOS carries no `NSPhotoLibraryUsageDescription`.

Five expectations rest on platform documentation or library source, not on a device run:

- Both engines report lower-case hosts, since they canonicalise a URL before offering it.
- An Android popup becomes a top-level navigation that the same callback decides (Android's
  `setSupportMultipleWindows` documentation).
- A provider file input that requests capture starts `IMAGE_CAPTURE` only when `resolveActivity`
  finds a camera app, which Android package visibility is expected to hide without that query
  (react-native-webview source).
- A provider page's `<input type="file">` still offers the iOS photo library without
  `NSPhotoLibraryUsageDescription`, because WebKit's `WKFileUploadPanel.mm` uses
  `PHPickerViewController`, which requests no photo-library authorisation.
- The iOS top-frame test: react-native-webview treats a request as a top frame only when its URL
  equals its main document URL. A main-frame redirect, or a main document URL that is nil or
  normalised differently, has not been seen; a top-frame request that fails the test would be checked
  as a subframe, without the origin list.

These gaps are accepted by the #13 owner decisions named beside each:

- Android has no origin check for camera requests: any page or frame receives the camera once the app
  holds `CAMERA`, and can raise the system `CAMERA` prompt when it does not. A request for audio and
  video cannot receive audio. Decision
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982).
- Android offers no HTTP(S) or `about:` iframe navigation to the callback; iframes with other schemes
  arrive as top frames and the shared policy refuses them. iOS offers iframe navigations but applies no
  origin list. Decisions
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982) for Android and
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034) for iOS.
- Android allows a navigation when JavaScript has not answered its synchronous callback within
  250 ms. Decision
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982).
- Android never offers POST navigations to the callback. Decision
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034).
- Only WebKit's prompt governs a provider's microphone request on iOS. Decision
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034).

The Sumsub SDK builder script loads from an unversioned URL, so its iframe host, token parsing and
frame permissions can change without a repository change. That is known, but no owner decision
accepts or rejects it.

## Buy-crypto WebView lifetime

The buy-crypto provider view follows the
[on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments) and
[#920](https://github.com/Ledova/ledova/issues/920)'s account guard; this section covers only its
lifetime. A provider route carries its requesting account UUID with the session epoch captured
before its request, so account replacement, loss of investing authority, sign-out, cancellation,
account change or owner unmount retires that URL even if authority later returns, and a late response
cannot open the provider. Widget requests also require active, unlocked admission before they start.

Backgrounding or losing app-lock admission retires a pending response, including quick loss and
regain before React renders; resuming starts a fresh request for the current selection, and the old
response cannot navigate after access returns. The native WebView wrapper is removed during app lock,
backgrounding or navigation blur, and a blur revision rejects queued callbacks across a quick blur and
return before React commits a new view. Completion and close are each delivered at most once, and a
completed URL stays retired when focus returns. A current purchase completion only refreshes wallet
and dashboard queries; it does not establish payment settlement. Native load errors use a fixed
message without the provider URL or error details.

## Document upload copies

`useDocumentUpload` (`mobile/src/hooks/useDocumentUpload.ts`) is the one document picker, serialised
across the app. It serves investor eligibility evidence, company authority requests
(`AuthorityRequestForm.tsx`), register evidence (`useRegisterEvidence.ts`) and company documents
(`CompanyUpload.tsx`); the copies themselves are managed by `mobile/src/services/documentCopies.ts`.

A returned file is accepted only when its URI identifies a generated UUID filename directly inside
Expo's private `DocumentPicker` cache. Provider originals and unrelated cache files are never deletion
targets. Unexpected multiple results are refused, with each recognised private copy retired.
Native and provider errors are presented without their raw diagnostic text.

Before attachment, the actual copied file must be non-empty, at most 10 MiB, and match the provider's
reported size when present. This check happens after native copying; it cannot bound a cloud-provider
download or temporary copy that has not returned to JavaScript. The copy moves into one of 16 fixed
private `ledova-upload-copies-v1/slot-*` files. The original URI is retained separately and its
retirement verified: Expo's move changes its object's URI, and supported Android versions below API 26
can report success without deleting the source.

A selected copy and its admitted upload consumers have separate lifetimes. Replacement, abandonment,
screen or account changes and session retirement release the selection. Bytes remain until every
admitted upload promise settles, including refresh, replay and mutation completion. A successful
submission retires its copy; a failed one keeps it so the same file can be retried. Register
evidence also keeps its idempotency key for the same file and appointment, dropping it after a
refusal below 500 or an unconfirmed receipt.
A late picker result or old success cannot replace or reset a newer draft. Already sent requests may
still complete on the server.

These uploads carry the session epoch captured with their selection
([session scope](#session-scope)), so credential reads, refresh entry and
replay refuse a successor session.

Before another picker opens, cleanup checks the 16 exact managed paths, preserving active selections
and consumers, and retires managed copies left by a previous process. After each pick settles, once
its returned copy has been adopted or retired, cleanup also lists the picker's own `DocumentPicker`
cache directory and removes only its UUID-named files: copies lost before adoption, partial copies
that never returned and files from older app versions. Session retirement runs the same sweep
immediately, or at the end of a pick that is still open. A listing or deletion failure only logs a
warning and never blocks sign-out. Other cache paths and provider originals are never listed or
removed. Metadata or deletion failure leaves a slot unavailable for reuse; it is not reported as
verified erasure.

## Document view copies

Viewing a document downloads it into the app-owned `ledova-document-views-v1` cache directory and
hands that copy to the share sheet (`shareDocumentCopy`). Every document view uses it: company,
offering, authority-request and register evidence documents, certificates, inspection copies,
register CSV files, the company pack and publication documents. Settings shares the
[account-data export](records.md#account-data-export) the same way, as one JSON copy.

A view is bound to the session current when it is tapped: its download carries that session epoch, so
credential reads, refresh and replay refuse a successor session, and a session change before the
write stops the view without an alert. One view per session may download and write at a time, and an
obsolete download never holds a successor session's view. Each new view first removes every file in
that directory, and session retirement does the same, even while a download is pending. The last
viewed document therefore stays until the next view or sign-out, and a receiving app still reading it
then loses access. Neither platform says when a receiver has finished reading: Android's chooser
result does not wait for the receiver, and the pinned iOS sharing module never settles a share whose
follow-up dialog the user cancels. The guard therefore ends before the share opens, so one unsettled
share cannot block later views. Copies that earlier builds wrote to the cache root are not found.

None of these lifetimes is covered by the mobile Jest suite; what the native probes do and do not
establish is listed in
[what automated checks do not establish](mobile-releases.md#what-automated-checks-do-not-establish).

Next: [mobile releases](mobile-releases.md),
[frontend](frontend.md) and
[authentication](security.md#authentication-and-sessions).
