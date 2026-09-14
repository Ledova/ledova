# Mobile transport and secret storage

[Architecture](README.md) · [Documentation](../README.md)

Native networking, session and wallet-seed storage policies. Use a Ledova native build to exercise these guarantees.

## Transport

Release builds require HTTPS for API requests, trading SSE and provider WebViews.
The shared URL policy refuses credentials embedded in URLs, fragments, malformed
URLs and any bearer destination outside `EXPO_PUBLIC_API_URL`'s origin. Axios
absolute URLs and `baseURL` overrides pass through the same check. An absent
stored session removes an existing Authorization header before dispatch.

Native Debug allows exact `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` hosts.
For a physical development device, set `EXPO_PUBLIC_DEV_API_HOST` to one private
LAN IPv4 and set the API/marketing URLs to that host before prebuild. Ports are
not restricted by the native allowlist. Do not put credentials in `EXPO_PUBLIC_`
variables; Expo embeds them in the bundle. Changing the native allowance requires
regeneration and rebuilding. A Release build made from a Debug-configured
prebuild still denies cleartext.

Android uses separate main/Debug network security resources. iOS uses separate
Release/Debug plists and a compile-time HTTP guard in its request handler, including
numeric IP addresses. This matters on supported older Apple systems where ATS
alone does not cover every local/numeric destination. [Android network security configuration](https://developer.android.com/privacy-and-security/security-config)
and [Apple's ATS reference](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html)
describe the platform behavior.

The API must serve requests directly. Android's existing RN OkHttp client and an
iOS subclass of RN's existing HTTP handler refuse redirects, including 307/308
requests that could otherwise forward sign-in or refresh bodies. The iOS handler
is registered through RN's new-architecture protocol provider. Normal platform
TLS validation, request cancellation, progress, multipart uploads and SSE remain
in the inherited networking implementation. Provider WebViews reject insecure
initial URLs, insecure navigation and mixed content. The identity-verification
WebViews also limit top-frame navigation to each provider's allowed origins and
refuse popups. On iOS they ask before media capture; on Android a page gets
the camera without an origin check once the app holds `CAMERA`. See
[identity-provider WebView lifetime](mobile-lifecycles.md#identity-provider-webview-lifetime).
The buy-crypto WebView keeps its own navigation behavior.

## Secret storage

Ordinary access/refresh tokens share a fresh `session.tokens.v2` SecureStore item
with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, without requiring biometric authentication.
A healthy complete legacy pair migrates only after replacement read-back and
verified removal of both originals. Incomplete or failed migration exposes no
credentials. A serial queue orders session and biometric mutations. Refresh
responses can update or retire only the generation and refresh identity captured
before their request, so late responses cannot recreate a logged-out session or
replace a newer sign-in.

Logout persists a non-secret retirement marker, removes the ordinary pair and
verifies its absence without an authentication prompt. If native deletion silently
leaves the pair behind, reads remain refused after an app restart and logout
reports failure. An unavailable retirement-marker write refuses reads in the
running process; durable retirement cannot be guaranteed while the storage
provider itself cannot write. When logout reports failure, the app still clears
cached account data and returns to sign-in with a fixed-text warning instead of
the storage error; an account deletion the server accepted is not reported as
failed. A deliberate successful sign-in activates a new pair. Optional biometric
sign-in stays optional: its ready marker is retired and verified without
prompting. Expo's iOS native deletion ignores Keychain deletion status, so
physical erasure of the separately gated copy is not verified by prompt-free
logout; the app refuses reads through its retired marker.

Wallet seeds use a fresh gated key and service with
`WHEN_PASSCODE_SET_THIS_DEVICE_ONLY` and `requireAuthentication`. Reads do not
trust the old secured marker. A legacy migration authenticates, writes and reads
back the new gated item, then verifies removal of the original before returning
the phrase. Failure returns no phrase and preserves whichever recoverable copy
already exists. This avoids Expo's iOS preference for a surviving no-auth alias
at the old key. Cancellation, unavailable protection and failed storage do not
fall back to ungated seed access.

Android retains SecureStore's exclusions in both legacy backup XML and Android
12+ cloud/device-transfer rules. Existing non-secret preference backups remain
enabled. iOS device-only accessibility prevents transfer of the selected secret
items to another device; it does not disable backups of the entire app container.
SecureStore can persist across iOS uninstall/reinstall, and biometric enrollment
or passcode changes can invalidate gated items. Keep a recovery phrase outside
the app under the existing wallet recovery procedure. These platform semantics
are documented by [Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)
and [Android backup rules](https://developer.android.com/identity/data/autobackup).

## Native dependencies and randomness

The RNG entry shim and mnemonic generation use Expo Crypto's native
`getRandomValues` directly and throw when it is unavailable. The removed
`react-native-get-random-values` dependency had a remote-debugging `Math.random`
fallback. Temporary mnemonic entropy is overwritten after conversion; that is
not a claim that JavaScript strings or all native copies can be securely erased.
The remaining Buffer, process, crypto-browserify, stream, events, assert and util
shims support the existing wallet/Keystone dependency graph. Resolution checks,
BIP39/BIP44 derivation/signature vectors and the native probe cover their use.

Next: [mobile builds](../development/mobile-builds.md), [native probes](../development/native-probes.md), and [screen/file lifetimes](mobile-lifecycles.md).
