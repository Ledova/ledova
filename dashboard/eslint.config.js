import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

const NODE_GLOBALS_THE_BROWSER_LACKS = [
  { name: 'Buffer', message: "The browser has no Buffer global. Import it: import { Buffer } from 'buffer'." },
  {
    name: 'process',
    message: "The browser has no process global. Import it (import process from 'process') or read import.meta.env.",
  },
  { name: 'global', message: 'The browser has no global variable. Use globalThis.' },
];

const MESSAGE = 'Write the ellipsis character "…", not three dots (docs/engineering/frontend-ux.md).';
const NO_THREE_DOTS = [
  { selector: 'Literal[value=/\\.\\.\\./]', message: MESSAGE },
  { selector: 'TemplateElement[value.raw=/\\.\\.\\./]', message: MESSAGE },
  { selector: 'JSXText[value=/\\.\\.\\./]', message: MESSAGE },
];

const INLINE_CALENDAR_DATES = {
  selector:
    "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name=/^(slice|split|substring|substr)$/]",
  message:
    'Use utcToday, sydneyToday, isCalendarDate, addCalendarDays or addCalendarYears from @ledova/shared (docs/engineering/frontend-ux.md#forms).',
};

const LOCALE_FORMATTING = {
  selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
  message:
    'Format with formatDate, formatDateTime, formatMoney, formatShareCount, shareCount or sharePercentage from @ledova/shared (docs/engineering/frontend-ux.md#dates-numbers-and-identifiers).',
};

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, prettierConfig, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier: prettierPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'prettier/prettier': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...NODE_GLOBALS_THE_BROWSER_LACKS],
      'no-alert': 'error',
      'no-restricted-syntax': ['error', ...NO_THREE_DOTS, INLINE_CALENDAR_DATES, LOCALE_FORMATTING],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ledova/shared',
              importNames: ['getErrorMessage'],
              message:
                'Read a failure with failureSentence, or apiErrorSentence and readApiError (docs/engineering/frontend-ux.md#validation).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx', 'src/pages/signup/user-profile/CountrySelector.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            'Choose the control by the data: Choices, SelectField or SearchSelect (docs/engineering/frontend-ux.md).',
        },
        ...NO_THREE_DOTS,
        INLINE_CALENDAR_DATES,
        LOCALE_FORMATTING,
      ],
    },
  },
  {
    files: ['src/testSupport/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
