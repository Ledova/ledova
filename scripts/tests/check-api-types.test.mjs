import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  checkApiTypes,
  generateApiTypes,
  tradingEvents,
} from "../check-api-types.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const streamPath = "/api/v1/trading/events/stream/";

function schema() {
  return {
    openapi: "3.0.3",
    info: { title: "Synthetic contracts", version: "1" },
    paths: {
      [streamPath]: {
        get: {
          operationId: "stream",
          responses: {
            200: {
              description: "Stream",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    "x-sse-events": [
                      "connected",
                      "order_created",
                      "swap_signed",
                    ],
                    "x-sse-connection-event": "connected",
                  },
                },
              },
            },
          },
        },
      },
      "/files/": {
        get: {
          operationId: "file_download",
          responses: {
            200: {
              description: "Binary content",
              content: {
                "application/pdf": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
      },
      "/things/": {
        get: {
          operationId: "things_list",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            200: {
              description: "Actual response, independent of the path name",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Result" },
                },
              },
            },
          },
        },
        post: {
          operationId: "things_create",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InputRequest" },
              },
            },
          },
          responses: { 204: { description: "No body" } },
        },
      },
    },
    components: {
      schemas: {
        Result: {
          type: "object",
          description: "This must not become a source comment.",
          required: [
            "uuid",
            "amount",
            "selectedPortfolio",
            "components",
            "version",
          ],
          properties: {
            uuid: { type: "string", readOnly: true },
            amount: { type: "string", format: "decimal" },
            selectedPortfolio: {
              nullable: true,
              allOf: [{ $ref: "#/components/schemas/Portfolio" }],
            },
            components: { type: "integer" },
            version: { type: "integer", enum: [1] },
            optional: { type: "string" },
          },
        },
        Portfolio: {
          type: "object",
          required: ["uuid"],
          properties: { uuid: { type: "string" } },
        },
        InputRequest: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: {
              oneOf: [
                { type: "string", format: "decimal" },
                { type: "number" },
              ],
            },
            selectedPortfolio: { type: "string", nullable: true },
            name: { type: "string", default: "Untitled" },
            password: { type: "string", writeOnly: true },
            file: { type: "string", format: "binary" },
          },
        },
      },
    },
  };
}

