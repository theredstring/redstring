// F45: Merge on the multi-select panel proposes merging the selected Things.
// The panel press opens the merge modal on its Selected page; the merge is the
// second press, made there, and one undo puts every Thing back.
import { test, expect, openFixture, storeEval } from './helpers.js';

const setSelection = (page, ids) => page.evaluate(async (list) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  ui.getState().setSelectedInstanceIds(new Set(list));
}, ids);

const livePrototypes = (page, ids) => storeEval(page, (st, list) => list.filter((id) => st.nodePrototypes.has(id)), ids);

test('F45 merging a selection goes through its own page and undoes in one step', async ({ page }) => {
  await openFixture(page, 'small');
  await setSelection(page, ['i-alpha', 'i-beta']);

  const mergeButton = page.locator('.unified-bottom-panel.mode-nodes .piemenu-button[title="Merge"]');
  await expect(mergeButton).toBeVisible();
  await mergeButton.click();

  const modal = page.locator('.canvas-modal');
  await expect(modal.locator('h2')).toHaveText('Selected');
  await expect(modal).toContainText('Alpha');
  await expect(modal).toContainText('Beta');
  // The first press only proposes.
  expect(await livePrototypes(page, ['p-alpha', 'p-beta'])).toEqual(['p-alpha', 'p-beta']);

  await modal.getByRole('button', { name: 'Merge 2' }).click();
  await expect(modal).toContainText('Merged into');
  expect(await livePrototypes(page, ['p-alpha', 'p-beta'])).toHaveLength(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => livePrototypes(page, ['p-alpha', 'p-beta'])).toEqual(['p-alpha', 'p-beta']);
  await expect(modal.getByRole('button', { name: 'Merge 2' })).toBeVisible();
});
