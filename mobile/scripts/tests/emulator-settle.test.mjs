import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { oneMinuteLoad, settle } from '../emulator-settle.mjs';

const helper = path.resolve(import.meta.dirname, '../emulator-settle.mjs');

function emulator(readings, { broadcastSeconds = 5, readSeconds = 1, killOverrun = 0 } = {}) {
  let time = 0;
  const calls = [];
  const lines = [];
  const run = settle({
    now: () => time,
    record: (line) => lines.push(line),
    waitForBroadcasts: async (limit) => {
      calls.push(['broadcast', limit]);
      time += Math.min(broadcastSeconds, limit);
      return ['All broadcast queues are idle!'];
    },
    readLoadavg: async (limit) => {
      calls.push(['read', limit]);
      time += readSeconds <= limit ? readSeconds : limit + killOverrun;
      return readings.length ? readings.shift() : null;
    },
    sleep: async (seconds) => {
      calls.push(['sleep', seconds]);
      time += seconds;
    },
  });
  return run.then((settled) => ({ settled, lines, calls, elapsed: time }));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

test('the 1-minute load accepts only a complete decimal', () => {
  for (const [text, load] of [
    ['3.81 2.00 1.00 1/900 4000', 3.81],
    ['4 1 1 1/1 1', 4],
    ['0.01', 0.01],
  ]) {
    assert.equal(oneMinuteLoad(text), load);
  }
  for (const text of ['.', '1.2.3', '0..4', '', 'unknown', '-1.0', '3.', '.5', '1e1', null, undefined]) {
    assert.equal(oneMinuteLoad(text), null, String(text));
  }
});

test('a valid reading below 4 within the budget settles', async () => {
  const result = await emulator(['9.10 5 2 3/900 4000', '3.20 4 2 1/900 4100']);
  assert.equal(result.settled, true);
  assert.deepEqual(result.lines, [
    'All broadcast queues are idle!',
    'broadcast wait ended after 5s',
    'settled after 17s with 1-minute load 3.2',
  ]);
  assert.deepEqual(result.calls[0], ['broadcast', 120]);
});

test('malformed and unavailable readings never settle and are recorded as unconfirmed, not busy', async () => {
  const unconfirmed = 'not settled within 300s; last reading: unconfirmed (no complete decimal 1-minute load)';
  const malformed = await emulator(Array(60).fill('1.2.3 1 1 1/1 1'));
  assert.equal(malformed.settled, false);
  assert.equal(malformed.lines.at(-1), unconfirmed);
  const unavailable = await emulator([]);
  assert.equal(unavailable.lines.at(-1), unconfirmed);
  assert.ok(unavailable.elapsed <= 300);
});

test('a guest that stays busy ends within the budget with every wait bounded by what is left', async () => {
  const result = await emulator(Array(60).fill('9.00 1 1 1/1 1'), { broadcastSeconds: 120, readSeconds: 10 });
  assert.equal(result.settled, false);
  assert.equal(result.lines.at(-1), 'not settled within 300s; last reading: busy at 1-minute load 9');
  assert.equal(result.elapsed, 300);
  let spent = 0;
  for (const [, limit] of result.calls) {
    assert.ok(limit <= 300 - spent, `a ${limit}s wait exceeded the ${300 - spent}s left`);
    spent += limit;
  }
});

test('a low reading that arrives after the budget is a gap, not settling', async () => {
  const result = await emulator([...Array(9).fill('9.00 1 1 1/1 1'), '1.00 1 1 1/1 1'], {
    broadcastSeconds: 115,
    readSeconds: 10,
    killOverrun: 0.5,
  });
  assert.equal(result.settled, false);
  assert.equal(result.elapsed, 300.5);
  assert.equal(result.lines.at(-1), 'not settled within 300s: a reading (1) arrived after the budget, at 301s');
});

test('interrupting the helper stops its adb command and keeps the start and interruption records', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-settle-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tools = path.join(directory, 'platform-tools');
  fs.mkdirSync(tools);
  const pidFile = path.join(directory, 'adb.pid');
  fs.writeFileSync(path.join(tools, 'adb'), `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`, { mode: 0o755 });
  const log = path.join(directory, 'settle.log');
  const child = spawn(process.execPath, [helper, log], {
    env: { ...process.env, ANDROID_HOME: directory, ANDROID_SERIAL: 'emulator-5556' },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const started = Date.now() + 10000;
  while (!fs.existsSync(pidFile) || !fs.readFileSync(pidFile, 'utf8').trim()) {
    assert.ok(Date.now() < started, 'the fake adb never started');
    await delay(25);
  }
  const adbPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(alive(adbPid), true);
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null });
  const reaped = Date.now() + 5000;
  while (alive(adbPid)) {
    assert.ok(Date.now() < reaped, `adb ${adbPid} survived the interruption`);
    await delay(25);
  }
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^settle started at \d{4}-\d{2}-\d{2}T[\d:.]+Z, after sys\.boot_completed$/);
  assert.match(lines[1], /^interrupted by SIGTERM at \d{4}-\d{2}-\d{2}T[\d:.]+Z; the settle did not complete$/);
});
