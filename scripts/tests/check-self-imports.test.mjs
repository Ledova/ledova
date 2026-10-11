import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { sourceImports } from '../source-imports.mjs';

test('imports, re-exports, require and import types are all source references', () => {
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
});
