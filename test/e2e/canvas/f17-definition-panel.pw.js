// F17: the right panel's Components list follows the definition chosen for a
// node (B-08, B-11). The index lives in canvasUIStore since P2.03; before
// that, the panel read a graphStore field that never existed and always
// listed the first definition's components.
import { test, expect, openFixture, storeEval } from './helpers.js';

test('F17 the panel lists the components of the definition chosen for the node', async ({ page }) => {
  await openFixture(page, 'small');
  const { key, secondIndex } = await storeEval(page, (st) => {
    st.createAndAssignGraphDefinitionWithoutActivation('p-alpha');
    st.createAndAssignGraphDefinitionWithoutActivation('p-alpha');
    const s = window.useGraphStore.getState();
    const ids = s.nodePrototypes.get('p-alpha').definitionGraphIds;
    // The second new definition holds one Beta; the one before it is empty.
    s.addNodeInstance(ids[ids.length - 1], 'p-beta', { x: 0, y: 0 });
    s.openRightPanelNodeTab('p-alpha');
    s.setRightPanelExpanded(true);
    return { key: `p-alpha-${s.activeGraphId}`, secondIndex: ids.length - 1 };
  });
  const setDefinition = (i) => page.evaluate(async ([k, index]) => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setNodeDefinitionIndex(k, index);
  }, [key, i]);

  const empty = page.getByText('No components in this definition.');
  await setDefinition(secondIndex - 1);
  await expect(empty).toBeVisible();
  await setDefinition(secondIndex);
  await expect(empty).toHaveCount(0);
  await setDefinition(secondIndex - 1);
  await expect(empty).toBeVisible();
});
