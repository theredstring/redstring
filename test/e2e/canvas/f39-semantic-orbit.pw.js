// F39 (P5.08): the semantic orbit. Orbit on a Thing's pie turns orbit mode on:
// the dim rect covers the canvas and the orbit layer mounts. A click on the dim
// rect leaves orbit mode. Candidates come from the network, which e2e blocks, so
// this checks the mode and its exit, not the rings.
import {
  test, expect, openFixture, pieButton, openPieMenu, clickCenter, waitForCameraSettled,
} from './helpers.js';

const orbitActive = (page) => page.evaluate(async () => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  return ui.getState().semanticOrbitActive;
});

test('F39 Orbit opens orbit mode; clicking the dim rect leaves it', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');

  // Orbit is on a later page: step right (as F6 does) until it shows.
  for (let i = 0; i < 4 && !(await pieButton(page, 'orbit').count()); i++) {
    const chevrons = page.locator('svg.canvas g.pie-chevron-intro');
    const [a, b] = await Promise.all([chevrons.nth(0).boundingBox(), chevrons.nth(1).boundingBox()]);
    await clickCenter(page, chevrons.nth(a.x > b.x ? 0 : 1));
    await page.waitForTimeout(400);
  }
  await clickCenter(page, pieButton(page, 'orbit'));

  await expect.poll(() => orbitActive(page)).toBe(true);
  await expect(page.locator('svg.canvas rect[data-orbit-dim]')).toHaveCount(1);
  await waitForCameraSettled(page);

  // A click well away from the focus node lands on the dim rect.
  await page.mouse.click(60, 700);
  await expect.poll(() => orbitActive(page)).toBe(false);
  await expect(page.locator('svg.canvas rect[data-orbit-dim]')).toHaveCount(0);
});
