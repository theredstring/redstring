// F7: hovering an edge highlights it; clicking selects it; a modified click
// adds to the selection.
//
// DEVIATION from the card, which says shift-click: the code adds to the edge
// selection with Ctrl/Cmd-click (getEdgeHitboxHandlers and selectEdgeFromClick
// in NodeCanvas.jsx), and a shift-click just replaces the selection. This flow
// asserts what the code does. Which modifier is intended is a question for Grant.
import {
  test, expect,
  openFixture, edgePoint, edgeGlow, selectedEdgeIds, expectBareCanvas, waitForCameraSettled, marqueeModifier,
} from './helpers.js';

test('F7 hover highlights an edge, click selects it, Cmd/Ctrl-click adds another', async ({ page }) => {
  await openFixture(page, 'small');
  const bare = { x: 1000, y: 620 };
  await expectBareCanvas(page, bare);
  await page.mouse.move(bare.x, bare.y);

  // Hover: after the dwell, the edge under the pointer glows.
  const p1 = await edgePoint(page, 'e-beta-gamma', 0.35);
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  await expect.poll(() => edgeGlow(page, 'e-beta-gamma'), { message: 'hovered edge glows' }).toBe('hover');
  expect(await edgeGlow(page, 'e-alpha-beta')).toBeNull();

  // Moving off clears it.
  await page.mouse.move(bare.x, bare.y, { steps: 4 });
  await expect.poll(() => edgeGlow(page, 'e-beta-gamma')).toBeNull();

  // Click selects.
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  await page.mouse.click(p1.x, p1.y);
  await expect.poll(() => selectedEdgeIds(page)).toEqual(['e-beta-gamma']);
  await expect.poll(() => edgeGlow(page, 'e-beta-gamma')).toBe('selected');
  await waitForCameraSettled(page);

  // Cmd/Ctrl-click adds a second edge without dropping the first.
  const modifier = await marqueeModifier(page);
  const p2 = await edgePoint(page, 'e-delta-epsilon', 0.3);
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.keyboard.down(modifier);
  await page.mouse.click(p2.x, p2.y);
  await page.keyboard.up(modifier);
  await expect.poll(() => selectedEdgeIds(page)).toEqual(['e-beta-gamma', 'e-delta-epsilon']);
  await expect.poll(() => edgeGlow(page, 'e-delta-epsilon')).toBe('selected');
  expect(await edgeGlow(page, 'e-beta-gamma')).toBe('selected');

  // A plain click on another edge replaces the selection.
  await waitForCameraSettled(page);
  const p3 = await edgePoint(page, 'e-alpha-delta', 0.3);
  await page.mouse.move(p3.x, p3.y, { steps: 4 });
  await page.mouse.click(p3.x, p3.y);
  await expect.poll(() => selectedEdgeIds(page)).toEqual(['e-alpha-delta']);
});

// Hover moving straight from one connection to another. Since P3.06a a render
// that only changes hover re-renders just the connection losing hover and the
// one gaining it; every other connection keeps its element. This checks both
// glows follow the pointer and an unrelated connection doesn't change at all.
test('F7b hover moves from one connection to another; the others are untouched', async ({ page }) => {
  // Label sprites bake asynchronously and swap a label's <text> for an <image>
  // whenever they land, which would change the bystander for reasons of its own.
  await page.addInitScript(() => { window.__labelSprites = false; });
  await openFixture(page, 'small');
  const bare = { x: 1000, y: 620 };
  await expectBareCanvas(page, bare);
  await page.mouse.move(bare.x, bare.y);
  const markup = (id) => page.evaluate((edgeId) => document.querySelector(`svg.canvas [data-edge-id="${edgeId}"]`)?.outerHTML, id);
  const bystander = await markup('e-alpha-delta');
  expect(bystander).toBeTruthy();

  const pa = await edgePoint(page, 'e-beta-gamma', 0.35);
  await page.mouse.move(pa.x, pa.y, { steps: 4 });
  await expect.poll(() => edgeGlow(page, 'e-beta-gamma')).toBe('hover');

  const pb = await edgePoint(page, 'e-alpha-beta', 0.4);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(() => edgeGlow(page, 'e-alpha-beta')).toBe('hover');
  expect(await edgeGlow(page, 'e-beta-gamma')).toBeNull();
  expect(await markup('e-alpha-delta')).toBe(bystander);

  await page.mouse.move(bare.x, bare.y, { steps: 4 });
  await expect.poll(() => edgeGlow(page, 'e-alpha-beta')).toBeNull();
  expect(await markup('e-alpha-delta')).toBe(bystander);
});
