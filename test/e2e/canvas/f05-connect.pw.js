// F5: drawing a connection from node A to node B creates an edge; a self-loop
// gesture opens the self-loop dialog.
//
// Pressing a node and moving before the lift delay (250 ms) draws a
// connection; holding still first would lift the node for a drag (F1).
import {
  test, expect, openFixture, nodeBox, centerOf, activeGraphSnapshot, storeEval,
} from './helpers.js';

async function newEdges(page, beforeIds) {
  const snap = await activeGraphSnapshot(page);
  const added = snap.edgeIds.filter((id) => !beforeIds.includes(id));
  return storeEval(page, (st, ids) => ids.map((id) => {
    const e = st.edges.get(id);
    return { id, sourceId: e.sourceId, destinationId: e.destinationId };
  }), added);
}

test('F5 dragging from one node to another creates an edge', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const from = centerOf(await nodeBox(page, 'i-gamma'));
  const to = centerOf(await nodeBox(page, 'i-epsilon'));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();

  await expect.poll(() => newEdges(page, before.edgeIds)).toHaveLength(1);
  const [edge] = await newEdges(page, before.edgeIds);
  expect(edge).toMatchObject({ sourceId: 'i-gamma', destinationId: 'i-epsilon' });
  await expect(page.locator(`svg.canvas [data-edge-id="${edge.id}"]`)).toHaveCount(1);

  // The node itself did not move: this was a connection, not a drag.
  const after = await activeGraphSnapshot(page);
  expect(after.instances['i-gamma']).toMatchObject({ x: before.instances['i-gamma'].x, y: before.instances['i-gamma'].y });
});

test('F5 leaving a node and coming back opens the self-loop dialog, which creates a self-loop', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const alpha = await nodeBox(page, 'i-alpha');
  const c = centerOf(alpha);
  // Out above the node, across bare canvas, and back in.
  const out = { x: c.x, y: alpha.y - 60 };

  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x, c.y + ((out.y - c.y) * i) / 8);
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + 10, out.y + ((c.y - out.y) * i) / 8);
  await page.mouse.up();

  const dialog = page.getByText('Self-referential connection?');
  await expect(dialog).toBeVisible();
  // Nothing is created until the user confirms.
  expect((await activeGraphSnapshot(page)).edgeIds).toEqual(before.edgeIds);

  // The dialog is DOM outside the SVG, so a locator click is safe here.
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => newEdges(page, before.edgeIds)).toHaveLength(1);
  const [edge] = await newEdges(page, before.edgeIds);
  expect(edge).toMatchObject({ sourceId: 'i-alpha', destinationId: 'i-alpha' });
  await expect(page.locator(`svg.canvas [data-edge-id="${edge.id}"]`)).toHaveCount(1);
});
