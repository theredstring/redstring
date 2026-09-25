// F21: the TypeList's type chips act on the canvas. Since P2.10 TypeList reads
// selection and nodes from the stores when clicked instead of NodeCanvas props.
import { test, expect, openFixture, storeEval, selectedNodeIds } from './helpers.js';

const setSelection = (page, ids) => page.evaluate(async (list) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  ui.getState().setSelectedInstanceIds(new Set(list));
}, ids);

// Make Beta a type in use on the active web (by typing one other node with it),
// so the node-types list shows a Beta chip.
async function setUpBetaType(page) {
  return storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    const typed = [...g.instances.values()].find((i) => !i.isGroupAnchor && !['p-alpha', 'p-beta'].includes(i.prototypeId));
    st.setNodeType(typed.prototypeId, 'p-beta');
    st.setTypeListMode('node');
    const betaInstances = [...g.instances.values()].filter((i) => i.prototypeId === 'p-beta').map((i) => i.id);
    return { typedInstanceId: typed.id, betaName: st.nodePrototypes.get('p-beta').name, betaInstances };
  });
}

// B-13: with nodes selected, TypeList passed instance ids to setNodeType,
// which looks up prototypes, so nothing was typed.
test('F21 with Alpha selected, clicking a type chip types Alpha (B-13)', async ({ page }) => {
  await openFixture(page, 'small');
  const { betaName } = await setUpBetaType(page);
  await setSelection(page, ['i-alpha']);

  await page.locator('.node-type-item', { hasText: betaName }).first().click();
  await expect.poll(() => storeEval(page, (st) => st.nodePrototypes.get('p-alpha').typeNodeId)).toBe('p-beta');
});

test('F21b with nothing selected, clicking a type chip selects its nodes', async ({ page }) => {
  await openFixture(page, 'small');
  const { typedInstanceId, betaName } = await setUpBetaType(page);
  await setSelection(page, []);

  await page.locator('.node-type-item', { hasText: betaName }).first().click();
  await expect.poll(() => selectedNodeIds(page)).toEqual([typedInstanceId]);
});
