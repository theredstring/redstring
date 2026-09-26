// F39: Decompose opens a Thing onto its definition itself (core/openDefinitions.js).
// Nothing is copied: the definition's own nodes draw inside the box, moving one
// moves it in the definition, a connection made from inside to outside stays in
// the outer web, and closing the box draws that connection to the Thing.
//
// Fixture "small": Cluster (instance ...05 on web A) is defined by a web holding
// Zeta ...09 → Eta ...0a, and is already expanded the old way — a copy-style
// node-group (...06) around copies i-zeta and i-eta. That is the state existing
// files are in, so each test first closes that box (the group panel's Combine).
import {
  test, expect, storeEval, openFixture, nodeBox, pieButton, openPieMenu,
  waitForCameraSettled, nextFrames,
} from './helpers.js';

const WEB = 'g-small-a';
const CLUSTER = '00000000-0000-4000-8100-000000000005';
const OLD_COPY_GROUP = '00000000-0000-4000-8100-000000000006';
const DEF = '00000000-0000-4000-8100-000000000004';
const ZETA = '00000000-0000-4000-8100-000000000009';
const ETA = '00000000-0000-4000-8100-00000000000a';

const node = (page, id) => page.locator(`svg.canvas g.node[data-instance-id="${id}"]`);
const edge = (page, id) => page.locator(`svg.canvas [data-edge-id="${id}"]`);
const counts = (page) => storeEval(page, (st, [w, d]) => ({
  web: st.graphs.get(w).instances.size,
  definition: st.graphs.get(d).instances.size,
}), [WEB, DEF]);

async function closeOldCopyBox(page) {
  const survivor = await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  expect(survivor).toBe(CLUSTER);
  await expect(node(page, 'i-zeta')).toHaveCount(0);
  await expect(node(page, CLUSTER)).toHaveCount(1);
  await waitForCameraSettled(page);
}

async function openClusterFromPie(page) {
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click(); // Decompose: preview the definition
  await expect.poll(() => page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return ui.getState().previewingNodeId;
  })).toBe(CLUSTER);
  await nextFrames(page, 30);
  await pieButton(page, 'package-open').click(); // Decompose Further: open in place
  await expect.poll(() => storeEval(page, (st, [w, id]) => !!st.graphs.get(w).instances.get(id).openDefinition, [WEB, CLUSTER])).toBe(true);
  await waitForCameraSettled(page);
}

test('F39 closing an old copy box leaves an unchanged definition as it was', async ({ page }) => {
  await openFixture(page, 'small');
  const defIds = () => storeEval(page, (st, d) => [...st.graphs.get(d).instances.keys()].sort(), DEF);
  const before = await defIds();
  await closeOldCopyBox(page);
  // The copy matched its definition, so nothing was rewritten: same nodes, same ids.
  expect(await defIds()).toEqual(before);
  expect(await storeEval(page, (st, [w, g]) => st.graphs.get(w).groups.has(g), [WEB, OLD_COPY_GROUP])).toBe(false);
});

test('F39 Decompose opens the definition in place, without copying it', async ({ page }) => {
  await openFixture(page, 'small');
  await closeOldCopyBox(page);
  const before = await counts(page);

  await openClusterFromPie(page);

  // The definition's own nodes draw on web A, inside the box…
  await expect(node(page, ZETA)).toHaveCount(1);
  await expect(node(page, ETA)).toHaveCount(1);
  await expect(page.locator(`svg.canvas g.node-group-title[data-group-id="open:${CLUSTER}"]`).first()).toBeVisible();
  // …and nothing was added anywhere.
  expect(await counts(page)).toEqual(before);
});

test('F39 edits inside the box land in the definition; connections out survive closing', async ({ page }) => {
  await openFixture(page, 'small');
  await closeOldCopyBox(page);
  await openClusterFromPie(page);

  // Move Zeta inside the box: the definition's own Zeta moves.
  const zetaX = () => storeEval(page, (st, [d, z]) => st.graphs.get(d).instances.get(z).x, [DEF, ZETA]);
  const x0 = await zetaX();
  await storeEval(page, (st, [w, z]) => st.updateNodeInstance(w, z, (inst) => { inst.x += 40; }), [WEB, ZETA]);
  expect(await zetaX()).toBe(x0 + 40);

  // Connect Zeta (inside) to Alpha (outside), as drawing a connection would.
  await storeEval(page, (st, [w, z]) => st.addEdge(w, {
    id: 'e-f39-across', sourceId: z, destinationId: 'i-alpha', typeNodeId: 'base-connection-prototype',
    directionality: { arrowsToward: new Set(['i-alpha']) },
  }), [WEB, ZETA]);
  const stored = await storeEval(page, (st, w) => ({
    sourceVia: st.edges.get('e-f39-across').sourceVia,
    inWeb: st.graphs.get(w).edgeIds.includes('e-f39-across'),
  }), WEB);
  expect(stored).toEqual({ sourceVia: [CLUSTER], inWeb: true });
  await expect(edge(page, 'e-f39-across')).toHaveCount(1);

  // Close the box: Zeta leaves the screen, the connection stays, drawn to Cluster.
  await storeEval(page, (st, [w, c]) => st.closeDefinitionInPlace(w, c), [WEB, CLUSTER]);
  await expect(node(page, ZETA)).toHaveCount(0);
  await expect(edge(page, 'e-f39-across')).toHaveCount(1);
  expect((await nodeBox(page, CLUSTER)).width).toBeGreaterThan(0);
  expect(await storeEval(page, (st, [d, z]) => st.graphs.get(d).instances.has(z), [DEF, ZETA])).toBe(true);
});
