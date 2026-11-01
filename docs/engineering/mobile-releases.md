# Mobile releases

[Engineering](README.md) · [Documentation](../README.md)

How to build the native apps, run the manual native probes, complete the physical-device checks and
understand the iOS distribution configuration. The architecture these checks exercise is in [mobile](mobile.md).

- [Toolchain and generated projects](#toolchain-and-generated-projects)
- [Building from a clean checkout](#building-from-a-clean-checkout)
- [Generated-project fixes](#generated-project-fixes)
- [Dependency integrity](#dependency-integrity)
- [Native checks before a release](#native-checks-before-a-release)
- [Native probes](#native-probes)
- [What automated checks do not establish](#what-automated-checks-do-not-establish)
- [Pre-release device checks](#pre-release-device-checks)
- [iOS distribution configuration](#ios-distribution-configuration)

## Toolchain and generated projects

The app uses the versions `mobile/package-lock.json` resolves, currently Expo SDK 54 on React Native
0.81. Native projects are generated from `mobile/app.json` and the config plugins in
`mobile/plugins/` (with `mobile/app.config.js` for [iOS distribution configuration](#ios-distribution-configuration));
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
scripts are watcher, fsevents and unrs-resolver. There is no full transitive source audit.

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
focus or transport outcome. No adbd restart or root escalation is used, and an empty record
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
bearer and body, API refresh, native entropy, binary download and cancellation controls. Numeric
HTTP requests must fail, including repeated refusal and cancellation. SIGINT and SIGTERM cancel the runner, terminate its owned command and server groups (forcibly
after two seconds), reap direct children and close resources; short synchronous tool calls have
timeouts. After an uncatchable kill or host loss, prebuild afresh before using the generated
project. Remove only the owned emulator or simulator afterwards (deleting the iOS simulator removes
its test CA), and never distribute the probe artifact or synthetic probe apps.

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

Apart from picked evidence, whose removal after saving and on a session change the member journey
checks with a fake picker and file system, the mobile Jest suite covers none of the screen and file
lifetimes in [mobile](mobile.md). On an emulator or simulator the native probes exercise the
transport and the document view copies,
driving no system UI; only completed emulator logs establish native results. The LAN probe calls the compiled
handler directly, establishing neither React Native dispatcher selection (the Release app probe
exercises it) nor local-network permission, which the
[simulator does not implement](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

OS prompt presentation, the system document picker with each platform's copy and the evidence's
multipart upload, device settings and OEM behaviour, global lock-overlay and input stacking, and low
storage remain device work under [#13](https://github.com/Ledova/ledova/issues/13). A
simulator also does not establish physical biometric enrolment or change,
hardware-backed key properties, OEM backup or transfer, store distribution or behaviour on every
supported OS.

Record Jest and native probe outcomes separately, with these limits, any failed native build and the
exact tested head, in the PR; JavaScript tests alone do not close a native hardening claim.

## Pre-release device checks

Complete these flows on physical hardware before a release and record them under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624). They need a
development or production build on a device. Emulator and
simulator checks can supplement them.

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

## iOS distribution configuration

`mobile/app.config.js` preserves the development configuration when `LEDOVA_IOS_RELEASE` is
absent. Its release branch requires `LEDOVA_IOS_RELEASE=1` and `EXPO_NO_DOTENV=1`. It validates
`LEDOVA_IOS_BUNDLE_ID`, `LEDOVA_APPLE_TEAM_ID`, `LEDOVA_APP_VERSION` and
`LEDOVA_IOS_BUILD_NUMBER`, requires HTTPS API and marketing URLs without credentials, queries or
fragments, and refuses development API hosts and native probe variables. Native CI produces a
simulator app.

Signing, archive/export and upload procedures are maintained in the private
[Ledova infrastructure guide](https://github.com/Ledova/infra/blob/main/docs/mobile-distribution.md).

Next: [mobile](mobile.md) and [testing](testing.md).
