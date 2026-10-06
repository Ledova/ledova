import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import vm from 'node:vm';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { test } from 'node:test';

const mobile = path.resolve(import.meta.dirname, '../..');

function report(phase) {
  return {
    checks: [
      ...Array.from({ length: 12 }, (_, index) => ({ name: `synthetic control ${index}`, passed: true })),
      { name: 'native 307 refusal', passed: phase === 'green' },
      { name: 'native 308 refusal', passed: phase === 'green' },
    ],
    counts: {
      redirectTarget: phase === 'red' ? 2 : 0,
      redirectBody: phase === 'red' ? 2 : 0,
      redirectBearer: 0,
      direct: 1,
      targetControl: 1,
      upload: 1,
      download: 1,
      stream: 1,
      cancelled: 1,
      http: 0,
      untrusted: 0,
    },
  };
}

async function phaseFixture(context, greenCommand, { resetFailure, screenshot } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-phase-report-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(mobile, 'scripts/native-smoke.mjs'), 'utf8');
  const start = source.indexOf('  for (const [name, source] of [');
  const end = source.indexOf("  console.log('Native Release probe passed", start);
  assert.ok(start > 0 && end > start);
  const serverReport = path.join(directory, 'server/result.json');
  fs.mkdirSync(path.dirname(serverReport));
  const phases = [];
  let resets = 0;
  const fixture = {
    assert,
    fs,
    path,
    directory,
    platform: 'android',
    bad: 'synthetic red source',
    correct: 'synthetic green source',
    nativeSource: path.join(directory, 'native-source'),
    endpoints: { apiUrl: 'https://localhost.invalid' },
    environment: {},
    ca: 'synthetic CA',
    adb: 'synthetic adb',
    adbArgs: [],
    appPath: 'synthetic apk',
    markStage() {},
    async localRequest(url, route) {
      assert.equal(route, '/reset');
      resets++;
      if (resets === 2 && resetFailure) throw resetFailure;
      fs.rmSync(serverReport, { force: true });
    },
    async build() {},
    archiveAndroidArtifact() {},
    async launch() {},
    async command(file, args, name) {
      const phase = name === 'scanner-release-red' ? 'red' : 'green';
      phases.push(phase);
      if (phase === 'green') await greenCommand({ directory, serverReport });
      else {
        fs.writeFileSync(serverReport, JSON.stringify(report('red')));
        fs.writeFileSync(path.join(directory, `${name}.log`), 'OK (1 test)');
      }
    },
    collectScannerEvidence() {},
    async waitFor(filename) {
      return JSON.parse(fs.readFileSync(filename, 'utf8'));
    },
    async delay() {},
    async screenshot() {
      await screenshot?.({ serverReport });
    },
  };
  return {
    directory,
    phases,
    run: () =>
      vm.compileFunction(
        `return (async () => { ${source.slice(start, end)} })()`,
        Object.keys(fixture),
      )(...Object.values(fixture)),
  };
}

test('a failed green instrumentation assertion preserves its report separately from red', async (context) => {
  const failed = report('green');
  failed.checks.push({
    name: 'Android scanner window bridge',
    passed: false,
    failure: { category: 'assertion', stage: 'method-native-function' },
  });
  const fixture = await phaseFixture(context, ({ directory, serverReport }) => {
    fs.writeFileSync(serverReport, JSON.stringify(failed));
    fs.writeFileSync(path.join(directory, 'scanner-release-green.log'), 'FAILURES!!!');
  });
  await assert.rejects(fixture.run(), /OK/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.directory, 'native-green.json'), 'utf8')), failed);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.directory, 'native-red.json'), 'utf8')), report('red'));
  assert.deepEqual(fixture.phases, ['red', 'green']);
});

test('a failed instrumentation command preserves the posted report and original failure', async (context) => {
  const failure = new Error('Synthetic instrumentation command failed.');
  const fixture = await phaseFixture(context, ({ serverReport }) => {
    fs.writeFileSync(serverReport, JSON.stringify(report('green')));
    throw failure;
  });
  await assert.rejects(fixture.run(), (error) => error === failure);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(fixture.directory, 'native-green.json'), 'utf8')),
    report('green'),
  );
});

