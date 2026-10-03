import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { crc32, deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { decodePng, hasContent, minimumContent, screenContent, waitForContent } from '../screen-content.mjs';
import { refuseNotResponding } from '../window-focus.mjs';

const mobile = path.resolve(import.meta.dirname, '../..');
const fixtures = path.join(import.meta.dirname, 'fixtures');
const signIn = path.join(fixtures, 'launch-sign-in.png');
const blackWindow = path.join(fixtures, 'launch-black-window.png');
const launchScreen = path.join(fixtures, 'launch-screen-before-black-window.png');
const paper = [0xf6, 0xf3, 0xec];
const ink = [0x1a, 0x1a, 0x1a];
const layouts = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function predictor(filter, left, up, upLeft) {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) {
    const estimate = left + up - upLeft;
    const distances = [left, up, upLeft].map((value) => Math.abs(estimate - value));
    return [left, up, upLeft][distances.indexOf(Math.min(...distances))];
  }
  return 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

function encodePng(width, height, sample, { colourType = 2, depth = 8, palette, interlace = 0 } = {}) {
  const channels = layouts[colourType];
  const bytesPerPixel = (channels * depth) / 8;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc(height * (stride + 1));
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      sample(x, y).forEach((value, channel) => {
        if (depth === 16) line.writeUInt16BE(value, (x * channels + channel) * 2);
        else line[x * channels + channel] = value;
      });
    }
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let index = 0; index < stride; index++) {
      const left = index >= bytesPerPixel ? line[index - bytesPerPixel] : 0;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      const value = line[index] - predictor(filter, left, previous[index], upLeft);
      raw[y * (stride + 1) + 1 + index] = value & 0xff;
    }
    previous = line;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colourType;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    ...(palette ? [chunk('PLTE', Buffer.from(palette.flat()))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function screen(marked) {
  return encodePng(100, 200, (x, y) => (marked(x, y) ? ink : paper));
}

const hex = ([red, green, blue]) => (red << 16) | (green << 8) | blue;

test('the CI sign-in launch screenshot has content and the black scene-less window has none', () => {
  const launch = screenContent(decodePng(fs.readFileSync(signIn)));
  assert.equal(launch.dominant, '#f6f3ec');
  assert.ok(launch.content > 0.3, `sign-in content ${launch.content}`);
  assert.equal(hasContent(launch), true);
  const black = decodePng(fs.readFileSync(blackWindow));
  const blank = screenContent(black);
  assert.deepEqual([blank.dominant, blank.colours, blank.content], ['#000000', 1, 0]);
  assert.equal(hasContent(blank), false);
  const withStatusBar = screenContent(black, { top: 0, bottom: 1 });
  assert.ok(hasContent(withStatusBar), 'the status bar alone would pass a whole-screen count');
});

test('a plain screen passes with one short mark and a single colour or a speck does not', () => {
  const band = 160 * 100;
  const oneLine = screenContent(decodePng(screen((x, y) => y >= 98 && y < 102 && x >= 40 && x < 44)));
  assert.equal(oneLine.content, 16 / band);
  assert.ok(oneLine.content >= minimumContent && hasContent(oneLine));
  const speck = screenContent(decodePng(screen((x, y) => y >= 100 && y < 102 && x >= 50 && x < 52)));
  assert.equal(hasContent(speck), false);
  const single = screenContent(decodePng(screen(() => false)));
  assert.deepEqual([single.colours, single.content, hasContent(single)], [1, 0, false]);
  const statusBarOnly = screenContent(decodePng(screen((x, y) => y < 20 || y >= 180)));
  assert.equal(hasContent(statusBarOnly), false);
});

test('every PNG filter and the grey, palette, alpha and 16-bit layouts decode to the same pixels', () => {
  let state = 779;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state >>> 24;
  };
  const noise = Array.from({ length: 40 * 40 }, () => [next(), next(), next()]);
  const colour = (x, y) => noise[y * 40 + x];
  const cases = [
    [{ colourType: 2 }, colour],
    [{ colourType: 6 }, (x, y) => [...colour(x, y), 255]],
    [{ colourType: 2, depth: 16 }, (x, y) => colour(x, y).map((value) => value * 257)],
    [{ colourType: 6, depth: 16 }, (x, y) => [...colour(x, y), 255].map((value) => value * 257)],
  ];
  for (const [options, sample] of cases) {
    assert.deepEqual(
      [...decodePng(encodePng(40, 40, sample, options)).pixels],
      noise.map(hex),
      JSON.stringify(options),
    );
  }
  const grey = (x, y) => (x * 29 + y * 17) & 0xff;
  const greys = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) greys.push(hex([grey(x, y), grey(x, y), grey(x, y)]));
  assert.deepEqual([...decodePng(encodePng(7, 9, (x, y) => [grey(x, y)], { colourType: 0 })).pixels], greys);
  assert.deepEqual([...decodePng(encodePng(7, 9, (x, y) => [grey(x, y), 128], { colourType: 4 })).pixels], greys);
  const palette = [paper, ink, [0x2e, 0x6b, 0x57]];
  const indexed = decodePng(encodePng(3, 2, (x) => [x], { colourType: 3, palette }));
  assert.deepEqual([...indexed.pixels], [...palette, ...palette].map(hex));
});

