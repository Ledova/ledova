import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';

const [mode, output] = process.argv.slice(2);
assert.ok(['watch', 'stop', 'collect'].includes(mode) && path.isAbsolute(output || ''));
const directory = path.resolve(output);
fs.mkdirSync(directory, { recursive: true });
const serial = process.env.ANDROID_SERIAL;
assert.match(serial || '', /^emulator-\d+$/);
const adb = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
const adbArgs = ['-P', process.env.ANDROID_ADB_SERVER_PORT || '5037', '-s', serial];
const cancellation = new globalThis.AbortController();
const commandTimeout = 10000;
const collectionTimeout = 120000;
const children = new Map();
const results = [];
let interrupted;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = signal;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    cancellation.abort();
  });
}

function status(result) {
  const entry = { timestamp: new Date().toISOString(), ...result };
  results.push(entry);
  fs.appendFileSync(path.join(directory, 'guest-records-status.jsonl'), `${JSON.stringify(entry)}\n`);
  return entry;
}

async function stopChild(child) {
  if (!child.pid) return;
  const closed = children.get(child);
  const liveGroup = () => {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat='], {
      encoding: 'utf8',
      timeout: 1000,
      killSignal: 'SIGKILL',
    })
      .trim()
      .split('\n')
      .map((row) => row.trim().split(/\s+/));
    const members = rows.filter(([, , group, state]) => Number(group) === child.pid && !state.startsWith('Z'));
    assert.ok(
      !members.some(([pid, parent]) => Number(pid) === child.pid && Number(parent) !== process.pid),
      'Refusing to signal an unrelated process leader.',
    );
    return members.length > 0;
  };
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!liveGroup()) break;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH' && !(error.code === 'EPERM' && !liveGroup())) throw error;
    }
    if (signal === 'SIGTERM') await Promise.race([closed, delay(2000, undefined, { ref: false })]);
  }
  await Promise.race([
    closed,
    delay(2000, undefined, { ref: false }).then(() => {
      throw new Error('An owned evidence child did not close.');
    }),
  ]);
  const deadline = Date.now() + 2000;
  while (liveGroup() && Date.now() < deadline) await delay(50);
  assert.ok(!liveGroup(), 'An owned evidence child group did not stop.');
}

async function record(file, executable, args, timeout = commandTimeout, onLine) {
  const destination = path.join(directory, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const descriptor = fs.openSync(destination, 'a');
  if (cancellation.signal.aborted) {
    fs.closeSync(descriptor);
    return status({ file, executable, args, started: false, complete: false, interrupted });
  }
  const child = spawn(executable, args, {
    detached: true,
    stdio: ['ignore', onLine ? 'pipe' : descriptor, descriptor],
  });
  let failure;
  let timedOut = false;
  let pending = '';
  child.once('error', (error) => {
    failure = error.code;
  });
  if (onLine) {
    child.stdout.on('data', (chunk) => {
      fs.writeSync(descriptor, chunk);
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) onLine(line);
    });
  }
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  children.set(child, closed);
  let stopping;
  const stop = () => {
    stopping ||= stopChild(child);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeout);
  cancellation.signal.addEventListener('abort', stop, { once: true });
  try {
    const { code, signal } = await closed;
    await (stopping || stopChild(child));
    return status({
      file,
      executable,
      args,
      pid: child.pid,
      code,
      signal,
      failure,
      timedOut,
      interrupted,
      complete: code === 0 && !failure && !timedOut && !cancellation.signal.aborted,
    });
  } finally {
    clearTimeout(timer);
    cancellation.signal.removeEventListener('abort', stop);
    children.delete(child);
    fs.closeSync(descriptor);
  }
}

const guest = (file, args, timeout, onLine) => record(file, adb, [...adbArgs, ...args], timeout, onLine);