test('a missing green report cannot be replaced with the prior red report', async (context) => {
  const failure = new Error('Synthetic command failed before reporting.');
  const fixture = await phaseFixture(context, () => {
    throw failure;
  });
  await assert.rejects(fixture.run(), (error) => error === failure);
  assert.equal(fs.existsSync(path.join(fixture.directory, 'native-green.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.directory, 'native-red.json'), 'utf8')), report('red'));
});

test('a failed green reset cannot label the retained server red report as green', async (context) => {
  const failure = new Error('Synthetic reset failed.');
  const fixture = await phaseFixture(context, () => assert.fail('Green instrumentation must not run.'), {
    resetFailure: failure,
  });
  await assert.rejects(fixture.run(), (error) => error === failure);
  assert.equal(fs.existsSync(path.join(fixture.directory, 'native-green.json')), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(fixture.directory, 'server/result.json'), 'utf8')),
    report('red'),
  );
  assert.deepEqual(fixture.phases, ['red']);
});

test('successful red and green phases retain both reports and their existing assertions', async (context) => {
  const fixture = await phaseFixture(context, ({ directory, serverReport }) => {
    fs.writeFileSync(serverReport, JSON.stringify(report('green')));
    fs.writeFileSync(path.join(directory, 'scanner-release-green.log'), 'OK (1 test)');
  });
  await fixture.run();
  for (const phase of ['red', 'green']) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture.directory, `native-${phase}.json`), 'utf8')),
      report(phase),
    );
  }
  assert.deepEqual(fixture.phases, ['red', 'green']);
});

test('a later server report cannot replace the snapshot actually evaluated by a phase', async (context) => {
  const fixture = await phaseFixture(
    context,
    ({ directory, serverReport }) => {
      fs.writeFileSync(serverReport, JSON.stringify(report('green')));
      fs.writeFileSync(path.join(directory, 'scanner-release-green.log'), 'OK (1 test)');
    },
    {
      screenshot({ serverReport }) {
        fs.writeFileSync(serverReport, JSON.stringify({ checks: [], counts: {} }));
      },
    },
  );
  await fixture.run();
  for (const phase of ['red', 'green']) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(fixture.directory, `native-${phase}.json`), 'utf8')),
      report(phase),
    );
  }
});

