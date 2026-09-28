# iOS distribution builds

[Mobile builds](mobile-builds.md) · [Documentation](../README.md)

An ordinary native CI run produces a simulator app, not an App Store archive.
Use a dedicated clean checkout and the pinned Node/npm dependencies for a signed
device build. Native prebuild replaces generated files; do not use a checkout
that serves an active development session.

## Release environment

Keep the registered store identifiers and signing material outside the repository.
In a private environment, set these values before **every** prebuild, bundle,
archive or export command:

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
| `EXPO_PUBLIC_USE_MOCK_DATA` | `false`                                      |

Unset `EXPO_PUBLIC_DEV_API_HOST` and every `EXPO_PUBLIC_NATIVE_PROBE_*` variable.
Set the support address and App Store URL when preparing the shipped experience.
`EXPO_PUBLIC_*` values are embedded in the app and must never contain secrets.
The release config refuses a missing or malformed identity, the development
placeholder, HTTP endpoints, URL credentials, whitespace or backslashes inside a
URL, mock data and native probe flags.
Without `LEDOVA_IOS_RELEASE`, the development config is unchanged.

Confirm the latest upload in App Store Connect before selecting a build number.
Keep the existing bundle ID when continuing an existing app. A store name change
does not require a new bundle ID. Align the store version with the binary before
submitting for App Review; an unused local build number is not reserved at Apple.

## Generate and archive

Use an Xcode release accepted by App Store Connect. Since April 28, 2026,
[Apple requires the iOS 26 SDK or later](https://developer.apple.com/news/?id=ueeok6yw).
This requirement is separate from the app's minimum supported iOS version and
the simulator CI toolchain. Xcode 27 also refuses pod targets below iOS 15.0;
the config plugin's post-install step raises them to the Podfile platform, as
[mobile builds](mobile-builds.md) describes.

After installing the locked dependencies described in [mobile builds](mobile-builds.md),
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

Set `LEDOVA_RELEASE_OUTPUT` to a new absolute directory outside the checkout.
Inspect the resolved bundle ID, team and version before archiving. Signing needs
a valid identity/profile for this app and team, or an authenticated Xcode account
able to manage them. Do not reuse expired or other-team profiles. Do not revoke
certificates to resolve a local setup issue without checking their other users.
The commands above do not request automatic profile/certificate creation.

Inspect the archive's Info.plist, signature and embedded provisioning profile.
In Xcode Organizer, validate and export for App Store Connect using the owning
team's distribution signing. A development-signed archive is not a distribution
IPA. Keep exports, logs, provisioning profiles and keys outside Git.

## Testing and submission

Test the actual device build with synthetic data on the configured test network.
Record the source commit, build, phone and results under the
[physical acceptance checklist](https://github.com/Ledova/ledova/issues/624).
Then upload the validated archive for internal TestFlight testing. Uploading a
build is separate from submitting it to App Review or releasing it publicly.

The backend must be reachable by the intended testers. An owner-IP-only API will
not work for Apple reviewers or testers on another network. Plan that access
deliberately, with working demo accounts and accurate review notes; do not turn
off access controls just to make a review connection succeed. Account recovery,
email, privacy disclosures, permissions, encryption declarations and any offered
push notifications need release-specific validation. A successful archive does
not complete these checks or establish store approval.

Next: [native probes and device checks](native-probes.md) and
[Apple's distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
