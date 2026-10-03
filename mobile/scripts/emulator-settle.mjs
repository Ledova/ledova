import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const decimal = /^\d+(\.\d+)?$/;
const interruptions = { SIGTERM: 143, SIGINT: 130 };

export function oneMinuteLoad(loadavg) {
  const first = String(loadavg ?? '')
    .trim()
    .split(/\s+/)[0];
  return decimal.test(first) ? Number(first) : null;
}

export async function settle({
  now,
  record,
  waitForBroadcasts,
  readLoadavg,
  sleep,
  budget = 300,
  broadcast = 120,
  poll = 10,
  threshold = 4,
}) {
  const start = now();
  const elapsed = () => now() - start;
  const left = () => budget - elapsed();
  const seconds = () => Math.round(elapsed());
  for (const line of await waitForBroadcasts(Math.min(broadcast, left()))) record(line);
  record(`broadcast wait ended after ${seconds()}s`);
  let last = 'none';
  while (left() > 0) {
    const load = oneMinuteLoad(await readLoadavg(Math.min(poll, left())));
    if (elapsed() > budget) {
      record(
        `not settled within ${budget}s: a reading (${load ?? 'unconfirmed'}) arrived after the budget, at ${seconds()}s`,
      );
      return false;
    }
    if (load !== null && load < threshold) {
      record(`settled after ${seconds()}s with 1-minute load ${load}`);
      return true;
    }
    last = load === null ? 'unconfirmed (no complete decimal 1-minute load)' : `busy at 1-minute load ${load}`;
    const pause = Math.min(poll, left());
    if (pause > 0) await sleep(pause);
  }
  record(`not settled within ${budget}s; last reading: ${last}`);
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [log] = process.argv.slice(2);
  const adb = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
  const write = (line) => fs.appendFileSync(log, `${line}\n`);
  const children = new Set();
  const stop = (child) => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const run = (args, seconds) =>
    new Promise((resolve) => {
      const child = spawn(adb, ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      children.add(child);
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      const deadline = setTimeout(() => stop(child), Math.max(1, Math.floor(seconds * 1000)));
      child.once('error', (error) => {
        clearTimeout(deadline);
        children.delete(child);
        resolve({ output, status: error.code });
      });
      child.once('close', (code, signal) => {
        clearTimeout(deadline);
        children.delete(child);
        resolve({ output, status: signal ?? code });
      });
    });
  for (const [signal, code] of Object.entries(interruptions)) {
    process.once(signal, () => {
      for (const child of children) stop(child);
      write(`interrupted by ${signal} at ${new Date().toISOString()}; the settle did not complete`);
      process.exit(code);
    });
  }
  write(`settle started at ${new Date().toISOString()}, after sys.boot_completed`);
  await settle({
    now: () => performance.now() / 1000,
    record: write,
    waitForBroadcasts: async (seconds) => {
      const { output, status } = await run(['am', 'wait-for-broadcast-idle'], seconds);
      const lines = output.trim() ? output.trim().split('\n') : [];
      return status === 0 ? lines : [...lines, `wait-for-broadcast-idle did not finish: ${status}`];
    },
    readLoadavg: async (seconds) => {
      const { output, status } = await run(['cat', '/proc/loadavg'], seconds);
      return status === 0 ? output : null;
    },
    sleep: (seconds) => delay(seconds * 1000),
  });
  write(`settle ended at ${new Date().toISOString()}`);
}
