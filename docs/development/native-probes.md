# Native probes and device checks

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Run isolated native controls and keep their evidence separate from JavaScript tests and physical-device acceptance.

Run the commands below from `mobile/`, after [native prebuild](mobile-builds.md).
Use a dedicated emulator/simulator and select it explicitly.

```bash
ANDROID_SERIAL=emulator-5556 npm run test:native -- android /absolute/fresh/android-results
IOS_SIMULATOR_UDID=your-owned-simulator-uuid npm run test:native -- ios /absolute/fresh/ios-results
```

The output directory must not already exist. The runner builds and launches the
ordinary Release app, preserves that artifact and checks its release policy.
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
Do not distribute the probe artifact.

Jest and native probe outcomes are recorded separately. A simulator does not
establish physical biometric enrollment/change, hardware-backed key properties,
OEM backup/transfer, store distribution or behavior on every supported OS.
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
Release result is recorded because numeric-host ATS behavior depends on the OS
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
or physical local-network permission behavior. Apple documents that the
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
  trading order through the QR branch. The transfer is the only place a raw
  transaction UR is exercised at all, and the encoder force-encodes a legacy
  type-0 transaction, so an EIP-1559 prepare is downgraded on the way to the
  device: check that what the Keystone displays matches what was prepared. The
  seed-phrase alternative in the dashboard does not cover any of this.

- **Bitcoin manual send.** Prepare a transfer from a Bitcoin wallet, sign the
  raw transaction with your own tooling, paste the hex, broadcast it, and
  confirm the success state links to the testnet explorer. The app never builds
  or signs a Bitcoin transaction.
- **Biometric sign-in.** The app always opens at the sign-in screen. It offers
  biometric sign-in only while biometrics are enrolled and a gated copy of the
  refresh token is stored: the Sign In button then shows a face-scan icon
  instead of a key, and tapping it with both fields empty starts biometric
  sign-in. Sign-out and account deletion remove the copy by design, so drive a
  relaunch instead. On Android, use a device with a strong (Class 3)
  biometric: the screen checks only that some biometric is enrolled, but the
  gated copy needs a strong one. `<type>` is Face ID or Touch ID, chosen from
  the device's biometric hardware, so an Android phone with face-unlock hardware
  says Face ID even when the fingerprint is used.
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
     copy stayed in step with the rotation in step 2.
  4. Android: repeat step 2, but cancel the second prompt or background the app
     while it shows. Sign-in still completes and the copy is dropped: after a
     relaunch the key icon shows, the next sign-in is typed once (no Enable
     alert, one Keystore prompt), and the relaunch after that offers biometrics.
  5. Sign out. Expect the key icon; an empty tap asks for email and password
     with no biometric prompt. One typed sign-in re-arms biometric sign-in for
     the next relaunch.

  A saved sign-in older than `REFRESH_TOKEN_LIFETIME` (seven days by default)
  or revoked elsewhere still shows the face-scan icon, but after the prompt it
  ends with `Your saved sign in has expired`.

- **Push delivery.** Configure `extra.eas.projectId` in `mobile/app.json` and
  verify delivery in the device build. Supported emulators and simulators can
  also exercise delivery; the [SDK 54 notification documentation](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/)
  describes their requirements and the Android Expo Go restriction.
