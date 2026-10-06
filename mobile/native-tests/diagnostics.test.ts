import { failureCategory, NativeProbeAssertion } from './diagnostics';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { Buffer } from 'buffer';

it('distinguishes an actual assertion from fixed native error categories', () => {
  expect(failureCategory(new NativeProbeAssertion())).toBe('assertion');
  expect(failureCategory({ code: 'ERR_KEY_CHAIN' })).toBe('native-keychain');
  expect(failureCategory({ code: 'ERR_FUNCTION_CALL' })).toBe('native-function');
  expect(failureCategory({ code: 'ERR_VIEW_NOT_FOUND' })).toBe('native-view-not-found');
});

it('never copies secret-bearing messages, arbitrary codes or object values into diagnostics', () => {
  for (const error of [
    new Error('synthetic-secret'),
    { code: 'synthetic-secret', message: 'synthetic-secret', value: 'synthetic-secret' },
    'synthetic-secret',
    null,
    undefined,
  ]) {
    expect(failureCategory(error)).toBe('unknown');
  }
  expect(failureCategory({ code: 'ERR_FUNCTION_CALL', message: 'synthetic-secret' })).toBe('native-function');
});

it('the actual probe retains the fixed failure stage and category while successful controls pass', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const start = source.indexOf('  async function check(');
  const end = source.indexOf('\n  await check(', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const checks: unknown[] = [];
  const check = new Function('checks', 'failureCategory', `${code}\nreturn check;`)(checks, failureCategory) as (
    name: string,
    action: (stage: (name: string) => void) => void,
  ) => Promise<void>;
  await check('synthetic-native-failure', (stage) => {
    stage('initial-sign-out');
    throw { code: 'ERR_FUNCTION_CALL', message: 'synthetic-secret' };
  });
  await check('synthetic-assertion', () => {
    throw new NativeProbeAssertion();
  });
  await check('synthetic-success', () => undefined);
  expect(checks).toEqual([
    {
      name: 'synthetic-native-failure',
      passed: false,
      failure: { category: 'native-function', stage: 'initial-sign-out' },
    },
    { name: 'synthetic-assertion', passed: false, failure: { category: 'assertion', stage: 'check' } },
    { name: 'synthetic-success', passed: true },
  ]);
});

it('the actual document probe supplies portable native arrays with the complete PDF', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const start = source.indexOf("  await check('multipart upload and binary download',");
  const end = source.indexOf('\n  await check(', start + 1);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'documentFixture.json'), 'utf8'));
  const writes: Uint8Array[] = [];
  const stopped = new Error('The native write arguments have been captured.');
  const file = jest.fn().mockImplementation(() => ({
    create: jest.fn(),
    info: () => ({ exists: false }),
    exists: false,
    write: (bytes: Uint8Array) => {
      writes.push(bytes);
      if (writes.length === 2) throw stopped;
    },
  }));
  const stages: string[] = [];
  const check = async (_name: string, action: (stage: (name: string) => void) => Promise<void>) => {
    await expect(action((name) => stages.push(name))).rejects.toBe(stopped);
  };
  await new Function('check', 'Buffer', 'File', 'Paths', 'documentFixture', `return (async () => { ${code} })();`)(
    check,
    Buffer,
    file,
    { cache: 'synthetic-cache' },
    fixture,
  );
  expect(stages.at(-1)).toBe('document-picker-write');
  expect(writes).toHaveLength(2);
  for (const bytes of writes) {
    expect(bytes.constructor.name).toBe('Uint8Array');
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(bytes.length).toBe(fixture.bytes);
    expect(Buffer.from(bytes).toString('base64')).toBe(fixture.base64);
  }
});
