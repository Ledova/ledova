import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDeadCode } from '../check-dead-code.mjs';

test('dead-code graph follows entry points, aliases, barrels, types and literal module loads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledova-dead-code-'));
  async function write(file, text) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  try {
    const fixture = {
      'dashboard/tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          baseUrl: './src',
          paths: { '@pages/*': ['pages/*'] },
        },
      }),
      'dashboard/src/main.tsx': [
        'import { used } from "@pages/live";',
        'import type { RecordType } from "./types";',
        'import { shared } from "@ledova/shared";',
        'import * as names from "./namespace";',
        'import "./side-effect.js";',
        'void import("./lazy");',
        'const required = require("./required");',
        'const record: RecordType = { used };',
        'type Values = typeof import("./type-module");',
        'const typedModule: Values = { count: 1 };',
        'console.log(typedModule);',
        'console.log(record, shared, names, required);',
      ].join('\n'),
      'dashboard/src/pages/live.ts': 'export const used = 1; export const redundant = 2;',
      'dashboard/src/types.ts': 'export interface RecordType { used: number }',
      'dashboard/src/type-module.ts': 'export const count = 1;',
      'dashboard/src/namespace.ts': 'export const selectedAtRuntime = 1;',
      'dashboard/src/lazy.ts': 'export const loaded = 1;',
      'dashboard/src/required.ts': 'export const loaded = 1;',
      'dashboard/src/side-effect.js': 'console.log("side effect");',
      'dashboard/src/orphan-a.ts': 'import "./orphan-b";',
      'dashboard/src/orphan-b.ts': 'import "./orphan-a";',
      'packages/shared/src/index.ts': 'export * from "./value";',
      'packages/shared/src/value.ts': 'export const shared = 1;',
      'packages/shared/src/generated/api.ts': 'export interface Generated { value: number }',
      'mobile/index.ts': 'import App from "./App"; console.log(App);',
      'mobile/App.tsx': 'import { mobile } from "./src/value"; export default mobile;',
      'mobile/src/value.ts': 'export const mobile = 1;',
      'site/src/theme.test.ts': 'import { testHelper } from "./testHelper"; console.log(testHelper);',
      'site/src/testHelper.ts': 'export const testHelper = 1;',
    };
    for (const [file, text] of Object.entries(fixture)) await write(file, text);
    assert.deepEqual(checkDeadCode(root).findings, [
      'dashboard/src/orphan-a.ts: unused file',
      'dashboard/src/orphan-b.ts: unused file',
      "dashboard/src/pages/live.ts: unused export 'redundant'",
    ]);
    await write('dashboard/src/pages/live.ts', 'export const used = 1;');
    await rm(path.join(root, 'dashboard/src/orphan-a.ts'));
    await rm(path.join(root, 'dashboard/src/orphan-b.ts'));
    assert.deepEqual(checkDeadCode(root).findings, []);
    await write('dashboard/src/main.tsx', fixture['dashboard/src/main.tsx'] + '\nimport "./missing";');
    assert.match(checkDeadCode(root).findings.join('\n'), /unresolved local import '.\/missing'/);
    await write('dashboard/src/main.tsx', 'export const = ;');
    assert.throws(() => checkDeadCode(root), /Cannot parse dashboard\/src\/main.tsx/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dead-code scan refuses an empty source tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledova-dead-code-empty-'));
  try {
    assert.throws(() => checkDeadCode(root), /refusing an empty scan/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
