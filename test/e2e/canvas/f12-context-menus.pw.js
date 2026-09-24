// F12: right-click menus. Bare canvas gets the web menu, a node gets the node
// menu; the node menu reflects the node's state; a chosen item runs; clicking
// off closes the menu.
//
// The menu (components/ContextMenu.jsx) is a fixed card of .context-menu-item
// rows over a full-screen .context-menu-backdrop. The backdrop ignores clicks
// in the first 300 ms, so a touch's trailing click can't close the menu it
// just opened; clicking off waits that out. The lists are exact on purpose:
// the refactor must not drop, add or reorder an item. Update them here when a
// menu changes deliberately.
import {
  test, expect,
  openFixture, nodeBox, centerOf, expectBareCanvas, storeEval, activeGraphSnapshot, selectedNodeIds,
  openPieMenu, marqueeModifier, EXPECT_KNOWN_BUGS,
} from './helpers.js';

const CANVAS_MENU = ['Auto Layout Web', 'Snap to Grid', 'Ask The Wizard', 'Merge Duplicates', 'Condense Things', 'Force Simulation', 'Refresh'];
const nodeMenu = (saveLabel) => ['Open Web', 'Decompose', 'Generalize / Specify', 'Delete', 'Edit', saveLabel, 'Color', 'Semantic Orbit'];
const BACKDROP_GUARD_MS = 300;

const menuItems = (page) => page.locator('.context-menu-item').allInnerTexts().then((ts) => ts.map((t) => t.trim()));
const BARE = { x: 1000, y: 650 }; // the small fixture's empty lower-right quarter

async function closeByClickingOff(page) {
  await page.waitForTimeout(BACKDROP_GUARD_MS);
  await page.mouse.click(BARE.x, BARE.y);
  await expect(page.locator('.context-menu-item')).toHaveCount(0);
  await expect(page.locator('.context-menu-backdrop')).toHaveCount(0);
}

test('F12 right-clicking bare canvas opens the web menu; clicking off closes it', async ({ page }) => {
  await openFixture(page, 'small');
  await expectBareCanvas(page, BARE);
  await page.mouse.click(BARE.x, BARE.y, { button: 'right' });
  await expect.poll(() => menuItems(page)).toEqual(CANVAS_MENU);
  // A right-click is not a click: no selection, no pie menu, no plus sign.
  expect(await selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
  await closeByClickingOff(page);
});

test('F12 right-clicking a node opens its menu, and the Save item follows the node', async ({ page }) => {
  await openFixture(page, 'small');

  // Alpha is bookmarked in the fixture, Gamma is not.
  await page.mouse.click(...Object.values(centerOf(await nodeBox(page, 'i-alpha'))), { button: 'right' });
  await expect.poll(() => menuItems(page)).toEqual(nodeMenu('Unsave'));
  await closeByClickingOff(page);

  await page.mouse.click(...Object.values(centerOf(await nodeBox(page, 'i-gamma'))), { button: 'right' });
  await expect.poll(() => menuItems(page)).toEqual(nodeMenu('Save'));
  expect(await selectedNodeIds(page), 'a right-click does not select').toEqual([]);

  // Choosing an item runs it and closes the menu.
  await page.locator('.context-menu-item', { hasText: /^Save$/ }).click();
  await expect(page.locator('.context-menu-item')).toHaveCount(0);
  await expect.poll(() => storeEval(page, (st) => st.savedNodeIds.has('p-gamma'))).toBe(true);
});

test('F12 after Save from the node menu, the same node\'s menu offers Unsave (B-05)', async ({ page }) => {
  // B-05: <Node>'s memo comparator ignores function props, so a node keeps the
  // onContextMenu closure from its last real render. Saving a Thing changes no
  // prop of its node, so the node does not re-render, and its menu is built
  // from the savedNodeIds that closure captured: it still says "Save".
  // Expected to fail until P3.02 makes node handlers stable (D-09); remove
  // test.fail() there.
  test.fail(EXPECT_KNOWN_BUGS, 'B-05, fixed in P3.02 (phases/P3-canvas-layers.md)');

  await openFixture(page, 'small');
  const gamma = centerOf(await nodeBox(page, 'i-gamma'));
  await page.mouse.click(gamma.x, gamma.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^Save$/ }).click();
  await expect.poll(() => storeEval(page, (st) => st.savedNodeIds.has('p-gamma'))).toBe(true);

  await page.mouse.click(gamma.x, gamma.y, { button: 'right' });
  // Short timeout: the menu is built once, on open, so waiting longer can't help.
  await expect.poll(() => menuItems(page), { timeout: 3_000 }).toEqual(nodeMenu('Unsave'));
});

test('F12 the node menu\'s Delete removes the node', async ({ page }) => {
  await openFixture(page, 'small');
  await page.mouse.click(...Object.values(centerOf(await nodeBox(page, 'i-delta'))), { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^Delete$/ }).click();
  await expect.poll(async () => Object.keys((await activeGraphSnapshot(page)).instances)).not.toContain('i-delta');
  const snap = await activeGraphSnapshot(page);
  expect(snap.edgeIds).not.toContain('e-alpha-delta');
  expect(snap.edgeIds).not.toContain('e-delta-epsilon');
});

test('F12 after a copy, the web menu offers Paste Thing, which pastes it', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);

  // Copy Alpha with the keyboard (Cmd on Mac, Ctrl elsewhere).
  await openPieMenu(page, 'i-alpha');
  const mod = await marqueeModifier(page);
  await page.keyboard.press(`${mod}+c`);

  await page.mouse.click(BARE.x, BARE.y, { button: 'right' });
  await expect.poll(() => menuItems(page)).toContain('Paste Thing');
  const items = await menuItems(page);
  expect(items.filter((t) => t !== 'Paste Thing'), 'the rest of the menu is unchanged').toEqual(CANVAS_MENU);

  await page.locator('.context-menu-item', { hasText: /^Paste Thing$/ }).click();
  await expect.poll(async () => Object.keys((await activeGraphSnapshot(page)).instances).length).toBe(Object.keys(before.instances).length + 1);
  const after = await activeGraphSnapshot(page);
  const [newId] = Object.keys(after.instances).filter((id) => !before.instances[id]);
  expect(after.instances[newId].prototypeId, 'a new instance of the copied Thing').toBe('p-alpha');
});
