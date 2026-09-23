// F6: clicking a node opens its pie menu; an action works; the menu closes.
//
// Pie buttons have no data attributes; each one's icon is a lucide component,
// which renders <svg class="lucide-<icon-name>">, so buttons are found by icon.
import {
  test, expect,
  openFixture, selectedNodeIds, storeEval, expectBareCanvas, pieButton, openPieMenu, clickCenter,
} from './helpers.js';

test('F6 click opens the pie menu; Save and Open in Panel work; clicking off closes it', async ({ page }) => {
  await openFixture(page, 'small');
  expect(await storeEval(page, (st) => st.savedNodeIds.has('p-alpha'))).toBe(true);

  await openPieMenu(page, 'i-alpha');

  // Save (bookmark) toggles the Thing's saved state.
  await clickCenter(page, pieButton(page, 'bookmark'));
  await expect.poll(() => storeEval(page, (st) => st.savedNodeIds.has('p-alpha'))).toBe(false);

  // Open in Panel opens the Thing's tab in the right panel and expands it.
  await clickCenter(page, pieButton(page, 'notebook-text'));
  await expect.poll(() => storeEval(page, (st) => ({
    expanded: st.rightPanelExpanded,
    activeTab: st.rightPanelTabs.find((t) => t.isActive),
  }))).toMatchObject({ expanded: true, activeTab: { type: 'node', nodeId: 'p-alpha' } });

  // Clicking bare canvas deselects, and the menu plays out and unmounts.
  const off = { x: 300, y: 700 };
  await expectBareCanvas(page, off);
  await page.mouse.click(off.x, off.y);
  await expect.poll(() => selectedNodeIds(page)).toEqual([]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
});
