// F2: drag-pan changes the view, and momentum settles.
import {
  test, expect,
  openFixture, camera, waitForCameraSettled, expectBareCanvas, storeEval, nodeBox,
} from './helpers.js';

test('F2 drag-pan moves the camera, glides, settles, and is saved to the graph view', async ({ page }) => {
  await openFixture(page, 'small');
  const cam0 = await camera(page);
  const alpha0 = await nodeBox(page, 'i-alpha');

  const from = { x: 1000, y: 620 };
  const drag = { x: -240, y: -160 };
  await expectBareCanvas(page, from);

  // A quick, continuous drag released while still moving, so the release has
  // velocity and the glide (mouseSettings.glideEnabled, default on) runs.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (drag.x * i) / steps, from.y + (drag.y * i) / steps);
  }
  const atRelease = await camera(page);
  await page.mouse.up();

  // During the drag the camera followed the pointer.
  expect(atRelease.zoom).toBeCloseTo(cam0.zoom, 6);
  expect(atRelease.pan.x - cam0.pan.x).toBeLessThan(drag.x * 0.5);
  expect(atRelease.pan.y - cam0.pan.y).toBeLessThan(drag.y * 0.5);

  // Momentum: the view keeps moving the same way after release, then stops.
  const settled = await waitForCameraSettled(page);
  expect(settled.pan.x - cam0.pan.x, 'glide continues left').toBeLessThanOrEqual(drag.x * 0.9);
  expect(settled.pan.y - cam0.pan.y, 'glide continues up').toBeLessThanOrEqual(drag.y * 0.9);
  expect(Math.abs(settled.pan.x - cam0.pan.x)).toBeGreaterThan(Math.abs(atRelease.pan.x - cam0.pan.x));

  // Nodes moved on screen with the camera, and the store did not change them.
  const alpha1 = await nodeBox(page, 'i-alpha');
  expect(alpha1.x - alpha0.x).toBeCloseTo(settled.pan.x - cam0.pan.x, 0);
  expect(alpha1.y - alpha0.y).toBeCloseTo(settled.pan.y - cam0.pan.y, 0);

  // The settled view is written back to the graph's view slice (debounced:
  // settle 150 ms, then a 300 ms save timer), so poll for it.
  await expect.poll(async () => {
    const v = await storeEval(page, (st) => st.graphViews.get(st.activeGraphId));
    return Math.hypot(v.panOffset.x - settled.pan.x, v.panOffset.y - settled.pan.y) + Math.abs(v.zoomLevel - settled.zoom);
  }, { message: 'graphViews holds the settled camera' }).toBeLessThan(0.5);
});
