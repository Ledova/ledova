# Native probes and device checks

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Run isolated native controls and keep their evidence separate from JavaScript tests and physical-device acceptance.

Run the commands below from `mobile/`, after [native prebuild](mobile-builds.md).
Use a dedicated emulator/simulator and select it explicitly.

```bash
ANDROID_SERIAL=emulator-5556 npm run test:native -- android /absolute/fresh/android-results
IOS_SIMULATOR_UDID=your-owned-simulator-uuid npm run test:native -- ios /absolute/fresh/ios-results
```

## The ordinary launch check

The output directory must not already exist. The runner builds and launches the
ordinary Release app, preserves that artifact and checks its release policy.
It then requires the launch to show something: from ten seconds after launch,
two screenshots in a row, a second apart, must each have rows 10% to 90% of the
screen, below the status bar and above the home indicator, differing from their
most common colour in at least 0.05% of pixels. The sign-in screen differs in
over 40%. iOS shows the launch screen, which has content, before a broken
window turns black: on simulators that took up to about two seconds, four on a
loaded machine after a fresh install, hence the wait and the pair. The runner
takes up to 20 screenshots and then fails, which is how a window without a
scene, black but for the status bar, shows up. `ordinary-screen.json` records
the final measurement.

## Android evidence collection

On Android it also records the focused window and app (`focus`) from
`dumpsys window displays`, kept whole in `ordinary-window-displays.txt`; on API 36
`dumpsys window windows` no longer prints them. It fails when a system
"Application Not Responding" window holds focus, since that dialog over the app
passes the content measurement, and when the dump has no `mCurrentFocus` line,
since focus is then unknown rather than checked. Pass or fail, CI's Android job
retains a separate `ledova-native-android-records` directory. The
[Android evidence collector](../../mobile/scripts/android-evidence.mjs) starts
continuous [main/events/system/crash logcat retention](https://developer.android.com/tools/logcat#alternativeBuffers) at the first usable adb
connection, before waiting for boot or building. It samples guest load, CPU and
memory immediately and then every 30 seconds (`guest-load.log`), records host
CPU/parallelism and `nproc`, and retains actual guest properties including the
system-image fingerprint. `ledova-emulator.log` records the actual emulator
version and any RAM adjustment; `ledova-host-vmstat.log` samples the host every
15 seconds. The first recorded `am_anr` event also triggers one window dump and
screenshot, without dismissing a dialog or replacing native focus validation.

Final collection retains the complete printed dropbox, window-manager last ANR,
events/system/crash snapshots, the ANR directory listing and raw trace files
named by that listing or dropbox. Each bounded command records its exit code,
signal, timeout, interruption, direct-child reap state and cleanup errors in
`guest-records-status.jsonl`, alongside any partial output. `collection-complete.json`
requires collection to reach its end and explicitly marks incomplete collection;
permission-denied trace output is not a successfully captured trace. Diagnostic
permission failures remain evidence gaps and do not override the native probe's
focus, camera or transport outcome. No adbd restart or root escalation is used.
An empty record is not proof that no ANR happened.

The watcher has a 55-minute observation bound. Collection has a two-minute total
budget, with ten-second commands and a 60-second dropbox bound. Stop requests
are bound to that watcher's generated identity; cancellation and timeouts stop
its owned child groups and reap direct children. Partial files survive those
paths and are uploaded even when setup or a build fails. Inventory or signalling
errors retain an incomplete cleanup status; unverified groups are not signalled
and an unreaped child is recorded as such. A runner loss or
uncatchable kill can still prevent final collection or upload. These collectors
observe; they never dismiss a dialog, retry or skip a probe.

## Emulator settling

Before the first build, the job attempts to let the emulator settle after boot,
within 300 seconds and without gating the run (`mobile/scripts/emulator-settle.mjs`).
It waits for the broadcast queues to go idle, then polls the guest's 1-minute
load until a complete decimal reading below 4 arrives within the budget; every
wait is bounded by the time left. `ledova-guest-settle.log` records either
settling or a budget gap: the guest stayed busy, a reading was unavailable or
malformed (unconfirmed), or a reading arrived after the budget. The emulator gets
the runner's four vCPUs, and `mobile/scripts/tests/emulator-policy.test.mjs`
executes the actual setup and prebuild shell blocks with isolated tool stubs.
It checks one emulator launch, at least four vCPUs, and completed foreground
boot and settle commands before prebuild. The helper's separate tests check
its real polling and budget behaviour; the shell controls do not boot Android.

These settings mitigate the resource conditions investigated in
[#880](https://github.com/Ledova/ledova/issues/880). In the
[two original failures](https://github.com/Ledova/ledova/actions/runs/37093359335)
([second run](https://github.com/Ledova/ledova/actions/runs/37096677489)), a
SystemUI dialog held focus before the scanner tests were built. Neither bundle
retains the original SystemUI reason, thread trace or onset resource record,
so its cause remains unestablished. Captured Google Play services ANRs belong
to separate processes and do not establish the SystemUI cause.

A 5 October 2026 audit through 00:37 UTC covered 62 completed Android jobs:
21 with two vCPUs and 41 with four. Both failures occurred in the first cohort;
the second had no failed job. This comparison is observational across different
CI hosts. Four vCPUs and settling do not eliminate background ANRs: both a
[dialer job](https://github.com/Ledova/ledova/actions/runs/37229379278) and
[Google Play services](https://github.com/Ledova/ledova/actions/runs/37242070985)
recorded ANRs during settling in successful four-vCPU runs. No retained event
identifies a SystemUI ANR. Early collectors retain a bounded observation
interval; missing original traces remain a gap, and successful later jobs do
not resolve it.

## iOS signing and TLS test servers

iOS uses Xcode's normal ad hoc simulator signing without an Apple account or
signing certificate. Before each ordinary/probe installation, it checks both built
architectures' `__TEXT,__entitlements` sections for the app identity and preserves
their public entitlements. Simulator entitlements are distinct from the code
signature's entitlements; disabling signing can omit the former and break Keychain
controls despite successful compilation and launch. Existing app capabilities
remain in the generated entitlements. Each build phase gets its own
temporary/cache directory so Expo's CI cache cannot retain a previous phase's API
destination. The probe checks the compiled
API client and policy destinations against its isolated server.
Server startup has a 120-second deadline. Each certificate or simulator inspection
tool call has a 30-second timeout. Certificate generation uses its own OpenSSL
configuration and explicit CA/leaf extensions, avoiding duplicate extensions from older tools'
ambient defaults. Before building, strict host requests check both CA-signed
endpoints, an independently trusted leaf and wrong-CA refusals. Top-level evidence
includes the selected tool path/version, configuration hash and public certificate
diagnostics; private keys are not uploaded. Named stages, including each probe
reset, and separate primary/cleanup errors identify
infrastructure failures without recording request credentials or bodies. Native
probe failures also carry a fixed error category and operation stage, never raw
error messages, stacks or values. Categories do not establish a Keychain OSStatus.
Xcode commands have a 45-minute deadline; other asynchronous commands retain their
30-minute limit, and the iOS CI job remains bounded to 90 minutes. A timeout
terminates the owned command group and is reported separately from an exit code
or signal. The runner
then builds a separate test entry against loopback TLS servers with a generated
CA. Android receives a temporary test-only trust resource; iOS receives the CA
only in the owned simulator keychain. The ordinary artifact retains its normal
trust. An untrusted certificate with the same hostname/IP coverage must fail.

## Transport controls

The runner first enables native redirects in generated source and requires both
307/308 refusal assertions to fail while the target receives exactly two
requests. It restores the policy and requires zero redirected target requests,
with successful direct bearer/body, API refresh, native entropy and signing,
file upload/download, streaming and cancellation controls. Numeric HTTP requests
must fail, including repeated refusal/cancellation. An unenrolled Android
emulator additionally checks gated-wallet refusal while preserving a legacy
recovery copy. SIGINT/SIGTERM cancel the runner, terminate its owned
command/server groups
(with forced termination after a two-second grace period), reap direct children,
and restore generated files. Short synchronous tool calls have timeouts.
An uncatchable kill or host loss requires a fresh prebuild before using the
generated project. Remove only the owned emulator/simulator afterward. Deleting
the iOS simulator also removes its test CA.
Do not distribute the probe artifact, the test APKs or the synthetic probe
apps.

## Android scanner instrumentation

`ScannerWindow.android.test.tsx` exercises each placement through the native
event boundary. The Android instrumentation suite exercises real Activity and
Dialog windows, CameraX open/closed state, parent visibility and detachment,
fully clipped previews, backgrounding, delayed provider completion, replacement
sessions, focus loss/regain before JavaScript admission changes, and real
decoding of a synthetic QR bitmap. It runs
inside the Android native CI probe and retains `scanner-window-tests.log`.
A wait that reaches its 15-second deadline appends the focused window, focused
app and top resumed activity at that moment, read through the instrumentation's
shell. When a focus wait fails, a system window such as `Application Not
Responding` holding focus marks an unhealthy emulator, and a test window holding
focus points at scanner admission. The activity and its dialogs are all listed
under the activity's name, so the state cannot say which of them has focus: for
the modal wait, the activity keeping focus instead of the scanner dialog remains
possible. When a camera wait fails, a focused test window only rules out lost
window focus: CameraX binding or camera availability can still be the cause.

The Release probe also drives nested React Native modal windows through the
actual Expo bridge with camera permission granted by the emulator runner. That
separate instrumentation APK first waits for bound preview/analysis use cases
and CameraX OPEN while the scan is active. It requests unmount without delivering
a barcode or calling finish, waits for an explicit JavaScript unmount checkpoint,
and separately requires the captured native view to be detached and absent from
all window trees. Both use cases must then be unbound, CameraX CLOSED and the
selected camera available. Only then does the test request a fresh scanner mount.
The same release conditions apply when that scanner's owning window is covered;
refocus must open fresh use cases on that same view. The Release test retains the
native window notifications while it
delivers a synthetic pre-loss barcode through the existing Expo event callback.
A recorder in the separate instrumentation APK observes the real native
admission function, always delegating its arguments and Boolean result unchanged.
The test requires that exact queued tuple to return false during loss and after
quick regain, then a fresh tuple to return true and call the real scanner finish
once. The completed scanner stays mounted and unbound through another focus
cycle. Final completion removes that scanner and exposes a separate JavaScript
checkpoint; native view absence and release must pass again before the test
requests the unchanged HTTP probe. A missing click acknowledgement therefore
fails its own stage before a teardown assertion is credited. Each release still
has the same 20-second wait and requires all four release conditions. Failure
artifacts record the last stage, captured camera ID, each use-case binding flag,
CameraX state, selected-camera availability, native view attachment/presence and
JavaScript scanner state. These are observations, not inferred failure causes.
Window observations deduplicate native view identities: React Native's modal host
also exposes the dialog's children from the activity tree. Distinct checkpoint
views remain distinct and still refuse an ambiguous JavaScript state.

Before its first checkpoint, each scanner mount asks an inactive 1×1 native
scanner whether generation -1, scan 0 is current and requires `false`. It waits
for that view's first native window event rather than its layout: under the New
Architecture a layout event can reach JavaScript before the view is mounted, and
Expo then rejects the call with `ERR_VIEW_NOT_FOUND`, reported as stage
`method-native-view-not-found`. Any failure of that check ends the scanner probe;
when it happens before the native test observes the camera, the Release test
then fails at `active-unmount-open`, or `remount-open` for the second mount, with
no camera observation. If the window event never arrives, the check never runs
and the mount's next checkpoint button never appears: the Release test fails at
`active-unmount-request`, or `queued-cover-request` for the second mount, after
its 15-second wait and before the probe's own deadline can report.
This exercises the loaded bridge with a synthetic event; it does not
reproduce natural JavaScript queue timing or scan a physical camera image.

The temporary recorder locates the loaded Expo `UntypedAsyncFunctionComponent`
for this view's `isCurrentScan`. Expo registers the same view definition under
its name and a compatibility default key; function lookup deduplicates those
object identities while still rejecting distinct matching functions. It requires
the original call to return a Boolean and returns that same result unchanged.
Both its original function body and the exact
view window callback are restored in `finally`, including a deliberate-throw
restoration control. A missing reflection shape or an unobserved query fails the
test. No product module API or scanner source is patched. The ordinary Release
APK is checked for absence of the test class
and probe controls; the test uses reflection rather than product test hooks.
This establishes Release adapter behaviour, not OS permission-prompt behaviour.

An additional native control opens the front camera through the pinned CameraX
internal camera interface to occupy its opening slot. The back-camera scanner
must remain bound in `PENDING_OPEN` while that front camera is OPEN. Closing the
holder must let the same scanner session, camera, use cases, generation and scan
ID reach OPEN without another request. The holder is closed in `finally`; only
the separate test APK reads the pinned adapter field. This exercises CameraX
resource availability, not camera contention with another application. The owned
emulator must expose both front and back cameras; CI starts it with
`-camera-front emulated`. All pending-state and recovery assertions remain
required. A previous same-process Camera2 holder was invalid: opening the same
camera again disconnects
the first handle, so it cannot establish the required pending state. Its failed
emulator run is retained. Cross-application camera priority remains device work.
The initial JavaScript mount retains its one-minute deadline. The expanded
continuation has a bounded six-minute deadline to accommodate its independent
native stages; each native poll retains its existing 15- or 20-second limit.
Mounted controls require progress past one minute and refusal at the continuation
deadline, and confirm the initial deadline still applies.

These emulator controls do not replace physical-device verification of sensor
shutdown, OS permission dialogs, settings or OEM behaviour. The runner retains
APK hashes, instrumentation logs, screenshots and window diagnostics, including
failed runs, and removes both owned instrumentation packages during cleanup.
The cleanup tracker includes attempted installs and uses bounded adb commands
outside the cancelled command runner. Node controls cover install, instrumentation
and cancellation failures, absent packages and a cleanup error alongside another
owned package. Only completed emulator logs establish native results; JavaScript
and script controls do not certify Kotlin compilation or camera hardware behaviour.

To run only these native controls on an owned emulator after prebuild:

```bash
cd mobile/android
./gradlew :ledova-scanner:assembleDebugAndroidTest --no-daemon --max-workers=2
cd ..
adb -s "$ANDROID_SERIAL" install -r modules/ledova-scanner/android/build/outputs/apk/androidTest/debug/ledova-scanner-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r org.example.ledova.scanner.test/androidx.test.runner.AndroidJUnitRunner
adb -s "$ANDROID_SERIAL" uninstall org.example.ledova.scanner.test
```

Require the instrumentation's nonzero `OK (... tests)` result; `am instrument`
can exit zero after test failure.

## Recording native results

Jest and native probe outcomes are recorded separately. A simulator does not
establish physical biometric enrollment/change, hardware-backed key properties,
OEM backup/transfer, store distribution or behaviour on every supported OS.
Record those limits, any failed native build and the exact tested head in the PR;
JavaScript tests alone do not close a native hardening claim.

## iOS Debug LAN handler probe

A separate local probe checks the configured private IPv4 allowance through the
compiled `LedovaHTTPRequestHandler`, alongside the stock React Native handler as
a reachability and ATS control. Choose an address assigned to a local interface
and a booted, dedicated simulator with no Ledova installation:

```bash
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 \
IOS_SIMULATOR_UDID=your-owned-simulator-uuid \
npm run test:native:lan -- /absolute/fresh/ios-lan-results
```

The output and any existing generated `ios/` directory must share the checkout's
filesystem. Preflight checks this before starting the server or moving the
project, so its preservation and restoration use atomic renames. Copy retained
evidence to an external volume after the command completes if needed.

The runner preserves an existing generated `ios/` directory, generates a fresh
configured project, adds an XCTest target and bundles a small test host. It uses
the actual native HTTP handler source. Configured Debug must reach the local
server, unconfigured Debug must refuse without reaching it, and Release must
refuse HTTP. The stock handler must reach the server in both Debug cases; its
Release result is recorded because numeric-host ATS behaviour depends on the OS
and linked SDK. A timeout or unrelated network error cannot count as a refusal.

An intentional change to the generated Debug allowlist guard must produce the
four expected refusal assertion failures and exactly one unwanted server
request. The runner restores that source before requiring the normal Debug and
Release results. Each case has a new identity that must match the native report,
so an earlier result cannot satisfy a later run. Evidence includes XCTest logs
and result bundles, actual server counts, compiled plists, OS/Xcode/SDK versions,
linked build versions, architecture and binary/source hashes.

SIGINT/SIGTERM and command deadlines stop and reap the owned build processes
before restoring the generated project. The runner removes its test app; remove
the dedicated simulator after inspecting the evidence. Keep the checkout idle
while this probe runs. An uncatchable kill requires recovery from the retained
`native-before` directory before using the generated project again. The output
contains the selected local address and synthetic test configuration; publish a
sanitized result record rather than committing the output directory.

This probe invokes the compiled handler directly. It does not establish React
Native dispatcher selection, which the separate Release app probe exercises,
or physical local-network permission behaviour. Apple documents that the
[simulator does not implement local-network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
The configured-host result must be repeated on a physical iPhone, with
permission/reachability recorded separately from
[ATS local-network policy](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).

## Pre-release device checks

Complete these four flows on physical hardware before release. The first needs
a Keystone; use a development or production build on a device for the mobile
checks. Emulator and simulator checks can supplement this release acceptance
work.

- **The Keystone QR round trip.** Automated scanner controls do not establish
  the complete physical camera and hardware-wallet firmware journey. Verify a wallet,
  send one EVM crypto transfer through the transfer signing flow, and sign one
  trading order through the QR branch. A transfer and a settlement's token
  approval are the only places a raw transaction UR is exercised. Both are sent
  as legacy type-0 transactions, which is what the backend prepares: check that
  what the Keystone displays matches what was prepared. The Keystone 3 firmware
  answers a transaction with an EIP-155 `v` (chain id × 2 + 35 + parity) in as
  few bytes as it needs, so its signature is 65 bytes on chain 1, 66 on Base and
  the local chain, 67 on Base Sepolia and 68 on Ethereum Sepolia. Both clients
  read 65 to 72 bytes and refuse a `v` for another network or a signature that
  does not recover to the wallet's address; tests encode signatures the same
  way, but only a device shows that the firmware still does. Messages and typed
  data are signed with `v` 27 or 28, always 65 bytes. The seed-phrase
  alternative in the dashboard does not cover any of this.

- **Bitcoin manual send.** Prepare a transfer from a Bitcoin wallet, sign the
  raw transaction with your own tooling, paste the hex, broadcast it, and
  confirm the success state links to the testnet explorer. The app never builds
  or signs a Bitcoin transaction.
- **Biometric sign-in.** The app always opens at the sign-in screen. It offers
  biometric sign-in only while biometrics are enrolled and a gated copy of the
  refresh token is stored: the Sign In button then shows a face-scan icon
  instead of a key, and tapping it with both fields empty starts biometric
  sign-in. Sign-out and account deletion remove the copy
  ([secret storage](../architecture/mobile-security.md#secret-storage)), so
  drive a relaunch instead. Start from a fresh install, or turn `<type> Sign In`
  on and then off in Settings: sign-out keeps the setting, and a typed sign-in
  then skips the Enable alert. Keep App Lock off, or backgrounding during a
  prompt can add an unlock screen. On Android, enrol a strong (Class 3)
  biometric: the screen accepts any enrolled biometric, but only a strong one
  opens the gated copy. `<type>` is Face ID when the device reports face
  hardware, Touch ID when it reports only a fingerprint, and Biometrics
  otherwise. An Android phone with weaker face unlock still says Face ID, and
  its prompt then needs the fingerprint.
  1. Sign in with email and password and tap Enable on `Enable <type> Sign In?`,
     or turn on `<type> Sign In` in Settings. Android's Keystore prompts
     `Authenticate to keep biometric sign in`; iOS writes silently.
  2. Without signing out, force-quit and relaunch. Expect the face-scan icon.
     Tap Sign In with both fields empty and pass the biometric prompt (Android
     titles it `Sign in with <type>`; on iOS the first use may show the system
     Face ID permission alert first, which must be allowed). On Android a second
     prompt, `Authenticate to keep biometric sign in`, then stores the rotated
     copy; iOS does not prompt again. Expect the main app.
  3. Force-quit, relaunch and sign in with biometrics again. The backend
     blacklists each refresh token it rotates, so this passes only if the gated
     copy stayed in step with the rotation in step 2. A failure shows the key
     icon, `Biometric sign in is temporarily unavailable` on every retry, or
     `Your saved sign in has expired`.
  4. Android: repeat step 2, but cancel the second prompt or background the app
     while it shows. Sign-in still completes and the copy is dropped: after a
     relaunch the key icon shows, the next sign-in is typed once (no Enable
     alert, one Keystore prompt), and the relaunch after that offers biometrics.
  5. Sign out. Expect the key icon; an empty tap asks for email and password
     with no biometric prompt. One typed sign-in re-arms biometric sign-in for
     the next relaunch.

  A saved sign-in older than `REFRESH_TOKEN_LIFETIME` (seven days by default)
  or revoked elsewhere still shows the face-scan icon, but after the prompt it
  ends with `Your saved sign in has expired`. iOS writes the copy without a
  prompt, so these steps cannot show on an iPhone that the copy is
  biometric-protected; Android's write prompt is the only visible sign.

- **Push delivery.** Configure `extra.eas.projectId` in `mobile/app.json` and
  verify delivery in the device build. Supported emulators and simulators can
  also exercise delivery; the [SDK 54 notification documentation](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/)
  describes their requirements and the Android Expo Go restriction.
