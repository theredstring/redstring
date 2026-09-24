// F1b: a self-loop's arrowhead keeps its size while its node is dragged (B-09).
//
// At rest, SelfLoopEdge draws the arrowhead with scale(connectionWidth), which
// is 1.25 at default settings (textSettings.connectionWidth 1 x
// CONNECTION_WIDTH_BASE_SCALE). During a drag, useNodeDrag rewrites the same
// element's transform imperatively each frame. If that rewrite leaves the scale
// out, the head shrinks to 80% for the length of the drag and snaps back on
// drop. Drag-zoom changes the camera mid-drag, so sizes are compared per unit
// of zoom (world units), not in screen pixels.
import {
  test, expect,
  openFixture, nodeBox, centerOf, camera, waitForCameraSettled, storeEval, NODE_LIFT_DELAY_MS,
} from './helpers.js';

const SELF = 'svg.canvas [data-edge-id="e-gamma-self"] [data-arrow="self"]';

async function arrowWorldSize(page) {
  const [box, cam] = await Promise.all([page.locator(SELF).first().boundingBox(), camera(page)]);
  return { w: box.width / cam.zoom, h: box.height / cam.zoom };
}

test('F1b a self-loop arrowhead keeps its size during a node drag (B-09)', async ({ page }) => {
  await openFixture(page, 'small');
  await storeEval(page, (st) => {
    st.addEdge(st.activeGraphId, {
      id: 'e-gamma-self',
      sourceId: 'i-gamma',
      destinationId: 'i-gamma',
      directionality: { arrowsToward: new Set(['i-gamma']) },
    });
  });
  await expect(page.locator(SELF)).toHaveCount(1);
  const rest = await arrowWorldSize(page);

  // Lift Gamma, let the drag-zoom finish, move it, and measure with the
  // button still down.
  const from = centerOf(await nodeBox(page, 'i-gamma'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  await page.mouse.move(from.x, from.y + 4);
  await waitForCameraSettled(page);
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 3 * i, from.y + 4 + 20 * i);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const mid = await arrowWorldSize(page);
  await page.mouse.up();
  await waitForCameraSettled(page);
  const dropped = await arrowWorldSize(page);

  expect(mid.w / rest.w, 'arrowhead width mid-drag vs at rest').toBeCloseTo(1, 1);
  expect(mid.h / rest.h, 'arrowhead height mid-drag vs at rest').toBeCloseTo(1, 1);
  expect(dropped.w / rest.w, 'and after the drop').toBeCloseTo(1, 1);
});
