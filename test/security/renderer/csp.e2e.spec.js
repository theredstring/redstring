/**
 * S-41 — the Content-Security-Policy in index.html, exercised in a real
 * browser against the production build.
 *
 *   npm run build
 *   npx playwright test -c test/security/renderer/playwright.csp.config.js
 *
 * Walks the app through the paths that load something — first paint and
 * onboarding, opening a universe file, the right panel on a Thing, the save and
 * canvas workers, a remote https image — and fails on any
 * `securitypolicyviolation` event or any CSP console error along the way.
 *
 * This file also matches vitest's include pattern (test/**\/*.spec.js); under
 * vitest it registers a skipped placeholder instead, because Playwright's
 * `test()` may only be called by the Playwright runner.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// A 1x1 PNG, served for the remote image request so the run needs no network.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);
const REMOTE_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/csp-probe.png/500px-csp-probe.png';

/**
 * The committed small canvas fixture, with one Thing given a remote https
 * picture and an external identifier, so the canvas and the panel both have
 * something from the web to draw.
 */
function writeProbeFixture(outDir) {
  const doc = JSON.parse(readFileSync(join(repoRoot, 'test/fixtures/canvas/small.redstring'), 'utf8'));
  const protos = doc.prototypeSpace.prototypes;
  // A Thing that is on the web the file opens to, so the canvas draws it.
  const activeGraphId = doc.userInterface['redstring:activeGraphId'];
  const instances = doc.spatialGraphs.graphs[activeGraphId]['redstring:instances'];
  const onCanvas = Object.values(instances).map((inst) => inst['redstring:prototypeId']);
  const id = Object.keys(protos).find((key) => onCanvas.some((pid) => key === pid || key.endsWith(`:${pid}`)));
  const proto = protos[id];
  proto['redstring:visualProperties'] = {
    ...(proto['redstring:visualProperties'] || {}),
    'redstring:thumbnailSrc': REMOTE_IMAGE,
    'redstring:imageSrc': REMOTE_IMAGE,
    'redstring:imageAspectRatio': 1,
  };
  proto['rdfs:seeAlso'] = ['https://www.wikidata.org/wiki/Q42'];
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'csp-probe.redstring');
  writeFileSync(file, JSON.stringify(doc));
  return { file, protoName: proto.name || proto['rdfs:label'] };
}

