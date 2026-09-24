// F11: make a group from a selection, then drag the group: its members move
// together and nothing else does.
//
// A group is dragged by its label (g.group-label inside g.group[data-group-id]):
// press, hold past the lift delay, move. Like a node drag, the lift zooms the
// view out and the drop zooms it back (drag-zoom), so the flow waits for the
// zoom-out before moving and compares world positions, not screen ones.
import {
  test, expect,
  openFixture, nodeBox, centerOf, activeGraphSnapshot, selectedNodeIds, camera, waitForCameraSettled,
  clickCenter, NODE_LIFT_DELAY_MS,
} from './helpers.js';
import { marqueeSelect } from './gestures.js';

async function dragGroupByLabel(page, groupId, delta) {
  const label = page.locator(`svg.canvas g.group[data-group-id="${groupId}"] g.group-label`).first();
  await expect(label).toBeVisible();
  // A label near the top of the screen puts the held pointer inside the
  // edge auto-pan band, and the view then scrolls for as long as the button is
  // down. Pan the view down (W) until the label is well clear of the edge.
  for (let i = 0; i < 6 && centerOf(await label.boundingBox()).y < 260; i++) {
    await page.keyboard.down('w');
    await page.waitForTimeout(150);
    await page.keyboard.up('w');
    await waitForCameraSettled(page);
  }
  const from = centerOf(await label.boundingBox());
  expect(from.y, 'group label clear of the top edge').toBeGreaterThanOrEqual(260);
  const cam0 = await camera(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(from.x, from.y + 4);
  const lifted = await waitForCameraSettled(page);
  expect(lifted.zoom, 'lifting a group zooms out like a node').toBeLessThan(cam0.zoom);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (delta.x * i) / steps, from.y + 4 + ((delta.y - 4) * i) / steps);
  }
  await page.mouse.up();
  const cam1 = await waitForCameraSettled(page);
  expect(cam1.zoom).toBeCloseTo(cam0.zoom, 4);
}

function expectMovedTogether(before, after, memberIds) {
  const moves = memberIds.map((id) => ({
    id,
    dx: after.instances[id].x - before.instances[id].x,
    dy: after.instances[id].y - before.instances[id].y,
  }));
  const [first] = moves;
  expect(Math.hypot(first.dx, first.dy), 'the group moved').toBeGreaterThan(150);
  for (const m of moves) {
    expect(m.dx, `${m.id} moved with the group (x)`).toBeCloseTo(first.dx, 1);
    expect(m.dy, `${m.id} moved with the group (y)`).toBeCloseTo(first.dy, 1);
  }
  const members = new Set(memberIds);
  for (const [id, inst] of Object.entries(before.instances)) {
    if (members.has(id) || inst.isGroupAnchor) continue;
    expect(after.instances[id], `${id} is not in the group and stays put`).toMatchObject({ x: inst.x, y: inst.y });
  }
  expect(after.edgeIds, 'dragging a group draws no connection').toEqual(before.edgeIds);
}

test('F11 group a selection from the bottom panel, then drag the group', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);

  // Marquee Alpha and Beta: the top row, left of Gamma.
  const alpha = await nodeBox(page, 'i-alpha');
  const beta = await nodeBox(page, 'i-beta');
  await marqueeSelect(page, { x: alpha.x - 25, y: alpha.y - 25 }, { x: beta.x + beta.width + 25, y: beta.y + beta.height + 12 });
  await expect.poll(() => selectedNodeIds(page)).toEqual(['i-alpha', 'i-beta']);

  // Group (lucide "group" icon) in the multi-selection panel.
  await clickCenter(page, page.locator('.unified-bottom-panel svg.lucide-group').first());
  let created;
  await expect.poll(async () => {
    const snap = await activeGraphSnapshot(page);
    created = Object.entries(snap.groups).find(([id]) => !before.groups[id]);
    return created ? created[1].memberInstanceIds.slice().sort() : null;
  }, { message: 'a new group holding exactly the selection' }).toEqual(['i-alpha', 'i-beta']);
  const [groupId, group] = created;
  expect(group.name).toBe('Group');
  expect(group.linkedNodePrototypeId, 'a plain group, not a node-group').toBeNull();
  // Grouping hands the selection over to the group.
  expect(await selectedNodeIds(page)).toEqual([]);
  await expect(page.locator(`svg.canvas g.group[data-group-id="${groupId}"]`)).toHaveCount(1);

  // Drag it down into the empty lower-right area.
  const mid = await activeGraphSnapshot(page);
  await dragGroupByLabel(page, groupId, { x: 120, y: 330 });
  const after = await activeGraphSnapshot(page);
  expectMovedTogether(mid, after, ['i-alpha', 'i-beta']);
  expect(after.groups[groupId].memberInstanceIds.slice().sort()).toEqual(['i-alpha', 'i-beta']);
});

test('F11 dragging an existing group moves exactly its members', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const [pairId, pair] = Object.entries(before.groups).find(([, g]) => g.name === 'Pair');
  await dragGroupByLabel(page, pairId, { x: 250, y: -40 });
  const after = await activeGraphSnapshot(page);
  expectMovedTogether(before, after, pair.memberInstanceIds);
});
