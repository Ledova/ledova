import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const workflow = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/mobile-native.yml'),
  'utf8',
);
const android = workflow.slice(workflow.indexOf('\n  android:\n'), workflow.indexOf('\n  ios:\n'));

test('the Android job owns exactly one emulator launch', () => {
  assert.ok(android.length > 0);
  const launches = android.split('\n').filter((line) => /\/emulator\/emulator"? -avd /.test(line));
  assert.equal(launches.length, 1);
});

test('the emulator keeps at least four vCPUs', () => {
  const [launch] = android.split('\n').filter((line) => /\/emulator\/emulator"? -avd /.test(line));
  const cores = launch.match(/ -cores (\d+)( |$)/);
  assert.ok(cores, 'the launch names its vCPU count');
  assert.ok(Number(cores[1]) >= 4, `the launch gives the emulator ${cores[1]} vCPUs`);
});

test('the emulator settles after boot and before the first build', () => {
  const boot = android.indexOf('getprop sys.boot_completed');
  const settle = android.indexOf('node mobile/scripts/emulator-settle.mjs');
  const build = android.indexOf('npx expo prebuild');
  assert.ok(boot > 0, 'the job waits for sys.boot_completed');
  assert.ok(settle > boot, 'the settle runs after boot completes');
  assert.ok(build > settle, 'the first build starts after the settle');
});
