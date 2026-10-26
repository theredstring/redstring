// F39b: one definition open on two nodes of the same web (core/openDefinitions.js).
// The first box draws the definition's nodes under their own ids; the second
// draws them again under view ids (`<anchor>/<node>`). Both are the definition:
// moving a node in either moves it in both, a connection made from the second
// box reaches outside through that box, and closing one leaves the other open.
//
// Fixture "small": Cluster (...05 on web A) is defined by a web holding Zeta
// ...09 → Eta ...0a, expanded the old copy way (group ...06); each test first
// closes that box, opens Cluster, then adds a second Cluster node on bare canvas
// and opens that too.
import {
  test, expect, storeEval, openFixture, nodeBox, centerOf, pieButton, openPieMenu,
  waitForCameraSettled, nextFrames, selectedNodeIds, findBareSpot, clientToWorld, NODE_LIFT_DELAY_MS,
} from './helpers.js';

const WEB = 'g-small-a';
const CLUSTER = '00000000-0000-4000-8100-000000000005';
const SECOND = 'i-cluster-again';
const OLD_COPY_GROUP = '00000000-0000-4000-8100-000000000006';
const DEF = '00000000-0000-4000-8100-000000000004';
const ZETA = '00000000-0000-4000-8100-000000000009';
const ETA = '00000000-0000-4000-8100-00000000000a';
const inSecond = (id) => `${SECOND}/${id}`;

const node = (page, id) => page.locator(`svg.canvas g.node[data-instance-id="${id}"]`);
const edge = (page, id) => page.locator(`svg.canvas [data-edge-id="${id}"]`);
const boxTitle = (page, anchorId) => page.locator(`svg.canvas g.node-group-title[data-group-id="open:${anchorId}"]`).first();

async function openFromPie(page, instanceId) {
  await openPieMenu(page, instanceId);
  await pieButton(page, 'package-open').click(); // Decompose: preview the definition
  await expect.poll(() => page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return ui.getState().previewingNodeId;
  })).toBe(instanceId);
  await nextFrames(page, 30);
  await pieButton(page, 'package-open').click(); // Decompose Further: open in place
  await expect.poll(() => storeEval(page, (st, [w, id]) => !!st.graphs.get(w).instances.get(id).openDefinition, [WEB, instanceId])).toBe(true);
  await waitForCameraSettled(page);
}

/** Both Cluster nodes open on web A. */
async function openTwice(page) {
  await openFixture(page, 'small');
  await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  await expect(node(page, 'i-zeta')).toHaveCount(0);
  await waitForCameraSettled(page);
  await openFromPie(page, CLUSTER);
  // Opening selects the box; let it go so the next click starts clean.
  const away = await findBareSpot(page);
  await page.mouse.click(away.x, away.y);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
  await waitForCameraSettled(page);
  const spot = await findBareSpot(page, { halfW: 160, halfH: 110 });
  const at = await clientToWorld(page, spot.x - 60, spot.y - 20);
  await storeEval(page, (st, [w, c, id, p]) => {
    st.addNodeInstance(w, st.graphs.get(w).instances.get(c).prototypeId, p, id);
  }, [WEB, CLUSTER, SECOND, at]);
  await expect(node(page, SECOND)).toHaveCount(1);
  await openFromPie(page, SECOND);
}

test('F39b Decompose opens a definition already open in the web a second time', async ({ page }) => {
  await openTwice(page);

  await expect(boxTitle(page, CLUSTER)).toBeVisible();
  await expect(boxTitle(page, SECOND)).toBeVisible();
  await expect(node(page, ZETA)).toHaveCount(1);
  await expect(node(page, inSecond(ZETA))).toHaveCount(1);
  await expect(node(page, inSecond(ETA))).toHaveCount(1);
  // The definition's own connection, drawn in each box.
  const innerEdge = await storeEval(page, (st, d) => st.graphs.get(d).edgeIds[0], DEF);
  await expect(edge(page, innerEdge)).toHaveCount(1);
  await expect(edge(page, inSecond(innerEdge))).toHaveCount(1);
  // Nothing was copied: the definition holds what it held, under its own ids.
  const defIds = await storeEval(page, (st, d) => [...st.graphs.get(d).instances.keys()].sort(), DEF);
  expect(defIds).toEqual([ZETA, ETA].sort());
});

