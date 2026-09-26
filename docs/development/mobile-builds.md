# Mobile builds

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Install the native toolchain and generate the Android or iOS project before running device probes.

The mobile app uses the versions resolved by `mobile/package-lock.json`: Expo
54.0.33, React Native 0.81.5, React 19.1.0, SecureStore 15.0.8 and Expo Crypto
15.0.8. Native projects are generated from `app.json` and the local config plugin;
`android/` and `ios/` are not committed. Use a native development build to test
these policies. Expo Go does not contain Ledova's native networking overrides.

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