async function serverFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-server-report-'));
  const child = spawn(process.execPath, [path.join(mobile, 'scripts/native-probe-server.mjs'), directory, 'ios'], {
    stdio: 'ignore',
  });
  const closed = once(child, 'close');
  context.after(async () => {
    const forced = setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    child.kill('SIGTERM');
    try {
      await closed;
    } finally {
      clearTimeout(forced);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const config = path.join(directory, 'config.json');
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(config) && child.exitCode === null && Date.now() < deadline) await delay(20);
  assert.ok(fs.existsSync(config), 'Synthetic report server must become ready.');
  const { apiUrl } = JSON.parse(fs.readFileSync(config, 'utf8'));
  const ca = fs.readFileSync(path.join(directory, 'ca.pem'));
  return {
    result: () => JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8')),
    async post(payload) {
      return await new Promise((resolve, reject) => {
        const request = https.request(`${apiUrl}/report`, { method: 'POST', ca, timeout: 2000 }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('timeout', () => request.destroy(new Error('Synthetic report request timed out.')));
        request.on('error', reject);
        request.end(JSON.stringify(payload));
      });
    },
  };
}

test('the report server retains only allowlisted failure category and stage values', async (context) => {
  const server = await serverFixture(context);
  const check = {
    name: 'Android scanner window bridge',
    passed: false,
    failure: {
      category: 'assertion',
      stage: 'method-native-function',
      message: 'synthetic-secret',
      provider: 'synthetic-secret',
      stack: 'synthetic-secret',
      credential: { value: 'synthetic-secret' },
    },
  };
  assert.equal(await server.post({ checks: [check], ignored: 'synthetic-secret' }), 200);
  assert.deepEqual(server.result().checks, [
    { name: check.name, passed: false, failure: { category: 'assertion', stage: 'method-native-function' } },
  ]);
  assert.ok(!JSON.stringify(server.result()).includes('synthetic-secret'));
  const controls = [
    { name: 'native 307 refusal', passed: false, failure: { category: 'assertion', stage: 'check' } },
    { name: 'native 308 refusal', passed: false, failure: { category: 'assertion', stage: 'check' } },
    { name: 'native entropy and mnemonic', passed: true },
    {
      name: 'legacy session migration and ordinary storage',
      passed: false,
      failure: { category: 'native-function', stage: 'initial-sign-out' },
    },
    { name: 'sign-out removes the native session', passed: false },
    {
      name: 'Android scanner window bridge',
      passed: false,
      failure: { category: 'native-view-not-found', stage: 'method-native-view-not-found' },
    },
  ];
  assert.equal(await server.post({ checks: controls }), 200);
  assert.deepEqual(server.result().checks, controls);
  for (const category of ['native-keychain', 'unknown']) {
    const control = {
      name: 'sign-out removes the native session',
      passed: false,
      failure: { category, stage: 'signed-out-session-read' },
    };
    assert.equal(await server.post({ checks: [control] }), 200);
    assert.deepEqual(server.result().checks, [control]);
  }
  for (const failure of [
    { category: 'synthetic-secret', stage: 'check' },
    { category: 'unknown', stage: 'synthetic-secret' },
    { category: null, stage: ['check'] },
    'synthetic-secret',
  ]) {
    assert.equal(await server.post({ checks: [{ name: check.name, passed: false, failure }] }), 200);
    assert.deepEqual(server.result().checks, [{ name: check.name, passed: false }]);
    assert.ok(!JSON.stringify(server.result()).includes('synthetic-secret'));
  }
  assert.equal(await server.post({ checks: [{ ...check, passed: true }] }), 200);
  assert.deepEqual(server.result().checks, [{ name: check.name, passed: true }]);
});

async function publication(filename) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-probe-publication-')));
  const output = path.join(root, 'results');
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'native-tests'));
  fs.copyFileSync(
    path.join(mobile, 'native-tests/documentFixture.json'),
    path.join(root, 'native-tests/documentFixture.json'),
  );
  fs.copyFileSync(path.join(mobile, 'app.json'), path.join(root, 'app.json'));
  for (const module of ['android-test-packages.mjs', 'screen-content.mjs', 'window-focus.mjs']) {
    fs.copyFileSync(path.join(mobile, 'scripts', module), path.join(root, 'scripts', module));
  }
  let server = fs.readFileSync(path.join(mobile, 'scripts/native-probe-server.mjs'), 'utf8');
  const created = 'fs.mkdirSync(directory, { recursive: true });';
  assert.ok(server.includes(created));
  server = server.replace(
    created,
    `${created}
const actualWrite = fs.writeFileSync;
fs.writeFileSync = (target, ...args) => {
  if (path.basename(target).replace(/\\.tmp$/, '') === ${JSON.stringify(filename)}) {
    actualWrite(target, '');
    actualWrite(target + '.opened', String(process.pid));
    const deadline = Date.now() + 90000;
    while (!fs.existsSync(target + '.release')) {
      if (Date.now() >= deadline) throw new Error('Synthetic publication was not released.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return actualWrite(target, ...args);
};`,
  );
  fs.writeFileSync(path.join(root, 'scripts/native-probe-server.mjs'), server);
  let runner = fs.readFileSync(path.join(mobile, 'scripts/native-smoke.mjs'), 'utf8');
  const boundary = "  const ca = fs.readFileSync(path.join(directory, 'server/ca.pem'));";
  assert.ok(runner.includes(boundary));
  runner = runner.replace(
    boundary,
    `
  const checks = [{ name: 'direct', passed: true }, { name: 'native 307 refusal', passed: false,
    failure: { category: 'assertion', stage: 'check' } }];
  const posted = new Promise((resolve, reject) => {
    const request = http.request(new URL('/report', endpoints.httpUrl), { method: 'POST' }, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('error', reject);
    request.end(JSON.stringify({ checks }));
  });
  const report = await waitFor(path.join(directory, 'server/result.json'), 120000, server);
  await posted;
  fs.writeFileSync(path.join(directory, 'publication-proof.json'), JSON.stringify({ endpoints, report }));
  throw new Error('Synthetic publication checks passed.');
${boundary}`,
  );
  fs.writeFileSync(path.join(root, 'scripts/native-smoke.mjs'), runner);
  const child = spawn(process.execPath, [path.join(root, 'scripts/native-smoke.mjs'), 'ios', output], {
    cwd: root,
    env: { ...process.env, IOS_SIMULATOR_UDID: 'synthetic-publication-control' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.resume();
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  let opened;
  try {
    const deadline = Date.now() + 90000;
    while (!opened) {
      opened = [filename, `${filename}.tmp`]
        .map((name) => path.join(output, 'server', `${name}.opened`))
        .find((name) => fs.existsSync(name));
      if (opened) break;
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, `Timed out waiting for the actual ${filename} writer.`);
      await delay(20);
    }
    assert.equal(
      fs.existsSync(path.join(output, 'server', filename)),
      false,
      `${filename} became visible before the actual writer completed it.`,
    );
    fs.writeFileSync(opened.replace(/\.opened$/, '.release'), 'continue');
    assert.equal(await done, 1, stderr);
    assert.match(stderr, /Synthetic publication checks passed\./);
    assert.doesNotMatch(stderr, /Unexpected end of JSON input/);
    const proof = JSON.parse(fs.readFileSync(path.join(output, 'publication-proof.json'), 'utf8'));
    for (const key of ['apiUrl', 'targetUrl', 'httpUrl', 'untrustedUrl']) {
      assert.ok(new URL(proof.endpoints[key]).port);
    }
    assert.deepEqual(proof.report.checks, [
      { name: 'direct', passed: true },
      { name: 'native 307 refusal', passed: false, failure: { category: 'assertion', stage: 'check' } },
    ]);
    assert.equal(proof.report.counts.http, 1);
  } finally {
    if (opened) fs.writeFileSync(opened.replace(/\.opened$/, '.release'), 'continue');
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await done;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const filename of ['config.json', 'result.json']) {
  test(`${filename} stays unpublished until complete, then the actual probe reader consumes it`, async () => {
    await publication(filename);
  });
}
