# Mobile builds

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Install the native toolchain and generate the Android or iOS project before running device probes.

The mobile app uses the versions resolved by `mobile/package-lock.json`: Expo
54.0.33, React Native 0.81.5, React 19.1.0, SecureStore 15.0.8 and Expo Crypto
15.0.8. Native projects are generated from `app.json` and the local config plugin;
`android/` and `ios/` are not committed. Use a native development build to test
these policies. Expo Go does not contain Ledova's native networking overrides.

The `expo-system-ui` plugin applies the paper-only light appearance to Android
native dialogs, including when the device uses dark mode. Generated-project
checks verify the Android light resource and both iOS light appearance settings.

iOS 27 stops an app built with the iOS 27 SDK at launch, in
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, unless it uses the
UIKit scene life cycle
([TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)).
Expo 54 and React Native 0.81.5 generate an app-delegate app with no scene delegate;
Expo adds one in SDK 58, and in 57.0.23 behind `ios.enableSceneSupport`. Until the
upgrade, `plugins/withSceneLifecycle.cjs` declares a `UIApplicationSceneManifest` in
both Info.plists and adds `LedovaSceneDelegate`, so every iOS version the app
supports runs the scene life cycle.

`LedovaSceneDelegate` moves the window that `AppDelegate` still creates at launch
into the connecting window scene. `AppDelegate` keeps creating it because Expo 54's
dev launcher needs a window in `didFinishLaunching`, and expo-system-ui and React
Native read `AppDelegate.window`. UIKit no longer calls the app delegate's URL,
user-activity, foreground and background methods, so the scene delegate forwards
those events to `AppDelegate`, which hands them to Expo's subscribers and
`RCTLinkingManager` as before. UIKit still posts the application notifications that
`AppState`, the app lock, the camera and WebViews observe. A window that becomes
visible without a scene, such as Expo's developer menu, is moved into the app's
scene. Generated-project checks verify the manifest and the delegate. The plugin
refuses an `AppDelegate` that no longer creates the window, or another scene
manifest, so an Expo upgrade that brings its own scene delegate stops at prebuild
until this plugin is removed. It also
refuses one whose window Objective-C cannot read, because the scene delegate
asks for it by selector and would otherwise get nil and a black screen: the
class must subclass `ExpoAppDelegate` and store `var window: UIWindow?`. Swift
still exposes a private or implicitly unwrapped `window` there; `@nonobjc`,
`static`, `let` or a computed property hides it, and a `weak` one is released as
soon as it is assigned, which leaves the same black screen.

