// F28: the hover vision aid shows what is under the pointer: a node after a
// short dwell, and a header button's label. Since P2.13 its state lives in
// canvasUIStore, HoverVisionAidLayer reads it, and buttons report through
// setActionHover instead of a NodeCanvas callback.
import { test, expect, openFixture, nodeBox, centerOf, storeEval } from './helpers.js';

test('F28 hovering a node, then a header button, shows each in the vision aid', async ({ page }) => {
  await openFixture(page, 'small');
  const aid = page.locator('.hover-vision-aid');
  const alphaName = await storeEval(page, (st) => st.nodePrototypes.get('p-alpha').name);

  const c = centerOf(await nodeBox(page, 'i-alpha'));
  await page.mouse.move(c.x - 5, c.y);
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await expect(aid).toContainText(alphaName, { timeout: 5_000 });

  await page.locator('.header-action-btn[title="Create New Thing"]:visible').first().hover();
  await expect(aid).toContainText('Create New Thing', { timeout: 5_000 });
});