if (process.env.VITEST) {
  const { describe, it } = await import('vitest');
  describe.skip('CSP e2e (runs under Playwright, see playwright.csp.config.js)', () => {
    it('is a Playwright spec', () => {});
  });
} else {
  const { test, expect } = await import('@playwright/test');

  test('the production build runs with zero CSP violations', async ({ page }, testInfo) => {
    const violations = [];
    const cspConsole = [];
    await page.exposeFunction('__cspViolation', (v) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolation({
          directive: e.violatedDirective,
          blocked: e.blockedURI,
          sample: e.sample,
          source: e.sourceFile,
          line: e.lineNumber,
        });
      });
      // Which workers the app starts, so the run can prove it started them.
      const RealWorker = window.Worker;
      window.__cspWorkers = [];
      window.Worker = function Worker(url, options) {
        window.__cspWorkers.push(String(url));
        return new RealWorker(url, options);
      };
      window.Worker.prototype = RealWorker.prototype;
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (/Content Security Policy|Refused to (load|execute|apply|connect|create|evaluate|frame)/i.test(text)) cspConsole.push(text);
    });

    // Remote images: answered locally, but still fetched over https by the
    // page, so img-src is what's exercised. Everything else off-origin is
    // aborted (no network in tests); an abort is not a CSP violation.
    await page.route('https://upload.wikimedia.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }));
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|upload\.wikimedia\.org)/, (route) => route.abort());

    // 1. First load: onboarding.
    await page.goto('/');
    await expect(page.getByText('Continue without linking')).toBeVisible({ timeout: 30_000 });

    // 2. Empty universe in this browser.
    await page.getByText('Continue without linking').click();
    await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeVisible();

    // 3. Open a universe file through the ordinary Load → Local File path.
    const { file, protoName } = writeProbeFixture(testInfo.outputDir);
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByText('Load from Local File').click(),
    ]);
    await chooser.setFiles(file);
    await page.getByRole('dialog').getByRole('button', { name: 'Load', exact: true }).click();
    await page.waitForFunction(() => {
      const s = window.useGraphStore?.getState?.();
      return s && s.graphs.size > 0 && s.nodePrototypes.size > 1;
    }, null, { timeout: 30_000 });

    // Make sure a web is on the canvas (the fixture's active graph, or the first).
    await page.evaluate(() => {
      const s = window.useGraphStore.getState();
      if (!s.activeGraphId) {
        const first = [...s.graphs.keys()][0];
        s.openGraphTab?.(first);
        s.setActiveGraph?.(first);
      }
    });
    // The canvas draws the Thing's remote thumbnail as an SVG <image>.
    await page.waitForFunction(
      (src) => [...document.querySelectorAll('svg image')].some((el) => el.getAttribute('href') === src),
      REMOTE_IMAGE,
      { timeout: 30_000 }
    );

    // 4. The right panel on the Thing with the remote picture.
    await page.evaluate((name) => {
      const s = window.useGraphStore.getState();
      const hit = [...s.nodePrototypes.values()].find((p) => p.name === name);
      if (hit) s.openRightPanelNodeTab(hit.id, hit.name);
    }, protoName);
    // The panel's image section loads the remote picture over https.
    await page.waitForFunction(
      (src) => [...document.images].some((img) => img.currentSrc === src && img.complete && img.naturalWidth > 0),
      REMOTE_IMAGE,
      { timeout: 20_000 }
    );

    // 5. The HEIC path: a file the browser can't decode sends the upload to
    //    the lazily-loaded heic-to decoder (its own chunk, and a blob: worker),
    //    which then reports the file unreadable in an alert.
    const alertShown = page.waitForEvent('dialog', { timeout: 30_000 }).then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    const [imageChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTitle('Add image').first().click(),
    ]);
    await imageChooser.setFiles({ name: 'probe.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a heic file') });
    expect(await alertShown).toMatch(/Couldn't read this image/);

    // 6. An edit, so the save pipeline (save worker) runs.
    await page.evaluate(() => {
      const s = window.useGraphStore.getState();
      const id = [...s.nodePrototypes.keys()].find((k) => k !== 'base-thing-prototype');
      s.updateNodePrototype(id, (draft) => { draft.description = `${draft.description || ''} (csp probe)`; });
    });
    await page.waitForTimeout(4000);

    const workers = await page.evaluate(() => window.__cspWorkers);
    testInfo.annotations.push({ type: 'workers', description: workers.join(', ') });
    expect(workers.length, 'the app should have started at least one worker').toBeGreaterThan(0);

    expect(violations, 'securitypolicyviolation events').toEqual([]);
    expect(cspConsole, 'CSP console errors').toEqual([]);
  });

  // Control: proves the listener above would have caught a violation, so a
  // green run means "none happened" rather than "none were observable".
  test('the policy is in force: inline script and eval are refused', async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
    await page.goto('/');
    const outcome = await page.evaluate(async () => {
      const seen = [];
      document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true';
      document.body.appendChild(s);
      let evalRefused = false;
      // Page code, not the test harness, so the policy applies to it.
      const probe = document.createElement('script');
      probe.src = 'data:text/javascript,window.__dataScriptRan=true';
      document.body.appendChild(probe);
      try { window.setTimeout.call(window, 'window.__stringTimerRan = true', 0); } catch { /* refused */ }
      await new Promise((r) => setTimeout(r, 300));
      try { (0, window.eval)('1'); } catch { evalRefused = true; }
      return {
        seen,
        inlineRan: !!window.__inlineRan,
        dataScriptRan: !!window.__dataScriptRan,
        stringTimerRan: !!window.__stringTimerRan,
        evalRefused,
      };
    });
    expect(outcome.inlineRan).toBe(false);
    expect(outcome.dataScriptRan).toBe(false);
    expect(outcome.stringTimerRan).toBe(false);
    expect(outcome.seen.some((d) => d.startsWith('script-src'))).toBe(true);
  });
}
