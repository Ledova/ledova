import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const decimal = /^\d+(\.\d+)?$/;

export function oneMinuteLoad(loadavg) {
  const first = String(loadavg ?? '')
    .trim()
    .split(/\s+/)[0];
  return decimal.test(first) ? Number(first) : null;
}

export async function settle({
  now,
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
  const lines = [...(await waitForBroadcasts(Math.min(broadcast, left())))];
  lines.push(`broadcast wait ended after ${seconds()}s`);
  let last = 'none';
  while (left() > 0) {
    const load = oneMinuteLoad(await readLoadavg(Math.min(poll, left())));
    if (elapsed() > budget) {
      lines.push(
        `not settled within ${budget}s: a reading (${load ?? 'unconfirmed'}) arrived after the budget, at ${seconds()}s`,
      );
      return { settled: false, lines };
    }
    if (load !== null && load < threshold) {
      lines.push(`settled after ${seconds()}s with 1-minute load ${load}`);
      return { settled: true, lines };
    }
    last = load === null ? 'unconfirmed (no complete decimal 1-minute load)' : `busy at 1-minute load ${load}`;
    const pause = Math.min(poll, left());
    if (pause > 0) await sleep(pause);
  }
  lines.push(`not settled within ${budget}s; last reading: ${last}`);
  return { settled: false, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [log] = process.argv.slice(2);
  const adb = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
  const run = (args, seconds) =>
    execFileSync(adb, ['-s', process.env.ANDROID_SERIAL, 'shell', ...args], {
      encoding: 'utf8',
      timeout: Math.max(1, Math.floor(seconds * 1000)),
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const began = new Date().toISOString();
  const result = await settle({
    now: () => Date.now() / 1000,
    waitForBroadcasts: async (seconds) => {
      try {
        return run(['am', 'wait-for-broadcast-idle'], seconds).trim().split('\n');
      } catch (error) {
        const partial = String(error.stdout ?? '').trim();
        return [
          ...(partial ? partial.split('\n') : []),
          `wait-for-broadcast-idle did not finish: ${error.code ?? error.signal ?? error.status}`,
        ];
      }
    },
    readLoadavg: async (seconds) => {
      try {
        return run(['cat', '/proc/loadavg'], seconds);
      } catch {
        return null;
      }
    },
    sleep: (seconds) => delay(seconds * 1000),
  });
  fs.writeFileSync(
    log,
    [`boot completed at ${began}`, ...result.lines, `settle ended at ${new Date().toISOString()}`].join('\n') + '\n',
  );
}
