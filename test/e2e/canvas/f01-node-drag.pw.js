// F1: dragging a node changes its instance position.
//
// Drag-zoom is on by default (mouseSettings / dragZoomSettings): the first
// move of a lifted node zooms the view out, and the drop zooms back in about
// the drop point, so the node lands where it was released on screen. The flow
// waits for the zoom-out to finish before moving, which makes the drop point
// in world space the same on every run.
import {
  test, expect,
  openFixture, nodeBox, centerOf, activeGraphSnapshot, camera, waitForCameraSettled,
  worldToClient, expectBareCanvas, NODE_LIFT_DELAY_MS,
} from './helpers.js';

test('F1 node drag moves the instance in the store and on screen', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const start = before.instances['i-gamma'];
  const cam0 = await camera(page);

  const box0 = await nodeBox(page, 'i-gamma');
  const from = centerOf(box0);
  // Straight down, into the fixture's empty lower-right quarter.
  const delta = { x: 60, y: 330 };
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  await expectBareCanvas(page, to);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Hold still past the lift delay so the press becomes a drag. Moving before
  // the lift draws a connection instead (F5).
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  // First move starts the drag-zoom-out; let it finish.
  await page.mouse.move(from.x, from.y + 4);
  const zoomedOut = await waitForCameraSettled(page);
  expect(zoomedOut.zoom, 'drag-zoom zooms out while a node is lifted').toBeLessThan(cam0.zoom);
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (delta.x * i) / steps, from.y + 4 + ((delta.y - 4) * i) / steps);
  }
  await page.mouse.up();

  // Zoom returns to where it was.
  const cam1 = await waitForCameraSettled(page);
  expect(cam1.zoom).toBeCloseTo(cam0.zoom, 4);

  // The node is where it was released on screen.
  const box1 = await nodeBox(page, 'i-gamma');
  expect(Math.abs(box1.x - (box0.x + delta.x)), 'released under the pointer (x)').toBeLessThan(6);
  expect(Math.abs(box1.y - (box0.y + delta.y)), 'released under the pointer (y)').toBeLessThan(6);

  // The store moved the instance, and agrees with what is drawn: the
  // background rect sits 6 world units inside the node's x/y.
  const end = (await activeGraphSnapshot(page)).instances['i-gamma'];
  expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(300);
  const drawnAt = await worldToClient(page, end.x + 6, end.y + 6);
  expect(Math.abs(drawnAt.x - box1.x)).toBeLessThan(3);
  expect(Math.abs(drawnAt.y - box1.y)).toBeLessThan(3);

  // Nothing else changed: no edge was drawn, no other node moved.
  const snap = await activeGraphSnapshot(page);
  expect(snap.edgeIds).toEqual(before.edgeIds);
  for (const [id, inst] of Object.entries(before.instances)) {
    if (id === 'i-gamma' || inst.isGroupAnchor) continue;
    expect(snap.instances[id], `instance ${id} should not move`).toMatchObject({ x: inst.x, y: inst.y });
  }
});