test('F39b dragging a node in the second box moves it in the definition, in both boxes', async ({ page }) => {
  await openTwice(page);
  const firstBefore = await nodeBox(page, ZETA);
  const zetaX = () => storeEval(page, (st, [d, z]) => st.graphs.get(d).instances.get(z).x, [DEF, ZETA]);
  const x0 = await zetaX();

  // Clicking it selects the copy in the second box, not the first.
  const from = centerOf(await nodeBox(page, inSecond(ZETA)));
  await page.mouse.click(from.x, from.y);
  await expect.poll(() => selectedNodeIds(page)).toEqual([inSecond(ZETA)]);
  await waitForCameraSettled(page);

  const start = centerOf(await nodeBox(page, inSecond(ZETA)));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(start.x + 4, start.y);
  await waitForCameraSettled(page);
  for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + 4 + 6 * i, start.y);
  await page.mouse.up();
  await waitForCameraSettled(page);

  // Stored under its own id, in the definition; nothing under a view id anywhere.
  expect(await zetaX()).not.toBe(x0);
  const stray = await storeEval(page, (st) => [...st.graphs.values()].some(g => [...g.instances.keys()].some(id => id.includes('/'))));
  expect(stray).toBe(false);
  // The first box's Zeta moved with it.
  const firstAfter = await nodeBox(page, ZETA);
  expect(Math.abs(firstAfter.x - firstBefore.x) + Math.abs(firstAfter.y - firstBefore.y)).toBeGreaterThan(0);
});

test('F39b a connection from the second box goes through that box; closing it leaves the first open', async ({ page }) => {
  await openTwice(page);

  // Connect the second box's Eta to Alpha (outside), as drawing a connection would.
  await storeEval(page, (st, [w, from]) => st.addEdge(w, {
    id: 'e-f39b-across', sourceId: from, destinationId: 'i-alpha', typeNodeId: 'base-connection-prototype',
    directionality: { arrowsToward: new Set(['i-alpha']) },
  }), [WEB, inSecond(ETA)]);
  const stored = await storeEval(page, (st, w) => {
    const e = st.edges.get('e-f39b-across');
    return { sourceId: e.sourceId, sourceVia: e.sourceVia, inWeb: st.graphs.get(w).edgeIds.includes('e-f39b-across') };
  }, WEB);
  expect(stored).toEqual({ sourceId: ETA, sourceVia: [SECOND], inWeb: true });
  await expect(edge(page, 'e-f39b-across')).toHaveCount(1);
  // Drawn from the second box's Eta, not the first's.
  const drawnFrom = await storeEval(page, async (st, w) => {
    const { projectGraphView } = await import('/src/core/openDefinitions.js');
    return projectGraphView(st, w).openView.edges.get('e-f39b-across').sourceId;
  }, WEB);
  expect(drawnFrom).toBe(inSecond(ETA));

  // Close the second box: its copies go, the first stays open, the connection is drawn to the second node.
  await storeEval(page, (st, [w, id]) => st.closeDefinitionInPlace(w, id), [WEB, SECOND]);
  await expect(node(page, inSecond(ETA))).toHaveCount(0);
  await expect(node(page, ETA)).toHaveCount(1);
  await expect(boxTitle(page, CLUSTER)).toBeVisible();
  await expect(edge(page, 'e-f39b-across')).toHaveCount(1);
  const drawnClosed = await storeEval(page, async (st, w) => {
    const { projectGraphView } = await import('/src/core/openDefinitions.js');
    return projectGraphView(st, w).openView.edges.get('e-f39b-across').sourceId;
  }, WEB);
  expect(drawnClosed).toBe(SECOND);
});

test('F39b deleting a node picked in the second box deletes it from the definition', async ({ page }) => {
  await openTwice(page);
  const c = centerOf(await nodeBox(page, inSecond(ETA)));
  await page.mouse.click(c.x, c.y);
  await expect.poll(() => selectedNodeIds(page)).toEqual([inSecond(ETA)]);
  await page.keyboard.press('Delete');
  await expect.poll(() => storeEval(page, (st, [d, e]) => st.graphs.get(d).instances.has(e), [DEF, ETA])).toBe(false);
  await expect(node(page, ETA)).toHaveCount(0);
  await expect(node(page, inSecond(ETA))).toHaveCount(0);
});
