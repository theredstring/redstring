// F20: the Panels still reach the canvas and follow the stores. Since P2.09
// each Panel is wired by PanelHost, the hurtle goes through the canvas command
// registry, and views that show live graph data subscribe for themselves.
import { test, expect, openFixture, storeEval } from './helpers.js';

const openLeftView = (page, view) => page.evaluate(async (v) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  window.useGraphStore.getState().setLeftPanelExpanded(true);
  ui.getState().openLeftPanelView(v);
}, view);

test("F20 the right panel's Expand definition hurtles into the definition graph", async ({ page }) => {
  await openFixture(page, 'small');
  const defGraphId = await storeEval(page, (st) => {
    st.createAndAssignGraphDefinitionWithoutActivation('p-alpha');
    const s = window.useGraphStore.getState();
    s.openRightPanelNodeTab('p-alpha');
    s.setRightPanelExpanded(true);
    return s.nodePrototypes.get('p-alpha').definitionGraphIds[0];
  });

  await page.locator('[title="Expand definition"]:visible').first().click();
  await expect.poll(() => storeEval(page, (st) => st.activeGraphId), { timeout: 10_000 }).toBe(defGraphId);
});

test('F20b Semantic Discovery offers the one selected node', async ({ page }) => {
  await openFixture(page, 'small');
  await openLeftView(page, 'semantic');
  const chip = page.locator('[title="Quick search from Selected"]');
  await expect(chip).toHaveCount(0);

  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setSelectedInstanceIds(new Set(['i-alpha']));
  });
  await expect(chip).toBeVisible();
  const alphaName = await storeEval(page, (st) => st.nodePrototypes.get('p-alpha').name);
  await expect(chip).toContainText(alphaName);

  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setSelectedInstanceIds(new Set());
  });
  await expect(chip).toHaveCount(0);
});

test('F20c the Open Webs list follows the store', async ({ page }) => {
  await openFixture(page, 'small');
  await openLeftView(page, 'grid');
  const { openCount, activeId } = await storeEval(page, (st) => ({
    openCount: new Set(st.openGraphIds.filter((id) => st.graphs.has(id))).size,
    activeId: st.activeGraphId,
  }));
  const items = page.locator('[data-graph-id]');
  await expect(items).toHaveCount(openCount);

  await storeEval(page, (st, id) => st.updateGraph(id, (d) => { d.name = 'Renamed In Store'; }), activeId);
  await expect(page.locator(`[data-graph-id="${activeId}"]`)).toHaveAttribute('title', 'Renamed In Store');
});
