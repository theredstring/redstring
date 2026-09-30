import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    ignores: [
      'dist',
      'dist-*',
      '.claude/**',
      'ios/**',
      'android/**',
      'node_modules',
      '**/*.bundle.cjs',
      '**/.vite-cache/**',
    ],
  },
  // Build and release tooling runs in Node, not the browser. Without this these
  // files report `process`/`__dirname` as undefined globals.
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  // The local servers, CLI and headless runtime are Node too.
  {
    files: [
      'src/headless/**/*.js',
      'src/security/**/*.js',
      'src/services/ai-bridge-service.js',
      '*-server.js',
      'bridge-daemon.js',
      'cli/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // Tests, configs, electron and the root servers run in Node (tests also use
  // vitest globals).
  {
    files: [
      'test/**/*.{js,jsx,mjs}',
      'src/**/*.test.{js,jsx}',
      'electron/**/*.{js,cjs}',
      'functions/**/*.js',
      'cloudflare/**/*.js',
      '*.config.js',
      '*.js',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.jest },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      // The codebase doesn't use PropTypes.
      'react/prop-types': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
]
