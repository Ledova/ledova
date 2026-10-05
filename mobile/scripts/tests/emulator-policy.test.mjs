import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const workflow = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/mobile-native.yml'),
  'utf8',
);
const android = workflow.slice(workflow.indexOf('\n  android:\n'), workflow.indexOf('\n  ios:\n'));

function commands(name) {
  const step = android.split('\n      - name: ').find((candidate) => candidate.startsWith(`${name}\n`));
  assert.ok(step, `the Android job retains ${name}`);
  const lines = step.split('\n');
  const start = lines.findIndex((line) => line === '        run: |');
  assert.ok(start >= 0, `${name} retains its shell commands`);
  return lines
    .slice(start + 1)
    .filter((line) => line.startsWith('          '))
    .map((line) => line.slice(10))
    .join('\n');
}

function observe() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-emulator-policy-'));
  const bin = path.join(directory, 'bin');
  const sdk = path.join(directory, 'sdk');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(sdk, 'emulator'), { recursive: true });
  fs.mkdirSync(path.join(sdk, 'cmdline-tools/latest/bin'), { recursive: true });
  fs.mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
  const executable = (file, script) => fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${script}\n`, { mode: 0o755 });
  executable(path.join(sdk, 'emulator/emulator'), 'printf "launch %s\\n" "$*" >> "$POLICY_EVENTS"');
  for (const tool of ['sdkmanager', 'avdmanager']) {
    executable(path.join(sdk, `cmdline-tools/latest/bin/${tool}`), 'cat >/dev/null');
  }
  for (const tool of ['sudo', 'vmstat']) executable(path.join(bin, tool), 'exit 0');
  executable(path.join(bin, 'timeout'), 'shift\nexec "$@"');
  executable(
    path.join(sdk, 'platform-tools/adb'),
    'case "$*" in\n*"getprop sys.boot_completed"*) printf "boot\\n" >> "$POLICY_EVENTS"; touch "$POLICY_BOOT"; printf "1\\n";;\nesac',
  );
  executable(
    path.join(bin, 'node'),
    'case "$1" in\n*android-evidence.mjs) mkdir -p "$3"; touch "$3/watcher-ready.txt";;\n*emulator-settle.mjs) test -f "$POLICY_BOOT"; printf "settle-start\\n" >> "$POLICY_EVENTS"; sleep 0.2; touch "$POLICY_SETTLED"; printf "settle-end\\n" >> "$POLICY_EVENTS";;\nesac',
  );
  executable(
    path.join(bin, 'npx'),
    'test "$1" = expo\ntest "$2" = prebuild\ntest -f "$POLICY_BOOT"\ntest -f "$POLICY_SETTLED"\nprintf "build\\n" >> "$POLICY_EVENTS"',
  );
  const events = path.join(directory, 'events');
  const script = [
    'set -euo pipefail',
    commands('Install native tools and prepare the emulator'),
    commands('Generate and check Debug and Release policy'),
    'wait',
  ].join('\n');
  try {
    const result = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        ANDROID_HOME: sdk,
        ANDROID_SERIAL: 'emulator-5556',
        ANDROID_AVD_HOME: path.join(directory, 'avd'),
        ANDROID_USER_HOME: path.join(directory, 'android-user'),
        JAVA_HOME_21_X64: path.join(directory, 'java21'),
        JAVA_HOME_17_X64: path.join(directory, 'java17'),
        RUNNER_TEMP: directory,
        GITHUB_ENV: path.join(directory, 'github-env'),
        GITHUB_PATH: path.join(directory, 'github-path'),
        POLICY_EVENTS: events,
        POLICY_BOOT: path.join(directory, 'boot'),
        POLICY_SETTLED: path.join(directory, 'settled'),
      },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(events, 'utf8').trim().split('\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('the Android shell actually launches exactly one owned emulator', () => {
  const launches = observe().filter((event) => event.startsWith('launch '));
  assert.equal(launches.length, 1);
  assert.match(launches[0], / -avd ledova_native(?: |$)/);
});

test('the actual emulator command keeps at least four vCPUs', () => {
  const launches = observe().filter((event) => event.startsWith('launch '));
  assert.equal(launches.length, 1);
  const cores = launches[0].match(/ -cores (\d+)(?: |$)/);
  assert.ok(cores, 'the launch names its vCPU count');
  assert.ok(Number(cores[1]) >= 4, `the launch gives the emulator ${cores[1]} vCPUs`);
});

test('the Android shell waits for boot and foreground settling before its first build', () => {
  const events = observe().filter((event) => !event.startsWith('launch '));
  assert.deepEqual(events, ['boot', 'settle-start', 'settle-end', 'build']);
});
