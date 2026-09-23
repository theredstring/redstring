// Warm the Vite dev server before any test runs.
//
// On a cold server, the first page load makes Vite pre-bundle dependencies and
// transform ~1,000 modules. If it discovers a new dependency part-way through,
// it forces a full page reload. In a test that reload lands mid-gesture and
// looks like a random failure. Loading each committed fixture once here, before
// workers start, moves that cost and that reload out of the measured flows.
import { chromium } from '@playwright/test';

export default async function globalSetup(config) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;
  const started = Date.now();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    for (const name of ['small', 'stress']) {
      // Two passes: the first may be interrupted by a dep-optimisation reload.
      for (let pass = 0; pass < 2; pass++) {
        await page.goto(`${baseURL}/?fixture=${name}`, { waitUntil: 'load', timeout: 120_000 });
        try {
          await page.waitForFunction(
            () => window.__fixture?.ready === true && document.querySelector('svg.canvas g.node'),
            null,
            { timeout: 90_000 },
          );
          break;
        } catch (err) {
          if (pass === 1) throw new Error(`warm-up: fixture "${name}" never became ready: ${err.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[canvas e2e] dev server warmed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
