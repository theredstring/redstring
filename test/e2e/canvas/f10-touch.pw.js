// F10: touch. One-finger pan, two-finger pinch zoom, long-press drag.
//
// All three run through useCanvasTouch, which P1.11 and P4 change and which
// nothing else checks in a real browser. Gestures go through CDP (see
// gestures.js); the context needs hasTouch so the app's touch paths turn on.
import {
  test, expect,
  openFixture, camera, waitForCameraSettled, clientToWorld, worldToClient, nodeBox, centerOf,
  activeGraphSnapshot, selectedNodeIds, expectBareCanvas, storeEval,
} from './helpers.js';
import { touchscreen, TOUCH_LIFT_DELAY_MS } from './gestures.js';

test.use({ hasTouch: true });

// The camera is saved to the graphViews slice, not the graph (see graphStore).
const graphView = (page) => storeEval(page, (st) => {
  const v = st.graphViews.get(st.activeGraphId);
  return { pan: v.panOffset, zoom: v.zoomLevel };
});

test('F10 one-finger pan moves the camera with the finger, glides, and is saved', async ({ page }) => {
  await openFixture(page, 'small');
  const touch = await touchscreen(page);
  const before = await activeGraphSnapshot(page);
  const cam0 = await camera(page);

  // The fixture's empty lower-right quarter.
  const from = { x: 1000, y: 650 };
  const finger = { x: -120, y: -72 };
  await expectBareCanvas(page, from);
  await touch.start([from]);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch.move([{ x: from.x + (finger.x * i) / steps, y: from.y + (finger.y * i) / steps }]);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  // While the finger is down the canvas follows it: same direction, about the
  // same distance (touch pan sensitivity scales it a little).
  const mid = await camera(page);
  const dx = mid.pan.x - cam0.pan.x;
  const dy = mid.pan.y - cam0.pan.y;
  expect(Math.abs(dx - finger.x), `pan x ${dx} follows finger ${finger.x}`).toBeLessThan(Math.abs(finger.x) * 0.2);
  expect(Math.abs(dy - finger.y), `pan y ${dy} follows finger ${finger.y}`).toBeLessThan(Math.abs(finger.y) * 0.2);
  expect(mid.zoom).toBe(cam0.zoom);

  await touch.end();
  // The release glides on in the same direction, then stops.
  const settled = await waitForCameraSettled(page);
  expect(settled.pan.x).toBeLessThan(mid.pan.x);
  expect(settled.pan.y).toBeLessThan(mid.pan.y);
  expect(settled.zoom).toBe(cam0.zoom);

  // The settled camera is written to the graph's view.
  await expect.poll(async () => {
    const v = await graphView(page);
    return Math.hypot(v.pan.x - settled.pan.x, v.pan.y - settled.pan.y);
  }, { message: 'settled touch pan saved to the graph view' }).toBeLessThan(1);

  // A pan is only a pan: nothing selected, nothing moved, no menu.
  expect(await selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
  expect((await activeGraphSnapshot(page)).instances).toEqual(before.instances);
});

test('F10 two-finger pinch zooms about the fingers\' midpoint, both ways', async ({ page }) => {
  await openFixture(page, 'small');
  const touch = await touchscreen(page);
  const cam0 = await camera(page);
  const center = { x: 900, y: 600 };
  const anchor = await clientToWorld(page, center.x, center.y);

  // Spread: zoom in.
  await touch.pinch(center, 80, 320);
  const zoomedIn = await waitForCameraSettled(page);
  expect(zoomedIn.zoom, 'spreading two fingers zooms in').toBeGreaterThan(cam0.zoom * 1.5);
  // The world point that was under the fingers is still under them.
  let at = await worldToClient(page, anchor.x, anchor.y);
  expect(Math.hypot(at.x - center.x, at.y - center.y), 'pinch zooms about the midpoint').toBeLessThan(10);

  // Pinch: zoom back out.
  await touch.pinch(center, 320, 80);
  const zoomedOut = await waitForCameraSettled(page);
  expect(zoomedOut.zoom, 'bringing two fingers together zooms out').toBeLessThan(zoomedIn.zoom / 1.5);
  at = await worldToClient(page, anchor.x, anchor.y);
  expect(Math.hypot(at.x - center.x, at.y - center.y), 'pinch-out keeps the same anchor').toBeLessThan(10);

  // A pinch is never a tap: nothing selected, no menu.
  expect(await selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
});

test('F10 long-press lifts a node and drags it under the finger', async ({ page }) => {
  await openFixture(page, 'small');
  const touch = await touchscreen(page);
  const before = await activeGraphSnapshot(page);
  const cam0 = await camera(page);
  const box0 = await nodeBox(page, 'i-gamma');
  const from = centerOf(box0);
  // Straight down into the empty lower-right quarter.
  const delta = { x: 60, y: 300 };

  await touch.start([from]);
  // Hold past the lift delay. Moving sooner draws a connection instead.
  await page.waitForTimeout(TOUCH_LIFT_DELAY_MS + 200);
  // Lifting starts the drag-zoom-out; let it finish before moving.
  const lifted = await waitForCameraSettled(page);
  expect(lifted.zoom, 'drag-zoom zooms out while a node is lifted').toBeLessThan(cam0.zoom);
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await touch.move([{ x: from.x + (delta.x * i) / steps, y: from.y + (delta.y * i) / steps }]);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await touch.end();

  // Zoom comes back, and the node is where the finger let go.
  const cam1 = await waitForCameraSettled(page);
  expect(cam1.zoom).toBeCloseTo(cam0.zoom, 4);
  const box1 = await nodeBox(page, 'i-gamma');
  expect(Math.abs(box1.x - (box0.x + delta.x)), 'released under the finger (x)').toBeLessThan(6);
  expect(Math.abs(box1.y - (box0.y + delta.y)), 'released under the finger (y)').toBeLessThan(6);

  // The store moved it; nothing else moved, and no connection was drawn.
  const after = await activeGraphSnapshot(page);
  const start = before.instances['i-gamma'];
  const end = after.instances['i-gamma'];
  expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(300);
  expect(after.edgeIds).toEqual(before.edgeIds);
  for (const [id, inst] of Object.entries(before.instances)) {
    if (id === 'i-gamma' || inst.isGroupAnchor) continue;
    expect(after.instances[id], `instance ${id} should not move`).toMatchObject({ x: inst.x, y: inst.y });
  }
});
