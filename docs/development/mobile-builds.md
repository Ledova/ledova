# Mobile builds

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Install the native toolchain and generate the Android or iOS project before running device probes.

The mobile app uses the versions resolved by `mobile/package-lock.json`,
currently Expo SDK 54 on React Native 0.81. Native projects are generated from
`app.json` and the local config plugins in `mobile/plugins/`; `android/` and
`ios/` are not committed. An explicit iOS distribution environment can override
the store identity through `app.config.js`; see
[iOS distribution builds](ios-distribution.md). Use a native development build
to test these policies. Expo Go does not contain Ledova's native networking
overrides.

The `expo-system-ui` plugin applies the paper-only light appearance to Android
native dialogs, including when the device uses dark mode. Generated-project
checks verify the Android light resource and both iOS light appearance settings.

iOS 27 stops an app built with the iOS 27 SDK at launch unless it uses the
UIKit scene life cycle
([TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)).
Expo 54 generates an app-delegate app with no scene delegate; Expo adds one in
SDK 58, and in 57.0.23 behind `ios.enableSceneSupport`. Until that upgrade,
`plugins/withSceneLifecycle.cjs` declares a `UIApplicationSceneManifest` and
adds `LedovaSceneDelegate`, which moves the window `AppDelegate` creates into
the connecting scene and forwards the URL, user-activity, foreground and
background events UIKit no longer sends to the app delegate.
`check-native-projects.mjs` refuses a generated project without the manifest
and the delegate. The plugin refuses an `AppDelegate` that no longer creates a
window Objective-C can read (`var window: UIWindow?` on an `ExpoAppDelegate`
subclass), or another scene manifest, so an Expo upgrade that brings its own
scene delegate stops at prebuild until the plugin is removed.

A link that opens the app from closed does not reach JavaScript: UIKit delivers
it with the connecting scene after React Native has started, so
`Linking.getInitialURL()` returns null. A link that arrives while the app runs,
such as an OAuth redirect, still reaches `Linking`'s `url` event. Nothing
depends on this today; a feature that needs a link to open the closed app must
first move to Expo SDK 58, or 57.0.23 with `ios.enableSceneSupport`
([expo/expo#47628](https://github.com/expo/expo/pull/47628)), which replaces
this plugin.

The lockfile keeps registry URLs and npm integrity values; the shared workspace
is the intentional local link. Install with `--ignore-scripts` in native CI.
The locked packages declaring install scripts are watcher, fsevents,
unrs-resolver and secp256k1; secp256k1 enters through Keystone's hdkey dependency.
No broad dependency upgrade or full transitive source audit is implied.

Each native run records the resolved Android release dependency graph and
repository configuration, or the resolved Podfile.lock and generated iOS protocol
provider in CI. The generated Android repositories are Google Maven, Maven
Central and JitPack. The Gradle distribution is SHA-256 pinned by the plugin.
Native dependency graphs still need review when they change; npm's lockfile does
not itself pin every downloaded Maven/Pod artifact. The ordinary APK is checked
for both ZIP alignment and every native library's ELF load-segment alignment at
16 KiB. [RN 0.81's compatibility statement](https://reactnative.dev/blog/2025/08/12/react-native-0.81)
does not replace checking third-party binaries.

RN 0.81.5 can turn an empty app spec search into a codegen dependency on the
entire iOS project directory, creating a cycle with Expo's generated provider.
The plugin's CocoaPods post-install helper removes only the exact
`${PODS_ROOT}/..` input from ReactCodegen's Generate Specs phase. Real spec inputs,
generation commands and handler registration remain intact. Manual iOS builds
preserve the generated Podspec and Pods project for build diagnosis. The same
post-install step raises any pod target whose `IPHONEOS_DEPLOYMENT_TARGET` is
below the Podfile's platform to that platform, because Xcode 27 refuses targets
below iOS 15.0 and some third-party resource bundles still declare older
minimums; targets at or above the platform are left alone. The manual native
build checks the generated project.

The exact toolchain is pinned in
[mobile-native.yml](../../.github/workflows/mobile-native.yml), which selects
[Xcode 16.4 on the macOS 15 runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md):

| Component                | Build baseline                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| Node / npm               | 22.15.1 / 11.5.2                                                            |
| Android                  | JDK 17, SDK/target 36, minimum API 24, Build Tools 36.0.0                   |
| Android native toolchain | NDK 27.1.12297006, CMake 3.22.1, Gradle 8.14.3                              |
| iOS                      | Xcode 16.4, minimum deployment target 15.1, ad hoc signed simulator Release |
| Runtime probes           | Android API 36 x86_64 emulator; iOS 18.5 simulator                          |

These minimum platform versions follow [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/).
The Android build includes ARM64 and x86_64; only the emulator architecture is
executed here. Current Android command line tools may require JDK 21 for SDK
installation; select JDK 17 for Gradle.

Install the SDK/NDK/CMake packages from the table, plus platform-tools, emulator
and `system-images;android-36;google_apis;x86_64`. Put SDK, Gradle cache and AVDs
in owned directories when sharing a machine; do not reuse a personal device or
live development service. On macOS, install CocoaPods and the iOS 18.5 simulator
runtime. No EAS account or signing credentials are needed.

Android and iOS native builds run only by manual dispatch of
[mobile-native.yml](../../.github/workflows/mobile-native.yml) before a mobile
release, under the [11 October decision](../decisions.md#minimum-tests-and-fresh-migrations).
Both platforms build and start the ordinary Release app and run the native
runtime probe. The `Mobile native checks` verdict requires both jobs to succeed.
Manual build results and device/probe gaps belong in the release record. Native
builds are outside `make preflight`.

From a clean checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix mobile ci --ignore-scripts --no-audit --no-fund
cd mobile
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run native:prebuild
EXPO_PUBLIC_DEV_API_HOST=192.168.50.10 npm run check:native
```

Prebuild replaces generated projects; preserve any local native experiments
first. For iOS, also run `cd ios && pod install` before returning to `mobile/`.

Next: [native probes and device checks](native-probes.md), [mobile security](../architecture/mobile-security.md), and [screen lifetimes](../architecture/mobile-lifecycles.md).
