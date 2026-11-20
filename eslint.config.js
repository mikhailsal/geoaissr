import js from '@eslint/js';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const NO_SERVER = [
  'server/**',
  './server/**',
  '../server/**',
  '../../server/**',
  '../../../server/**',
];
const NO_WEB = ['web/**', './web/**', '../web/**', '../../web/**', '../../../web/**'];
const NO_BOT_TOOLS = [
  'bot-tools/**',
  './bot-tools/**',
  '../bot-tools/**',
  '../../bot-tools/**',
  '../../../bot-tools/**',
];
const NO_SCRIPTS = ['scripts/**', './scripts/**', '../scripts/**', '../../scripts/**'];
const NO_SPIKES = ['spikes/**', './spikes/**', '../spikes/**', '../../spikes/**'];
const NO_TEST = ['test/**', './test/**', '../test/**', '../../test/**'];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'vendor/orbit-rig/*.js',
      'web/dist/**',
      'dist/**',
      '.geoaissr-dev/**',
      '.gstack/**',
      'playwright-report/**',
      'test-results/**',
      'eslint.config.js',
      'svelte.config.js',
      'vite.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'max-lines-per-function': ['error', { max: 80 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: tseslint.parser,
        svelteConfig,
      },
    },
  },
  {
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...NO_SERVER,
                ...NO_WEB,
                ...NO_BOT_TOOLS,
                ...NO_SCRIPTS,
                ...NO_SPIKES,
                ...NO_TEST,
              ],
              message: 'shared/ must not import from other project directories.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['web/**/*.ts', 'web/**/*.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NO_SERVER, ...NO_BOT_TOOLS, ...NO_SCRIPTS, ...NO_SPIKES],
              message: 'web/ may only import from shared/ and packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['bot-tools/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NO_SERVER, ...NO_WEB, ...NO_SCRIPTS, ...NO_SPIKES, ...NO_TEST],
              message: 'bot-tools/ may only import from shared/ and packages.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NO_WEB, ...NO_BOT_TOOLS],
              message: 'server/ must not import from web/ or bot-tools/.',
            },
          ],
        },
      ],
    },
  },
);