test('unsupported or damaged screenshots fail with a reason instead of passing', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
  assert.throws(() => decodePng(encodePng(4, 4, () => paper, { interlace: 1 })), /Unsupported PNG layout/);
  assert.throws(() => decodePng(encodePng(4, 4, () => [0], { colourType: 3 })), /no PLTE/);
});

test('the launch check needs content on two screenshots in a row, so a launch screen before a black window fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-screen-'));
  const file = path.join(directory, 'ordinary.png');
  const run = async (sequence, attempts) => {
    let captures = 0;
    const capture = async () => fs.copyFileSync(sequence[Math.min(captures++, sequence.length - 1)], file);
    try {
      return { ...(await waitForContent(capture, file, { attempts, interval: 0 })), captures };
    } catch (error) {
      return { error: error.message, captures };
    }
  };
  try {
    assert.equal(hasContent(screenContent(decodePng(fs.readFileSync(launchScreen)))), true);
    const slowLaunch = await run([launchScreen, blackWindow, signIn, signIn], 6);
    assert.deepEqual([slowLaunch.attempt, slowLaunch.dominant, slowLaunch.captures], [4, '#f6f3ec', 4]);
    const quickLaunch = await run([signIn], 6);
    assert.deepEqual([quickLaunch.attempt, quickLaunch.captures], [2, 2]);
    const blackAfterLaunchScreen = await run([launchScreen, blackWindow], 5);
    assert.equal(blackAfterLaunchScreen.captures, 5);
    assert.match(
      blackAfterLaunchScreen.error,
      /ordinary\.png did not show content on 2 screenshots in a row within 5: in the last, 0\.000% of rows 87-787 differ from #000000/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const appFocus = [
  'mCurrentFocus=Window{7d2c1a3 u0 org.example.ledova/org.example.ledova.MainActivity}',
  'mFocusedApp=ActivityRecord{2f9e3c1 u0 org.example.ledova/.MainActivity t12}',
];

function ordinaryLaunch(context, frames, focused = { focus: appFocus }) {
  const source = fs.readFileSync(path.join(mobile, 'scripts/native-smoke.mjs'), 'utf8');
  const start = source.indexOf("  await launch('ordinary');");
  const end = source.indexOf("  if (platform === 'android') {", start);
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-launch-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const events = [];
  let captures = 0;
  const fixture = {
    fs,
    path,
    directory,
    async launch(name) {
      events.push(`launch ${name}`);
    },
    async delay(milliseconds) {
      events.push(`wait ${milliseconds}`);
    },
    async screenshot(name) {
      events.push(`screenshot ${name}`);
      fs.copyFileSync(frames[Math.min(captures++, frames.length - 1)], path.join(directory, `${name}.png`));
    },
    waitForContent: (capture, file, options) => waitForContent(capture, file, { ...options, interval: 0 }),
    markStage(name) {
      events.push(`stage ${name}`);
    },
    focus(name) {
      events.push(`focus ${name}`);
      return focused;
    },
    refuseNotResponding,
  };
  const run = vm.compileFunction(
    `return (async () => { ${source.slice(start, end)} })()`,
    Object.keys(fixture),
  )(...Object.values(fixture));
  return { events, run, record: path.join(directory, 'ordinary-screen.json') };
}

test('the native smoke runner waits ten seconds after launch, fails a black window after twenty screenshots and records a real one', async (context) => {
  const blank = ordinaryLaunch(context, [launchScreen, blackWindow]);
  await assert.rejects(blank.run, /ordinary\.png did not show content on 2 screenshots in a row within 20:/);
  assert.equal(blank.events.filter((event) => event === 'screenshot ordinary').length, 20);
  assert.equal(blank.events.includes('focus ordinary'), false);
  assert.equal(fs.existsSync(blank.record), false);
  const launched = ordinaryLaunch(context, [signIn]);
  await launched.run;
  assert.deepEqual(launched.events, [
    'launch ordinary',
    'wait 10000',
    'screenshot ordinary',
    'screenshot ordinary',
    'stage ordinary-focus',
    'focus ordinary',
  ]);
  const recorded = JSON.parse(fs.readFileSync(launched.record, 'utf8'));
  assert.deepEqual([recorded.dominant, recorded.attempt, recorded.focus], ['#f6f3ec', 2, appFocus]);
});

test('a launch screenshot with content still fails while a SystemUI Application Not Responding window holds focus, and its record is kept', async (context) => {
  const systemUi = [
    'mCurrentFocus=Window{8633492 u0 Application Not Responding: com.android.systemui}',
    'mFocusedApp=ActivityRecord{2f9e3c1 u0 org.example.ledova/.MainActivity t12}',
  ];
  const blocked = ordinaryLaunch(context, [signIn], { focus: systemUi });
  await assert.rejects(
    blocked.run,
    /^Error: ordinary\.png was taken while a system Application Not Responding window for com\.android\.systemui held focus instead of the app: mCurrentFocus=Window\{8633492 u0 Application Not Responding: com\.android\.systemui\}; mFocusedApp=/,
  );
  assert.deepEqual(blocked.events.slice(-2), ['stage ordinary-focus', 'focus ordinary']);
  const recorded = JSON.parse(fs.readFileSync(blocked.record, 'utf8'));
  assert.deepEqual([recorded.dominant, recorded.attempt, recorded.focus], ['#f6f3ec', 2, systemUi]);
  const ios = ordinaryLaunch(context, [signIn], {});
  await ios.run;
  assert.equal(JSON.parse(fs.readFileSync(ios.record, 'utf8')).focus, undefined);
});
