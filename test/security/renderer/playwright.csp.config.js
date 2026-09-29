/* global process */
// Playwright config for the CSP check (S-41): the PRODUCTION build under
// `vite preview`, so the policy is tested exactly as it ships (the dev server
// adds its own header and inline preamble, which the build doesn't have).
//
//   npm run build
//   npx playwright test -c test/security/renderer/playwright.csp.config.js
//
// The spec is csp.e2e.spec.js. vitest's include (vite.config.js) matches
// test/**/*.spec.js too, so the spec guards itself: under vitest it registers
// a skipped placeholder instead of Playwright tests.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.CSP_E2E_PORT || 4831);

export default defineConfig({
  testDir: '.',
  testMatch: 'csp.e2e.spec.js',
  outputDir: './.csp-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // Serves dist/ as built; run `npm run build` first.
    command: `npx vite preview --port ${PORT} --strictPort`,
    cwd: '../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
