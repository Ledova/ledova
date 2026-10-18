# Mobile releases

[Engineering](README.md) · [Documentation](../README.md)

How to build the native apps, run the manual native probes, complete the physical-device checks and
produce an iOS distribution build. The architecture these checks exercise is in [mobile](mobile.md).

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

The app uses the versions `mobile/package-lock.json` resolves, currently Expo SDK 54 on React Native
0.81. Native projects are generated from `mobile/app.json` and the config plugins in
`mobile/plugins/` (with `mobile/app.config.js` for [iOS distribution](#ios-distribution-builds));
`android/` and `ios/` are not committed.

[mobile-native.yml](../../.github/workflows/mobile-native.yml) pins the toolchain, selecting
[Xcode 16.4 on the macOS 15 runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md):

| Component                | Build baseline                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| Node / npm               | 22.22.2 / 11.5.2                                                            |
| Android                  | JDK 17, SDK/target 36, minimum API 24, Build Tools 36.0.0                   |
| Android native toolchain | NDK 27.1.12297006, CMake 3.22.1, Gradle 8.14.3                              |
| iOS                      | Xcode 16.4, minimum deployment target 15.1, ad hoc signed simulator Release |
| Runtime probes           | Android API 36 x86_64 emulator; iOS 18.5 simulator                          |

Minimum platform versions follow [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/). The Android
build includes ARM64 and x86_64; the probes run only x86_64. Installing the SDK may need JDK 21 with
current command line tools; Gradle uses JDK 17.

Install the table's SDK, NDK and CMake packages, platform-tools, emulator and
`system-images;android-36;google_apis;x86_64`, and on macOS CocoaPods and the iOS 18.5 simulator
runtime. On a shared machine keep the SDK, Gradle cache and AVDs in owned directories; never use a
personal device or live development service. No EAS account or signing credentials are needed.

## Building from a clean checkout

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix mobile ci --ignore-scripts --no-audit --no-fund
cd mobile
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run native:prebuild
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run check:native
```

`native:prebuild` replaces the generated projects, so preserve local native experiments first. For
iOS, also run `cd ios && pod install` before returning to `mobile/`. `check:native`
(`mobile/scripts/check-native-projects.mjs`) checks the generated Debug and Release policy,
including the appearance settings and the iOS scene manifest. `EXPO_PUBLIC_DEV_API_HOST` is the
Debug LAN allowance ([native transport](mobile.md#native-transport)).

## Generated-project fixes

### iOS scene life cycle

iOS 27 stops an app built with the iOS 27 SDK at launch unless it uses the UIKit scene life cycle
([TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)).
Expo 54 generates no scene delegate, so `mobile/plugins/withSceneLifecycle.cjs` declares a
`UIApplicationSceneManifest` and adds `LedovaSceneDelegate`, which moves `AppDelegate`'s window into
the connecting scene and forwards the URL, user-activity, foreground and background events UIKit no
longer sends the app delegate. `check-native-projects.mjs` refuses a project without them, and the
plugin refuses an `AppDelegate` whose window Objective-C cannot read (`var window: UIWindow?` on an
`ExpoAppDelegate` subclass) or another scene manifest, so an Expo upgrade with its own scene
delegate stops at prebuild until the plugin is removed.

A link that opens the closed app does not reach JavaScript (UIKit delivers it with the connecting
scene after React Native starts, so `Linking.getInitialURL()` returns null); one arriving while the
app runs, such as an OAuth redirect, still reaches `Linking`'s `url` event. Nothing depends on this;
a feature that needs it must first move to Expo SDK 58, which adds a scene delegate, or 57.0.23 with
`ios.enableSceneSupport` ([expo/expo#47628](https://github.com/expo/expo/pull/47628)), either
replacing the plugin.

### CocoaPods post-install fixes

React Native 0.81.5 can turn an empty app spec search into a codegen dependency on the whole iOS
project directory, a cycle with Expo's generated provider. The post-install helper
`mobile/plugins/native/codegen-inputs.rb` removes only the exact `${PODS_ROOT}/..` input from
ReactCodegen's Generate Specs phase, leaving real spec inputs, generation commands and handler
registration. Manual iOS builds keep the generated Podspec and Pods project for diagnosis.
`mobile/plugins/native/deployment-targets.rb` raises any pod target whose
`IPHONEOS_DEPLOYMENT_TARGET` is below the Podfile's platform to that platform, because Xcode 27
refuses targets below iOS 15.0 and some third-party resource bundles still declare older minimums;
the manual native build checks the result.

## Dependency integrity

The lockfile keeps registry URLs and npm integrity values; the shared workspace is the intentional
local link. Native CI installs with `--ignore-scripts`; the locked packages declaring install
scripts are watcher, fsevents, unrs-resolver and secp256k1 (through Keystone's hdkey). There is no
full transitive source audit.

Each native run records the resolved Android release dependency graph and repository configuration
(Google Maven, Maven Central, JitPack) or the resolved Podfile.lock and generated iOS protocol
provider, and `mobile/plugins/withMobileSecurity.cjs` pins the Gradle distribution by SHA-256. npm's
lockfile does not pin every Maven or Pod artifact, so review native graphs when they change. The
ordinary APK is checked for ZIP alignment and each native library's 16 KiB ELF load-segment
alignment;
[React Native 0.81's compatibility statement](https://reactnative.dev/blog/2025/08/12/react-native-0.81)
does not replace checking third-party binaries.

## Native checks before a release

Native builds run only by manual [mobile-native.yml](../../.github/workflows/mobile-native.yml)
dispatch before a mobile release ([CI](testing.md#ci);
[11 October decision](../decisions.md#minimum-tests-and-fresh-migrations)). Each platform builds and
starts the ordinary Release app and runs the native probe; the `Mobile native checks` verdict needs
both jobs. Record build results and device or probe gaps in the release record.

## Native probes

After [native prebuild](#building-from-a-clean-checkout), run from `mobile/` on a dedicated,
explicitly selected emulator or simulator:

```bash
ANDROID_SERIAL=emulator-5556 npm run test:native -- android /absolute/fresh/android-results
IOS_SIMULATOR_UDID=your-owned-simulator-uuid npm run test:native -- ios /absolute/fresh/ios-results
```

### The ordinary launch check

The output directory must be new. The runner (`mobile/scripts/native-smoke.mjs`) builds, launches
and preserves the ordinary Release app and checks its release policy. From ten seconds after launch,
two screenshots a second apart must each have rows 10% to 90% of the screen (below the status bar,
above the home indicator) differing from their most common colour in at least 0.05% of pixels;
sign-in differs in over 40%. The wait and the pair cover iOS's launch screen, which has content,
before a broken window turns black (up to about two seconds on simulators, four on a loaded machine
after a fresh install). After 20 screenshots the runner fails: that is how a window
without a scene, black but for the status bar, shows up. `ordinary-screen.json` records the final
measurement.

Bounds: server startup 120 seconds, each certificate or simulator inspection tool call 30 seconds,
Xcode commands 45 minutes, other asynchronous commands 30 minutes, the iOS CI job 90 minutes. A
timeout terminates the owned command group and is reported apart from an exit code or signal.

### Android evidence collection

The Android runner records the focused window and app (`focus`) from `dumpsys window displays`, kept
whole in `ordinary-window-displays.txt` (API 36's `dumpsys window windows` omits them), and fails
when a system "Application Not Responding" window holds focus (that dialog passes the content
measurement) or the dump has no `mCurrentFocus` line. CI's Android job always keeps a separate
`ledova-native-android-records` directory.

The [Android evidence collector](../../mobile/scripts/android-evidence.mjs) starts
[main, events, system and crash logcat retention](https://developer.android.com/tools/logcat#alternativeBuffers)
at the first usable adb connection, before boot or building. It samples guest load, CPU and memory
every 30 seconds from the start (`guest-load.log`), the host every 15 (`ledova-host-vmstat.log`),
records host CPU, parallelism, `nproc`, guest properties and the system-image fingerprint, the
emulator version and any RAM adjustment (`ledova-emulator.log`), and takes one window dump and
screenshot on the first `am_anr` event.

Final collection keeps the printed dropbox, window-manager last ANR, events, system and crash
snapshots, the ANR directory listing and the raw traces they name. Each bounded command records exit
code, signal, timeout, interruption, direct-child reap state, cleanup errors and partial output in
`guest-records-status.jsonl`; `collection-complete.json` marks whether collection finished.
Permission-denied trace output is not a captured trace, and such gaps never override the probe's
focus, camera or transport outcome. No adbd restart or root escalation is used, and an empty record
does not prove that no ANR happened.

The watcher observes for at most 55 minutes; collection has a two-minute budget, ten-second commands
and a 60-second dropbox bound. Stop requests are bound to the watcher's generated identity;
cancellation and timeouts stop and reap its owned child groups, and partial files survive and upload
even when setup or a build fails. Inventory or signalling errors leave an incomplete cleanup status,
unverified groups are not signalled and an unreaped child is recorded; a runner loss or uncatchable
kill can still prevent collection or upload. The collectors never dismiss a dialog, retry or skip a
probe.

### Emulator settling

The manual Android workflow gives the emulator four vCPUs and, before prebuild, completes foreground
boot and tries for up to 300 seconds, without gating the run, to let it settle
(`mobile/scripts/emulator-settle.mjs`): broadcast queues idle, then a complete 1-minute load reading
below 4, each wait bounded by the time left. `ledova-guest-settle.log` records settling or the gap:
guest busy, reading unavailable or malformed (unconfirmed), or reading late. Settling mitigates
emulator resource conditions ([#880](https://github.com/Ledova/ledova/issues/880)) but not
background ANRs in other processes, and without an original SystemUI trace a run's cause stays
unestablished.

### iOS signing and TLS test servers

iOS uses Xcode's ad hoc simulator signing. Before each installation the runner checks both
architectures' `__TEXT,__entitlements` sections for the app identity and preserves their public
entitlements, which differ from the code signature's: disabling signing can drop them and break
Keychain controls despite a good build and launch. Existing app capabilities stay in the generated
entitlements. Each build phase has its own temporary and cache directory, so Expo's CI cache cannot
keep an earlier phase's API destination, and the probe checks the compiled API client and policy
destinations against its isolated server.

Certificate generation uses its own OpenSSL configuration with explicit CA and leaf extensions,
avoiding older tools' duplicate defaults; strict host requests first check both CA-signed endpoints,
an independently trusted leaf and wrong-CA refusals. Evidence records the tool path and version,
configuration hash and public certificate diagnostics, never private keys. Named stages (each probe
reset included) and separate primary and cleanup errors identify infrastructure failures without
recording request credentials or bodies; probe failures carry only a fixed error category and
operation stage, which do not establish a Keychain OSStatus.

A separate test entry is then built against loopback TLS servers with a generated CA, trusted only
through a temporary test resource on Android and the owned simulator keychain on iOS; the ordinary
artifact keeps normal trust. An untrusted certificate with the same hostname or IP coverage must
fail.

### Transport controls

The runner checks 307 and 308 refusal with zero redirected target requests, beside successful direct
bearer and body, API refresh, native entropy and signing, file upload and download, streaming and
cancellation controls. Numeric HTTP requests must fail, including repeated refusal and cancellation.
An unenrolled Android emulator also checks gated-wallet refusal while keeping a legacy recovery
copy. SIGINT and SIGTERM cancel the runner, terminate its owned command and server groups (forcibly
after two seconds), reap direct children and close resources; short synchronous tool calls have
timeouts. After an uncatchable kill or host loss, prebuild afresh before using the generated
project. Remove only the owned emulator or simulator afterwards (deleting the iOS simulator removes
its test CA), and never distribute the probe artifact, test APKs or synthetic probe apps.

### Android scanner instrumentation

The instrumentation suite runs inside the Android probe (`scanner-window-tests.log`) and exercises
real Activity and Dialog windows, CameraX open and closed state, parent visibility and detachment,
fully clipped previews, backgrounding, delayed provider completion, replacement sessions, focus loss
and regain before JavaScript admission changes, and real decoding of a synthetic QR bitmap. A wait
reaching its 15-second deadline appends the focused window, focused app and top resumed activity:
after a failed focus wait, a focused system window such as `Application Not Responding` marks an
unhealthy emulator and a focused test window points at scanner admission; after a failed camera
wait, a focused test window only rules out lost window focus.

The Release probe drives nested React Native modal windows through the actual Expo bridge, with
camera permission granted by the emulator runner, and establishes:

1. Release across unmount, cover and refocus: a scanner unmounted without a barcode must detach its
   native view from every window tree, unbind both use cases, reach CameraX CLOSED and free the
   camera before a fresh mount; likewise when its window is covered, and refocus must open fresh use
   cases on the same view.
2. Admission during focus loss: a recorder on the real native admission function, passing arguments
   and result through, requires the queued tuple to return false during loss and after a quick
   regain, then a fresh tuple to return true and call the real scanner finish once.
3. Resource availability: while a native control holds the front camera through the pinned CameraX
   interface, the back-camera scanner must stay bound in `PENDING_OPEN`, and closing the holder must
   let the same session reach OPEN without another request (CI starts the emulator with
   `-camera-front emulated`).

Release waits are 20 seconds, native polls keep their 15- or 20-second limits, and the initial
JavaScript mount has one minute and the continuation six. Before its first checkpoint each mount
asks an inactive 1×1 native scanner whether generation -1, scan 0 is current and requires `false`,
waiting for the view's first native window event rather than its layout, which under the New
Architecture can reach JavaScript before the view is mounted (`ERR_VIEW_NOT_FOUND`, stage
`method-native-view-not-found`). Failure artifacts record observations, not causes: last stage,
captured camera ID, use-case binding flags, CameraX state, selected-camera availability, native view
attachment and presence, and JavaScript scanner state. The recorder restores the original function
and view window callback in `finally`; no product module API or scanner source is patched, and the
ordinary Release APK is checked for absence of the test class and probe controls. The runner keeps
APK hashes, instrumentation logs, screenshots and window diagnostics, failed runs included, and
removes both owned instrumentation packages.

To run only these controls on an owned emulator after prebuild:

```bash
cd mobile/android
./gradlew :ledova-scanner:assembleDebugAndroidTest --no-daemon --max-workers=2
cd ..
adb -s "$ANDROID_SERIAL" install -r modules/ledova-scanner/android/build/outputs/apk/androidTest/debug/ledova-scanner-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r org.example.ledova.scanner.test/androidx.test.runner.AndroidJUnitRunner
adb -s "$ANDROID_SERIAL" uninstall org.example.ledova.scanner.test
```

Require the nonzero `OK (... tests)` result; `am instrument` can exit zero after a test failure.

### iOS Debug LAN handler probe

This local probe checks the configured private IPv4 allowance through the compiled
`LedovaHTTPRequestHandler`, with the stock React Native handler as reachability and ATS control, on
an address assigned to a local interface and a booted, dedicated simulator without Ledova installed:

```bash
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 \
IOS_SIMULATOR_UDID=your-owned-simulator-uuid \
npm run test:native:lan -- /absolute/fresh/ios-lan-results
```

The output and any generated `ios/` must share the checkout's filesystem, checked before the server
starts or the project moves, so preservation and restoration are atomic renames (copy evidence
elsewhere afterwards). The runner preserves the existing `ios/`, generates a fresh configured
project with an XCTest target and a small test host, and uses the actual handler source. Configured
Debug must reach the local server, unconfigured Debug must refuse without reaching it, and Release
must refuse HTTP; the stock handler must reach the server in both Debug cases, and its Release
result is only recorded, as numeric-host ATS behaviour depends on the OS and linked SDK. A timeout
or unrelated network error never counts as a refusal.

A deliberate change to the generated Debug allowlist guard must produce the four expected refusal
assertion failures and exactly one unwanted server request, after which the runner restores the
source and requires the normal Debug and Release results. Each case's new identity must match the
native report, so an earlier result cannot satisfy a later run. Evidence: XCTest logs and result
bundles, server counts, compiled plists, OS, Xcode and SDK versions, linked build versions,
architecture, and binary and source hashes.

The runner removes its test app; remove the simulator after inspecting the evidence. Keep the
checkout idle meanwhile, and after an uncatchable kill restore the generated project from the
retained `native-before` directory. The output holds the local address and synthetic test
configuration, so publish a sanitised record, not the directory. Repeat the configured-host result
on a physical iPhone, recording permission and reachability separately from
[ATS local-network policy](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).

## What automated checks do not establish

The mobile Jest suite covers none of the screen and file lifetimes in [mobile](mobile.md). On an
emulator or simulator the native probes exercise the Android scanner's session ownership and, with a
synthetic picker result, the document copy move, retention, multipart upload and retirement, driving
no system UI. The scanner controls use the loaded bridge with a synthetic event, so they do not
reproduce natural JavaScript queue timing, scan a physical camera image or show camera contention
with another application; only completed emulator logs establish native results, and JavaScript
checks certify neither Kotlin compilation nor camera hardware. The LAN probe calls the compiled
handler directly, establishing neither React Native dispatcher selection (the Release app probe
exercises it) nor local-network permission, which the
[simulator does not implement](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

OS prompt presentation, physical camera shutdown and WebView media release, device settings and OEM
behaviour, global lock-overlay and input stacking, the WebView behaviours in
[identity-provider WebView lifetime](mobile.md#identity-provider-webview-lifetime), iframe message
provenance, third-party payment redirects, local or cloud provider pickers, low storage and the
complete camera and hardware-wallet firmware journey remain device work under
[#13](https://github.com/Ledova/ledova/issues/13); a form-completion signal is not server
verification approval. A simulator also does not establish physical biometric enrolment or change,
hardware-backed key properties, OEM backup or transfer, store distribution or behaviour on every
supported OS.

Record Jest and native probe outcomes separately, with these limits, any failed native build and the
exact tested head, in the PR; JavaScript tests alone do not close a native hardening claim.

## Pre-release device checks

Complete these flows on physical hardware before a release and record them under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624). The Keystone checks
need a Keystone; the mobile checks need a development or production build on a device. Emulator and
simulator checks can supplement them.

### The Keystone QR round trip

Verify a wallet, send one EVM crypto transfer through the transfer signing flow, and sign one
trading order through the QR branch. A transfer and a settlement's token approval are the only raw
transaction UR uses; both are legacy type-0 transactions, as the backend prepares them, so check
that what the Keystone displays matches what was prepared. The firmware answers a transaction with
an EIP-155 `v` in as few bytes as it needs; both clients read 65 to 72 bytes and refuse a `v` for
another network or a signature that does not recover to the wallet's address, and only a device
shows the firmware's actual result. Messages and typed data are signed with `v` 27 or 28, always 65
bytes. The dashboard's seed-phrase alternative covers none of this.

### Bitcoin manual send

Prepare a transfer from a Bitcoin wallet, sign the raw transaction with your own tooling, paste the
hex, broadcast it, and confirm the success state links to the testnet explorer. The app never builds
or signs a Bitcoin transaction.

### Biometric sign-in

Biometric sign-in is offered only while biometrics are enrolled and a gated copy of the refresh
token is stored: Sign In then shows a face-scan icon instead of a key, and tapping it with both
fields empty starts it. Sign-out and account deletion remove the copy
([secret storage](mobile.md#secret-storage)), so test by relaunching. Start from a fresh install, or
turn `<type> Sign In` on and then off in Settings (sign-out keeps the setting, so a typed sign-in
skips the Enable alert), and keep App Lock off, since backgrounding during a prompt can add an
unlock screen. On Android enrol a strong (Class 3) biometric: only that opens the gated copy, and a
phone with weaker face unlock says Face ID but needs the fingerprint. `<type>` is Face ID with face
hardware, Touch ID with only a fingerprint, and Biometrics otherwise.

1. Sign in with email and password and tap Enable on `Enable <type> Sign In?`, or turn on
   `<type> Sign In` in Settings. Android's Keystore prompts
   `Authenticate to keep biometric sign in`; iOS writes silently.
2. Without signing out, force-quit and relaunch: expect the face-scan icon. Tap Sign In with both
   fields empty and pass the biometric prompt (Android: `Sign in with <type>`; iOS may first show
   the system Face ID permission alert, which must be allowed). Android then prompts
   `Authenticate to keep biometric sign in` to store the rotated copy; iOS does not. Expect the main
   app.
3. Force-quit, relaunch and sign in with biometrics again. The backend blacklists each refresh token
   it rotates, so this passes only if the gated copy kept pace with step 2's rotation; a failure
   shows the key icon, `Biometric sign in is temporarily unavailable` on every retry, or
   `Your saved sign in has expired`.
4. Android: repeat step 2, but cancel the second prompt or background the app during it. Sign-in
   completes and the copy is dropped: after a relaunch the key icon shows, the next sign-in is typed
   once (no Enable alert, one Keystore prompt), and the following relaunch offers biometrics.
5. Sign out. Expect the key icon; an empty tap asks for email and password with no biometric prompt.
   One typed sign-in re-arms biometric sign-in for the next relaunch.

A saved sign-in older than `REFRESH_TOKEN_LIFETIME` (seven days by default) or revoked elsewhere
still shows the face-scan icon but ends with `Your saved sign in has expired` after the prompt.
Because iOS writes silently (step 1), an iPhone cannot show that the copy is biometric-protected;
only Android's write prompt does.

### Push delivery

Push delivery needs the Expo project ID and a device build
([push notifications](../operations/configuration.md#push-notifications)); supported emulators and
simulators can also exercise it.

### Keystone ownership on a Mac

This check uses a real Keystone 3 Pro (the owner's reported firmware 2.3.6) and Chrome's camera
against the web dashboard on a fresh synthetic local instance, on a Mac with a working camera
because the Linux deployment computer has none. It verifies an EIP-191 ownership message and needs
no operator private key, deployed contract, company approval, funds or gas. Signature recovery is
local: unavailable RPC can leave balances unavailable and wallet sync queued without blocking
verification, and neither is a chain-sync result. The procedure is source-reviewed but not yet run
on a Mac. Its database is separate from the Linux instance holding the
[Base Sepolia evidence](../operations/approval-controls.md#base-sepolia); never copy that instance's
operator key, reset its database or repeat its public deployment for this test.

#### Prepare the Keystone

The [official firmware guide](https://keystone3.com/en/docs/firmware-upgrade/) requires devices
below 2.4.0 to install that security upgrade first: for 2.3.6, take the path for 2.0.0 or above,
then the official updater for supported Multi-Coin firmware, which supports Ethereum accounts
(current release on the [official download page](https://keyst.one/firmware)). The owner performs
the update and any on-device approval, following the vendor's battery, backup and
[checksum instructions](https://keystone3.com/en/docs/firmware-checksum/), and records the firmware
actually installed. The recovery phrase stays offline, never entered into Ledova, a browser, the
assistant or GitHub.

#### Start a separate local instance

With Docker Desktop (Compose), Git and Python 3, use a clean checkout of the reviewed commit named
in the #624 handover whose required checks passed, Chrome on the Mac, no connection to the Linux
computer and no environment files from an unrelated checkout. From that checkout:

```sh
python3 scripts/init-local-env.py
docker compose -p ledova-keystone-local up --build -d backend dashboard
```

Wait for the backend's normal initialisation, migration and role checks and for both application
surfaces to respond; if startup fails, check `docker compose -p ledova-keystone-local ps` and the
backend logs, never weakening database role checks. Operator and external-provider credentials stay
unconfigured, as the fresh templates leave them; the stack's own chain, contract deployment and
scanner start as dependencies with the compose anchor's chain addresses, no worker is needed and
nothing is signed. Create the synthetic demo once, keeping its generated credentials in a private
local file:

```sh
umask 077
mkdir -p "$HOME/.local/share/ledova-keystone-local"
docker compose -p ledova-keystone-local exec -T backend \
  python manage.py seed_demo \
  > "$HOME/.local/share/ledova-keystone-local/demo-credentials.txt"
```

The owner reads the investor login privately; never paste credentials or the file into an issue or
assistant output ([demo data](../getting-started.md#demo-data)). The demo's sign-up, identity,
terms, classification and preverified development wallets are synthetic setup, not human acceptance.
Open <http://localhost:5174> in Chrome, sign in and open Wallets (the API is
<http://localhost:8000>; the Linux acceptance instance uses other ports). Check the camera permission
in [macOS Privacy & Security](https://support.apple.com/guide/mac-help/mchlf6d108da/mac) and allow
the site's camera request when the scanner opens: `localhost` is a
[camera-capable secure context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
and a plain HTTP LAN address is not.

#### Import and prove the hardware account

1. On the unlocked device, select Connect Software Wallet → MetaMask to display the public-account
   QR (an export mode; Ledova's direct QR flow needs no MetaMask extension connection).
2. In Wallets → Base → + Add wallet → Scan QR, scan it. At Review the accounts to import, select
   Base as the EVM network, deselect unrelated accounts, compare the address with the device, and
   import only the intended test account. An unavailable balance is not an ownership result.
3. Select the newly imported Keystone wallet. It must start unverified (the seed's preverified
   development wallet is not the device under test) and keep the imported derivation path and master
   fingerprint; a manually entered address does not establish the hardware import flow.
4. Choose Verify → Continue and scan the displayed Scan Challenge QR with the Keystone. The owner
   checks the ownership message and signs on the device; the challenge expires after five minutes,
   so generate a fresh one if needed.
5. Choose I've Signed the Message, scan the device's response, and keep the actual Wallet Verified!
   result. Reload the wallet and confirm it stays verified through the normal authenticated
   readback.

Public-account import supports multipart `ur:crypto-multi-accounts`; the signature scanner requires
one complete `eth-signature` QR with a 65-byte signature, and the camera has no QR-file-upload
alternative. If a device emits an unsupported format or a scanner fails, keep the error and report
it on #624; never substitute a database override or the seeded wallet's verified status.

#### Record the Keystone result

Record the tester, time with timezone, application commit, macOS and Chrome versions, Keystone
model, firmware before and after, camera result, public-account import, challenge signing, signature
decoding and verified-wallet readback. Hardware addresses, account metadata, credentials and QR
payloads stay in private evidence unless the owner publishes them; a public issue comment can show a
masked address and PASS or BLOCK with the observed error. Ownership PASS does not complete EIP-712
order signing, transaction signing, physical Android or iPhone acceptance or #624's
release-deployment swap; coordinate defects with the existing issues before any parallel
implementation. To stop the Mac instance and keep its data:

```sh
docker compose -p ledova-keystone-local down
```

Add `-v` only to delete the separate Mac test database intentionally.

## iOS distribution builds

An ordinary native CI run produces a simulator app, not an App Store archive. A signed device build
needs a dedicated clean checkout, never one serving an active development session (prebuild replaces
generated files), and the pinned Node and npm dependencies.

### Release environment

Keep store identifiers, signing material, exports, logs, provisioning profiles and keys outside the
repository, and set these in a private environment before every prebuild, bundle, archive or export
command:

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

Unset `EXPO_PUBLIC_DEV_API_HOST` and every `EXPO_PUBLIC_NATIVE_PROBE_*` variable, and set
`EXPO_PUBLIC_SUPPORT_EMAIL` and `EXPO_PUBLIC_APP_STORE_URL` for the shipped experience
([client variables](../operations/configuration.md#clients)). The release config
(`mobile/app.config.js`) refuses a missing or malformed identity, the development placeholder, HTTP
endpoints, URL credentials, a query or fragment (even empty), whitespace or backslashes in a URL, a
development API host and native probe flags; without `LEDOVA_IOS_RELEASE` the development config is
unchanged. Check the latest App Store Connect upload before choosing a build number (Apple reserves
no unused local number), keep the bundle ID when continuing an app (even after a store name change),
and align the store version with the binary before App Review.

### Generate and archive

Use an Xcode release App Store Connect accepts: since 28 April 2026
[Apple requires the iOS 26 SDK or later](https://developer.apple.com/news/?id=ueeok6yw),
independently of the app's minimum iOS version and the simulator CI toolchain. The
[generated-project fixes](#generated-project-fixes) meet Xcode 27's deployment-target and iOS 27's
scene life-cycle requirements. Before uploading, launch the same commit on iOS 27 (a Release build
on an iOS 27 simulator opened to sign-in, or the archive on an iOS 27 device); an earlier iOS does
not enforce the scene life cycle.

After installing the locked dependencies
([building from a clean checkout](#building-from-a-clean-checkout)), run from `mobile/` with the
release environment set:

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

Set `LEDOVA_RELEASE_OUTPUT` to a new absolute directory outside the checkout, and inspect the
resolved bundle ID, team and version before archiving. Signing needs a valid identity and profile
for this app and team, and the commands use only what is installed; with Xcode signed in to an
account that can manage them, `-allowProvisioningUpdates` on the archive and export commands lets
xcodebuild create or refresh the profile (check the developer account for what it created). Never
reuse expired or other-team profiles, or revoke certificates for a local setup issue without
checking their other users. Inspect the archive's Info.plist, signature and embedded provisioning
profile, then validate and export for App Store Connect in Xcode Organiser with the owning team's
distribution signing; a development-signed archive is not a distribution IPA.

### Testing and submission

Test the device build with synthetic data on the configured test network, record the source commit,
build, phone and results under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624), then upload the
validated archive for internal TestFlight testing (not App Review submission or public release). The
backend must be reachable by the intended testers and Apple's reviewers, by planned access rather
than disabled access controls. Account recovery, email, privacy disclosures, permissions and
encryption declarations need release-specific validation under the same checklist; a successful
archive establishes none of these or store approval.

Next: [mobile](mobile.md), [testing](testing.md) and
[Apple's distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
