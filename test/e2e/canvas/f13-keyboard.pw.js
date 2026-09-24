// F13: keyboard. Delete removes the selection; WASD / arrows pan and
// Shift / Space zoom; none of it reaches the canvas while a text field has
// focus.
//
// Movement keys are tracked by useKeyboardShortcuts (held = true until keyup)
// and applied once per frame by the loop in useCanvasKeyboard, which writes the
// camera straight to the DOM. So "held for N ms" is the unit here, and the
// assertions are about direction, not distance: frame timing decides distance.
import {
  test, expect,
  openFixture, camera, waitForCameraSettled, activeGraphSnapshot,
  selectedNodeIds, storeEval, openPieMenu, CLICK_DELAY_MS,
} from './helpers.js';

const HOLD_MS = 300;

async function hold(page, key, ms = HOLD_MS) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  return waitForCameraSettled(page);
}

test('F13 WASD and arrow keys pan the camera the way they point', async ({ page }) => {
  await openFixture(page, 'small');
  // Keys pan the camera, so the world moves the other way: D (right) moves the
  // view right, which is the pan offset going down.
  const cases = [
    ['d', 'x', -1], ['a', 'x', +1], ['s', 'y', -1], ['w', 'y', +1],
    ['ArrowRight', 'x', -1], ['ArrowLeft', 'x', +1], ['ArrowDown', 'y', -1], ['ArrowUp', 'y', +1],
  ];
  for (const [key, axis, sign] of cases) {
    const before = await camera(page);
    const after = await hold(page, key);
    const other = axis === 'x' ? 'y' : 'x';
    expect(Math.sign(after.pan[axis] - before.pan[axis]), `${key} pans ${axis}`).toBe(sign);
    expect(Math.abs(after.pan[axis] - before.pan[axis]), `${key} moves a visible amount`).toBeGreaterThan(20);
    expect(after.pan[other], `${key} leaves ${other} alone`).toBeCloseTo(before.pan[other], 3);
    expect(after.zoom, `${key} does not zoom`).toBe(before.zoom);
  }

  // The last settled camera is written to the graph's view.
  const settled = await camera(page);
  await expect.poll(async () => {
    const v = await storeEval(page, (st) => st.graphViews.get(st.activeGraphId));
    return Math.hypot(v.panOffset.x - settled.pan.x, v.panOffset.y - settled.pan.y) + Math.abs(v.zoomLevel - settled.zoom);
  }, { message: 'keyboard pan saved to graphViews' }).toBeLessThan(0.5);
});

test('F13 Shift zooms in and Space zooms out', async ({ page }) => {
  await openFixture(page, 'small');
  const cam0 = await camera(page);
  const zoomedIn = await hold(page, 'Shift');
  expect(zoomedIn.zoom).toBeGreaterThan(cam0.zoom);
  const zoomedOut = await hold(page, ' ');
  expect(zoomedOut.zoom).toBeLessThan(zoomedIn.zoom);
});

test('F13 Delete and Backspace remove the selected node and its connections', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);

  // Delete: Gamma, which has one connection (from Beta).
  await openPieMenu(page, 'i-gamma');
  await page.keyboard.press('Delete');
  await expect.poll(async () => Object.keys((await activeGraphSnapshot(page)).instances)).not.toContain('i-gamma');
  let snap = await activeGraphSnapshot(page);
  expect(snap.edgeIds).not.toContain('e-beta-gamma');
  expect(await selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);

  // Backspace: Epsilon (connections to Delta and Beta).
  await openPieMenu(page, 'i-epsilon');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => Object.keys((await activeGraphSnapshot(page)).instances)).not.toContain('i-epsilon');
  snap = await activeGraphSnapshot(page);
  expect(snap.edgeIds).not.toContain('e-delta-epsilon');
  expect(snap.edgeIds).not.toContain('e-epsilon-beta');

  // Nothing else went: every other instance and connection is still there.
  const gone = new Set(['i-gamma', 'i-epsilon']);
  for (const id of Object.keys(before.instances)) {
    if (!gone.has(id)) expect(snap.instances[id], `${id} kept`).toBeTruthy();
  }
  expect(snap.edgeIds.sort()).toEqual(
    before.edgeIds.filter((id) => !['e-beta-gamma', 'e-delta-epsilon', 'e-epsilon-beta'].includes(id)).sort(),
  );
});

test('F13 keys typed into a text field never reach the canvas', async ({ page }) => {
  await openFixture(page, 'small');
  // Gamma's tab in the right panel: its Bio is a real text field on screen.
  await storeEval(page, (st) => { st.openRightPanelNodeTab('p-gamma'); st.setRightPanelExpanded(true); });
  const bioPrompt = page.locator('.panel-container.right').getByText('Double-click to add a bio');
  await expect(bioPrompt).toBeVisible();

  // Select Alpha on the canvas, then start typing into Gamma's bio.
  await openPieMenu(page, 'i-alpha');
  await bioPrompt.dblclick();
  const field = page.locator('.panel-container.right').locator('textarea:focus, input:focus, [contenteditable="true"]:focus');
  await expect(field).toHaveCount(1);
  // The canvas selection survives focusing the panel, so a leaked Backspace
  // really would delete something.
  expect(await selectedNodeIds(page)).toEqual(['i-alpha']);

  const cam0 = await camera(page);
  await page.keyboard.type('wasd');
  await page.keyboard.down('d');
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up('d');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(CLICK_DELAY_MS);

  // The text went into the field...
  const typed = await field.evaluate((el) => (el.value ?? el.textContent));
  expect(typed.startsWith('wasd')).toBe(true);
  // ...and nothing reached the canvas: no pan, no zoom, Alpha still there.
  const cam1 = await camera(page);
  expect(cam1).toEqual(cam0);
  expect((await activeGraphSnapshot(page)).instances['i-alpha']).toBeTruthy();

  // Control: with the field blurred, the same key pans. Otherwise the checks
  // above could pass because the keyboard was off for some other reason.
  await field.evaluate((el) => el.blur());
  const moved = await hold(page, 'd');
  expect(moved.pan.x).toBeLessThan(cam1.pan.x);
});
