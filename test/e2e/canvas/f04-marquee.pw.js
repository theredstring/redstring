// F4: marquee selects the expected set, and does not select group anchors.
//
// Selection lives in NodeCanvas React state (selectedInstanceIds), not in the
// store. Two DOM views of it:
//   - g.node.selected: the rendered nodes that are selected. Group anchors are
//     never rendered in a multi-selection, so this view cannot show B-01.
//   - the multi-selection bottom panel (.unified-bottom-panel.mode-nodes),
//     which lists one entry per selected instance's prototype
//     (selectedNodePrototypes, straight from selectedInstanceIds). A selected
//     anchor shows up there as its node-group's Thing.
import {
  test, expect,
  openFixture, nodeBox, selectedNodeIds, camera, marqueeModifier, expectBareCanvas, EXPECT_KNOWN_BUGS,
} from './helpers.js';

async function marquee(page, from, to) {
  const modifier = await marqueeModifier(page);
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down(modifier);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  // The rubber band is drawn while dragging.
  await expect(page.locator('svg.canvas rect[stroke="red"]')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up(modifier);
  await expect(page.locator('svg.canvas rect[stroke="red"]')).toHaveCount(0);
}

async function bottomPanelNames(page) {
  const panel = page.locator('.unified-bottom-panel.mode-nodes .unified-bottom-content');
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  return text.split('\n').map((s) => s.trim()).filter(Boolean).sort();
}

test('F4 marquee selects exactly the nodes inside the rectangle', async ({ page }) => {
  await openFixture(page, 'small');
  const cam0 = await camera(page);
  const alpha = await nodeBox(page, 'i-alpha');
  const epsilon = await nodeBox(page, 'i-epsilon');

  // Around Alpha, Beta, Delta, Epsilon: the upper-left block of free nodes.
  const from = { x: alpha.x - 25, y: alpha.y - 25 };
  const to = { x: epsilon.x + epsilon.width + 25, y: epsilon.y + epsilon.height + 12 };
  await expectBareCanvas(page, from);
  await marquee(page, from, to);

  await expect.poll(() => selectedNodeIds(page)).toEqual(['i-alpha', 'i-beta', 'i-delta', 'i-epsilon']);
  expect(await bottomPanelNames(page)).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon']);

  // A marquee is not a pan.
  const cam1 = await camera(page);
  expect(cam1.pan).toEqual(cam0.pan);
});

test('F4 marquee over a node-group selects its members but not its anchor (B-01)', async ({ page }) => {
  // B-01: the mouse marquee release path skips the anchor filter that
  // selectionFromRect applies, so the node-group's hidden anchor instance is
  // selected too and "Cluster" appears in the multi-selection panel. Expected
  // to fail until P1.04 fixes B-01; remove test.fail() there.
  test.fail(EXPECT_KNOWN_BUGS, 'B-01, fixed in P1.04 (phases/P1-stop-rerenders.md)');

  await openFixture(page, 'small');
  const zeta = await nodeBox(page, 'i-zeta');
  const eta = await nodeBox(page, 'i-eta');
  const from = { x: zeta.x - 30, y: zeta.y - 40 };
  const to = { x: eta.x + eta.width + 20, y: eta.y + eta.height + 30 };
  await marquee(page, from, to);

  // The members are selected (this part holds today)...
  await expect.poll(() => selectedNodeIds(page)).toEqual(['i-eta', 'i-zeta']);
  // ...and nothing else is: no anchor, so no "Cluster" entry.
  expect(await bottomPanelNames(page)).toEqual(['Eta', 'Zeta']);
});
