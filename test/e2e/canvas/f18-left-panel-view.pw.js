// F18: the left panel opens to the view it's asked for, and asking again after
// the user has moved elsewhere switches back. Since P2.05 a view is a request
// in canvasUIStore with a nonce, replacing the imperative setActiveView and the
// null-then-rAF re-set of a prop.
import { test, expect, openFixture, storeEval, clickCenter, openPieMenu, pieButton } from './helpers.js';

test('F18 a Universes request opens the left panel there, and a repeat request switches back', async ({ page }) => {
  await openFixture(page, 'small');
  const isActive = (title) => page.locator(`.panel-view-tab[title="${title}"]`).first().getAttribute('data-active');
  const askForUniverses = () => page.evaluate(() => window.dispatchEvent(new Event('redstring:open-federation')));

  await askForUniverses();
  await expect.poll(() => storeEval(page, (st) => st.leftPanelExpanded)).toBe(true);
  await expect.poll(() => isActive('Universes')).toBe('true');

  // At the default width only the active tab fits; the rest are behind
  // "More views". The active tab is always kept visible, titled.
  await clickCenter(page, page.locator('.panel-view-tab[title="More views"]'));
  await page.locator('.context-menu-item', { hasText: /^Saved Things$/ }).click();
  await expect.poll(() => isActive('Saved Things')).toBe('true');

  await askForUniverses();
  await expect.poll(() => isActive('Universes')).toBe('true');
});

// The pie's Semantic Search opens the left panel on Semantic Discovery, and on
// its Discover list even if the view was last left on History: the search used
// to run behind whichever mode the view was in, where nobody could see it.
test('F18b the pie\'s Semantic Search opens Semantic Discovery on its results', async ({ page }) => {
  await openFixture(page, 'small');
  const isActive = (title) => page.locator(`.panel-view-tab[title="${title}"]`).first().getAttribute('data-active');
  const modeButton = page.locator('h2', { hasText: 'Semantic Discovery' }).locator('xpath=following-sibling::div[1]/*').first();
  const semanticSearchFromPie = async () => {
    await openPieMenu(page, 'i-alpha');
    if (await pieButton(page, 'text-search').count() === 0) {
      // Second page of the pie: the right-hand chevron.
      const chevrons = page.locator('svg.canvas g.pie-chevron-intro');
      const [a, b] = await Promise.all([chevrons.nth(0).boundingBox(), chevrons.nth(1).boundingBox()]);
      await clickCenter(page, chevrons.nth(a.x > b.x ? 0 : 1));
    }
    await clickCenter(page, pieButton(page, 'text-search'));
  };

  await semanticSearchFromPie();
  await expect.poll(() => storeEval(page, (st) => st.leftPanelExpanded)).toBe(true);
  await expect.poll(() => isActive('Semantic Discovery')).toBe('true');

  await clickCenter(page, modeButton);
  await page.locator('.context-menu-item', { hasText: /^History/ }).click();
  await expect(modeButton).toHaveText(/^History/);

  // Deselect (closing the pie), shut the panel, and search again.
  await page.mouse.click(700, 700);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
  await storeEval(page, (st) => st.setLeftPanelExpanded(false));
  await semanticSearchFromPie();
  await expect.poll(() => storeEval(page, (st) => st.leftPanelExpanded)).toBe(true);
  await expect.poll(() => isActive('Semantic Discovery')).toBe('true');
  await expect(modeButton).toHaveText(/^Discover/);
});
