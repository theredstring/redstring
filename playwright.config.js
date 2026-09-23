// Playwright config for the NodeCanvas interaction flows (refactor P0.03, D-12).
//
//   npm run test:canvas            # headless, the whole suite
//   npm run test:canvas:headed     # watch it run
//   npm run test:canvas -- -g F6   # one flow
//
// Specs live in test/e2e/canvas/ and are named *.pw.js, NOT *.spec.js or
// *.test.js: vitest's include (vite.config.js) matches test/**/*.{test,spec}.js,
// and must never pick these up.
//
// The web server is a dedicated Vite dev server on its own port with
// reuseExistingServer: false, so a run never attaches to a developer's server
// (4001 by default) and always serves this checkout. It also uses its own
// dependency cache (test/e2e/canvas/vite.e2e.config.js), so it never rewrites
// the node_modules/.vite cache a developer's server is using. Fixtures load through the
// dev-only loader (?fixture=…, src/dev/fixtureLoader.js), which also turns off
// saving and sandboxes storage and network.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.CANVAS_E2E_PORT || 4873);

export default defineConfig({
  testDir: './test/e2e/canvas',
  testMatch: '**/*.pw.js',
  outputDir: './test/e2e/canvas/.results',
  globalSetup: './test/e2e/canvas/global-setup.js',
  fullyParallel: true,
  // Gesture timing (lift delay, click delay, glide) is real time, so keep
  // enough CPU per worker that a busy machine can't stretch a 250 ms hold.
  workers: Number(process.env.CANVAS_E2E_WORKERS || 3),
  // No retries: a flow that needs one is flaky, and we want to see that.
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['list']]
    : [['list'], ['html', { outputFolder: 'test/e2e/canvas/.report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Own config wrapper: same app config, private dependency cache (see there).
    command: `npx vite --config test/e2e/canvas/vite.e2e.config.js --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
