import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFocus, windowFocus } from '../window-focus.mjs';

const systemUi = [
  'mCurrentFocus=Window{1f0517d u0 Application Not Responding: com.android.systemui}',
  'mFocusedApp=ActivityRecord{196737320 u0 org.example.ledova.scanner.test/org.example.ledova.scanner.ScannerTestActivity t9}',
];
const app = [
  'mCurrentFocus=Window{8c6fb85 u0 org.example.ledova/org.example.ledova.MainActivity}',
  'mFocusedApp=ActivityRecord{246716032 u0 org.example.ledova/.MainActivity t6}',
];

function displays(focus) {
  return [
    'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
    '  Display: mDisplayId=0 (organized)',
    '    init=1080x2400 420dpi mMinSizeOfResizeableTaskDp=220 cur=1080x2400 app=1080x2400 rng=1080x1080-2400x2400',
    '    deferred=false mLayoutNeeded=false',
    '  mLayoutSeq=61',
    ...focus.map((line) => `  ${line}`),
    '  mFixedRotationLaunchingApp=null',
    '',
  ].join('\r\n');
}

const windowsOnly = [
  'WINDOW MANAGER WINDOWS (dumpsys window windows)',
  '  Window #0 Window{ce007bf u0 ScreenDecorOverlayBottom}:',
  '    mDisplayId=0 mSession=Session{2bb241d 1033:u0a10194} mClient=android.os.BinderProxy@2ee2c60',
  '  mHasPermanentDpad=false',
  '  mTopFocusedDisplayId=0',
  '  mInputMethodWindow=Window{1415e80 u0 InputMethod}',
  '',
].join('\n');

test('an Application Not Responding window holding focus is refused, naming its owner and the focus lines', () => {
  const record = windowFocus(displays(systemUi));
  assert.deepEqual(record, { focus: systemUi });
  assert.throws(
    () => checkFocus(record, 'ordinary.png'),
    (error) =>
      error.message ===
      `ordinary.png was taken while a system Application Not Responding window for com.android.systemui held focus instead of the app: ${systemUi.join('; ')}.`,
  );
  const launcher = windowFocus(
    displays(['mCurrentFocus=Window{4e8a2b1 u0 Application Not Responding: com.google.android.apps.nexuslauncher}']),
  );
  assert.throws(() => checkFocus(launcher, 'ordinary.png'), /window for com\.google\.android\.apps\.nexuslauncher/);
});

test('the app holding focus passes and keeps its focus lines, as does an explicit null focus', () => {
  const record = windowFocus(displays(app));
  assert.deepEqual(record, { focus: app });
  assert.doesNotThrow(() => checkFocus(record, 'ordinary.png'));
  const unfocused = windowFocus(displays(['mCurrentFocus=null', 'mFocusedApp=null']));
  assert.deepEqual(unfocused, { focus: ['mCurrentFocus=null', 'mFocusedApp=null'] });
  assert.doesNotThrow(() => checkFocus(unfocused, 'ordinary.png'));
});

test('a dump without mCurrentFocus fails as unknown focus instead of passing as checked', () => {
  for (const dump of [
    windowsOnly,
    '',
    displays(['mFocusedApp=ActivityRecord{246716032 u0 org.example.ledova/.MainActivity t6}']),
  ]) {
    const record = windowFocus(dump);
    assert.equal(
      record.focus.some((line) => line.startsWith('mCurrentFocus=')),
      false,
    );
    assert.throws(
      () => checkFocus(record, 'ordinary.png'),
      /^Error: ordinary\.png could not be checked: the window dump has no mCurrentFocus line, so focus is unknown\.$/,
    );
  }
});

test('the iOS record has no focus to check', () => {
  assert.doesNotThrow(() => checkFocus({}, 'ordinary.png'));
});
