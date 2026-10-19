import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'art/**', 'client/public/assets/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Game rules must run in the browser and in Node, so no Node APIs here.
    files: ['shared/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path'] }] },
  },
  {
    files: ['client/src/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        performance: 'readonly',
        WebSocket: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['client/public/sw.js'],
    languageOptions: { globals: { self: 'readonly', location: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
  },
);
