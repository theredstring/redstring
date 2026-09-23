// F15: switching graphs restores each graph's view.
//
// The camera per graph lives in the store's graphViews slice; NodeCanvas saves
// the settled camera there (debounced) and jumps to it on a graph switch.
import {
  test, expect, openFixture, camera, waitForCameraSettled, storeEval, expectBareCanvas, marqueeModifier, nextFrames,
} from './helpers.js';

const views = (page) => storeEval(page, (st) => Object.fromEntries([...st.graphViews].map(([id, v]) => [id, v])));

async function switchTo(page, tabName, graphId, probeInstanceId) {
  // Header tabs are DOM outside the canvas: a locator click is safe.
  await page.getByTitle(tabName, { exact: true }).first().click();
  await expect.poll(() => storeEval(page, (st) => st.activeGraphId)).toBe(graphId);
  await expect(page.locator(`svg.canvas g.node[data-instance-id="${probeInstanceId}"]`)).toBeVisible();
  return waitForCameraSettled(page);
}

async function waitForSavedView(page, graphId, cam) {
  await expect.poll(async () => {
    const v = (await views(page))[graphId];
    if (!v) return Infinity;
    return Math.hypot(v.panOffset.x - cam.pan.x, v.panOffset.y - cam.pan.y) + Math.abs(v.zoomLevel - cam.zoom);
  }, { message: `graphViews[${graphId}] holds the settled camera` }).toBeLessThan(0.5);
}

const expectCamera = (actual, expected, what) => {
  expect(actual.zoom, `${what}: zoom`).toBeCloseTo(expected.zoom, 5);
  expect(Math.abs(actual.pan.x - expected.pan.x), `${what}: pan x`).toBeLessThan(0.5);
  expect(Math.abs(actual.pan.y - expected.pan.y), `${what}: pan y`).toBeLessThan(0.5);
};

test('F15 each graph keeps its own camera across tab switches', async ({ page }) => {
  await openFixture(page, 'small');
  const stored = await views(page);

  // Move A's camera: a drag-pan (no glide: hold still before releasing).
  const from = { x: 1000, y: 620 };
  await expectBareCanvas(page, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x - 18 * i, from.y - 9 * i);
  await page.waitForTimeout(150); // pause before release: no momentum
  await page.mouse.up();
  const camA = await waitForCameraSettled(page);
  expect(Math.abs(camA.pan.x - stored['g-small-a'].panOffset.x)).toBeGreaterThan(100);
  await waitForSavedView(page, 'g-small-a', camA);

  // B opens at its own stored camera.
  const camB0 = await switchTo(page, 'Small Web B', 'g-small-b', 'i-lambda');
  expectCamera(camB0, { pan: stored['g-small-b'].panOffset, zoom: stored['g-small-b'].zoomLevel }, 'B on first visit');

  // Change B's camera: zoom in with the wheel.
  const modifier = await marqueeModifier(page);
  await page.mouse.move(700, 450);
  await page.keyboard.down(modifier);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -100); await nextFrames(page, 1); }
  await page.keyboard.up(modifier);
  const camB = await waitForCameraSettled(page);
  expect(camB.zoom).toBeGreaterThan(camB0.zoom * 1.05);
  await waitForSavedView(page, 'g-small-b', camB);

  // Back to A: A's moved camera, not B's and not A's original.
  expectCamera(await switchTo(page, 'Small Web A', 'g-small-a', 'i-alpha'), camA, 'A restored');
  // And B again: B's zoomed camera.
  expectCamera(await switchTo(page, 'Small Web B', 'g-small-b', 'i-lambda'), camB, 'B restored');
});
