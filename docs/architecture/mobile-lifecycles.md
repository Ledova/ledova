# Mobile screen and file lifetimes

[Architecture](README.md) · [Documentation](../README.md)

How scans, provider forms and temporary upload copies respond to focus, app lock and session changes.

## Create-order recovery

Starting a new buy or sell order saves a fresh submission identity in AsyncStorage
before requesting a signing challenge. Each record contains only the protocol
version and user, account, wallet and submission UUIDs. Terms, challenges,
signatures, seeds and bearer tokens are not saved with it. A read/write or
verification failure prevents the first signing request. Equal terms submitted
as explicit new orders remain separate orders; the saved-orders list retains
multiple unresolved submissions for the current user and account.

Closing the draft or signing window, changing account, or retiring the session
prevents stale seed-read continuations, signing results and authenticated HTTP
replays. An already sent request can still finish on the server. Its saved
identity remains available for authenticated recovery after closing or restarting.
Recovery reads the original terms or recorded outcome before requesting another
challenge. A missing or inaccessible lookup stays unconfirmed; it never supplies
invented terms or silently starts a replacement. Confirmed outcomes show the
order's current state, including later changes or cancellation. A terminal refusal
requires an explicit new order to try again with a new identity.

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
preview on the next render and stays completed across foreground changes.

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

Component tests exercise the installed Expo permission methods at a controlled
native boundary, actual UR encoding/decoding and verification step/mutation
hooks, plus the actual app-lock provider with delayed session/authentication
responses. They establish JavaScript request, callback and mount timing. OS prompt
presentation, physical camera shutdown, device settings/OEM behavior and global
lock-overlay/input stacking are not established by these controls and remain
under #13.

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
script or enter a script escape state inside a token. Parser controls use the
mounted WebView's actual HTML and verify that the SDK receives the original token,
including quotes, closing-script text and Unicode separators. These controls use
synthetic tokens and do not contact the provider.

KYCAID completion redirects must retain the configured marketing URL's scheme and
port and match its hostname or existing `www` alias. The shared navigation policy
also rejects credentials and fragments before a redirect can retire the form.
Mounted controls retain ordinary completion and reject changed origins; this
callback check does not constrain the provider's full navigation or media origins.

Mounted JavaScript controls use the locked WebView wrapper, actual app-lock
provider and owner hooks with synthetic credentials. They establish mount,
callback and error-display behavior, not physical camera shutdown or native
permission-dialog cancellation. Provider origin/media grants, Android owning-window
focus and global modal/lock stacking remain separate #13 checks. Provider browsing
and media policies remain unchanged; playback settings do not establish camera
capture control, and a form-completion signal is not server verification approval.

The buy-crypto provider uses the same admission and session lifetime. A widget
URL carries the session epoch captured before its request; a late response after
logout, cancellation, account change or owner unmount cannot open the provider.
Widget requests also require active, unlocked admission before they start.
Backgrounding or losing app-lock admission retires a pending response, including
quick loss/regain before React renders. Resuming starts a fresh request for the
current selection; the old response cannot navigate after access returns.
The native WebView wrapper is removed during app lock, backgrounding or navigation
blur. A blur revision also rejects queued callbacks across a quick blur/return
before React commits a new view. Completion and close are each delivered at most
once, and a completed URL stays retired when focus returns. A current purchase
completion only refreshes wallet/dashboard queries; it does not establish payment
settlement. Native load errors use a fixed message without the provider URL or
error details.

These on-ramp controls exercise the installed WebView JavaScript adapter and real
query mutation callbacks with a synthetic native host and provider response. They
do not establish physical WebView media release or validate vendor origins,
iframe message provenance, third-party payment redirects or media permissions.
Those policies and native/device observations remain part of #13.

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
earlier builds wrote to the cache root are not found.

Component tests control native picker, file and sharing boundaries while
retaining the actual upload hooks and React Query mutation lifecycle. The native
probe supplies a synthetic picker result and exercises actual file move,
retention, multipart upload and retirement on the emulator/simulator. It also
replaces the share sheet to check that only the latest viewed copy remains. It
drives neither system UI. Local/cloud-provider, low-storage and physical-device
checks remain under #13.

Next: [native scanner controls](../reference/native-scanner-probe.md) and [device checks](../development/native-probes.md).
