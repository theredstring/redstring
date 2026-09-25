// Playwright config for the NodeCanvas perf scenarios (refactor P0.04).
//
//   npm run perf:canvas                         # build the profile bundle, run everything
//   npm run perf:canvas -- --scenario S1,S6     # some scenarios
//   npm run perf:canvas -- --no-build           # reuse dist-profile/
//
// Use the script, not this config directly: it builds dist-profile, passes the
// scenario list and run count, and turns the raw runs into the median table.
//
// Measurements come from the profiling production build (`vite build --mode
// profile`): React's profiling renderer, no StrictMode double renders, real
// minification. The dev server's numbers are counts only (F-28).
// One worker: scenarios measure time, so nothing else may compete for the CPU.
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The repo root: vite preview must run there to find vite.config.js and dist-profile/.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const PORT = Number(process.env.CANVAS_PERF_PORT || 4832);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.perf.js',
  outputDir: './.results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Each test runs one scenario N times (default 5), each on a fresh page.
  timeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    // A scenario that gets stuck (a menu that never closes) fails in 15 s
    // instead of waiting out the whole test timeout.
    actionTimeout: 15_000,
  },
  webServer: {
    // PERF_DIST=dist-explain for --explain (vite.explain.config.mjs).
    command: `npx vite preview --mode profile --outDir ${process.env.PERF_DIST || 'dist-profile'} --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
