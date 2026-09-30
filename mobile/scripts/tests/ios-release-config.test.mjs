import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const original = require('../../app.json').expo;
const project = new URL('../../', import.meta.url);
const release = {
  LEDOVA_IOS_RELEASE: '1',
  EXPO_NO_DOTENV: '1',
  LEDOVA_IOS_BUNDLE_ID: 'com.example.register',
  LEDOVA_APPLE_TEAM_ID: 'TESTTEAM01',
  LEDOVA_APP_VERSION: '1.2.3',
  LEDOVA_IOS_BUILD_NUMBER: '62',
  EXPO_PUBLIC_API_URL: 'https://api.example.test',
  EXPO_PUBLIC_MARKETING_URL: 'https://example.test',
};

function resolve(overrides) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write(JSON.stringify(require("./app.config.js")({config:require("./app.json").expo})))'],
      { cwd: project, env: overrides, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}

test('development config is unchanged without explicit release mode', () => {
  assert.deepEqual(resolve({}), original);
  assert.deepEqual(resolve({ LEDOVA_IOS_BUNDLE_ID: release.LEDOVA_IOS_BUNDLE_ID }), original);
});

test('release config changes only the app version and iOS store identity', () => {
  const result = resolve(release);
  assert.deepEqual(result, {
    ...original,
    version: '1.2.3',
    ios: {
      ...original.ios,
      bundleIdentifier: 'com.example.register',
      appleTeamId: 'TESTTEAM01',
      buildNumber: '62',
    },
  });
});

test('missing release inputs and development identities cannot silently ship', () => {
  for (const name of Object.keys(release).filter((name) => name !== 'LEDOVA_IOS_RELEASE')) {
    const env = { ...release };
    delete env[name];
    assert.throws(() => resolve(env), undefined, name);
  }
  assert.throws(() => resolve({ ...release, LEDOVA_IOS_BUNDLE_ID: original.ios.bundleIdentifier }));
});

test('rejects ambiguous versions, teams, build numbers and release flags', () => {
  for (const [name, values] of Object.entries({
    LEDOVA_IOS_RELEASE: ['true', '0'],
    LEDOVA_IOS_BUNDLE_ID: ['org example.app', 'single'],
    LEDOVA_APPLE_TEAM_ID: ['short', 'testteam01'],
    LEDOVA_APP_VERSION: ['1.0', '1.0-beta', ' 1.0.0', '01.0.0'],
    LEDOVA_IOS_BUILD_NUMBER: ['0', '01', '1.2', '10000'],
  })) {
    for (const value of values) assert.throws(() => resolve({ ...release, [name]: value }));
  }
});

test('release endpoints cannot use HTTP, carry credentials, a query or a fragment, or hide whitespace and backslashes', () => {
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_MARKETING_URL']) {
    for (const value of [
      'http://localhost:8000',
      'https://user:password@example.test',
      'https://user@example.test',
      'https://:pw@example.test',
      'https://example.test?token=secret',
      'https://example.test#fragment',
      'https://api.example.test?',
      'https://api.example.test#',
      'https://api.example.test/?#',
      'https://',
      'https://api.example.test/a b',
      'https://api.example.test\\v1',
      'https://api.example.test/\tv1',
      'https://api.example.test/\nv1',
    ]) {
      assert.throws(() => resolve({ ...release, [name]: value }));
    }
  }
});

test('release endpoints keep an ordinary HTTPS URL with a path', () => {
  assert.deepEqual(resolve({ ...release, EXPO_PUBLIC_API_URL: 'https://api.example.test/v1' }), resolve(release));
});

test('release builds refuse development hosts and native diagnostic overrides', () => {
  for (const override of [
    { EXPO_PUBLIC_DEV_API_HOST: '192.168.50.10' },
    { EXPO_PUBLIC_NATIVE_PROBE_TARGET: 'https://example.test' },
  ]) {
    assert.throws(() => resolve({ ...release, ...override }));
  }
});
