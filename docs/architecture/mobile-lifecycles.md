# Mobile screen and file lifetimes

[Architecture](README.md) · [Documentation](../README.md)

How scans, provider forms and temporary upload copies respond to focus, app lock and session changes.

## Create-order recovery

Starting a new buy or sell order saves a fresh submission identity in AsyncStorage
before requesting a signing challenge. Each record contains only the protocol
version and user, account, wallet and submission UUIDs; terms, challenges,
signatures, seeds and bearer tokens are never saved with it. A read/write or
verification failure prevents the first signing request. Closing the draft or
signing window, changing account, or retiring the session prevents stale
seed-read continuations, signing results and authenticated HTTP replays; an
already sent request can still finish on the server, and its saved identity
remains available for authenticated recovery after closing or restarting. The
saved-orders list retains multiple unresolved submissions for the current user
and account. Recovery follows the
[create protocol](../reference/order-submissions.md#creating-an-order).

Shared React/query peer resolution is documented in [client architecture](clients.md).

## QR scanner permission timing

The shared modal, animated wallet importer and wallet-verification scanner use
one camera permission controller. Hidden scanners do not read or request
permission or mount a preview. Opening a scanner checks the current permission
and makes one request when the platform allows asking again. Concurrent openings
share an outstanding request. Denial and native getter/request failures do not
loop; closing and opening the scanner again permits another attempt.

Leaving the foreground removes the preview and invalidates its callbacks.
Returning refreshes permission, including changes made in settings, without
asking again. A pending native response cannot restore an old preview or override
a newer refresh. Closing, unmounting or leaving the verification scan step also
retires callbacks. Verification pauses while another navigation route covers it.
A completed scan retires its callback before delivering the result, removes its
preview on the next render and stays completed across foreground changes. In the
preview's place it shows "✓ Scanned!", which screen readers read as "Scanned!".

The animated importer retains its UR fragments during a permission refresh and
clears them on a new opening. Wallet verification requests permission at the scan
step, after the challenge; software-wallet verification does not use the camera.
An unsupported signature QR displays guidance and leaves scanning available.

The app-lock provider also pauses camera admission during initialization,
backgrounding, a pending foreground lock decision and the locked overlay. Its
synchronous admission snapshot blocks permission work and retained callbacks
before React removes the preview, regardless of provider/scanner listener order.
A newer background transition or an authorized unlock/disable retires an older
lock decision. Unlock refreshes permission without requesting it again; an opening
first made while locked is passive until a later explicit close/reopen. A lock
pause preserves completed scans, accumulated UR parts and the verification
challenge/step. The optional lock setting, existing session criterion, absence
threshold and biometric/passcode fallback remain unchanged.

## Android scanner sessions

The three QR placements use the local Expo module in
`mobile/modules/ledova-scanner`. Its native view stays mounted while permission
is pending or the preview is paused, so it can observe its own window's focus,
attachment and visibility. The iOS placements retain Expo Camera. Android
requires a rebuilt Ledova app; Expo Go does not contain the local module and
cannot open these scanners.

The Android view owns a CameraX lifecycle for each admitted scan. Window loss,
hidden ancestors, detachment, disposal or inactive preview props retire that
session and unbind only its preview and analysis use cases. Neither Activity
blur nor JavaScript delivery is needed to close a modal's camera. Provider
completion and decoded QR results recheck the current native session, including
after asynchronous work. The QR-only decoder uses the same CameraX 1.5.0-rc01
and bundled ML Kit 17.3.0 versions already resolved for Expo Camera; upstream
package source is unchanged.

Every window transition advances a generation. Focus recovery needs fresh
JavaScript admission for that generation, after the existing app-lock and
permission checks. An old `active` prop cannot reopen a camera while JavaScript
is stalled. Scan events also carry an admission ID, so queued results from an
earlier preview cannot complete a new scan. Focus recovery reads permission
without prompting again and preserves completed scans and partial UR decoding.
Barcode delivery also asks the native view to validate the generation and scan
ID on the Android UI thread, then rechecks JavaScript admission after the reply.
This refuses events that waited in the JavaScript queue after native focus loss,
even when the window-change notification has not reached JavaScript yet. The
instrumentation that verifies this ownership is in
[native probes](../development/native-probes.md#android-scanner-instrumentation).

## Identity-provider WebView lifetime

The signup and profile verification forms mount their provider WebView only
while their owner is visible and focused, the app is active, and the app-lock
provider admits camera use. Initialization, foreground lock evaluation and the
locked overlay remove the WebView. A synchronous admission/session check also
rejects retained completion, navigation and load callbacks before React removes
the native view. Returning from a lock or foreground pause mounts a fresh view
for the same form; a completed or closed form stays retired.

Closing, replacing credentials, leaving the owning screen or retiring the session
invalidates pending form launches and old callbacks. A later explicit launch can
open a new form. Normal successful submission and its existing status polling
continue; hiding the owner alone does not stop submitted-status polling. Provider
SDK failures and native page-load failures use fixed messages instead of raw
provider or WebView error payloads. Existing backend initialization error messages
are still shown.

Sumsub access tokens remain opaque strings when embedded in the initial HTML.
The serialized value escapes less-than characters so HTML parsing cannot end the
script or enter a script escape state inside a token, so the SDK receives the
original token, including quotes, closing-script text and Unicode separators.

KYCAID completion redirects must retain the configured site URL's scheme and
port and match its hostname or existing `www` alias. The shared navigation policy
also rejects credentials and fragments before a redirect can retire the form. The
same completion check admits the redirect as a navigation, so what may load and
what completes cannot drift apart.

Both verification WebViews keep `originWhitelist` open, so a refused URL is never
handed to the operating system. Their navigation callback is synchronous, returns
false on any exception and first requires the current form lifecycle. A top-frame
navigation must also pass the shared web navigation policy and be `about:blank` or
an exact scheme, host and port match from the view's list:

- KYCAID: the origin of the form URL the backend returned, plus the completion
  origin above.
- Sumsub: the site origin, which is the inline page's base URL.

Android requests carry `isTopFrame` absent or true, so every one is a top frame.
iOS sends `isTopFrame` false when the request URL differs from its main document
URL; such a navigation passes only the lifecycle and shared web navigation checks.
Configured hostnames are lower-cased before comparison, because the app's `URL`
global, Expo's WHATWG polyfill, keeps a hostname's case; a reported upper-case
host would be refused. Both views refuse new windows: `onOpenWindow` does
nothing, multiple windows are disabled and automatic JavaScript window opening
stays off. On iOS, camera and microphone requests reach WebKit's own prompt
instead of a silent grant, and `NSMicrophoneUsageDescription` stays. Android
blocks `RECORD_AUDIO` app-wide, although Expo Camera's plugin and library
manifest declare it; nothing in the app records audio. The app's config plugin
declares the `IMAGE_CAPTURE` and `GET_CONTENT` intent queries, and no permission
with them. Removing `expo-image-picker` dropped `NSPhotoLibraryUsageDescription`
on iOS.

Five expectations rest on platform documentation or library source, not on a
device run:

- Both engines report lower-case hosts, since they canonicalise a URL before
  offering it.
- An Android popup becomes a top-level navigation that the same callback
  decides (Android's `setSupportMultipleWindows` documentation).
- A provider file input that requests capture starts `IMAGE_CAPTURE` only when
  `resolveActivity` finds a camera app, which Android package visibility is
  expected to hide without that query (react-native-webview source).
- A provider page's `<input type="file">` still offers the iOS photo library
  without `NSPhotoLibraryUsageDescription`, because WebKit's
  `WKFileUploadPanel.mm` uses `PHPickerViewController`, which requests no
  photo-library authorization.
- The iOS top-frame test: react-native-webview treats a request as a top frame
  only when its URL equals its main document URL. A main-frame redirect, or a
  main document URL that is nil or normalised differently, has not been seen; a
  top-frame request that fails the test would be checked as a subframe, without
  the origin list.

These gaps are accepted by the #13 owner decisions named beside each:

- Android has no origin check for camera requests: any page or frame receives the
  camera once the app holds `CAMERA`, and can raise the system `CAMERA` prompt
  when it does not. A request for audio and video cannot receive audio. Decision
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982).
- Android offers no HTTP(S) or `about:` iframe navigation to the callback; iframes
  with other schemes arrive as top frames and the shared policy refuses them. iOS
  offers iframe navigations but applies no origin list. Decisions
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982)
  for Android and
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034)
  for iOS.
