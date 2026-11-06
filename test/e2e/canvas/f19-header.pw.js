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

test('F19 header buttons: bookmark, new web, search, auto layout, and renaming the web', async ({ page }) => {
  await openFixture(page, 'small');

  const bookmarked = () => storeEval(page, (st) => {
    const d = st.graphs.get(st.activeGraphId)?.definingNodeIds?.[0];
    return st.savedNodeIds.has(d);
  });
  const before = await bookmarked();
  await headerButton(page, before ? 'Remove Bookmark' : 'Add Bookmark').click();
  await expect.poll(bookmarked).toBe(!before);
  await expect(headerButton(page, before ? 'Add Bookmark' : 'Remove Bookmark')).toBeVisible();

  await headerButton(page, 'Create or Open Web').click();
  await expect.poll(() => ui(page, 'newWebPrompt')).toBe(true);
  await setUI(page, 'setNewWebPrompt', { visible: false });

  await headerButton(page, 'Search Everything').click();
  await expect.poll(() => ui(page, 'searchScope')).toBe('everything');
  await setUI(page, 'setSearchScope', null);

  const beforeLayout = await activeGraphSnapshot(page);
  await headerButton(page, 'Auto Layout Web').click();
  await expect.poll(async () => movedCount(beforeLayout, await activeGraphSnapshot(page)), { timeout: 10_000 })
    .toBeGreaterThan(0);

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

// B-12: Header took neither onSnapToGrid nor the grid appearance props, so
// these two menu items did nothing.
test('F19c View > Snap to Grid and View > Grid > Dot reach the canvas (B-12)', async ({ page }) => {
  await openFixture(page, 'small');
  const { graphId, instanceId } = await storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    const [id] = [...g.instances].find(([, inst]) => !inst.isGroupAnchor);
    st.updateNodeInstance(st.activeGraphId, id, (draft) => { draft.x += 37; draft.y += 23; });
    return { graphId: st.activeGraphId, instanceId: id };
  });
  const position = () => storeEval(page, (st, [g, i]) => {
    const inst = st.graphs.get(g).instances.get(i);
    return { x: inst.x, y: inst.y };
  }, [graphId, instanceId]);
  const offGrid = await position();

  const openView = async () => {
    await page.locator('.header-logo-button').click();
    await page.locator('.menu-item', { hasText: /^View$/ }).first().hover();
  };

  await openView();
  await page.locator('.submenu-item', { hasText: 'Snap to Grid' }).click();
  await expect.poll(async () => {
    const p = await position();
    return Math.abs(p.x - offGrid.x) + Math.abs(p.y - offGrid.y);
  }, { timeout: 10_000 }).toBeGreaterThan(0.5);

  const appearance = () => storeEval(page, (st) => st.gridSettings?.appearance || 'lattice');
  expect(await appearance()).toBe('lattice');
  // Snap to Grid leaves the menu open; the logo again would close it.
  await page.locator('.menu-item', { hasText: /^View$/ }).first().hover();
  await page.locator('.submenu-item.has-submenu', { hasText: /^Grid/ }).hover();
  await page.locator('.submenu-item', { hasText: /^Dot/ }).click();
  await expect.poll(appearance).toBe('dot');
});

test('F19d a press on a nested menu item lands: File > Export keeps its submenu to the click', async ({ page }) => {
  await openFixture(page, 'small');
  await page.evaluate(() => {
    window.__landed = [];
    document.addEventListener('click', (e) => {
      const item = e.target.closest?.('.recent-file-item');
      if (item) { window.__landed.push(item.innerText); e.preventDefault(); e.stopPropagation(); }
    }, true);
  });
  await page.locator('.header-logo-button').click();
  await page.locator('.menu-item', { hasText: /^File$/ }).first().hover();
  await page.locator('.submenu-item.has-submenu', { hasText: /^Export/ }).hover();
  await page.locator('.recent-file-item', { hasText: 'JSON' }).click();
  expect(await page.evaluate(() => window.__landed)).toHaveLength(1);
});

test('F19e the menu works from the keyboard: focus opens each level and an item takes Enter', async ({ page }) => {
  await openFixture(page, 'small');
  const appearance = () => storeEval(page, (st) => st.gridSettings?.appearance || 'lattice');
  await page.locator('.header-logo-button').click();
  await page.locator('.menu-item', { hasText: /^View$/ }).first().focus();
  const grid = page.locator('.submenu-item.has-submenu', { hasText: /^Grid/ });
  await expect(grid).toBeVisible();
  await grid.focus();
  const dot = page.locator('.submenu-item', { hasText: /^Dot/ });
  await expect(dot).toBeVisible();
  await dot.focus();
  await expect(dot).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(appearance).toBe('dot');
  // Another menu takes over from the nested one.
  await page.locator('.menu-item', { hasText: /^File$/ }).first().focus();
  await expect(dot).toHaveCount(0);
  await expect(page.locator('.submenu-item', { hasText: 'Import Ontology' })).toBeVisible();
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