async function watch() {
  const id = randomUUID();
  const lease = path.join(directory, 'watcher.json');
  assert.ok(!fs.existsSync(lease), 'Use a fresh evidence directory.');
  fs.writeFileSync(lease, JSON.stringify({ id, pid: process.pid }));
  fs.writeFileSync(
    path.join(directory, 'host-identity.json'),
    JSON.stringify(
      { cpus: os.cpus(), availableParallelism: os.availableParallelism(), platform: os.platform() },
      null,
      2,
    ),
  );
  let firstAnr;
  const live = guest(
    'guest-live.log',
    ['logcat', '-b', 'main,events,system,crash', '-v', 'UTC', '-v', 'year'],
    55 * 60 * 1000,
    (line) => {
      if (firstAnr || !/\bam_anr\s*:/.test(line)) return;
      fs.writeFileSync(path.join(directory, 'first-anr-event.txt'), `${line}\n`);
      firstAnr = Promise.all([
        guest('first-anr-window.txt', ['shell', 'dumpsys', 'window', 'displays']),
        guest('first-anr.png', ['exec-out', 'screencap', '-p']),
      ]);
    },
  );
  const samples = (async () => {
    while (!cancellation.signal.aborted) {
      fs.appendFileSync(path.join(directory, 'guest-load.log'), `== ${new Date().toISOString()}\n`);
      await guest('guest-load.log', [
        'shell',
        'set -e; cat /proc/loadavg; head -n 1 /proc/stat; grep -E "^(MemAvailable|SwapFree):" /proc/meminfo',
      ]);
      await delay(30000, undefined, { signal: cancellation.signal }).catch(() => {});
    }
  })();
  fs.writeFileSync(path.join(directory, 'watcher-ready.txt'), id);
  const stopTimer = setInterval(() => {
    const request = path.join(directory, 'watcher-stop.txt');
    if (fs.existsSync(request) && fs.readFileSync(request, 'utf8') === id) cancellation.abort();
  }, 100);
  const deadline = setTimeout(
    () => {
      status({ collectorDeadline: true, complete: false });
      cancellation.abort();
    },
    55 * 60 * 1000,
  );
  try {
    await Promise.all([record('host-nproc.txt', 'nproc', []), guest('guest-properties.txt', ['shell', 'getprop'])]);
    await live;
    if (!cancellation.signal.aborted) {
      status({ liveStreamEnded: true, complete: false });
      cancellation.abort();
    }
    await samples;
    await firstAnr;
  } finally {
    cancellation.abort();
    clearInterval(stopTimer);
    clearTimeout(deadline);
    await Promise.all([live, samples, firstAnr]);
    fs.writeFileSync(
      path.join(directory, 'watcher-complete.json'),
      JSON.stringify({ id, interrupted, results }, null, 2),
    );
  }
}

async function stop() {
  const lease = path.join(directory, 'watcher.json');
  if (!fs.existsSync(lease)) {
    status({ watcherMissing: true, complete: false });
    return;
  }
  const { id } = JSON.parse(fs.readFileSync(lease, 'utf8'));
  fs.writeFileSync(path.join(directory, 'watcher-stop.txt'), id);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const completed = path.join(directory, 'watcher-complete.json');
    if (fs.existsSync(completed) && JSON.parse(fs.readFileSync(completed, 'utf8')).id === id) return;
    await delay(100);
  }
  throw new Error('The owned evidence watcher did not finish cleanup.');
}

async function collect() {
  const deadline = setTimeout(() => cancellation.abort(), collectionTimeout);
  let remainingTraces = [];
  try {
    await guest('guest-anr-dropbox.txt', ['shell', 'dumpsys', 'dropbox', '--print'], 60000);
    await guest('guest-last-anr.txt', ['shell', 'dumpsys', 'window', 'lastanr']);
    await guest('guest-events.log', ['logcat', '-d', '-b', 'events', '-v', 'UTC', '-v', 'year']);
    await guest('guest-system.log', ['logcat', '-d', '-b', 'system,crash', '-v', 'UTC', '-v', 'year']);
    await guest('guest-anr-index.txt', ['shell', 'ls', '-1', '/data/anr']);
    const index = fs.readFileSync(path.join(directory, 'guest-anr-index.txt'), 'utf8');
    const dropbox = fs.readFileSync(path.join(directory, 'guest-anr-dropbox.txt'), 'utf8');
    remainingTraces = [
      ...new Set([
        ...index.split('\n').filter((name) => /^anr_[\w.-]+$/.test(name)),
        ...[...dropbox.matchAll(/Data File: \/data\/anr\/(anr_[\w.-]+)/g)].map((match) => match[1]),
      ]),
    ];
    while (remainingTraces.length && !cancellation.signal.aborted) {
      const name = remainingTraces.shift();
      await guest(`guest-anr-traces/${name}.txt`, ['exec-out', 'cat', `/data/anr/${name}`]);
    }
  } finally {
    clearTimeout(deadline);
    fs.writeFileSync(
      path.join(directory, 'collection-complete.json'),
      JSON.stringify(
        {
          complete: results.every((result) => result.complete) && !cancellation.signal.aborted,
          interrupted,
          deadlineExpired: cancellation.signal.aborted && !interrupted,
          remainingTraces,
          results,
        },
        null,
        2,
      ),
    );
  }
}

await { watch, stop, collect }[mode]();
