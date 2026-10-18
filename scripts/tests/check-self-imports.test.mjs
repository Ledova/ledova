import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { checkDebt, frontendFindings, RULES } from '../check-frontend-imports.mjs';
import { sourceImports } from '../source-imports.mjs';

test('source references retain their syntax and frontend import boundaries', async () => {
  const source = [
    'import "@sample/own";',
    'import { value } from "@sample/own/subpath";',
    'export * from "@sample/own";',
    'const lazy = import("@sample/own");',
    'const required = require(`@sample/own`);',
    'import alias = require("@sample/own");',
    'type Value = import("@sample/own").Value;',
  ].join('\n');
  assert.deepEqual(
    sourceImports(ts, source, 'test.ts').map(({ line }) => line),
    [1, 2, 3, 4, 5, 6, 7],
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'ledova-frontend-imports-'));
  try {
    const files = {
      'dashboard/tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          baseUrl: './src',
          paths: {
            '@pages/*': ['pages/*'],
            '@routes/*': ['routes/*'],
            '@services/*': ['services/*'],
          },
        },
      }),
      'dashboard/src/App.tsx': 'import "@routes/guard";',
      'dashboard/src/main.tsx': 'import "@services/apiClient";',
      'dashboard/src/routes/guard.tsx': 'import "./other"; import "@pages/first/local";',
      'dashboard/src/routes/other.tsx': 'export {};',
      'dashboard/src/components/Bad.tsx':
        'import "@routes/guard"; import "@pages/first/local"; import "@services/apiClient";',
      'dashboard/src/services/apiClient.ts': 'export {};',
      'dashboard/src/pages/first/index.tsx':
        'import "./local"; import "../second/local"; import "@services/apiClient";',
      'dashboard/src/pages/first/local.ts': 'export {};',
      'dashboard/src/pages/first/useLocal.ts': 'import "@services/apiClient";',
      'dashboard/src/pages/first/child/index.tsx':
        'import "@pages/first/shared/helper"; import "@pages/second/shared/helper";',
      'dashboard/src/pages/first/shared/helper.ts': 'export {};',
      'dashboard/src/pages/second/index.tsx': 'export {};',
      'dashboard/src/pages/second/local.ts': 'export {};',
      'dashboard/src/pages/second/shared/helper.ts': 'export {};',
      'dashboard/src/pages/first/ignored.test.tsx': 'import "../second/local";',
      'dashboard/src/testSupport/helper.ts': 'import "../pages/second/local";',
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    const { findings, scanned } = await frontendFindings(root);
    assert.equal(scanned, 14);
    assert.deepEqual(new Set(findings.map(({ rule }) => rule)), new Set(Object.keys(RULES)));
    const { counts } = checkDebt(findings, {});
    assert.deepEqual(checkDebt(findings, counts).failures, []);
    const key = 'dashboard/src/pages/first/index.tsx:relative-parent';
    assert.match(checkDebt(findings, { ...counts, [key]: 2 }).failures.join('\n'), /stale debt pin/);
    assert.match(
      checkDebt([...findings, findings.find(({ rule }) => rule === 'relative-parent')], counts).failures.join('\n'),
      /relative-parent.*pin 1, found 2/,
    );
    await rename(
      path.join(root, 'dashboard/src/components/Bad.tsx'),
      path.join(root, 'dashboard/src/components/Moved.tsx'),
    );
    const moved = (await frontendFindings(root)).findings;
    assert.match(checkDebt(moved, counts).failures.join('\n'), /stale debt pin/);
    const movedPins = Object.fromEntries(
      Object.entries(counts).map(([file, count]) => [file.replace('/Bad.tsx:', '/Moved.tsx:'), count]),
    );
    assert.deepEqual(checkDebt(moved, movedPins).failures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
