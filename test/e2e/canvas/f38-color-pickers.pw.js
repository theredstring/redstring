// F38 (P5.06b): the colour pickers. Palette on a Thing's pie opens the picker,
// a hex typed into it recolours the Thing's prototype, pressing Palette again
// closes it; Palette on a defined connection's pie recolours the defining Thing,
// and deselecting the connection takes its picker with it.
import {
  test, expect,
  openFixture, storeEval, pieButton, openPieMenu, clickCenter, edgePoint, selectedEdgeIds,
  waitForCameraSettled, expectBareCanvas,
} from './helpers.js';

const picker = (page) => page.locator('.color-picker-panel');
const protoColor = (page, id) => storeEval(page, (st, pid) => st.nodePrototypes.get(pid)?.color, id);

async function typeHex(page, hex) {
  const input = picker(page).locator('input[type="text"]');
  await input.fill(hex);
  await input.blur();
}

test('F38 Palette on a Thing opens the picker, recolours the Thing, and toggles closed', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');

  await clickCenter(page, pieButton(page, 'palette'));
  await expect(picker(page)).toHaveCount(1);

  await typeHex(page, '#123456');
  await expect.poll(() => protoColor(page, 'p-alpha')).toBe('#123456');

  // Palette again on the same Thing closes it.
  await clickCenter(page, pieButton(page, 'palette'));
  await expect(picker(page)).toHaveCount(0);
});

test('F38b Palette on a defined connection recolours its Thing; deselecting closes the picker', async ({ page }) => {
  await openFixture(page, 'small');
  // Give the connection a definition so its pie offers Palette.
  await storeEval(page, (st) => st.updateEdge('e-beta-gamma', (d) => { d.definitionNodeIds = ['p-gamma']; }));

  const p = await edgePoint(page, 'e-beta-gamma', 0.35);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => selectedEdgeIds(page)).toEqual(['e-beta-gamma']);
  await waitForCameraSettled(page);

  await clickCenter(page, pieButton(page, 'palette'));
  await expect(picker(page)).toHaveCount(1);
  await typeHex(page, '#654321');
  await expect.poll(() => protoColor(page, 'p-gamma')).toBe('#654321');

  // Deselect the connection from the store (a canvas click would also close the
  // picker as a click-away); the picker follows the selection.
  await storeEval(page, (st) => { st.setSelectedEdgeId(null); st.setSelectedEdgeIds(new Set()); });
  await expect(picker(page)).toHaveCount(0);
  const bare = { x: 1000, y: 620 };
  await expectBareCanvas(page, bare);
});
