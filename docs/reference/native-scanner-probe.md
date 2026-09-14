# Android scanner probe

[Reference](README.md) · [Documentation](../README.md)

Native scanner ownership and the instrumentation controls that verify it. Start with [native probes](../development/native-probes.md).

The three QR placements use the local Expo module in
`mobile/modules/ledova-scanner`. Its native view stays mounted while permission
is pending or the preview is paused, so it can observe its own window's focus,
attachment and visibility. The iOS placements retain Expo Camera. Android
requires a rebuilt Ledova app; Expo Go does not contain the local module and
cannot open these scanners.

The Android view owns a CameraX lifecycle for each admitted scan. Window loss,
hidden ancestors, detachment, disposal or inactive preview props retire that
session and unbind only its preview and analysis use cases. Neither Activity
blur nor JavaScript delivery is needed to close a modal's camera. Provider
completion and decoded QR results recheck the current native session, including
after asynchronous work. The QR-only decoder uses the same CameraX 1.5.0-rc01
and bundled ML Kit 17.3.0 versions already resolved for Expo Camera; upstream
package source is unchanged.

Every window transition advances a generation. Focus recovery needs fresh
JavaScript admission for that generation, after the existing app-lock and
permission checks. An old `active` prop cannot reopen a camera while JavaScript
is stalled. Scan events also carry an admission ID, so queued results from an
earlier preview cannot complete a new scan. Focus recovery reads permission
without prompting again and preserves completed scans and partial UR decoding.
Barcode delivery also asks the native view to validate the generation and scan
ID on the Android UI thread, then rechecks JavaScript admission after the reply.
This refuses events that waited in the JavaScript queue after native focus loss,
even when the window-change notification has not reached JavaScript yet.

`ScannerWindow.android.test.tsx` exercises each placement through the native
event boundary. The Android instrumentation suite exercises real Activity and
Dialog windows, CameraX open/closed state, parent visibility and detachment,
fully clipped previews, backgrounding, delayed provider completion, replacement
sessions, focus loss/regain before JavaScript admission changes, and real
decoding of a synthetic QR bitmap. It runs
inside the Android native CI probe and retains `scanner-window-tests.log`.
A wait that reaches its 15-second deadline appends the focused window, focused
app and top resumed activity at that moment, read through the instrumentation's
shell. A system window such as `Application Not Responding` holding focus marks
an unhealthy emulator; the test's own activity holding focus points at scanner
admission. The failure stands either way: nothing is dismissed or retried.
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
This establishes Release adapter behavior, not OS permission-prompt behavior.
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
shutdown, OS permission dialogs, settings or OEM behavior. The runner retains
APK hashes, instrumentation logs, screenshots and window diagnostics, including
failed runs, and removes both owned instrumentation packages during cleanup.
The cleanup tracker includes attempted installs and uses bounded adb commands
outside the cancelled command runner. Node controls cover install, instrumentation
and cancellation failures, absent packages and a cleanup error alongside another
owned package. Only completed emulator logs establish native results; JavaScript
and script controls do not certify Kotlin compilation or camera hardware behavior.
The test APKs and synthetic probe apps must not be distributed.

To run only these native controls on an owned emulator after prebuild:

```bash
cd mobile/android
./gradlew :ledova-scanner:assembleDebugAndroidTest --no-daemon --max-workers=2
cd ..
adb -s "$ANDROID_SERIAL" install -r modules/ledova-scanner/android/build/outputs/apk/androidTest/debug/ledova-scanner-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r org.example.ledova.scanner.test/androidx.test.runner.AndroidJUnitRunner
adb -s "$ANDROID_SERIAL" uninstall org.example.ledova.scanner.test
```

Use only an explicitly selected emulator, and require the instrumentation's
nonzero `OK (... tests)` result; `am instrument` can exit zero after test failure.
