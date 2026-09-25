// F24: what the canvas shows without a universe to draw. Since P2.06c those
// screens are UniverseScreens and the lifecycle around them is UniverseHost.
import { test, expect, openFixture, storeEval } from './helpers.js';

test('F24 loading, then a failed load: the error card and "Go to Universes"', async ({ page }) => {
  await openFixture(page, 'small');
  await expect(page.locator('svg.canvas')).toBeVisible();

  await storeEval(page, () => window.useGraphStore.setState({ isUniverseLoading: true }));
  await expect(page.getByText(/Loading |Preparing your universe/).first()).toBeVisible();
  await expect(page.locator('svg.canvas')).toHaveCount(0);

  await storeEval(page, () => window.useGraphStore.setState({
    isUniverseLoading: false, isUniverseLoaded: false, universeLoadingError: 'F24: the file could not be read',
  }));
  await expect(page.getByText('F24: the file could not be read')).toBeVisible();
  const actions = page.locator('.canvas-loading-actions');
  await expect(actions).toBeVisible();

  await actions.getByText('Go to Universes').click();
  await expect.poll(() => storeEval(page, (st) => [st.isUniverseLoaded, st.leftPanelExpanded])).toEqual([true, true]);
  await expect(page.locator('.panel-view-tab[title="Universes"]')).toHaveAttribute('data-active', 'true');
});

test('F24b the save status pill is on screen', async ({ page }) => {
  await openFixture(page, 'small');
  await expect(page.getByText(/^(Saved|Saving|Not saved|Unsaved)/).first()).toBeVisible();
});
