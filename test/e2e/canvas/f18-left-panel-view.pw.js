// F18: the left panel opens to the view it's asked for, and asking again after
// the user has moved elsewhere switches back. Since P2.05 a view is a request
// in canvasUIStore with a nonce, replacing the imperative setActiveView and the
// null-then-rAF re-set of a prop.
import { test, expect, openFixture, storeEval, clickCenter } from './helpers.js';

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
