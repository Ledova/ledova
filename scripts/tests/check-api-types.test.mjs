import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkApiTypes, generateApiTypes } from '../check-api-types.mjs';

const streamPath = '/api/v1/trading/events/stream/';

function schema() {
  return {
    openapi: '3.0.3',
    info: { title: 'Synthetic contracts', version: '1' },
    paths: {
      [streamPath]: {
        get: {
          operationId: 'stream',
          responses: {
            200: {
              description: 'Stream',
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    'x-sse-events': ['connected', 'order_created', 'swap_signed'],
                    'x-sse-connection-event': 'connected',
                  },
                },
              },
            },
          },
        },
      },
      '/files/': {
        get: {
          operationId: 'file_download',
          responses: {
            200: {
              description: 'Binary content',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      },
      '/things/': {
        get: {
          operationId: 'things_list',
          parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
          responses: {
            200: {
              description: 'Actual response, independent of the path name',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Result' },
                },
              },
            },
          },
        },
        post: {
          operationId: 'things_create',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InputRequest' },
              },
            },
          },
          responses: { 204: { description: 'No body' } },
        },
      },
    },
    components: {
      schemas: {
        Result: {
          type: 'object',
          description: 'This must not become a source comment.',
          required: ['uuid', 'amount', 'selectedPortfolio', 'components', 'version'],
          properties: {
            uuid: { type: 'string', readOnly: true },
            amount: { type: 'string', format: 'decimal' },
            selectedPortfolio: {
              nullable: true,
              allOf: [{ $ref: '#/components/schemas/Portfolio' }],
            },
            components: { type: 'integer' },
            version: { type: 'integer', enum: [1] },
            optional: { type: 'string' },
          },
        },
        Portfolio: {
          type: 'object',
          required: ['uuid'],
          properties: { uuid: { type: 'string' } },
        },
        InputRequest: {
          type: 'object',
          required: ['amount'],
          properties: {
            amount: {
              oneOf: [{ type: 'string', format: 'decimal' }, { type: 'number' }],
            },
            selectedPortfolio: { type: 'string', nullable: true },
            name: { type: 'string', default: 'Untitled' },
            password: { type: 'string', writeOnly: true },
            file: { type: 'string', format: 'binary' },
          },
        },
      },
    },
  };
}

async function directory(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ledova-api-types-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('generation is repeatable and only an explicit update replaces stale output', async (t) => {
  const folder = await directory(t);
  const schemaPath = path.join(folder, 'schema.json');
  const outputPath = path.join(folder, 'api.ts');
  const document = schema();
  await writeFile(schemaPath, JSON.stringify(document));
  await checkApiTypes({ schemaPath, outputPath, update: true });
  const first = await readFile(outputPath, 'utf8');
  await checkApiTypes({ schemaPath, outputPath });
  assert.equal(first, await generateApiTypes(JSON.parse(JSON.stringify(document))));
  document.components.schemas.Result.properties = Object.fromEntries(
    Object.entries(document.components.schemas.Result.properties).reverse(),
  );
  assert.equal(first, await generateApiTypes(document));
  document.components.schemas.Result.properties.amount.type = 'number';
  await writeFile(schemaPath, JSON.stringify(document));
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /stale/);
  assert.equal(await readFile(outputPath, 'utf8'), first);
  await checkApiTypes({ schemaPath, outputPath, update: true });
  assert.notEqual(await readFile(outputPath, 'utf8'), first);
  await checkApiTypes({ schemaPath, outputPath });
});

test('missing inputs, missing output and invalid schema references fail closed', async (t) => {
  const folder = await directory(t);
  const schemaPath = path.join(folder, 'schema.json');
  const outputPath = path.join(folder, 'api.ts');
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /ENOENT/);
  const document = schema();
  await writeFile(schemaPath, JSON.stringify(document));
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /ENOENT/);
  document.paths['/things/'].get.responses[200].content['application/json'].schema.$ref =
    '#/components/schemas/Missing';
  await assert.rejects(generateApiTypes(document), /Missing|resolve/);
});