async function directory(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "ledova-api-types-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

async function compile(t, generated, source) {
  const folder = await directory(t);
  const entry = path.join(folder, "consumer.ts");
  await writeFile(path.join(folder, "api.ts"), generated);
  await writeFile(entry, source);
  const helpers = await readFile(
    path.join(root, "packages/shared/src/types/contracts.ts"),
    "utf8",
  );
  await writeFile(
    path.join(folder, "contracts.ts"),
    helpers.replace("../generated/api", "./api"),
  );
  const program = ts.createProgram([entry], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  return ts.getPreEmitDiagnostics(program).map((item) => ({
    code: item.code,
    message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
  }));
}

test("generated operations preserve exact strings, nullable responses and distinct writable requests", async (t) => {
  const generated = await generateApiTypes(schema());
  const diagnostics = await compile(
    t,
    generated,
    `
    import type { ApiComponents, ApiOperations, ApiPaths } from './api';
    import type { ApiResponse, ApiRequest, ApiQuery } from './contracts';
    type Assert<T extends true> = T;
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Output = ApiComponents['schemas']['Result'];
    type Input = ApiComponents['schemas']['InputRequest'];
    type ResponseAlias = Assert<Equal<ApiResponse<'things_list'>, Output>>;
    type RequestAlias = Assert<Equal<ApiRequest<'things_create'>, Input>>;
    type QueryAlias = Assert<Equal<ApiQuery<'things_list'>, { page?: number }>>;
    type EmptyResponse = Assert<Equal<ApiResponse<'things_create'>, void>>;
    type FileResponse = Assert<Equal<ApiResponse<'file_download'>, Blob>>;
    type StreamResponse = Assert<Equal<ApiResponse<'stream'>, string>>;
    type Amount = Assert<Equal<Output['amount'], string>>;
    type Version = Assert<Equal<Output['version'], 1>>;
    type InputAmount = Assert<Equal<Input['amount'], string | number>>;
    type ReadOnlyExcluded = Assert<Equal<'uuid' extends keyof Input ? true : false, false>>;
    type Operation = Assert<Equal<ApiOperations['things_list']['responses'][200]['content']['application/json'], Output>>;
    type Route = Assert<Equal<ApiPaths['/things/']['get'], ApiOperations['things_list']>>;
    const response: Output = { uuid: 'a', amount: '9007199254740993.123456789', selectedPortfolio: null, components: 1, version: 1 };
    response.uuid = 'copied-data';
    const request: Input = { amount: 4 };
    const upload: Input = { amount: '4', password: 'synthetic', file: new Blob(['synthetic']), selectedPortfolio: 'portfolio' };
  `,
  );
  assert.deepEqual(diagnostics, []);
  assert.doesNotMatch(generated, /\/\*|\/\//);
  assert.match(generated, /export interface ApiComponents/);
});

test("the compiler rejects rounded amounts, wrong nested values and absent required fields", async (t) => {
  const generated = await generateApiTypes(schema());
  const diagnostics = await compile(
    t,
    generated,
    `
    import type { ApiComponents } from './api';
    type Output = ApiComponents['schemas']['Result'];
    const amount: Output['amount'] = 9007199254740993;
    const selected: Output['selectedPortfolio'] = 'portfolio';
    const absent: Output = { uuid: 'a' };
    const request: ApiComponents['schemas']['InputRequest'] = { amount: '4', uuid: 'forged-owner' };
  `,
  );
  assert.deepEqual(
    diagnostics.map((item) => item.code).sort(),
    [2322, 2322, 2353, 2739],
  );
});

test("generation is repeatable and only an explicit update replaces stale output", async (t) => {
  const folder = await directory(t);
  const schemaPath = path.join(folder, "schema.json");
  const outputPath = path.join(folder, "api.ts");
  const document = schema();
  await writeFile(schemaPath, JSON.stringify(document));
  await checkApiTypes({ schemaPath, outputPath, update: true });
  const first = await readFile(outputPath, "utf8");
  await checkApiTypes({ schemaPath, outputPath });
  assert.equal(
    first,
    await generateApiTypes(JSON.parse(JSON.stringify(document))),
  );
  document.components.schemas.Result.properties = Object.fromEntries(
    Object.entries(document.components.schemas.Result.properties).reverse(),
  );
  assert.equal(first, await generateApiTypes(document));
  document.components.schemas.Result.properties.amount.type = "number";
  await writeFile(schemaPath, JSON.stringify(document));
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /stale/);
  assert.equal(await readFile(outputPath, "utf8"), first);
  await checkApiTypes({ schemaPath, outputPath, update: true });
  assert.notEqual(await readFile(outputPath, "utf8"), first);
  await checkApiTypes({ schemaPath, outputPath });
});

test("missing inputs, missing output and invalid schema references fail closed", async (t) => {
  const folder = await directory(t);
  const schemaPath = path.join(folder, "schema.json");
  const outputPath = path.join(folder, "api.ts");
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /ENOENT/);
  const document = schema();
  await writeFile(schemaPath, JSON.stringify(document));
  await assert.rejects(checkApiTypes({ schemaPath, outputPath }), /ENOENT/);
  document.paths["/things/"].get.responses[200].content[
    "application/json"
  ].schema.$ref = "#/components/schemas/Missing";
  await assert.rejects(generateApiTypes(document), /Missing|resolve/);
});

test("trading events require a nonempty unique catalogue and a declared connection event", () => {
  assert.deepEqual(tradingEvents(schema()), ["order_created", "swap_signed"]);
  for (const events of [
    undefined,
    [],
    ["connected"],
    ["connected", "connected"],
    ["connected", ""],
    ["connected", 1],
  ]) {
    const document = schema();
    document.paths[streamPath].get.responses[200].content[
      "text/event-stream"
    ].schema["x-sse-events"] = events;
    assert.throws(() => tradingEvents(document), /x-sse-events/);
  }
  const document = schema();
  document.paths[streamPath].get.responses[200].content[
    "text/event-stream"
  ].schema["x-sse-connection-event"] = "absent";
  assert.throws(() => tradingEvents(document), /x-sse-connection-event/);
});

test("the real invalidation map rejects both added and removed server events", async (t) => {
  const document = JSON.parse(
    await readFile(path.join(root, "backend/schema/openapi.json"), "utf8"),
  );
  const source = await readFile(
    path.join(root, "packages/shared/src/constants/business/trading.ts"),
    "utf8",
  );
  const file = ts.createSourceFile(
    "trading.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => node.declarationList.declarations)
    .find(
      (node) => node.name.getText(file) === "TRADING_EVENT_INVALIDATION_MAP",
    );
  assert.ok(declaration);
  const consumer = `import type { TradingEventType } from './api';
    const invalidations: Record<TradingEventType, string[][]> = ${declaration.initializer.getText(file)};`;
  assert.deepEqual(
    await compile(t, await generateApiTypes(document), consumer),
    [],
  );
  const added = structuredClone(document);
  added.paths[streamPath].get.responses[200].content[
    "text/event-stream"
  ].schema["x-sse-events"].push("synthetic_new_event");
  const missingKey = await compile(t, await generateApiTypes(added), consumer);
  assert.ok(
    missingKey.some(
      (item) =>
        item.message.includes("synthetic_new_event") &&
        item.message.includes("missing"),
    ),
  );
  const removed = structuredClone(document);
  const stream =
    removed.paths[streamPath].get.responses[200].content["text/event-stream"]
      .schema;
  const retired = tradingEvents(document)[0];
  stream["x-sse-events"] = stream["x-sse-events"].filter(
    (event) => event !== retired,
  );
  const staleKey = await compile(t, await generateApiTypes(removed), consumer);
  assert.ok(
    staleKey.some(
      (item) => item.code === 2353 && item.message.includes(retired),
    ),
  );
});
