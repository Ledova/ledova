import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const source = path.resolve(import.meta.dirname, '../android-evidence.mjs');

function fixture(context, behavior = '') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-android-evidence-')));
  const output = path.join(root, 'records');
  const helper = path.join(root, 'android-evidence.mjs');
  fs.mkdirSync(path.join(root, 'sdk/platform-tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  const runner = fs.readFileSync(source, 'utf8');
  assert.ok(runner.includes('const commandTimeout = 10000;'));
  assert.ok(runner.includes('const collectionTimeout = 120000;'));
  fs.writeFileSync(
    helper,
    runner
      .replace('const commandTimeout = 10000;', 'const commandTimeout = 1000;')
      .replace('const collectionTimeout = 120000;', 'const collectionTimeout = 1800;')
      .replace('60000', '1000'),
  );
  const adb = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVIDENCE_CONTROL_CALLS, JSON.stringify({pid: process.pid, args}) + '\\n');
const command = args.slice(4);
${behavior}
if (command[0] === 'logcat' && !command.includes('-d')) {
  process.stdout.write('BOOT MAIN BUFFER\\n');
  setTimeout(() => process.stdout.write('2026-10-04 I am_anr : [0,123,synthetic.control]\\n'), 40);
  setTimeout(() => process.stdout.write('2026-10-04 I am_anr : [0,124,synthetic.control]\\n'), 80);
  setInterval(() => {}, 1000);
} else if (command[0] === 'shell' && command[1].includes('/proc/loadavg')) {
  process.stdout.write('0.00 0.01 0.02 1/10 123\\ncpu 1 2 3 4 5 6 7 8\\nMemAvailable: 1000 kB\\nSwapFree: 1000 kB\\n');
} else if (command.includes('getprop')) {
  process.stdout.write('[ro.build.fingerprint]: [synthetic.control/image:16/fixture]\\n');
} else if (command.includes('dropbox')) {
  process.stdout.write('system_app_anr complete-record\\nsystem_server_anr complete-record\\nData File: /data/anr/anr_2026-10-04-00-00-00-000\\n');
} else if (command.includes('ls')) {
  process.stdout.write('anr_2026-10-04-00-00-00-000\\n');
} else if (command[0] === 'exec-out' && command[1] === 'cat') {
  process.stdout.write('RAW MATCHING TRACE\\n');
} else if (command.includes('screencap')) {
  process.stdout.write(Buffer.from([137,80,78,71,13,10,26,10]));
} else {
  process.stdout.write('retained ' + command.join(' ') + '\\n');
}
`;
  fs.writeFileSync(path.join(root, 'sdk/platform-tools/adb'), adb, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'bin/nproc'), '#!/bin/sh\nprintf "4\\n"\n', { mode: 0o700 });
  const environment = {
    ...process.env,
    ANDROID_HOME: path.join(root, 'sdk'),
    ANDROID_SERIAL: 'emulator-5556',
    ANDROID_ADB_SERVER_PORT: '5437',
    EVIDENCE_CONTROL_CALLS: path.join(root, 'calls.jsonl'),
    PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
  };
  context.after(() => {
    const calls = path.join(root, 'calls.jsonl');
    if (fs.existsSync(calls)) {
      for (const { pid } of fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse)) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    output,
    helper,
    environment,
    run(mode) {
      const result = spawnSync(process.execPath, [helper, mode, output], {
        env: environment,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result;
    },
    calls() {
      return fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    },
    statuses() {
      return fs
        .readFileSync(path.join(output, 'guest-records-status.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
    },
  };
}

async function waitUntil(check) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await delay(20);
  assert.ok(check(), 'The controlled collector did not reach the expected state.');
}

const waitFor = (file) => waitUntil(() => fs.existsSync(file));

function noLiveGroup(pid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 1000 })
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/));
  assert.ok(!rows.some(([, group, state]) => Number(group) === pid && !state.startsWith('Z')));
  assert.ok(!rows.some(([child]) => Number(child) === pid), 'The direct child must be reaped.');
}

test('early collection streams every buffer, samples immediately and captures only the first ANR without touching an unrelated child', async (context) => {
  const control = fixture(context);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  context.after(() => unrelated.kill());
  const watcher = spawn(process.execPath, [control.helper, 'watch', control.output], {
    env: control.environment,
    stdio: 'pipe',
  });
  const closed = new Promise((resolve) => watcher.once('close', (code) => resolve(code)));
  context.after(() => watcher.kill());
  await waitFor(path.join(control.output, 'watcher-ready.txt'));
  await waitFor(path.join(control.output, 'first-anr.png'));
  await waitFor(path.join(control.output, 'guest-properties.txt'));
  fs.writeFileSync(path.join(control.output, 'watcher-stop.txt'), 'another-watcher');
  await delay(150);
  assert.doesNotThrow(() => process.kill(watcher.pid, 0));
  control.run('stop');
  control.run('stop');
  assert.equal(await closed, 0);
  const calls = control.calls();
  assert.ok(calls.every(({ args }) => args.slice(0, 4).join(' ') === '-P 5437 -s emulator-5556'));
  assert.ok(calls.some(({ args }) => args.includes('main,events,system,crash')));
  assert.ok(calls.some(({ args }) => args.some((arg) => arg.includes('/proc/loadavg'))));
  assert.equal(calls.filter(({ args }) => args.includes('screencap')).length, 1);
  assert.equal(calls.filter(({ args }) => args.includes('displays')).length, 1);
  assert.match(fs.readFileSync(path.join(control.output, 'guest-live.log'), 'utf8'), /BOOT MAIN BUFFER/);
  assert.match(fs.readFileSync(path.join(control.output, 'guest-load.log'), 'utf8'), /MemAvailable: 1000/);
  assert.equal(fs.readFileSync(path.join(control.output, 'host-nproc.txt'), 'utf8'), '4\n');
  assert.match(fs.readFileSync(path.join(control.output, 'guest-properties.txt'), 'utf8'), /ro.build.fingerprint/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(control.output, 'host-identity.json'), 'utf8')).cpus.length > 0);
  for (const { pid } of calls) noLiveGroup(pid);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
});

test('final collection retains complete dropbox and the named raw trace with actual statuses', (context) => {
  const control = fixture(context);
  control.run('collect');
  assert.match(
    fs.readFileSync(path.join(control.output, 'guest-anr-dropbox.txt'), 'utf8'),
    /system_server_anr complete-record/,
  );
  assert.equal(
    fs.readFileSync(path.join(control.output, 'guest-anr-traces/anr_2026-10-04-00-00-00-000.txt'), 'utf8'),
    'RAW MATCHING TRACE\n',
  );
  const summary = JSON.parse(fs.readFileSync(path.join(control.output, 'collection-complete.json'), 'utf8'));
  assert.equal(summary.complete, true);
  assert.ok(summary.results.every(({ code, complete }) => code === 0 && complete));
  assert.ok(control.calls().some(({ args }) => args.slice(-3).join(' ') === 'dumpsys dropbox --print'));
});

test('denied raw traces preserve stderr and a failed collection verdict without replacing native probe acceptance', (context) => {
  const control = fixture(
    context,
    "if (command[0] === 'exec-out' && command[1] === 'cat') { process.stderr.write('Permission denied\\n'); process.exit(13); }",
  );
  control.run('collect');
  const summary = JSON.parse(fs.readFileSync(path.join(control.output, 'collection-complete.json'), 'utf8'));
  assert.equal(summary.complete, false);
  assert.ok(
    summary.results.some(
      ({ file, code, complete }) => file.startsWith('guest-anr-traces/') && code === 13 && !complete,
    ),
  );
  assert.match(
    fs.readFileSync(path.join(control.output, 'guest-anr-traces/anr_2026-10-04-00-00-00-000.txt'), 'utf8'),
    /Permission denied/,
  );
});

test('a timed-out adb command keeps partial output, terminates its descendant and reaps the direct child', (context) => {
  const control = fixture(
    context,
    `if (command.includes('dropbox')) {
process.stdout.write('partial dropbox before timeout\\n');
spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {stdio: 'ignore'});
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
return;
}`,
  );
  control.run('collect');
  const result = control.statuses().find(({ file }) => file === 'guest-anr-dropbox.txt');
  assert.equal(result.timedOut, true);
  assert.equal(result.complete, false);
  assert.equal(result.signal, 'SIGKILL');
  assert.match(
    fs.readFileSync(path.join(control.output, 'guest-anr-dropbox.txt'), 'utf8'),
    /partial dropbox before timeout/,
  );
  noLiveGroup(result.pid);
});

test('SIGTERM stops the live logcat and pending sample, preserves partial evidence and reaps both children', async (context) => {
  const control = fixture(
    context,
    `if (command[0] === 'logcat' || command[1]?.includes('/proc/loadavg')) {
process.stdout.write('partial before cancel\\n');
spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {stdio: 'ignore'});
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
return;
}`,
  );
  const watcher = spawn(process.execPath, [control.helper, 'watch', control.output], {
    env: control.environment,
    stdio: 'pipe',
  });
  let stderr = '';
  watcher.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const closed = new Promise((resolve) => watcher.once('close', (code) => resolve(code)));
  context.after(() => watcher.kill());
  await waitFor(path.join(control.output, 'watcher-ready.txt'));
  await waitFor(path.join(control.root, 'calls.jsonl'));
  await waitUntil(() => control.calls().length >= 2);
  await waitUntil(() =>
    ['guest-live.log', 'guest-load.log'].every((name) =>
      fs.readFileSync(path.join(control.output, name), 'utf8').includes('partial before cancel'),
    ),
  );
  watcher.kill('SIGTERM');
  assert.equal(await closed, 143, stderr);
  assert.match(fs.readFileSync(path.join(control.output, 'guest-live.log'), 'utf8'), /partial before cancel/);
  assert.match(fs.readFileSync(path.join(control.output, 'guest-load.log'), 'utf8'), /partial before cancel/);
  assert.ok(control.statuses().some(({ interrupted, complete }) => interrupted === 'SIGTERM' && !complete));
  for (const { pid } of control.calls()) noLiveGroup(pid);
});
