import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Input-channel and DOM-sink restrictions from spec §11.2 and §11.4. Bogey accepts content
// only through user gestures and never sends data anywhere, so these APIs have no legitimate use
// in application code.
const bannedGlobals = [
  ['fetch', 'Bogey makes no network requests from app code (spec §11.2).'],
  ['XMLHttpRequest', 'Bogey makes no network requests from app code (spec §11.2).'],
  ['WebSocket', 'Bogey makes no network requests from app code (spec §11.2).'],
  ['EventSource', 'Bogey makes no network requests from app code (spec §11.2).'],
  ['URLSearchParams', 'Bogey takes no input from the URL (spec §11.2).'],
].map(([name, message]) => ({ name, message }));

const bannedSyntax = [
  {
    selector: "MemberExpression[property.name=/^(search|hash)$/][object.name='location']",
    message: 'Bogey takes no input from the URL (spec §11.2).',
  },
  {
    selector: "MemberExpression[property.name=/^(search|hash)$/][object.property.name='location']",
    message: 'Bogey takes no input from the URL (spec §11.2).',
  },
  {
    selector:
      "CallExpression[callee.property.name='addEventListener'][arguments.0.value='message']",
    message: 'No cross-window messaging (spec §11.2).',
  },
  {
    selector: "AssignmentExpression[left.property.name='onmessage'][left.object.name='window']",
    message: 'No cross-window messaging (spec §11.2).',
  },
  {
    selector: "MemberExpression[object.name='navigator'][property.name='sendBeacon']",
    message: 'Bogey makes no network requests from app code (spec §11.2).',
  },
  {
    selector: "MemberExpression[object.name='window'][property.name=/^(open|opener)$/]",
    message: 'Bogey never opens or reads other windows (spec §11.2).',
  },
  {
    selector: "MemberExpression[object.name='navigator'][property.name='serviceWorker']",
    message: 'Only src/sw/register.ts may touch the service worker (spec §11.5).',
  },
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Render user content as text only (spec §11.4).',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'Render user content as text only (spec §11.4).',
  },
  {
    // document.write only: streaming parsers (htmlparser2's parser.write) are fine.
    selector:
      "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: 'Render user content as text only (spec §11.4).',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'tooling/fixtures/',
      'out/',
      // Agent worktrees live under .claude/worktrees inside the repository.
      '.claude/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-globals': ['error', ...bannedGlobals],
      'no-restricted-syntax': ['error', ...bannedSyntax],
    },
  },
  {
    files: [
      '**/*.mjs',
      '**/*.config.{js,ts}',
      'eslint.config.js',
      '.dependency-cruiser.cjs',
      'scripts/**/*.ts',
      'tooling/**/*.ts',
      'e2e/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['.dependency-cruiser.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/no-danger': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    // The service worker (spec §11.5): the one place allowed to fetch, and the one place that
    // registers it. Both are reviewed against the allow-list in the spec.
    files: ['apps/web/src/sw/sw.ts'],
    rules: {
      'no-restricted-globals': ['error', ...bannedGlobals.filter(({ name }) => name !== 'fetch')],
    },
  },
  {
    files: ['apps/web/src/sw/register.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...bannedSyntax.filter(({ message }) => !message.includes('service worker')),
      ],
    },
  },
  {
    files: ['**/test/**/*.{ts,tsx}', 'tooling/**/*.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': 'off',
      // Vitest accepts a failure message as the second argument.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },
  prettier,
);
