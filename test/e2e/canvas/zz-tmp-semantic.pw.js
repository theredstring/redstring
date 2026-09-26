import { test, expect, openFixture, storeEval, pieButton, openPieMenu, clickCenter } from './helpers.js';

test('tmp semantic pie', async ({ page }) => {
  page.on('console', m => { if (/semantic|Semantic|error/i.test(m.text())) console.log('[console]', m.text().slice(0, 200)); });
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');
  let btn = page.locator('svg.canvas g.pie-menu svg.lucide-text-search');
  if (await btn.count() === 0) {
    const chevrons = page.locator('svg.canvas g.pie-chevron-intro');
    const [a, b] = await Promise.all([chevrons.nth(0).boundingBox(), chevrons.nth(1).boundingBox()]);
    await clickCenter(page, chevrons.nth(a.x > b.x ? 0 : 1));
  }
  console.log('btn count', await btn.count());
  await clickCenter(page, btn);
  await page.waitForTimeout(1500);
  console.log('expanded', await storeEval(page, st => st.leftPanelExpanded));
  const tabs = await page.locator('.panel-view-tab').evaluateAll(els => els.map(e => [e.getAttribute('title'), e.getAttribute('data-active')]));
  console.log('tabs', JSON.stringify(tabs));
});
