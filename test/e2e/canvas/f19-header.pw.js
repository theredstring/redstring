// F19: the header's controls still reach the stores and the canvas. Since P2.08
// Header is wired by HeaderHost (stores, the canvas command registry, a file
// actions module) instead of by NodeCanvas props.
import { test, expect, openFixture, storeEval, activeGraphSnapshot } from './helpers.js';

const ui = (page, key) => page.evaluate(async (k) => {
  const { default: store } = await import('/src/store/canvasUIStore.js');
  const v = store.getState()[k];
  return v && typeof v === 'object' && 'visible' in v ? v.visible : v;
}, key);

const setUI = (page, setter, value) => page.evaluate(async ([s, v]) => {
  const { default: store } = await import('/src/store/canvasUIStore.js');
  store.getState()[s](v);
}, [setter, value]);

const headerButton = (page, title) => page.locator(`.header-action-btn[title="${title}"]:visible`).first();

const movedCount = (before, after) => Object.keys(before.instances).filter((id) => {
  const a = before.instances[id];
  const b = after.instances[id];
  return b && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5);
}).length;

test('F19 header buttons: bookmark, new web, both searches, and renaming the web', async ({ page }) => {
  await openFixture(page, 'small');

  const bookmarked = () => storeEval(page, (st) => {
    const d = st.graphs.get(st.activeGraphId)?.definingNodeIds?.[0];
    return st.savedNodeIds.has(d);
  });
  const before = await bookmarked();
  await headerButton(page, before ? 'Remove Bookmark' : 'Add Bookmark').click();
  await expect.poll(bookmarked).toBe(!before);
  await expect(headerButton(page, before ? 'Add Bookmark' : 'Remove Bookmark')).toBeVisible();

  await headerButton(page, 'Create New Thing').click();
  await expect.poll(() => ui(page, 'newWebPrompt')).toBe(true);
  await setUI(page, 'setNewWebPrompt', { visible: false });

  await headerButton(page, 'Search All Things').click();
  await expect.poll(() => ui(page, 'headerAllThingsSearchVisible')).toBe(true);
  await setUI(page, 'setHeaderAllThingsSearchVisible', false);

  const webName = await storeEval(page, (st) => st.graphs.get(st.activeGraphId).name);
  await headerButton(page, `Search ${webName}`).click();
  await expect.poll(() => ui(page, 'headerSearchVisible')).toBe(true);
  await setUI(page, 'setHeaderSearchVisible', false);

  const activeId = await storeEval(page, (st) => st.activeGraphId);
  await page.locator(`[data-header-tab-id="${activeId}"]`).dblclick();
  const input = page.locator('input.editable-title-input');
  await expect(input).toBeVisible();
  await expect.poll(() => ui(page, 'isHeaderEditing')).toBe(true);
  await input.fill('Renamed Web');
  await input.press('Enter');
  await expect.poll(() => storeEval(page, (st) => st.graphs.get(st.activeGraphId).name)).toBe('Renamed Web');
  await expect.poll(() => ui(page, 'isHeaderEditing')).toBe(false);
});

test("F19b the Redstring menu's View > Auto Layout reaches the canvas", async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);

  await page.locator('.header-logo-button').click();
  await page.locator('.menu-item', { hasText: /^View$/ }).first().hover();
  await page.locator('.submenu-item', { hasText: 'Auto Layout' }).click();

  await expect.poll(async () => movedCount(before, await activeGraphSnapshot(page)), { timeout: 10_000 })
    .toBeGreaterThan(0);
});
