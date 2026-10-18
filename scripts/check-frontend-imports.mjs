import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceImports } from './source-imports.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const DEBT_FILE = 'scripts/frontend-import-debt.json';
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|^testSupport\.[jt]sx?$)/;
const NOT_SOURCE = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const TEST_DIRECTORIES = new Set(['tests', '__tests__', '__fixtures__', 'testSupport']);

export const RULES = {
  'routes-only-app': 'only App.tsx and routes themselves import routes/',
  'pages-only-pages-or-routes': 'only pages/ and routes/ import pages/',
  'routes-page-entry': 'routes/ imports a page only through its index.tsx entry',
  'page-boundary': 'page files import their own page or an enclosing shared/ folder',
  'api-client-outside-hook': 'only main.tsx, use*.ts hooks and services/ import apiClient',
  'relative-parent': 'relative imports never climb; use a dashboard alias',
};

async function* sourceFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (NOT_SOURCE.has(entry.name) || TEST_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) yield full;
  }
}

function inside(file, directory) {
  return file === directory || file.startsWith(`${directory}${path.sep}`);
}

function pageOwner(file, pages, entries) {
  for (let directory = path.dirname(file); inside(directory, pages); directory = path.dirname(directory)) {
    if (entries.has(directory)) return directory;
  }
  return undefined;
}

function samePage(source, target, pages, entries) {
  const owner = pageOwner(source, pages, entries);
  const targetOwner = pageOwner(target, pages, entries);
  if (owner && owner === targetOwner) return true;
  if (path.dirname(source) === path.dirname(target)) return true;
  const relative = path.relative(pages, target).split(path.sep);
  const shared = relative.indexOf('shared');
  if (shared === -1) return false;
  const parent = path.join(pages, ...relative.slice(0, shared));
  return (entries.has(parent) || path.dirname(parent) === pages) && inside(source, parent);
}

export async function frontendFindings(root = ROOT) {
  const source = path.join(root, 'dashboard/src');
  const pages = path.join(source, 'pages');
  const routes = path.join(source, 'routes');
  const services = path.join(source, 'services');
  const files = [];
  for await (const file of sourceFiles(source)) files.push(file);
  files.sort();
  const entries = new Set(files.filter((file) => path.basename(file) === 'index.tsx').map(path.dirname));
  const configFile = path.join(root, 'dashboard/tsconfig.app.json');
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile)).options;
  const cache = ts.createModuleResolutionCache(root, (name) => name, options);
  const findings = [];
  for (const file of files) {
    for (const { specifier, line } of sourceImports(ts, await readFile(file, 'utf8'), file)) {
      const found = new Set();
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.split('/').includes('..')) {
        found.add('relative-parent');
      }
      const target = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule?.resolvedFileName;
      if (target && inside(target, source)) {
        if (inside(target, routes) && file !== path.join(source, 'App.tsx') && !inside(file, routes)) {
          found.add('routes-only-app');
        }
        if (inside(target, pages)) {
          if (!inside(file, pages) && !inside(file, routes)) found.add('pages-only-pages-or-routes');
          if (inside(file, routes) && path.basename(target) !== 'index.tsx') found.add('routes-page-entry');
          if (inside(file, pages) && !samePage(file, target, pages, entries)) found.add('page-boundary');
        }
        if (
          target === path.join(services, 'apiClient.ts') &&
          file !== path.join(source, 'main.tsx') &&
          !/^use.*\.ts$/.test(path.basename(file)) &&
          !inside(file, services)
        ) {
          found.add('api-client-outside-hook');
        }
      }
      for (const rule of found)
        findings.push({ file: path.relative(root, file).split(path.sep).join('/'), line, rule, specifier });
    }
  }
  return { findings, scanned: files.length };
}

export function checkDebt(findings, debt) {
  const counts = {};
  const failures = [];
  for (const { file, rule } of findings) {
    const key = `${file}:${rule}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(debt)) {
    const delimiter = key.lastIndexOf(':');
    const file = key.slice(0, delimiter);
    const rule = key.slice(delimiter + 1);
    if (!file.startsWith('dashboard/src/') || !RULES[rule] || !Number.isSafeInteger(count) || count <= 0) {
      failures.push(`${key}: invalid debt pin; use a dashboard file, a known rule and a positive integer`);
    } else if ((counts[key] || 0) < count) {
      failures.push(`${key}: stale debt pin ${count}, found ${counts[key] || 0}; lower or remove the pin`);
    }
  }
  for (const { file, line, rule, specifier } of findings) {
    const key = `${file}:${rule}`;
    if (counts[key] > (debt[key] || 0)) {
      failures.push(
        `${file}:${line}: ${rule}: '${specifier}'; ${RULES[rule]} (pin ${debt[key] || 0}, found ${counts[key]})`,
      );
    }
  }
  return { failures: failures.sort(), counts };
}

export async function checkFrontendImports(root = ROOT, debt) {
  const pinned = debt ?? JSON.parse(await readFile(path.join(root, DEBT_FILE), 'utf8'));
  const { findings, scanned } = await frontendFindings(root);
  return { ...checkDebt(findings, pinned), findings, scanned };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, findings, scanned } = await checkFrontendImports();
  if (process.argv.includes('--show-debt')) {
    for (const { file, line, rule, specifier } of findings) console.log(`${file}:${line}: ${rule}: '${specifier}'`);
  }
  if (failures.length) {
    console.error(`Frontend import violations (${failures.length}):\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Frontend imports checked in ${scanned} non-test files (${findings.length} pinned findings).`);
  }
}
