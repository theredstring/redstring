// F26: deleting nodes plays a shrink ghost per node, and each ghost removes
// itself. Since P2.07 the ghosts live in canvasUIStore and DeletionGhostLayer.
import { test, expect, openFixture, storeEval } from './helpers.js';

test('F26 deleting two nodes shows two ghosts, which clear themselves', async ({ page }) => {
  await openFixture(page, 'small');
  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setSelectedInstanceIds(new Set(['i-alpha', 'i-beta']));
  });
  await page.locator('svg.canvas').focus().catch(() => {});
  await page.keyboard.press('Delete');

  await expect(page.locator('rect.node-delete-ghost')).toHaveCount(2);
  await expect.poll(() => storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    return [g.instances.has('i-alpha'), g.instances.has('i-beta')];
  })).toEqual([false, false]);
  await expect(page.locator('rect.node-delete-ghost')).toHaveCount(0, { timeout: 5_000 });
  const left = await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return ui.getState().deletionGhosts.length;
  });
  expect(left).toBe(0);
});
