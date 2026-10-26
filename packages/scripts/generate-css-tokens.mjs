#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const { DESIGN_TOKENS, THEMES } = await import('../shared/src/constants/ui/design-tokens.ts');

function kebab(key) {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function flattenColors(obj, prefix, lines) {
  for (const [key, value] of Object.entries(obj)) {
    const name = key === 'default' ? prefix : `${prefix}-${kebab(key)}`;
    if (typeof value === 'string') {
      lines.push(`  --color-${name}: ${value};`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      flattenColors(value, name, lines);
    }
  }
}

function section(lines) {
  lines.push('');
}

function add(lines, varName, value) {
  lines.push(`  ${varName}: ${value};`);
}

function generateColorVars(colors) {
  const lines = [];

  section(lines);
  flattenColors(colors.surface, 'surface', lines);

  section(lines);
  flattenColors(colors.text, 'text', lines);

  section(lines);
  flattenColors(colors.brand, 'brand', lines);

  section(lines);
  flattenColors(colors.border, 'border', lines);

  section(lines);
  flattenColors(colors.success, 'success', lines);
  flattenColors(colors.error, 'error', lines);
  flattenColors(colors.warning, 'warning', lines);
  flattenColors(colors.info, 'info', lines);

  return lines;
}

function generateSharedVars() {
  const lines = [];

  section(lines);
  for (const [, value] of Object.entries(DESIGN_TOKENS.spacing)) {
    add(lines, `--spacing-${value / 4}`, `${value}px`);
  }

  section(lines);
  for (const [key, shadow] of Object.entries(DESIGN_TOKENS.shadows)) {
    add(lines, `--shadow-${key}`, shadow);
  }

  return lines;
}

const paperColors = generateColorVars(THEMES.paper);
const darkColors = generateColorVars(THEMES.dark);
const paperCharts = [];
const darkCharts = [];
flattenColors(THEMES.paper.chart, 'chart', paperCharts);
flattenColors(THEMES.dark.chart, 'chart', darkCharts);

const variableNames = (lines) =>
  lines
    .filter(Boolean)
    .map((line) => line.split(':')[0])
    .sort()
    .join();
if (variableNames([...paperColors, ...paperCharts]) !== variableNames([...darkColors, ...darkCharts])) {
  throw new Error('Paper and Dark themes emit different colour variables');
}

const css = `@theme {${[...paperColors, ...generateSharedVars()].join('\n')}
}

@theme static {
${paperCharts.join('\n')}
}

:root[data-theme='dark'] {
  color-scheme: dark;${[...darkColors, '', ...darkCharts].join('\n')}
}
`;

const targets = [join(ROOT, 'dashboard/src/styles/tokens.css'), join(ROOT, 'site/src/tokens.css')];

for (const target of targets) {
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf-8') !== css) throw new Error(`Stale design tokens: ${target}`);
  } else writeFileSync(target, css, 'utf-8');
  console.log(`✓ ${target.replace(ROOT + '/', '')}`);
}
