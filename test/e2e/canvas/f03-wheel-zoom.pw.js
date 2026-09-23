// F3: wheel zoom in and out around the pointer.
import {
  test, expect,
  openFixture, camera, clientToWorld, waitForCameraSettled, marqueeModifier, nextFrames,
} from './helpers.js';

// A mouse-wheel detent: one large pixel step. Small steps take the trackpad
// (eased) path instead, which Mac-trackpad device checks cover (D-12).
const DETENT = 100;

async function zoomNotches(page, point, notches, direction) {
  const modifier = await marqueeModifier(page); // Cmd on Mac, Ctrl elsewhere: same rule as zoom
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down(modifier);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, direction * DETENT);
    await nextFrames(page, 1);
  }
  await page.keyboard.up(modifier);
}

test('F3 modifier+wheel zooms in and out about the pointer', async ({ page }) => {
  await openFixture(page, 'small');
  const cam0 = await camera(page);

  // Off-centre on purpose: zooming about the viewport centre would pass even
  // if the pointer anchor were ignored.
  const pointer = { x: 380, y: 300 };
  const world0 = await clientToWorld(page, pointer.x, pointer.y);

  await zoomNotches(page, pointer, 3, -1);
  const zoomedIn = await waitForCameraSettled(page);
  expect(zoomedIn.zoom).toBeGreaterThan(cam0.zoom * 1.1);
  const worldIn = await clientToWorld(page, pointer.x, pointer.y);
  expect(Math.hypot(worldIn.x - world0.x, worldIn.y - world0.y), 'world point under the pointer stays put').toBeLessThan(2);

  await zoomNotches(page, pointer, 6, 1);
  const zoomedOut = await waitForCameraSettled(page);
  expect(zoomedOut.zoom).toBeLessThan(zoomedIn.zoom / 1.2);
  expect(zoomedOut.zoom).toBeLessThan(cam0.zoom);
  const worldOut = await clientToWorld(page, pointer.x, pointer.y);
  expect(Math.hypot(worldOut.x - world0.x, worldOut.y - world0.y), 'world point under the pointer stays put').toBeLessThan(2);
});
