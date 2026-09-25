// Runner for the perf scenarios (refactor P0.04). One Playwright test per
// scenario x fixture; each runs the scenario PERF_RUNS times (default 5), on a
// fresh page every time, and appends one JSON line per run to PERF_OUT.
// scripts/perf-canvas.mjs turns those lines into the median table.
//
// Fixtures (METRICS.md, D-15):
//   medium = chambers, the local-only snapshot of Grant's universe, on its
//            largest graph. Falls back to `stress` when the file is absent, and
//            the result says so. Only counts and timings are recorded: no names.
//   large  = stress, the committed ~600-node synthetic graph.
import { test } from '@playwright/test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { waitForCanvasReady, waitForCameraSettled, chambersPath } from '../../e2e/canvas/helpers.js';
import { SCENARIOS } from './scenarios.js';
import { countNodeCanvasRenders } from './selfRenders.js';
import { logCommits, formatCommitLog } from './commitLog.js';

const RUNS = Number(process.env.PERF_RUNS || 5);
const OUT = process.env.PERF_OUT || null;
const WANT = (process.env.PERF_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FIXTURES = (process.env.PERF_FIXTURES || 'medium,large').split(',');
// --explain: a folder to write each scenario's commit log to (commitLog.js).
const EXPLAIN = process.env.PERF_EXPLAIN || null;
const CHAMBERS = chambersPath();
let chambersText = null;

const wanted = (id) => !WANT.length || WANT.some((w) => id === w || id.startsWith(`${w}-`));

async function openMedium(page) {
  if (!CHAMBERS) return openLarge(page, 'stress (chambers absent)');
  chambersText ??= readFileSync(CHAMBERS, 'utf-8');
  await page.goto('/?fixture=small&probe=1');
  await page.waitForFunction(() => window.__fixture?.ready === true || !!window.__fixtureError, null, { timeout: 60_000 });
  const s = await page.evaluate(
    (data) => window.__loadFixture(data, { label: 'chambers', activeGraphId: 'largest', frame: true, thumbnails: 'placeholder' }),
    chambersText,
  );
  return { fixture: 'chambers', instances: s.instancesOnActive };
}

async function openLarge(page, label = 'stress') {
  await page.goto('/?fixture=stress&probe=1');
  await page.waitForFunction(() => window.__fixture?.ready === true || !!window.__fixtureError, null, { timeout: 60_000 });
  const err = await page.evaluate(() => window.__fixtureError || null);
  if (err) throw new Error(`fixture boot failed: ${err}`);
  const instances = await page.evaluate(() => window.__fixture.instancesOnActive);
  return { fixture: label, instances };
}

/** Wait until no NodeCanvas commit lands for `quietMs`. Measures nothing. */
async function waitForQuiet(page, { quietMs = 700, timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.evaluate(() => window.__renderProbe.start('quiet-check'));
    await page.waitForTimeout(quietMs);
    const r = await page.evaluate(() => window.__renderProbe.stop());
    if (r.commits === 0) return;
  }
  throw new Error(`canvas never went quiet for ${quietMs} ms`);
}

/** With a session running: return once `quietMs` passes with no new commit. */
async function settleSession(page, { quietMs = 500, timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = await page.evaluate(() => window.__renderProbe.peek().commits);
  while (Date.now() < deadline) {
    await page.waitForTimeout(quietMs);
    const now = await page.evaluate(() => window.__renderProbe.peek().commits);
    if (now === last) return;
    last = now;
  }
  throw new Error('commits never stopped after the scenario');
}

for (const scenario of SCENARIOS) {
  for (const size of scenario.fixtures) {
    if (!FIXTURES.includes(size)) continue;
    const id = size === 'large' ? `L-${scenario.id}` : scenario.id;
    if (!wanted(scenario.id) && !wanted(id)) continue;

    test(`${id} ${scenario.name}`, async ({ browser }) => {
      for (let run = 1; run <= RUNS; run++) {
        const context = await browser.newContext({ hasTouch: !!scenario.touch });
        await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
        await context.addInitScript(EXPLAIN ? logCommits : countNodeCanvasRenders);
        const page = await context.newPage();
        try {
          const fx = size === 'large' ? await openLarge(page) : await openMedium(page);
          await waitForCanvasReady(page);
          await waitForCameraSettled(page);
          await page.evaluate(() => {
            if (!window.__renderProbe) throw new Error('no __renderProbe: not the profile build?');
            if (!window.__nodeCanvasRenders?.found) throw new Error('NodeCanvas render counter never found the NodeCanvas fiber');
          });
          // NodeCanvas sets isInitialLoadComplete 2 s after it mounts (the
          // BackToCivilization delay). Keep that render out of the measurement.
          await page.waitForFunction(() => performance.now() - window.__nodeCanvasRenders.mountedAt > 2200);

          const ctx = {};
          if (scenario.setup) await scenario.setup(page, ctx);
          await waitForQuiet(page);

          await page.evaluate((label) => {
            Object.assign(window.__nodeCanvasRenders, { ran: 0, rendered: 0 });
            if (window.__commitLog) Object.assign(window.__commitLog, { on: true, t0: performance.now(), commits: [] });
            window.__renderProbe.start(label);
          }, id);
          const extra = (await scenario.run(page, ctx)) || {};
          await settleSession(page);
          const r = await page.evaluate(() => ({
            ...window.__renderProbe.stop(),
            ncRan: window.__nodeCanvasRenders.ran,
            ncRendered: window.__nodeCanvasRenders.rendered,
            log: window.__commitLog?.commits ?? null,
          }));
          if (EXPLAIN) writeFileSync(path.join(EXPLAIN, `${id}.txt`), formatCommitLog(id, r, r.log));

          const row = {
            id, run, fixture: fx.fixture, instances: fx.instances,
            commits: r.commits, ncRan: r.ncRan, ncRendered: r.ncRendered, totalMs: r.totalMs, maxMs: r.maxMs, wallMs: r.wallMs, ...extra,
          };
          console.log(`[perf] ${JSON.stringify(row)}`);
          if (OUT) appendFileSync(OUT, `${JSON.stringify(row)}\n`);
        } finally {
          await context.close();
        }
      }
    });
  }
}