A link that opens the app from closed does not reach JavaScript. UIKit delivers
it with the connecting scene, after `AppDelegate` has started React Native with
launch options that no longer carry it, so `Linking.getInitialURL()` returns null,
and the `url` event the scene delegate sends fires before any JavaScript listens.
On iOS 27.0 and 26.5 simulators the launch options React Native keeps for
`getInitialURL` were empty after a link started the Release build; on iOS 26.5,
which can launch the same build without the scene manifest, they held the link. A link that arrives while the
app runs, such as an OAuth redirect back to it, still reaches `Linking`'s `url`
event. Nothing depends on this today: the app reads no incoming links, and
`mobile/scripts/tests/ios-scene-lifecycle.test.mjs` fails if `App.tsx`, `index.ts`
or code under `mobile/src` starts to. A feature that needs a link to open the
closed app, such as an emailed confirmation link, must first move to Expo SDK 58,
or 57.0.23 or later with `ios.enableSceneSupport`, whose scene delegate starts
React Native with the link in its launch options
([expo/expo#47628](https://github.com/expo/expo/pull/47628)). That upgrade
replaces this plugin, which refuses the new `AppDelegate` at prebuild.

The lockfile keeps registry URLs and npm integrity values; the shared workspace
is the intentional local link. Install with `--ignore-scripts` in native CI.
The locked packages declaring install scripts are watcher, fsevents,
unrs-resolver and secp256k1; secp256k1 enters through Keystone's hdkey dependency.
No broad dependency upgrade or full transitive source audit is implied.

Each native run records the resolved Android release dependency graph and
repository configuration, or the resolved Podfile.lock and generated iOS protocol
provider in CI. The generated Android repositories are Google Maven, Maven
Central and JitPack. The Gradle 8.14.3 distribution is SHA-256 pinned by the
plugin. Native dependency graphs still need review when they change; npm's
lockfile does not itself pin every downloaded Maven/Pod artifact. The ordinary
APK is checked for both ZIP alignment and every native library's ELF load-segment
alignment at 16 KiB. [RN 0.81's compatibility statement](https://reactnative.dev/blog/2025/08/12/react-native-0.81)
does not replace checking third-party binaries.

RN 0.81.5 can turn an empty app spec search into a codegen dependency on the
entire iOS project directory, creating a cycle with Expo's generated provider.
The plugin's CocoaPods post-install helper removes only the exact
`${PODS_ROOT}/..` input from ReactCodegen's Generate Specs phase. Real spec inputs,
generation commands and handler registration remain intact. iOS CI checks this
with a genuine native spec control and preserves the generated Podspec and Pods
project for build diagnosis.

| Component                | Build baseline                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| Node / npm               | 22.15.1 / 11.5.2                                                            |
| Android                  | JDK 17, SDK/target 36, minimum API 24, Build Tools 36.0.0                   |
| Android native toolchain | NDK 27.1.12297006, CMake 3.22.1, Gradle 8.14.3, Kotlin 2.1.20               |
| iOS                      | Xcode 16.4, minimum deployment target 15.1, ad hoc signed simulator Release |
| Runtime probes           | Android API 36 x86_64 emulator; iOS 18.5 simulator                          |

These minimum platform versions follow [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/).
The Android build includes ARM64 and x86_64; only the emulator architecture is
executed here. Some native subprojects also request Android Build Tools 35.0.0,
which Gradle installs when its SDK license is available. Current Android command
line tools may require JDK 21 for SDK installation; select JDK 17 for Gradle.

Install the SDK/NDK/CMake packages from the table, plus platform-tools, emulator
and `system-images;android-36;google_apis;x86_64`. Put SDK, Gradle cache and AVDs
in owned directories when sharing a machine; do not reuse a personal device or
live development service. On macOS, install CocoaPods and the iOS 18.5 simulator
runtime. The exact CI setup is in
[mobile-native.yml](../../.github/workflows/mobile-native.yml), which selects
[Xcode 16.4 on the macOS 15 runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md).
No EAS account or signing credentials are needed.

Pull requests and pushes to `main` run both native builds when their complete
change includes one of these inputs:

- Anything under `mobile/` or `packages/shared/`.
- Root `package.json`, `package-lock.json`, `npm-shrinkwrap.json` or `.npmrc`,
  and `dashboard/package.json`: the native jobs install the root workspace
  dependency graph before installing mobile dependencies.
- Any `.gitattributes`, which can change how the files beside it are checked out.
- `.github/workflows/mobile-native.yml`, `scripts/ci-scope.py` or
  `scripts/tests/test_ci_scope.py`. The script also decides whether a change
  runs the Django jobs, so a change to either decision builds both platforms.

Other paths, including backend, dashboard application code, marketing and
documentation, skip both native builds. Ordinary CI still runs. The router
compares a pull request's head with the base commit its event records, or the
full push before-to-after range, including deleted and renamed inputs. GitHub
can leave a pull request's recorded base at the branch point after `main` moves,
which still covers every file the pull request changes. A verified empty diff
skips. These run both platforms, to be safe:

- an unavailable or malformed comparison;
- a recorded base that is not an ancestor of the head;
- a push range whose start is not an ancestor of its end.

Manual runs always build both, and can check external tool or dependency drift
without a mobile change.

The lightweight scope job and `Mobile native checks` verdict always run. The
verdict requires successful classification and the expected platform results;
require that verdict when configuring branch protection. When adding a native
dependency outside the listed paths, update the router and its tests as part of
that change.

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