- Android allows a navigation when JavaScript has not answered its synchronous
  callback within 250 ms. Decision
  [5663884982](https://github.com/Ledova/ledova/issues/13#issuecomment-5663884982).
- Android never offers POST navigations to the callback. Decision
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034).
- Only WebKit's prompt governs a provider's microphone request on iOS. Decision
  [5665093034](https://github.com/Ledova/ledova/issues/13#issuecomment-5665093034).

The Sumsub SDK builder script loads from an unversioned URL, so its iframe host,
token parsing and frame permissions can change without a repository change. That
is known and recorded here, but no owner decision accepts or rejects it.

The buy-crypto provider view follows the
[on-ramp decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)
and [#920](https://github.com/Ledova/ledova/issues/920)'s account guard; this
page covers only its lifetime. A provider route carries its requesting account
UUID with the session epoch captured before its request, so account replacement,
loss of investing authority, logout, cancellation, account change or owner
unmount retires that URL even if authority later returns, and a late response
cannot open the provider. Widget requests also require active, unlocked
admission before they start. Backgrounding or losing app-lock admission retires
a pending response, including quick loss/regain before React renders; resuming
starts a fresh request for the current selection, and the old response cannot
navigate after access returns. The native WebView wrapper is removed during app
lock, backgrounding or navigation blur, and a blur revision rejects queued
callbacks across a quick blur/return before React commits a new view.
Completion and close are each delivered at most once, and a completed URL stays
retired when focus returns. A current purchase completion only refreshes
wallet/dashboard queries; it does not establish payment settlement. Native load
errors use a fixed message without the provider URL or error details.

## Document upload copies

Eligibility and company listing use one serialized document picker. A returned
file is accepted only when its URI identifies a generated UUID filename directly
inside Expo's private `DocumentPicker` cache. Provider originals and unrelated
cache files are never deletion targets. Unexpected multiple results are refused,
with each recognized private copy retired. Native/provider errors are presented
without their raw diagnostic text.

Before attachment, the actual copied file must be non-empty, at most 10 MiB,
and match the provider's reported size when present. This check happens after
native copying; it cannot bound a cloud-provider download or temporary copy that
has not returned to JavaScript. The copy moves into one of 16 fixed private
`ledova-upload-copies-v1/slot-*` files. The original URI is retained separately
and its retirement verified: Expo's move changes its object's URI, and supported
Android versions below API 26 can report success without deleting the source.

A selected copy and its admitted upload consumers have separate lifetimes.
Replacement, abandonment, screen/account changes and session retirement release
the selection. Bytes remain until every admitted upload promise settles,
including refresh/replay and mutation completion. Eligibility retains a failed
submission for retry; listing has no retained-file retry and releases its copy
after either result. A late picker result or old success cannot replace or reset
a newer draft. Already sent requests may still complete on the server.

These uploads carry the session epoch captured with their selection. Fresh login,
biometric entry from an absent session, and logout invalidate it; ordinary token
rotation preserves it. Credential reads, refresh entry and replay check that
epoch so an old upload cannot acquire a newer login's credentials. Conditional
retirement from an obsolete refresh does not invalidate a newer session.

Before another picker opens, cleanup checks the 16 exact managed paths,
preserving active selections and consumers, and retires managed copies left by a
previous process. After each pick settles, once its returned copy has been
adopted or retired, cleanup also lists the picker's own `DocumentPicker` cache
directory and removes only its UUID-named files: copies lost before adoption,
partial copies that never returned and files from older app versions. Session
retirement runs the same sweep immediately, or at the end of a pick that is still
open. A listing or deletion failure only logs a warning and never blocks
sign-out. Other cache paths and provider originals are never listed or removed.
Metadata or deletion failure leaves a slot unavailable for reuse; it is not
reported as verified erasure.

Viewing a listing document downloads it into the app-owned
`ledova-document-views-v1` cache directory and hands that copy to the share
sheet. A view is bound to the session current when it is tapped: its download
carries that session epoch, so credential reads, refresh and replay refuse a
successor session, and a session change before the write stops the view without
an alert. One view per session may download and write at a time, and an obsolete
download never holds a successor session's view. Each new view first removes
every file in that directory, and session retirement does the same, even while a
download is pending. The last viewed document therefore stays until the next view
or sign-out, and a receiving app still reading it then loses access. Neither
platform says when a receiver has finished reading: Android's chooser result does
not wait for the receiver, and the pinned iOS sharing module never settles a
share whose follow-up dialog the user cancels. The guard therefore ends before
the share opens, so one unsettled share cannot block later views. Copies that
earlier builds wrote to the cache root are not found. Settings shares the
[account-data export](../reference/account-data-export.md) the same way, as one
JSON copy in that directory.

## Not established by automated checks

The mobile Jest suite covers none of these lifetimes. The manual
[native probes](../development/native-probes.md) exercise the Android scanner's
session ownership and, with a synthetic picker result, the document copy move,
retention, multipart upload and retirement on an emulator or simulator; they
drive no system UI. OS prompt presentation, physical camera shutdown and
WebView media release, device settings and OEM behaviour, global lock-overlay
and input stacking, native frame, POST, popup, timeout and prompt behaviour,
vendor origins, iframe message provenance, third-party payment redirects,
local or cloud provider pickers, low storage and physical-device checks remain
device work under #13, and a form-completion signal is not server verification
approval.

Next: [scanner instrumentation](../development/native-probes.md#android-scanner-instrumentation) and [device checks](../development/native-probes.md#pre-release-device-checks).
