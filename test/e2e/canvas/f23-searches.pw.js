// F23: the header's New Thing prompt and search act on the store and the
// canvas. Since P2.06d they render from SearchHosts, and This Web's camera move
// is the navigateToPrototypeInstances canvas command.
import { test, expect, openFixture, storeEval, camera, waitForCameraSettled } from './helpers.js';

const openUI = (page, setter, value) => page.evaluate(async ([s, v]) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  ui.getState()[s](v);
}, [setter, value]);

// Opens search where it looks from, and waits out the selector's first 250 ms,
// when it drops clicks (INPUT_GRACE_MS: the second click of the one that opened it).
const openSearch = async (page, scope) => {
  await openUI(page, 'setSearchScope', scope);
  await expect(page.locator('.unified-selector-card').first()).toBeVisible();
  await page.waitForTimeout(300);
};

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

test('F23b search this web: picking a Thing opens its tab and flies the camera to it', async ({ page }) => {
  await openFixture(page, 'small');
  const { name } = await storeEval(page, (st) => ({ name: st.nodePrototypes.get('p-gamma')?.name }));
  test.skip(!name, 'fixture has no p-gamma');
  await waitForCameraSettled(page);
  const cam0 = await camera(page);

  await openSearch(page, 'this-web');
  const card = page.locator('.unified-selector-card', { hasText: name }).first();
  await expect(card).toBeVisible();
  await card.click();

  await expect.poll(() => storeEval(page, (st) => st.rightPanelTabs.find((t) => t.isActive)?.nodeId)).toBe('p-gamma');
  await expect.poll(async () => {
    const c = await camera(page);
    return Math.hypot(c.pan.x - cam0.pan.x, c.pan.y - cam0.pan.y) + Math.abs(c.zoom - cam0.zoom);
  }, { timeout: 8_000 }).toBeGreaterThan(1);
});

test('F23c search moves between where it looks, keeping what is typed', async ({ page }) => {
  await openFixture(page, 'small');
  const name = await storeEval(page, (st) => st.nodePrototypes.get('p-gamma')?.name);
  test.skip(!name, 'fixture has no p-gamma');
  await storeEval(page, (st) => { st.closeGraph(st.activeGraphId); });

  await openUI(page, 'setSearchScope', 'open-webs');
  const input = page.locator('input.unified-selector-control').first();
  await input.fill(name);
  const title = page.locator('.unified-selector-title-menu');
  await expect(title).toHaveText('Search Open Webs');
  await title.click();
  await page.locator('.context-menu-item', { hasText: 'Search Everything' }).click();

  await expect(title).toHaveText('Search Everything');
  await expect(input).toHaveValue(name);
  await expect(page.locator('.unified-selector-card', { hasText: name }).first()).toBeVisible();
});

test('F23d search never makes a Web: one opens, none opens the tab, several are chosen from', async ({ page }) => {
  await openFixture(page, 'small');
  const ids = await storeEval(page, (st) => {
    return { size: st.graphs.size, thing: [...st.nodePrototypes.values()].find(p => !p.definitionGraphIds?.length && p.id !== 'base-thing-prototype' && p.name)?.id };
  });
  test.skip(!ids.thing, 'fixture has no Thing without a Web');

  await openSearch(page, 'everything');
  const name = await storeEval(page, (st, id) => st.nodePrototypes.get(id).name, ids.thing);
  await page.locator('.unified-selector-card', { hasText: name }).first().click();
  await expect.poll(() => storeEval(page, (st) => st.rightPanelTabs.find((t) => t.isActive)?.nodeId)).toBe(ids.thing);
  expect(await storeEval(page, (st) => st.graphs.size)).toBe(ids.size);

  // Two Webs: their cards, with no New Web among them, and the second opens.
  const webs = await storeEval(page, (st, id) => [
    st.createAndAssignGraphDefinitionWithoutActivation(id),
    st.createAndAssignGraphDefinitionWithoutActivation(id),
  ], ids.thing);
  await openSearch(page, 'everything');
  await page.locator('.unified-selector-card', { hasText: name }).first().click();
  await expect(page.getByText('Choose a Web to open')).toBeVisible();
  const cards = page.locator('.unified-selector-card');
  await expect(cards).toHaveCount(2);
  // A page of its own, with the same first 250 ms: a double click on the Thing
  // doesn't also choose a Web.
  await page.waitForTimeout(300);
  await cards.nth(1).click();
  await expect.poll(() => storeEval(page, (st) => st.activeGraphId)).toBe(webs[1]);
  expect(await storeEval(page, (st) => st.graphs.size)).toBe(ids.size + 2);
});

test('F23e read-only: search reads the same, the + is gone, and Auto Layout is dimmed', async ({ page }) => {
  await openFixture(page, 'small');
  const ids = await storeEval(page, (st) => ({
    size: st.graphs.size,
    thing: [...st.nodePrototypes.values()].find(p => !p.definitionGraphIds?.length && p.id !== 'base-thing-prototype' && p.name),
  }));
  test.skip(!ids.thing, 'fixture has no Thing without a Web');
  await page.evaluate(async () => {
    const { setReadOnlyUniverse } = await import('/src/store/readOnlyUniverse.js');
    setReadOnlyUniverse({ slug: 'link', name: 'Link', sourceUrl: 'https://example.com/a.redstring' });
  });

  await expect(page.locator('.header-action-btn[title="Create or Open Web"]:visible')).toHaveCount(0);
  await expect(page.locator('.header-action-btn[title="Make a copy to edit"]:visible').first()).toHaveAttribute('data-disabled', 'true');

  const nudges = () => page.evaluate(async () => {
    const { default: store } = await import('/src/store/readOnlyUniverse.js');
    return store.getState().nudge;
  });
  const nudged = await nudges();
  await openSearch(page, 'everything');
  await page.locator('.unified-selector-card', { hasText: ids.thing.name }).first().click();
  await expect.poll(() => storeEval(page, (st) => st.rightPanelTabs.find((t) => t.isActive)?.nodeId)).toBe(ids.thing.id);
  expect(await nudges()).toBe(nudged);
  expect(await storeEval(page, (st) => st.graphs.size)).toBe(ids.size);

  // However the + was asked for, it's search.
  await openUI(page, 'setNewWebPrompt', { visible: true });
  await expect(page.locator('.unified-selector-title-menu')).toHaveText('Search Everything');
});
