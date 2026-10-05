import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const workflow = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/mobile-native.yml'),
  'utf8',
);
const android = workflow.slice(workflow.indexOf('\n  android:\n'), workflow.indexOf('\n  ios:\n'));
const lines = android.split('\n').map((line) => line.trim());
const launches = lines.filter((line) => /\/emulator\/emulator"? -avd /.test(line));

test('the Android job owns exactly one emulator launch', () => {
  assert.ok(android.length > 0);
  assert.equal(launches.length, 1);
});

test('the emulator keeps at least four vCPUs', () => {
  const cores = launches[0].match(/ -cores (\d+)( |$)/);
  assert.ok(cores, 'the launch names its vCPU count');
  assert.ok(Number(cores[1]) >= 4, `the launch gives the emulator ${cores[1]} vCPUs`);
  assert.doesNotMatch(launches[0], / -smp /, 'no QEMU option overrides the vCPU count');
});

test('the emulator settles in the foreground after boot and before the first build', () => {
  const boot = lines.findIndex((line) => line.includes('getprop sys.boot_completed'));
  const settle = lines.indexOf('node mobile/scripts/emulator-settle.mjs "$RUNNER_TEMP/ledova-guest-settle.log"');
  const build = lines.indexOf('npx expo prebuild --clean --no-install --platform all');
  assert.ok(boot >= 0, 'the job waits for sys.boot_completed');
  assert.ok(settle > boot, 'the settle runs as its own foreground command after boot completes');
  assert.ok(build > settle, 'the first build starts after the settle');
});
