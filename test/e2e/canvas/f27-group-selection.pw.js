// F27: the group panel shows the group as it is now. Since P2.03b the selected
// group is an id in canvasUIStore and the group is read from the active web;
// before, it was a snapshot, so an edit made elsewhere left the panel stale.
import { test, expect, openFixture, activeGraphSnapshot, clickCenter, storeEval } from './helpers.js';

test('F27 renaming the selected group in the store updates its control panel', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);
  const [pairId] = Object.entries(before.groups).find(([, g]) => g.name === 'Pair');

  await clickCenter(page, page.locator(`svg.canvas g.group[data-group-id="${pairId}"] g.group-label`).first());
  const panel = page.locator('.unified-bottom-panel.mode-group');
  await expect(panel).toContainText('Pair');

  await storeEval(page, (st, id) => st.updateGroup(st.activeGraphId, id, (g) => { g.name = 'Renamed Pair'; }), pairId);
  await expect(panel).toContainText('Renamed Pair');
});
