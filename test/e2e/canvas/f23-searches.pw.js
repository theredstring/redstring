// F23: the header's New Thing prompt and component search act on the store and
// the canvas. Since P2.06d they render from SearchHosts, and the search's
// camera move is the navigateToPrototypeInstances canvas command.
import { test, expect, openFixture, storeEval, camera, waitForCameraSettled } from './helpers.js';

const openUI = (page, setter, value) => page.evaluate(async ([s, v]) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  ui.getState()[s](v);
}, [setter, value]);

test('F23 New Thing: naming it creates a web defined by a new Thing and opens it', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await storeEval(page, (st) => st.graphs.size);
  await openUI(page, 'setNewWebPrompt', { visible: true });
  const input = page.locator('input.unified-selector-control').first();
  await expect(input).toBeVisible();
  await input.fill('Fresh Web');
  await input.press('Enter');
  await expect.poll(() => storeEval(page, (st) => st.graphs.size)).toBe(before + 1);
  await expect.poll(() => storeEval(page, (st) => st.graphs.get(st.activeGraphId)?.name)).toBe('Fresh Web');
  await expect(input).toHaveCount(0);
});

test('F23b component search: picking a Thing opens its tab and flies the camera to it', async ({ page }) => {
  await openFixture(page, 'small');
  const { name } = await storeEval(page, (st) => ({ name: st.nodePrototypes.get('p-gamma')?.name }));
  test.skip(!name, 'fixture has no p-gamma');
  await waitForCameraSettled(page);
  const cam0 = await camera(page);

  await openUI(page, 'setHeaderSearchVisible', true);
  const card = page.locator('.unified-selector-card', { hasText: name }).first();
  await expect(card).toBeVisible();
  await card.click();

  await expect.poll(() => storeEval(page, (st) => st.rightPanelTabs.find((t) => t.isActive)?.nodeId)).toBe('p-gamma');
  await expect.poll(async () => {
    const c = await camera(page);
    return Math.hypot(c.pan.x - cam0.pan.x, c.pan.y - cam0.pan.y) + Math.abs(c.zoom - cam0.zoom);
  }, { timeout: 8_000 }).toBeGreaterThan(1);
});
