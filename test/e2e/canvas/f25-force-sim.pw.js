// F25: the force-simulation tuner works on the live canvas. Since P2.06f it
// renders from ForceSimHost and reads the canvas's nodes through the
// layoutNodes canvas command.
import { test, expect, openFixture, activeGraphSnapshot } from './helpers.js';

const movedCount = (before, after) => Object.keys(before.instances).filter((id) => {
  const a = before.instances[id];
  const b = after.instances[id];
  return b && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5);
}).length;

test('F25 the force-sim tuner opens from the store and Randomize moves the nodes', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setForceSimModalVisible(true);
  });
  const header = page.locator('.force-sim-header');
  await expect(header).toBeVisible();
  await page.locator('.rs-pill-btn', { hasText: 'Randomize' }).click();
  await expect.poll(async () => movedCount(before, await activeGraphSnapshot(page)), { timeout: 8_000 }).toBeGreaterThan(0);

  await page.locator('.force-sim-close').click();
  await expect(header).toHaveCount(0);
});
