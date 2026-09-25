// F31: adding a concept to the generalization axis from the carousel. Plus
// opens stage 2; "Add Above" opens the abstraction prompt; submitting a name
// puts a new concept above the focused one in the chain. (Since the refactor
// the submit lives in components/canvas/actions/abstractionSubmit.js.)
import { test, expect, openFixture, pieButton, clickCenter, openPieMenu, waitForCameraSettled, storeEval } from './helpers.js';

const chainNames = (page) => page.evaluate(() => [...document.querySelectorAll('[data-carousel-level]')]
  .map((g) => ({ level: Number(g.getAttribute('data-carousel-level')), name: g.textContent.trim() }))
  .sort((a, b) => a.level - b.level).map((e) => e.name));

test('F31 Add Above in the carousel puts a new, named concept above the focused one', async ({ page }) => {
  await openFixture(page, 'small');
  await openPieMenu(page, 'i-alpha');
  await clickCenter(page, pieButton(page, 'layers'));
  await expect.poll(() => chainNames(page)).toEqual(['Alpha', 'Thing']);
  await waitForCameraSettled(page);

  // Stage 2 carries the add buttons.
  await clickCenter(page, pieButton(page, 'plus'));
  await expect(pieButton(page, 'corner-up-left')).toBeVisible();
  await clickCenter(page, pieButton(page, 'corner-up-left'));

  const input = page.locator('input.unified-selector-control[type="text"]:visible');
  await expect(input).toBeVisible();
  await input.fill('Letter');
  await input.press('Enter');

  // Levels run top to bottom, so "above" Alpha is the level before it.
  await expect.poll(() => chainNames(page), { message: 'the new concept joins the chain above Alpha' })
    .toEqual(['Letter', 'Alpha', 'Thing']);
  expect(await storeEval(page, (st) => [...st.nodePrototypes.values()].some((p) => p.name === 'Letter'))).toBe(true);
});
