import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { namingConventions } from './eslint-naming-rules.js';

const MESSAGE = 'Write the ellipsis character "…", not three dots (docs/engineering/frontend-ux.md).';
const NO_THREE_DOTS = [
  { selector: 'Literal[value=/\\.\\.\\./]', message: MESSAGE },
  { selector: 'TemplateElement[value.raw=/\\.\\.\\./]', message: MESSAGE },
  { selector: 'JSXText[value=/\\.\\.\\./]', message: MESSAGE },
];

export default tseslint.config(
  { ignores: ['node_modules'] },
  {
    extends: [js.configs.recommended, prettierConfig, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/generated/**'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_THREE_DOTS],
    },
  },
  {
    files: ['src/types/**/*.ts'],
    rules: {
      ...namingConventions.rules,
    },
  },
);
