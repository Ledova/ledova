import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refuseNotResponding, windowFocus } from '../window-focus.mjs';

const systemUi = [
  'mCurrentFocus=Window{1f0517d u0 Application Not Responding: com.android.systemui}',
  'mFocusedApp=ActivityRecord{196737320 u0 org.example.ledova.scanner.test/org.example.ledova.scanner.ScannerTestActivity t9}',
];
const app = [
  'mCurrentFocus=Window{7d2c1a3 u0 org.example.ledova/org.example.ledova.MainActivity}',
  'mFocusedApp=ActivityRecord{2f9e3c1 u0 org.example.ledova/.MainActivity t12}',
];

function windows(focus) {
  return [
    'WINDOW MANAGER WINDOWS (dumpsys window windows)',
    '  Window #0 Window{3b1e2a0 u0 NotificationShade}:',
    '    mDisplayId=0 rootTaskId=1 mSession=Session{5c41d7e 1234:u0a10123}',
    ...focus.map((line) => `  ${line}`),
    ...focus.map((line) => `  ${line}`),
    '',
  ].join('\r\n');
}

test('an Application Not Responding window holding focus is refused, naming its owner and the focus lines', () => {
  const record = windowFocus(windows(systemUi));
  assert.deepEqual(record, { focus: systemUi });
  assert.throws(
    () => refuseNotResponding(record, 'ordinary.png'),
    (error) =>
      error.message ===
      `ordinary.png was taken while a system Application Not Responding window for com.android.systemui held focus instead of the app: ${systemUi.join('; ')}.`,
  );
  const launcher = windowFocus(
    windows(['mCurrentFocus=Window{4e8a2b1 u0 Application Not Responding: com.google.android.apps.nexuslauncher}']),
  );
  assert.throws(
    () => refuseNotResponding(launcher, 'ordinary.png'),
    /window for com\.google\.android\.apps\.nexuslauncher/,
  );
});

test('the app holding focus passes and keeps its focus lines', () => {
  const record = windowFocus(windows(app));
  assert.deepEqual(record, { focus: app });
  assert.doesNotThrow(() => refuseNotResponding(record, 'ordinary.png'));
});

test('no focus to report refuses nothing: an empty dump, a null focus and the iOS record', () => {
  assert.deepEqual(windowFocus(''), { focus: [] });
  const unfocused = windowFocus(windows(['mCurrentFocus=null', 'mFocusedApp=null']));
  assert.deepEqual(unfocused, { focus: ['mCurrentFocus=null', 'mFocusedApp=null'] });
  for (const record of [windowFocus(''), unfocused, {}]) {
    assert.doesNotThrow(() => refuseNotResponding(record, 'ordinary.png'));
  }
});
