// SCRATCH (not for commit): does opening and combining a box leave anything behind?
import { test, expect, storeEval, openFixture, pieButton, openPieMenu, waitForCameraSettled, nextFrames } from './helpers.js';
const WEB = 'g-small-a';
const CLUSTER = '00000000-0000-4000-8100-000000000005';
const CYCLES = 15;

async function snapshot(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map(x => [x.name, x.value]));
  const dom = await page.evaluate(() => ({
    styles: document.querySelectorAll('style[data-box-morph]').length,
    standIns: document.querySelector('[data-box-morphs]')?.childElementCount ?? -1,
    animations: document.getAnimations().length,
    svgNodes: document.querySelector('svg.canvas')?.getElementsByTagName('*').length,
  }));
  return { heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, layout: m.LayoutObjects, ...dom };
}

// Average frame interval while the page zooms itself by wheel for ~1.5s.
async function frameCost(page) {
  const box = await page.locator('svg.canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    window.__frames = [];
    const tick = (t) => { window.__frames.push(t); if (window.__frames.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i % 2 ? 120 : -120); await page.waitForTimeout(40); }
  return page.evaluate(() => {
    const f = window.__frames; const d = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    d.sort((a, b) => a - b);
    return { frames: d.length, medianMs: +d[Math.floor(d.length / 2)].toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2) };
  });
}

async function cycle(page) {
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click();
  await nextFrames(page, 20);
  await pieButton(page, 'package-open').click();
  await expect.poll(() => storeEval(page, (st, [w, c]) => !!st.graphs.get(w).instances.get(c).openDefinition, [WEB, CLUSTER])).toBe(true);
  await page.waitForTimeout(600);
  await page.locator('[title="Combine Into Thing"]').first().click();
  await expect.poll(() => storeEval(page, (st, [w, c]) => !st.graphs.get(w).instances.get(c).openDefinition, [WEB, CLUSTER])).toBe(true);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.mouse.click(1200, 700);
  await waitForCameraSettled(page);
}

for (const motion of ['no-preference', 'reduce']) {
  test(`leak probe, motion=${motion}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: motion });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await openFixture(page, 'small');
    await storeEval(page, (st, w) => st.collapseNodeGroupIntoDefinition(w, '00000000-0000-4000-8100-000000000006'), WEB);
    await waitForCameraSettled(page);
    await cycle(page); // warm up: first-use code and caches
    const before = await snapshot(page, cdp);
    const fpsBefore = await frameCost(page);
    await waitForCameraSettled(page);
    for (let i = 0; i < CYCLES; i++) await cycle(page);
    const after = await snapshot(page, cdp);
    const fpsAfter = await frameCost(page);
    console.log(`[${motion}] before`, JSON.stringify(before), JSON.stringify(fpsBefore));
    console.log(`[${motion}] after `, JSON.stringify(after), JSON.stringify(fpsAfter));
  });
}
