import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkClientOperations } from '../check-client-operations.mjs';
const good = { responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } } };
const client =
  "import axios, { AxiosError, AxiosHeaders, type AxiosInstance } from 'axios'; const client = axios.create();\n";

async function fixture(t, sources, paths) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledova-client-operations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(sources)) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  return checkClientOperations(root, { paths });
}

test('Axios symbols retain renamed parameters, imports and endpoint functions across modules', async (t) => {
  const result = await fixture(
    t,
    {
      'packages/shared/src/index.ts': "export { ENDPOINTS } from './endpoints';",
      'packages/shared/src/endpoints.ts':
        'export const ENDPOINTS = { DETAIL: (uuid: string) => `/api/items/${uuid}/` } as const;',
      'dashboard/src/service.ts':
        client +
        "import { ENDPOINTS as URLS } from '@ledova/shared'; export function read(renamed: AxiosInstance, id: string) { return renamed.get(URLS.DETAIL(id)); }",
      'mobile/src/service.ts':
        client + "client.post('/api/items/'); client['patch'](`/api/items/${'selected'}/?ignored=yes`);",
    },
    { '/api/items/{uuid}/': { get: good }, '/api/items/': { post: good }, '/api/items/selected/': { patch: good } },
  );
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    result.operations.map(({ method, path: url }) => [method, url]),
    [
      ['get', '/api/items/{}/'],
      ['post', '/api/items/'],
      ['patch', '/api/items/selected/'],
    ],
  );
});

test('missing paths and wrong verbs identify the actual untyped caller', async (t) => {
  const result = await fixture(
    t,
    { 'mobile/src/service.ts': client + "client.delete('/api/items/'); client.get('/missing/');" },
    { '/api/items/': { get: good } },
  );
  assert.equal(result.failures.length, 2);
  assert.match(result.failures.join('\n'), /mobile\/src\/service.ts:2: DELETE \/api\/items\//);
  assert.match(result.failures.join('\n'), /GET \/missing\//);
});

test('new unresolved Axios paths/configs, reassigned URLs, indirect methods and fetch fail visibly', async (t) => {
  const result = await fixture(
    t,
    {
      'mobile/src/service.ts':
        client +
        [
          "client.get('/api/items/');",
          'export function dynamic(destination: string) { client.get(destination); client.request({url: destination}); }',
          "let destination = '/api/items/'; destination = globalThis.location.href; client.get(destination);",
          'const indirect = client.get; indirect(globalThis.location.href);',
          "fetch('/api/items/');",
        ].join('\n'),
    },
    { '/api/items/': { get: good } },
  );
  assert.match(result.failures.join('\n'), /:3: Unresolved client destination/);
  assert.match(result.failures.join('\n'), /:3: Unresolved Axios request configuration/);
  assert.match(result.failures.join('\n'), /:4: Unresolved client destination/);
  assert.match(result.failures.join('\n'), /:5: Indirect Axios transport reference/);
  assert.match(result.failures.join('\n'), /:6: Unclassified fetch transport/);
});
