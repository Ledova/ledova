# Mobile releases

[Engineering](README.md) · [Documentation](../README.md)

How to build the native apps, run the manual native probes, complete the physical-device checks and
produce an iOS distribution build. For engineers preparing a mobile release; the app's architecture
and the guarantees these checks exercise are in [mobile](mobile.md).

- [Toolchain and generated projects](#toolchain-and-generated-projects)
- [Building from a clean checkout](#building-from-a-clean-checkout)
- [Generated-project fixes](#generated-project-fixes)
- [Dependency integrity](#dependency-integrity)
- [Native checks before a release](#native-checks-before-a-release)
- [Native probes](#native-probes)
- [What automated checks do not establish](#what-automated-checks-do-not-establish)
- [Pre-release device checks](#pre-release-device-checks)
- [iOS distribution builds](#ios-distribution-builds)

## Toolchain and generated projects

The app uses the versions resolved by `mobile/package-lock.json`, currently Expo SDK 54 on React
Native 0.81. Native projects are generated from `mobile/app.json` and the local config plugins in
`mobile/plugins/`; `android/` and `ios/` are not committed. An explicit iOS distribution environment
can override the store identity through `mobile/app.config.js`
([iOS distribution builds](#ios-distribution-builds)).

The exact toolchain is pinned in [mobile-native.yml](../../.github/workflows/mobile-native.yml), which
selects
[Xcode 16.4 on the macOS 15 runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md):

| Component                | Build baseline                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| Node / npm               | 22.15.1 / 11.5.2                                                            |
| Android                  | JDK 17, SDK/target 36, minimum API 24, Build Tools 36.0.0                   |
| Android native toolchain | NDK 27.1.12297006, CMake 3.22.1, Gradle 8.14.3                              |
| iOS                      | Xcode 16.4, minimum deployment target 15.1, ad hoc signed simulator Release |
| Runtime probes           | Android API 36 x86_64 emulator; iOS 18.5 simulator                          |

These minimum platform versions follow [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/). The
Android build includes ARM64 and x86_64; only the emulator architecture is executed by the probes.
Current Android command line tools may require JDK 21 for SDK installation; select JDK 17 for Gradle.

Install the SDK, NDK and CMake packages from the table, plus platform-tools, emulator and
`system-images;android-36;google_apis;x86_64`. Put the SDK, Gradle cache and AVDs in owned
directories when sharing a machine; do not reuse a personal device or live development service. On
macOS, install CocoaPods and the iOS 18.5 simulator runtime. No EAS account or signing credentials are
needed.

## Building from a clean checkout

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix mobile ci --ignore-scripts --no-audit --no-fund
cd mobile
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run native:prebuild
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run check:native
```

`native:prebuild` replaces the generated projects; preserve any local native experiments first. For
iOS, also run `cd ios && pod install` before returning to `mobile/`. `check:native`
(`mobile/scripts/check-native-projects.mjs`) checks the generated Debug and Release policy, including
the appearance settings and the iOS scene manifest below. `EXPO_PUBLIC_DEV_API_HOST` is the Debug
LAN allowance described in [native transport](mobile.md#native-transport).

## Generated-project fixes

### iOS scene life cycle

iOS 27 stops an app built with the iOS 27 SDK at launch unless it uses the UIKit scene life cycle
([TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)).
Expo 54 generates an app-delegate app with no scene delegate; Expo adds one in SDK 58, and in 57.0.23
behind `ios.enableSceneSupport`. Until that upgrade, `mobile/plugins/withSceneLifecycle.cjs` declares
a `UIApplicationSceneManifest` and adds `LedovaSceneDelegate`, which moves the window `AppDelegate`
creates into the connecting scene and forwards the URL, user-activity, foreground and background
events UIKit no longer sends to the app delegate. `check-native-projects.mjs` refuses a generated
project without the manifest and the delegate. The plugin refuses an `AppDelegate` that no longer
creates a window Objective-C can read (`var window: UIWindow?` on an `ExpoAppDelegate` subclass), or
another scene manifest, so an Expo upgrade that brings its own scene delegate stops at prebuild until
the plugin is removed.

A link that opens the app from closed does not reach JavaScript: UIKit delivers it with the
connecting scene after React Native has started, so `Linking.getInitialURL()` returns null. A link
that arrives while the app runs, such as an OAuth redirect, still reaches `Linking`'s `url` event.
Nothing depends on this today; a feature that needs a link to open the closed app must first move to
Expo SDK 58, or 57.0.23 with `ios.enableSceneSupport`
([expo/expo#47628](https://github.com/expo/expo/pull/47628)), which replaces this plugin.

### CocoaPods post-install fixes

React Native 0.81.5 can turn an empty app spec search into a codegen dependency on the entire iOS
project directory, creating a cycle with Expo's generated provider. The plugin's CocoaPods
post-install helper (`mobile/plugins/native/codegen-inputs.rb`) removes only the exact
`${PODS_ROOT}/..` input from ReactCodegen's Generate Specs phase. Real spec inputs, generation
commands and handler registration remain intact. Manual iOS builds preserve the generated Podspec and
Pods project for build diagnosis.

The same post-install step (`mobile/plugins/native/deployment-targets.rb`) raises any pod target
whose `IPHONEOS_DEPLOYMENT_TARGET` is below the Podfile's platform to that platform, because Xcode 27
refuses targets below iOS 15.0 and some third-party resource bundles still declare older minimums;
targets at or above the platform are left alone. The manual native build checks the generated
project.

## Dependency integrity

The lockfile keeps registry URLs and npm integrity values; the shared workspace is the intentional
local link. Install with `--ignore-scripts` in native CI. The locked packages declaring install
scripts are watcher, fsevents, unrs-resolver and secp256k1; secp256k1 enters through Keystone's hdkey
dependency. No broad dependency upgrade or full transitive source audit is implied.

Each native run records the resolved Android release dependency graph and repository configuration,
or the resolved Podfile.lock and generated iOS protocol provider. The generated Android repositories
are Google Maven, Maven Central and JitPack. The Gradle distribution is SHA-256 pinned by
`mobile/plugins/withMobileSecurity.cjs`. Native dependency graphs still need review when they change;
npm's lockfile does not itself pin every downloaded Maven or Pod artifact. The ordinary APK is checked
for both ZIP alignment and every native library's ELF load-segment alignment at 16 KiB.
[React Native 0.81's compatibility statement](https://reactnative.dev/blog/2025/08/12/react-native-0.81)
does not replace checking third-party binaries.

## Native checks before a release

Android and iOS native builds run only by manual dispatch of
[mobile-native.yml](../../.github/workflows/mobile-native.yml) before a mobile release, under the
[11 October decision](../decisions.md#minimum-tests-and-fresh-migrations). Both platforms build
and start the ordinary Release app and run the native runtime probe. The `Mobile native checks`
verdict requires both jobs to succeed. Native builds are outside `make preflight`
([CI](testing.md#ci)). Record manual build results and device or probe gaps in the
release record.

## Native probes

Run native controls in isolation and keep their evidence separate from JavaScript tests and
physical-device acceptance. Run these commands from `mobile/`, after
[native prebuild](#building-from-a-clean-checkout), on a
dedicated emulator or simulator selected explicitly:

```bash
ANDROID_SERIAL=emulator-5556 npm run test:native -- android /absolute/fresh/android-results
IOS_SIMULATOR_UDID=your-owned-simulator-uuid npm run test:native -- ios /absolute/fresh/ios-results
```

### The ordinary launch check

The output directory must not already exist. The runner (`mobile/scripts/native-smoke.mjs`) builds
and launches the ordinary Release app, preserves that artifact and checks its release policy. It then
requires the launch to show something: from ten seconds after launch, two screenshots in a row, a
second apart, must each have rows 10% to 90% of the screen, below the status bar and above the home
indicator, differing from their most common colour in at least 0.05% of pixels. The sign-in screen
differs in over 40%. iOS shows the launch screen, which has content, before a broken window turns
black: on simulators that took up to about two seconds, four on a loaded machine after a fresh
install, hence the wait and the pair. The runner takes up to 20 screenshots and then fails, which is
how a window without a scene, black but for the status bar, shows up. `ordinary-screen.json` records
the final measurement.

Runner bounds: server startup has a 120-second deadline and each certificate or simulator inspection
tool call 30 seconds; Xcode commands have a 45-minute deadline, other asynchronous commands 30
minutes, and the iOS CI job 90 minutes. A timeout terminates the owned command group and is reported
separately from an exit code or signal.

### Android evidence collection

On Android the runner also records the focused window and app (`focus`) from
`dumpsys window displays`, kept whole in `ordinary-window-displays.txt`; on API 36
`dumpsys window windows` no longer prints them. It fails when a system "Application Not Responding"
window holds focus, since that dialog over the app passes the content measurement, and when the dump
has no `mCurrentFocus` line, since focus is then unknown rather than checked. Pass or fail, CI's
Android job retains a separate `ledova-native-android-records` directory.

The [Android evidence collector](../../mobile/scripts/android-evidence.mjs) starts continuous
[main, events, system and crash logcat retention](https://developer.android.com/tools/logcat#alternativeBuffers)
at the first usable adb connection, before waiting for boot or building. It samples guest load, CPU
and memory immediately and then every 30 seconds (`guest-load.log`), records host CPU, parallelism and
`nproc`, and retains actual guest properties including the system-image fingerprint.
`ledova-emulator.log` records the actual emulator version and any RAM adjustment;
`ledova-host-vmstat.log` samples the host every 15 seconds. The first recorded `am_anr` event also
triggers one window dump and screenshot, without dismissing a dialog or replacing native focus
validation.

Final collection retains the complete printed dropbox, window-manager last ANR, events, system and
crash snapshots, the ANR directory listing and raw trace files named by that listing or dropbox. Each
bounded command records its exit code, signal, timeout, interruption, direct-child reap state and
cleanup errors in `guest-records-status.jsonl`, alongside any partial output.
`collection-complete.json` requires collection to reach its end and explicitly marks incomplete
collection; permission-denied trace output is not a successfully captured trace. Diagnostic
permission failures remain evidence gaps and do not override the native probe's focus, camera or
transport outcome. No adbd restart or root escalation is used. An empty record is not proof that no
ANR happened.

The watcher has a 55-minute observation bound. Collection has a two-minute total budget, with
ten-second commands and a 60-second dropbox bound. Stop requests are bound to that watcher's generated
identity; cancellation and timeouts stop its owned child groups and reap direct children. Partial
files survive those paths and are uploaded even when setup or a build fails. Inventory or signalling
errors retain an incomplete cleanup status; unverified groups are not signalled and an unreaped child
is recorded as such. A runner loss or uncatchable kill can still prevent final collection or upload.
These collectors observe; they never dismiss a dialog, retry or skip a probe.

### Emulator settling

Before the first build, the job attempts to let the emulator settle after boot, within 300 seconds
and without gating the run (`mobile/scripts/emulator-settle.mjs`). It waits for the broadcast queues
to go idle, then polls the guest's 1-minute load until a complete decimal reading below 4 arrives
within the budget; every wait is bounded by the time left. `ledova-guest-settle.log` records either
settling or a budget gap: the guest stayed busy, a reading was unavailable or malformed
(unconfirmed), or a reading arrived after the budget. The emulator gets four vCPUs in the manual
Android workflow, with foreground boot and settling completed before prebuild.

Four vCPUs and settling mitigate the emulator resource conditions investigated in
[#880](https://github.com/Ledova/ledova/issues/880), where a SystemUI dialog held focus before the
scanner tests were built. They do not eliminate background ANRs in other processes, and a run that
retains no original SystemUI trace leaves its cause unestablished.

### iOS signing and TLS test servers

iOS uses Xcode's normal ad hoc simulator signing without an Apple account or signing certificate.
Before each ordinary or probe installation, it checks both built architectures'
`__TEXT,__entitlements` sections for the app identity and preserves their public entitlements.
Simulator entitlements are distinct from the code signature's entitlements; disabling signing can omit
the former and break Keychain controls despite successful compilation and launch. Existing app
capabilities remain in the generated entitlements. Each build phase gets its own temporary and cache
directory so Expo's CI cache cannot retain a previous phase's API destination. The probe checks the
compiled API client and policy destinations against its isolated server.

Certificate generation uses its own OpenSSL configuration and explicit CA and leaf extensions,
avoiding duplicate extensions from older tools' ambient defaults. Before building, strict host
requests check both CA-signed endpoints, an independently trusted leaf and wrong-CA refusals.
Top-level evidence includes the selected tool path and version, configuration hash and public
certificate diagnostics; private keys are not uploaded. Named stages, including each probe reset, and
separate primary and cleanup errors identify infrastructure failures without recording request
credentials or bodies. Native probe failures also carry a fixed error category and operation stage,
never raw error messages, stacks or values. Categories do not establish a Keychain OSStatus.

The runner then builds a separate test entry against loopback TLS servers with a generated CA.
Android receives a temporary test-only trust resource; iOS receives the CA only in the owned
simulator keychain. The ordinary artifact retains its normal trust. An untrusted certificate with the
same hostname or IP coverage must fail.

### Transport controls

The runner checks 307 and 308 refusal with zero redirected target requests, alongside successful
direct bearer and body, API refresh, native entropy and signing, file upload and download, streaming
and cancellation controls. Numeric HTTP requests must fail, including repeated refusal and
cancellation. An unenrolled Android emulator additionally checks gated-wallet refusal while preserving
a legacy recovery copy. SIGINT and SIGTERM cancel the runner, terminate its owned command and server
groups (with forced termination after a two-second grace period), reap direct children, and close
their resources. Short synchronous tool calls have timeouts. An uncatchable kill or host loss requires
a fresh prebuild before using the generated project. Remove only the owned emulator or simulator
afterward; deleting the iOS simulator also removes its test CA. Do not distribute the probe artifact,
the test APKs or the synthetic probe apps.

### Android scanner instrumentation

The Android instrumentation suite exercises real Activity and Dialog windows, CameraX open and closed
state, parent visibility and detachment, fully clipped previews, backgrounding, delayed provider
completion, replacement sessions, focus loss and regain before JavaScript admission changes, and real
decoding of a synthetic QR bitmap. It runs inside the Android native probe and retains
`scanner-window-tests.log`. A wait that reaches its 15-second deadline appends the focused window,
focused app and top resumed activity at that moment. When a focus wait fails, a system window such as
`Application Not Responding` holding focus marks an unhealthy emulator, and a test window holding
focus points at scanner admission; when a camera wait fails, a focused test window only rules out
lost window focus.

The Release probe drives nested React Native modal windows through the actual Expo bridge, with
camera permission granted by the emulator runner, and establishes three things:

1. Release across unmount, cover and refocus: a scanner whose unmount is requested without a barcode
   must detach its native view from every window tree, unbind both use cases, reach CameraX CLOSED
   and leave the camera available before a fresh mount is requested; the same conditions apply when
   its owning window is covered, and refocus must open fresh use cases on the same view.
2. Admission during focus loss: a recorder on the real native admission function, which delegates
   arguments and result unchanged, requires the queued tuple to return false during loss and after a
   quick regain, then a fresh tuple to return true and call the real scanner finish once.
3. Resource availability: a native control holds the front camera through the pinned CameraX
   interface, the back-camera scanner must stay bound in `PENDING_OPEN` while it is OPEN, and closing
   the holder must let the same session reach OPEN without another request; CI starts the emulator
   with `-camera-front emulated`.

Each release wait is 20 seconds and each native poll keeps its 15- or 20-second limit; the initial
JavaScript mount has a one-minute deadline and the continuation six minutes.

Before its first checkpoint, each scanner mount asks an inactive 1×1 native scanner whether
generation -1, scan 0 is current and requires `false`, waiting for that view's first native window
event rather than its layout, because under the New Architecture a layout event can reach JavaScript
before the view is mounted (`ERR_VIEW_NOT_FOUND`, stage `method-native-view-not-found`). Failure
artifacts record the last stage, captured camera ID, each use-case binding flag, CameraX state,
selected-camera availability, native view attachment and presence, and JavaScript scanner state;
these are observations, not inferred causes. The recorder restores the original function and the view
window callback in `finally`; no product module API or scanner source is patched, and the ordinary
Release APK is checked for absence of the test class and probe controls.

These emulator controls exercise the loaded bridge with a synthetic event. They do not reproduce
natural JavaScript queue timing, scan a physical camera image, establish OS permission-prompt
behaviour or camera contention with another application, or replace physical-device verification of
sensor shutdown, settings or OEM behaviour. The runner retains APK hashes, instrumentation logs,
screenshots and window diagnostics, including failed runs, and removes both owned instrumentation
packages during cleanup. Only completed emulator logs establish native results; JavaScript checks do
not certify Kotlin compilation or camera hardware behaviour.

To run only these native controls on an owned emulator after prebuild:

```bash
cd mobile/android
./gradlew :ledova-scanner:assembleDebugAndroidTest --no-daemon --max-workers=2
cd ..
adb -s "$ANDROID_SERIAL" install -r modules/ledova-scanner/android/build/outputs/apk/androidTest/debug/ledova-scanner-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r org.example.ledova.scanner.test/androidx.test.runner.AndroidJUnitRunner
adb -s "$ANDROID_SERIAL" uninstall org.example.ledova.scanner.test
```

Require the instrumentation's nonzero `OK (... tests)` result; `am instrument` can exit zero after a
test failure.

### iOS Debug LAN handler probe

A separate local probe checks the configured private IPv4 allowance through the compiled
`LedovaHTTPRequestHandler`, alongside the stock React Native handler as a reachability and ATS
control. Choose an address assigned to a local interface and a booted, dedicated simulator with no
Ledova installation:

```bash
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 \
IOS_SIMULATOR_UDID=your-owned-simulator-uuid \
npm run test:native:lan -- /absolute/fresh/ios-lan-results
```

The output and any existing generated `ios/` directory must share the checkout's filesystem. The
probe checks this first, before starting its server or moving the project, so preservation and
restoration use atomic renames. Copy retained evidence to an external volume after the command
completes if needed.

The runner preserves an existing generated `ios/` directory, generates a fresh configured project,
adds an XCTest target and bundles a small test host. It uses the actual native HTTP handler source.
Configured Debug must reach the local server, unconfigured Debug must refuse without reaching it, and
Release must refuse HTTP. The stock handler must reach the server in both Debug cases; its Release
result is recorded because numeric-host ATS behaviour depends on the OS and linked SDK. A timeout or
unrelated network error cannot count as a refusal.

An intentional change to the generated Debug allowlist guard must produce the four expected refusal
assertion failures and exactly one unwanted server request. The runner restores that source before
requiring the normal Debug and Release results. Each case has a new identity that must match the
native report, so an earlier result cannot satisfy a later run. Evidence includes XCTest logs and
result bundles, actual server counts, compiled plists, OS, Xcode and SDK versions, linked build
versions, architecture and binary and source hashes.

The runner removes its test app; remove the dedicated simulator after inspecting the evidence. Keep
the checkout idle while this probe runs; after an uncatchable kill, restore the generated project from
the retained `native-before` directory before using it again. The output contains the selected local
address and synthetic test configuration; publish a sanitised result record rather than committing
the output directory.

This probe invokes the compiled handler directly. It does not establish React Native dispatcher
selection, which the separate Release app probe exercises, or physical local-network permission
behaviour. Apple documents that the
[simulator does not implement local-network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
The configured-host result must be repeated on a physical iPhone, with permission and reachability
recorded separately from
[ATS local-network policy](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).

## What automated checks do not establish

The mobile Jest suite covers none of the screen and file lifetimes in
[mobile](mobile.md). The native probes exercise the Android scanner's session
ownership and, with a synthetic picker result, the document copy move, retention, multipart upload and
retirement on an emulator or simulator; they drive no system UI. OS prompt presentation, physical
camera shutdown and WebView media release, device settings and OEM behaviour, global lock-overlay and
input stacking, native frame, POST, popup, timeout and prompt behaviour, vendor origins, iframe message
provenance, third-party payment redirects, local or cloud provider pickers, low storage and
physical-device checks remain device work under [#13](https://github.com/Ledova/ledova/issues/13), and
a form-completion signal is not server verification approval. A simulator also does not establish
physical biometric enrolment or change, hardware-backed key properties, OEM backup or transfer, store
distribution or behaviour on every supported OS.

Record Jest and native probe outcomes separately, and record these limits, any failed native build
and the exact tested head in the PR; JavaScript tests alone do not close a native hardening claim.

## Pre-release device checks

Complete these flows on physical hardware before a release and record them under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624). The Keystone checks need
a Keystone; use a development or production build on a device for the mobile checks. Emulator and
simulator checks can supplement this release acceptance work.

### The Keystone QR round trip

Automated scanner controls do not establish the complete physical camera and hardware-wallet firmware
journey. Verify a wallet, send one EVM crypto transfer through the transfer signing flow, and sign one
trading order through the QR branch. A transfer and a settlement's token approval are the only places
a raw transaction UR is exercised; both are legacy type-0 transactions, which is what the backend
prepares, so check that what the Keystone displays matches what was prepared. The firmware answers a
transaction with an EIP-155 `v` in as few bytes as it needs; both clients read 65 to 72 bytes and
refuse a `v` for another network or a signature that does not recover to the wallet's address, and
only a device shows the firmware's actual result. Messages and typed data are signed with `v` 27 or
28, always 65 bytes. The seed-phrase alternative in the dashboard does not cover any of this.

### Bitcoin manual send

Prepare a transfer from a Bitcoin wallet, sign the raw transaction with your own tooling, paste the
hex, broadcast it, and confirm the success state links to the testnet explorer. The app never builds
or signs a Bitcoin transaction.

### Biometric sign-in

The app always opens at the sign-in screen and offers biometric sign-in only while biometrics are
enrolled and a gated copy of the refresh token is stored: the Sign In button then shows a face-scan
icon instead of a key, and tapping it with both fields empty starts biometric sign-in. Sign-out and
account deletion remove the copy ([secret storage](mobile.md#secret-storage)), so
drive a relaunch instead. Start from a fresh install, or turn `<type> Sign In` on and then off in
Settings: sign-out keeps the setting, and a typed sign-in then skips the Enable alert. Keep App Lock
off, or backgrounding during a prompt can add an unlock screen. On Android, enrol a strong (Class 3)
biometric: only a strong one opens the gated copy, and a phone with weaker face unlock still says
Face ID but needs the fingerprint at the prompt. `<type>` is Face ID when the device reports face
hardware, Touch ID when it reports only a fingerprint, and Biometrics otherwise.

1. Sign in with email and password and tap Enable on `Enable <type> Sign In?`, or turn on
   `<type> Sign In` in Settings. Android's Keystore prompts `Authenticate to keep biometric sign in`;
   iOS writes silently.
2. Without signing out, force-quit and relaunch. Expect the face-scan icon. Tap Sign In with both
   fields empty and pass the biometric prompt (Android titles it `Sign in with <type>`; on iOS the
   first use may show the system Face ID permission alert first, which must be allowed). On Android a
   second prompt, `Authenticate to keep biometric sign in`, then stores the rotated copy; iOS does not
   prompt again. Expect the main app.
3. Force-quit, relaunch and sign in with biometrics again. The backend blacklists each refresh token
   it rotates, so this passes only if the gated copy stayed in step with the rotation in step 2. A
   failure shows the key icon, `Biometric sign in is temporarily unavailable` on every retry, or
   `Your saved sign in has expired`.
4. Android: repeat step 2, but cancel the second prompt or background the app while it shows. Sign-in
   still completes and the copy is dropped: after a relaunch the key icon shows, the next sign-in is
   typed once (no Enable alert, one Keystore prompt), and the relaunch after that offers biometrics.
5. Sign out. Expect the key icon; an empty tap asks for email and password with no biometric prompt.
   One typed sign-in re-arms biometric sign-in for the next relaunch.

A saved sign-in older than `REFRESH_TOKEN_LIFETIME` (seven days by default) or revoked elsewhere still
shows the face-scan icon, but after the prompt it ends with `Your saved sign in has expired`. iOS
writes the copy without a prompt, so these steps cannot show on an iPhone that the copy is
biometric-protected; Android's write prompt is the only visible sign.

### Push delivery

Push delivery needs the Expo project ID and a device build
([push notifications](../operations/configuration.md#push-notifications)); supported emulators and
simulators can also exercise delivery.

### Keystone ownership on a Mac

This check exercises a real Keystone 3 Pro with Chrome's camera against the web dashboard, on a fresh
synthetic local instance. The owner's device reported firmware 2.3.6, and the Linux deployment
computer has no camera, so it runs on a Mac with a working built-in or connected camera; owning a Mac
alone does not establish camera availability. It verifies an EIP-191 ownership message and needs no
operator private key, deployed contract, company approval, funds or gas. Signature recovery is local;
unavailable RPC can leave balances unavailable and wallet sync queued without preventing ownership
verification, and neither is a successful chain-sync result. The procedure has been source-reviewed
but not yet executed on a Mac.

The [Base Sepolia approval-control evidence](../operations/approval-controls.md#base-sepolia)
belongs to the existing Linux instance and its two fictional companies. A Git checkout contains code
and documentation, not that instance's database or credentials, and the Mac database created below is
separate. Do not copy the Linux operator key, reset its database or repeat its public deployment for
this test.

#### Prepare the Keystone

The [official firmware guide](https://keystone3.com/en/docs/firmware-upgrade/) requires devices below
2.4.0 to install that security upgrade before proceeding to newer firmware. For 2.3.6, use the
upgrade path for versions 2.0.0 or above, then follow the official updater for supported Multi-Coin
firmware, which supports Ethereum accounts. Check the
[official download page](https://keyst.one/firmware) for the current Multi-Coin release when
executing this procedure (it listed 3.1.0 on 25 September 2026).

The owner performs the update and any on-device approval. Follow the vendor's battery, backup and
[checksum instructions](https://keystone3.com/en/docs/firmware-checksum/). Keep the recovery phrase
offline; it is never entered into Ledova, a browser, the assistant or GitHub. Record the firmware
actually installed.

#### Start a separate local instance

Install and start Docker Desktop with Compose, and have Git and Python 3 available. Use a clean
checkout of the reviewed commit named in the #624 handover, and confirm the required checks for that
commit passed before starting. Use Chrome on the Mac; no connection to the Linux computer is required.
Do not reuse an unrelated checkout's environment files. From that fresh checkout:

```sh
python3 scripts/init-local-env.py
docker compose -p ledova-keystone-local up --build -d backend dashboard
```

The normal dependencies and backend initialisation still run. Wait for the backend to finish its
migration and role checks and for both application surfaces to respond. Check
`docker compose -p ledova-keystone-local ps` and the backend logs if startup fails. Do not weaken
database role checks to get past an error.

The fresh templates leave operator and external-provider credentials unconfigured; leave them so for
this ownership-only exercise. The stack's own chain, contract deployment and scanner start as
dependencies, and the compose anchor sets the chain addresses; no worker is needed and nothing is
signed for this exercise.

Create the synthetic demo once, keeping its generated credentials in a private local file:

```sh
umask 077
mkdir -p "$HOME/.local/share/ledova-keystone-local"
docker compose -p ledova-keystone-local exec -T backend \
  python manage.py seed_demo \
  > "$HOME/.local/share/ledova-keystone-local/demo-credentials.txt"
```

The owner reads the investor login privately. Do not paste credentials or the file contents into an
issue or assistant output. Rerunning `seed_demo` resets the seeded passwords. The demo's sign-up,
identity, terms, classification and preverified development wallets are synthetic setup, not human
acceptance.

Open <http://localhost:5174> in Chrome, sign in, and open Wallets. The API is
<http://localhost:8000>. These are the fresh Mac defaults; the separate Linux acceptance instance uses
different ports. Check the camera permission in
[macOS Privacy & Security](https://support.apple.com/guide/mac-help/mchlf6d108da/mac) and allow the
site's camera request when the scanner opens. `localhost` is a
[camera-capable secure context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia);
a plain HTTP LAN address does not supply the same browser guarantee.

#### Import and prove the hardware account

1. On the unlocked device, select Connect Software Wallet → MetaMask to display the public-account
   QR. This is an export mode; Ledova's direct QR flow needs no MetaMask extension connection.
2. In Wallets → Base → + Add wallet → Scan QR, scan that public-account QR. At Review the accounts to
   import, explicitly select Base as the EVM network, deselect unrelated accounts, and compare the
   address with the device. Import only the intended test account. An unavailable balance is not an
   ownership result.
3. Select the newly imported Keystone wallet. It must start unverified; the seed's preverified
   development wallet is not the device under test. Keep the imported derivation path and master
   fingerprint; a manually entered address does not establish the hardware import flow.
4. Choose Verify → Continue. Scan the displayed Scan Challenge QR using the Keystone. The owner checks
   the ownership message and signs on the device. The challenge expires after five minutes; generate a
   fresh one if necessary.
5. Choose I've Signed the Message, scan the device's response, and retain the actual Wallet Verified!
   result. Reload the wallet and confirm it remains verified through the normal authenticated
   application readback.

Public-account import supports multipart `ur:crypto-multi-accounts`. The signature scanner requires
one complete `eth-signature` QR with a 65-byte signature. If a device emits an unsupported format or a
scanner fails, retain the error and report it on #624. Do not substitute a database override or the
seeded wallet's verified status. The flow has no QR-file-upload alternative to the camera.

#### Record the Keystone result

Record the tester, time with timezone, application commit, macOS and Chrome versions, Keystone model,
firmware before and after, camera result, public-account import, challenge signing, signature decoding
and verified-wallet readback. Keep full hardware addresses, account metadata, credentials and QR
payloads in private evidence unless the owner chooses to publish them. A public issue comment can use
a masked address and report PASS or BLOCK with the observed error.

Ownership PASS does not complete EIP-712 order signing, transaction signing, physical Android or
iPhone acceptance or the release-deployment swap in #624; those need their own device evidence.
Coordinate any defect with the existing issues before starting a parallel implementation.

To stop the Mac instance while retaining its local data:

```sh
docker compose -p ledova-keystone-local down
```

Do not add `-v` unless intentionally deleting the separate Mac test database.

## iOS distribution builds

An ordinary native CI run produces a simulator app, not an App Store archive. Use a dedicated clean
checkout and the pinned Node and npm dependencies for a signed device build. Native prebuild replaces
generated files; do not use a checkout that serves an active development session.

### Release environment

Keep the registered store identifiers and signing material outside the repository. In a private
environment, set these values before every prebuild, bundle, archive or export command:

| Variable                    | Required value                               |
| --------------------------- | -------------------------------------------- |
| `LEDOVA_IOS_RELEASE`        | `1`                                          |
| `EXPO_NO_DOTENV`            | `1`, so a development `.env` is not loaded   |
| `LEDOVA_IOS_BUNDLE_ID`      | Existing registered app bundle ID            |
| `LEDOVA_APPLE_TEAM_ID`      | Owning Apple team's ten-character ID         |
| `LEDOVA_APP_VERSION`        | Store version in `major.minor.patch` form    |
| `LEDOVA_IOS_BUILD_NUMBER`   | Unused positive integer, at most four digits |
| `EXPO_PUBLIC_API_URL`       | Reachable HTTPS API base URL                 |
| `EXPO_PUBLIC_MARKETING_URL` | Public HTTPS website base URL                |

Unset `EXPO_PUBLIC_DEV_API_HOST` and every `EXPO_PUBLIC_NATIVE_PROBE_*` variable. Set
`EXPO_PUBLIC_SUPPORT_EMAIL` and `EXPO_PUBLIC_APP_STORE_URL` when preparing the shipped experience
([client variables](../operations/configuration.md#clients)). The release config
(`mobile/app.config.js`) refuses a missing or malformed identity, the development placeholder, HTTP
endpoints, URL credentials, a query or fragment (even an empty one), whitespace or backslashes inside
a URL, a development API host and native probe flags. Without `LEDOVA_IOS_RELEASE`, the development
config is unchanged.

Confirm the latest upload in App Store Connect before selecting a build number. Keep the existing
bundle ID when continuing an existing app; a store name change does not require a new bundle ID.
Align the store version with the binary before submitting for App Review; an unused local build number
is not reserved at Apple.

### Generate and archive

Use an Xcode release accepted by App Store Connect. Since 28 April 2026,
[Apple requires the iOS 26 SDK or later](https://developer.apple.com/news/?id=ueeok6yw). This
requirement is separate from the app's minimum supported iOS version and the simulator CI toolchain.
The [generated-project fixes](#generated-project-fixes) satisfy
Xcode 27's deployment-target and iOS 27's scene life-cycle requirements. Before uploading, launch the
same commit on iOS 27: build it in Release for an iOS 27 simulator and open it to the sign-in screen,
or install the archive on an iOS 27 device. An earlier iOS does not enforce the scene life cycle, so a
device on iOS 18 does not cover this check.

After installing the locked dependencies
([building from a clean checkout](#building-from-a-clean-checkout)),
run from `mobile/` with the release environment already set:

```bash
npx expo config --type public
npx expo prebuild --clean --no-install --platform ios
node scripts/check-native-projects.mjs . ios
cd ios
pod install
cd ..
xcodebuild -workspace ios/Ledova.xcworkspace -scheme Ledova \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$LEDOVA_RELEASE_OUTPUT/Ledova.xcarchive" \
  -derivedDataPath "$LEDOVA_RELEASE_OUTPUT/DerivedData" archive
```

Set `LEDOVA_RELEASE_OUTPUT` to a new absolute directory outside the checkout. Inspect the resolved
bundle ID, team and version before archiving. Signing needs a valid identity and profile for this app
and team. The commands above use only what is already installed. With Xcode signed in to an account
that can manage them, add `-allowProvisioningUpdates` to the archive and export commands so xcodebuild
may create or refresh the profile, then check the developer account for anything it created. Do not
reuse expired or other-team profiles. Do not revoke certificates to resolve a local setup issue
without checking their other users.

Inspect the archive's Info.plist, signature and embedded provisioning profile. In Xcode Organiser,
validate and export for App Store Connect using the owning team's distribution signing. A
development-signed archive is not a distribution IPA. Keep exports, logs, provisioning profiles and
keys outside Git.

### Testing and submission

Test the actual device build with synthetic data on the configured test network. Record the source
commit, build, phone and results under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624). Then upload the
validated archive for internal TestFlight testing. Uploading a build is separate from submitting it to
App Review or releasing it publicly.

The backend must be reachable by the intended testers and by Apple's reviewers; plan that access
deliberately rather than turning off access controls. Account recovery, email, privacy disclosures,
permissions and encryption declarations need release-specific validation under the same checklist. A
successful archive does not complete these checks or establish store approval.

Next: [mobile](mobile.md), [testing](testing.md) and
[Apple's distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
