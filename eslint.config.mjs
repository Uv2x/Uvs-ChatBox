// Flat ESLint config (ESLint 9+). Replaces the legacy .eslintrc.cjs, which
// ESLint 9 no longer reads. Preserves the same rule set: TS + React +
// React-Hooks recommended, with the project's overrides.
//
// Plugin config exports are consumed as plain `.rules` objects (eslintrc
// shape) spread into flat blocks — verified to exist for all three plugins.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Never lint build output / deps.
  { ignores: ['dist/', 'release/', 'node_modules/', 'build/', '*.config.*'] },

  // Baseline JS recommended for everything.
  js.configs.recommended,

  // Plain CommonJS scripts (e.g. scripts/hash-release.js) — Node globals,
  // require/module are legit here.
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // TypeScript + React sources.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      // Renderer is browser, main is node — allow both global sets rather
      // than maintaining two overlapping blocks.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      // react-hooks recommended is just these two rules.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ---- Project overrides (carried over from .eslintrc.cjs) ----
      'react/react-in-jsx-scope': 'off', // not needed with react-jsx runtime
      'react/prop-types': 'off',
      // Literal apostrophes/quotes in JSX copy are intentional and far more
      // readable than &apos;/&quot; entities. Cosmetic rule — off.
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Lazy require() in main (electron-updater, optional bindings) is
      // intentional; allow it but keep the rule available for disable-comments.
      '@typescript-eslint/no-require-imports': 'off',
      // TypeScript itself handles undefined-symbol detection; the core rule
      // produces false positives on type-only references.
      'no-undef': 'off',
      // Defer unused-var reporting to the TS-aware rule above.
      'no-unused-vars': 'off',
    },
  },
];
