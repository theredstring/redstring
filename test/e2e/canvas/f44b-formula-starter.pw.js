// F44b: the formula starter. New Formula offers nothing from the bank until
// the bank is added to the universe (Settings → Data → Formula Starter), by
// discipline or all of them: built in a worker in a store of its own, then
// merged, filed under Formulas, each equation shown as its formula in its
// section's web. From then on New Formula lists the universe's equations, and
// picking one places that equation, not a copy of it. Adding the same again
// adds nothing.
//
// FORMULA_SHOTS=<dir> also saves screenshots of each step.
import { test, expect, openFixture, storeEval } from './helpers.js';

const BARE = { x: 780, y: 640 };
const shots = process.env.FORMULA_SHOTS;
const shot = async (page, name) => {
  if (!shots) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/${name}.png` });
};
const object = (page) => page.locator('svg.canvas g.formula-object');

const openComposer = async (page, at = BARE) => {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^New Formula$/ }).click();
  await expect(page.locator('.formula-selector .unified-selector-pill input')).toBeFocused();
};
const named = (page, name) => storeEval(page, (st, n) => [...st.nodePrototypes.values()].filter(p => p.name === n).length, name);
const webOf = (page, name) => storeEval(page, (st, n) => {
  const d = [...st.nodePrototypes.values()].find(x => x.name === n);
  const web = d && st.graphs.get(d.definitionGraphIds[0]);
  return web ? [...web.instances.values()].filter(i => !i.isGroupAnchor).map(i => st.nodePrototypes.get(i.prototypeId).name).sort() : null;
}, name);

test('F44b the formula starter: nothing offered until added; then listed, and placed as the same equation', async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, 'small');

  // Nothing from the bank yet.
  await openComposer(page);
  await expect(page.locator('.format-bank-body')).toContainText('No equations in this universe yet');
  await shot(page, 's1-empty');
  await page.keyboard.press('Escape');
  await expect(page.locator('.formula-selector')).toHaveCount(0);

  // Settings → Data: pick a discipline, add (the button asks once more), and wait for it.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'data' } })));
  await expect(page.locator('.settings-section-subtitle', { hasText: 'Formula Starter' })).toBeVisible();
  const chip = page.locator('.settings-option-group button', { hasText: /^Epidemiology \d+$/ });
  await chip.click();
  const row = page.locator('.settings-row', { hasText: 'Add to This Universe' });
  await expect(row).toContainText(/14 equations and the \d+ things they're about/);
  await shot(page, 's2-chosen');
  // A pointer press, as a person makes one: locator.click scrolls the page to the button first.
  const press = async () => {
    const b = await row.locator('button').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  await press();
  await expect(row.locator('button')).toContainText('Add 14?');
  await press();
  const opened = page.locator('.settings-row', { hasText: /^Formulas/ });
  await expect(opened).toContainText('Added 14 equations', { timeout: 60_000 });
  expect(await page.evaluate(() => document.body.scrollLeft)).toBe(0);
  await shot(page, 's3-added');
  // Added: none of it is new any more.
  await expect(chip).toHaveText('Epidemiology 0');

  // Filed: Formulas holds the discipline, the discipline its webs, each equation shown as its formula.
  expect(await webOf(page, 'Formulas')).toEqual(['Epidemiology']);
  const shown = await storeEval(page, (st) => {
    let formulas = 0;
    for (const g of st.graphs.values()) for (const gr of g.groups?.values() || []) if (gr.format === 'formula') formulas++;
    return formulas;
  });
  expect(shown).toBe(14);
  // Built apart: no web of it opened, and the web you were on is where you are.
  const tabs = await storeEval(page, (st) => st.openGraphIds.map(id => st.graphs.get(id)?.name));
  expect(tabs).not.toContain('Formulas');

  // Open takes you to Formulas.
  const home = await storeEval(page, (st) => st.activeGraphId);
  await opened.locator('button').click();
  await expect.poll(() => storeEval(page, (st) => st.graphs.get(st.activeGraphId)?.name)).toBe('Formulas');
  await shot(page, 's4-formulas-web');

  // New Formula lists them now: the discipline, by section.
  await storeEval(page, (st, id) => st.setActiveGraph(id), home);
  await openComposer(page);
  await expect(page.locator('.format-bank-choice.is-on', { hasText: /^Epidemiology$/ })).toHaveCount(1);
  await expect(page.locator('.format-bank-choice', { hasText: /^Physics$/ })).toHaveCount(0);
  await shot(page, 's5-listed');
  // Picking one places that equation here, shown as its formula: the same Thing.
  const before = await storeEval(page, (st) => st.nodePrototypes.size);
  await page.locator('.format-bank-row').first().click();
  await expect(page.locator('.formula-selector')).toHaveCount(0);
  await expect(object(page)).toHaveCount(1);
  expect(await storeEval(page, (st) => st.nodePrototypes.size)).toBe(before);
  // Where it was asked for: its middle on the spot that was right-clicked.
  await page.waitForTimeout(700); // its entrance
  const box = await object(page).boundingBox();
  expect(Math.abs(box.x + box.width / 2 - BARE.x)).toBeLessThan(60);
  expect(Math.abs(box.y + box.height / 2 - BARE.y)).toBeLessThan(60);
  await shot(page, 's6-placed');

  // Adding the same again adds nothing.
  const things = await storeEval(page, (st) => st.nodePrototypes.size);
  const again = await page.evaluate(async () => {
    const { addFormulaStarter } = await import('/src/components/canvas/formats/formula/bank/formulaStarter.js');
    return (await addFormulaStarter(['epidemiology'])).added;
  });
  expect(again).toBe(0);
  expect(await storeEval(page, (st) => st.nodePrototypes.size)).toBe(things);
  expect(await named(page, 'Formulas')).toBe(1);
});
