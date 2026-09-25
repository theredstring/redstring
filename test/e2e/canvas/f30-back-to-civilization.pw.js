// F30: pan away until no node is on screen, and the "back to civilization"
// pill appears; clicking it brings the nodes back into view. (Since the
// refactor its handler lives in components/canvas/camera/backToCivilization.js.)
import { test, expect, openFixture, waitForCameraSettled, activeGraphSnapshot, camera, canvasRect, CANVAS_OFFSET } from './helpers.js';

// Instances whose box (generously sized) overlaps the canvas on screen, from
// store positions and the camera, so culled and anchor instances count too.
async function nodesOnScreen(page) {
  const [snap, cam, rect] = await Promise.all([activeGraphSnapshot(page), camera(page), canvasRect(page)]);
  const W = 400 * cam.zoom;
  const H = 200 * cam.zoom;
  return Object.values(snap.instances).filter((inst) => {
    const x = rect.x + cam.pan.x + (inst.x - CANVAS_OFFSET) * cam.zoom;
    const y = rect.y + cam.pan.y + (inst.y - CANVAS_OFFSET) * cam.zoom;
    return x + W > rect.x && x < rect.x + rect.width && y + H > rect.y && y < rect.y + rect.height;
  }).length;
}

test('F30 panning off into empty space shows the pill, which brings the nodes back', async ({ page }) => {
  await openFixture(page, 'small');
  const pill = page.locator('.back-to-civilization-pill');
  await expect(pill).toHaveCount(0);

  // Hold the pan key (keyboard pan, as in F9) until every node has left the screen.
  await page.mouse.move(640, 400);
  for (let i = 0; i < 12 && (await nodesOnScreen(page)) > 0; i++) {
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
  }
  await waitForCameraSettled(page);
  expect(await nodesOnScreen(page), 'panned clear of every node').toBe(0);

  await expect(pill).toBeVisible({ timeout: 5_000 });
  await pill.click();
  await waitForCameraSettled(page);
  await expect.poll(() => nodesOnScreen(page), { message: 'nodes back in view' }).toBeGreaterThan(0);
  await expect(pill).toHaveCount(0);
});
