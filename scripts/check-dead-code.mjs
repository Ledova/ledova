import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceImports } from './source-imports.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const DIRECTORIES = [
  'dashboard/src',
  'site/src',
  'mobile/src',
  'mobile/native-tests',
  'packages/shared/src',
  'packages/shared/tests',
];
const ENTRIES = [
  'dashboard/src/main.tsx',
  'site/src/main.tsx',
  'mobile/index.ts',
  'mobile/native-tests/index.tsx',
  'mobile/native-tests/NetworkProbeHost.tsx',
];
const TEST = /(?:\.(?:test|spec)\.[jt]sx?$|\/(?:tests|__tests__|__mocks__)\/)/;
const GENERATED = 'packages/shared/src/generated/api.ts';
const PLATFORM_SUFFIXES = [[], ['.ios', '.native', ''], ['.android', '.native', '']];
const PLATFORM = /\.(?:ios|android|native)\.[jt]sx?$/;

function filesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : /\.[jt]sx?$/.test(entry.name) ? [filename] : [];
  });
}

function canonical(checker, symbol) {
  return symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

export function checkDeadCode(root = ROOT) {
  const filenames = [
    ...DIRECTORIES.flatMap((directory) => filesIn(path.join(root, directory))),
    ...['mobile/App.tsx', 'mobile/index.ts'].map((file) => path.join(root, file)).filter(existsSync),
  ].sort();
  const configPath = path.join(root, 'dashboard/tsconfig.app.json');
  let aliases = {};
  if (existsSync(configPath)) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    aliases = Object.fromEntries(
      Object.entries(parsed.options.paths ?? {}).map(([name, values]) => [
        name,
        values.map((value) => path.resolve(parsed.options.baseUrl ?? path.dirname(configPath), value)),
      ]),
    );
  }
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    baseUrl: root,
    paths: {
      '@ledova/shared': ['packages/shared/src/index.ts'],
      ...aliases,
    },
  };
  const platforms = PLATFORM_SUFFIXES.map((moduleSuffixes) => ({ ...options, moduleSuffixes }));
  const resolve = (specifier, filename) =>
    platforms
      .map((platform) => ts.resolveModuleName(specifier, filename, platform, ts.sys).resolvedModule?.resolvedFileName)
      .filter(Boolean);
  const program = ts.createProgram(filenames, options);
  const checker = program.getTypeChecker();
  const files = new Map(filenames.map((filename) => [filename, program.getSourceFile(filename)]));
  const findings = [];
  const graph = new Map();
  const used = new Set();
  const roots = new Set(ENTRIES.map((file) => path.join(root, file)).filter((file) => files.has(file)));
  if (!files.size || !roots.size) throw new Error('No application entry points found; refusing an empty scan');
  if (files.has(path.join(root, GENERATED))) roots.add(path.join(root, GENERATED));
  const relative = (filename) => path.relative(root, filename).split(path.sep).join('/');

  function use(symbol) {
    if (!symbol) return;
    used.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Module) {
      for (const exported of checker.getExportsOfModule(symbol)) used.add(canonical(checker, exported));
    }
  }

  for (const [filename, source] of files) {
    if (!source) throw new Error(`Cannot parse ${filename}`);
    if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${relative(filename)}`);
    if (TEST.test(relative(filename)) || source.isDeclarationFile) roots.add(filename);
    const dependencies = [];
    for (const { specifier, line } of sourceImports(ts, source.text, filename)) {
      const targets = resolve(specifier, filename);
      dependencies.push(...targets.filter((target) => files.has(target)));
      if (
        !targets.length &&
        (specifier.startsWith('.') ||
          Object.keys(options.paths).some((alias) =>
            alias.includes('*') ? specifier.startsWith(alias.split('*')[0]) : specifier === alias,
          )) &&
        !/\.(?:css|svg|png|jpe?g|gif|webp|ttf|woff2?)(?:\?|$)/.test(specifier)
      ) {
        findings.push(`${relative(filename)}:${line}: unresolved local import '${specifier}'`);
      }
    }
    graph.set(filename, dependencies);
  }
  const reached = new Set();
  function reach(filename) {
    if (reached.has(filename)) return;
    reached.add(filename);
    for (const dependency of graph.get(filename) ?? []) reach(dependency);
  }
  for (const root of roots) reach(root);
  for (const filename of reached) {
    const source = files.get(filename);
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const specifier = node.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) {
          for (const target of resolve(specifier.text, filename)) {
            const imported = files.get(target);
            if (imported) use(checker.getSymbolAtLocation(imported));
          }
        }
      }
      if (ts.isIdentifier(node)) {
        const reference = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        const symbol = canonical(checker, reference);
        if (symbol?.declarations?.some((declaration) => declaration.getSourceFile() !== source)) use(symbol);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  for (const [filename, source] of files) {
    const file = relative(filename);
    if (!reached.has(filename)) {
      findings.push(`${file}: unused file`);
      continue;
    }
    if (roots.has(filename) || file === GENERATED || source.isDeclarationFile || PLATFORM.test(file)) continue;
    const module = checker.getSymbolAtLocation(source);
    if (!module) continue;
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol = canonical(checker, exported);
      if (used.has(symbol) || !symbol?.declarations?.some((declaration) => declaration.getSourceFile() === source))
        continue;
      findings.push(`${file}: unused export '${exported.name}'`);
    }
  }
  return { findings: findings.sort(), scanned: files.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { findings, scanned } = checkDeadCode();
  if (findings.length) {
    console.error(`TypeScript dead-code findings (${findings.length}):\n${findings.join('\n')}`);
    process.exitCode = 1;
  } else console.log(`No unused TypeScript files or exports in ${scanned} files.`);
}
