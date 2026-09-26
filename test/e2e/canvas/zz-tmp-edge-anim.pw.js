// TEMP: film the connection animations. Delete after.
import { test, expect, openFixture, nodeBox, centerOf, activeGraphSnapshot, storeEval } from './helpers.js';

const sampleFrames = (page, ms) => page.evaluate((ms) => new Promise((resolve) => {
  const out = []; const start = performance.now();
  const tick = () => {
    const host = document.querySelector('[data-edge-transitions]');
    const morph = document.querySelector('svg.canvas path:not([data-edge-hit]):not([data-edge-main])[stroke^="rgb("]');
    const maskPath = host?.querySelector('mask path');
    const labels = [...document.querySelectorAll('svg.canvas [data-edge-label]')].map(l => getComputedStyle(l).opacity).filter(o => o !== '1');
    out.push({
      t: Math.round(performance.now() - start),
      morphBeforeWrapper: morph ? morph.nextElementSibling?.hasAttribute('data-edge-id') : null,
      ghost: !!host?.querySelector(':scope > g'), dash: maskPath?.getAttribute('stroke-dasharray')?.slice(0, 5),
      labelOpacities: labels.join(','),
    });
    if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve(out);
  };
  tick();
}), ms);
const log = (tag, f) => console.log(tag, JSON.stringify(f.filter((_, i) => i % 3 === 0)));

test('tmp edge animations', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const from = centerOf(await nodeBox(page, 'i-gamma'));
  const to = centerOf(await nodeBox(page, 'i-epsilon'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) await page.mouse.move(from.x + ((to.x + 20 - from.x) * i) / 16, from.y + ((to.y + 10 - from.y) * i) / 16);
  const hp = sampleFrames(page, 500);
  await page.mouse.up();
  await page.waitForTimeout(290);
  await page.screenshot({ path: 'test/e2e/canvas/.results/tmp-1-fadein.png' });
  log('HANDOFF', await hp);
  const newId = (await activeGraphSnapshot(page)).edgeIds.find(id => !before.edgeIds.includes(id));
  await expect(page.locator('[data-edge-transitions] > *')).toHaveCount(0);

  const rp = sampleFrames(page, 350);
  await storeEval(page, (st, id) => st.removeEdge(id), newId);
  await page.waitForTimeout(110);
  await page.screenshot({ path: 'test/e2e/canvas/.results/tmp-2-retract.png' });
  log('RETRACT', await rp);

  // Self-loop via the dialog
  const alpha = await nodeBox(page, 'i-alpha');
  const c = centerOf(alpha);
  const out = { x: c.x, y: alpha.y - 60 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x, c.y + ((out.y - c.y) * i) / 8);
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + 10, out.y + ((c.y - out.y) * i) / 8);
  await page.mouse.up();
  await page.getByText('Self-referential connection?').waitFor();
  const tp = sampleFrames(page, 600);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test/e2e/canvas/.results/tmp-3-trace.png' });
  log('TRACE', await tp);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/e2e/canvas/.results/tmp-4-trace-end.png' });
  await expect(page.locator('[data-edge-transitions] > *')).toHaveCount(0);
});
