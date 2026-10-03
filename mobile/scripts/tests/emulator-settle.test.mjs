import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneMinuteLoad, settle } from '../emulator-settle.mjs';

function emulator(readings, { broadcastSeconds = 5, readSeconds = 1, killOverrun = 0 } = {}) {
  let time = 0;
  const calls = [];
  const run = settle({
    now: () => time,
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
  return run.then((result) => ({ ...result, calls, elapsed: time }));
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
  const result = await emulator(Array(60).fill('1.2.3 1 1 1/1 1'));
  assert.equal(result.settled, false);
  assert.equal(
    result.lines.at(-1),
    'not settled within 300s; last reading: unconfirmed (no complete decimal 1-minute load)',
  );
  const unavailable = await emulator([]);
  assert.equal(
    unavailable.lines.at(-1),
    'not settled within 300s; last reading: unconfirmed (no complete decimal 1-minute load)',
  );
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
