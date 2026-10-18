// F44: formulas. "New Formula" on the web menu builds a typed formula as
// Things in a group and shows it in place: one object on the canvas where the
// Things are, which hides them and the connections among them. A connection
// from outside lands on its Thing's token. A hovered token shows its Thing;
// the corner button turns the object back into Things; the offer pill (Back to
// Civilization's spot) shows the group the same way, and its X waves it off.
//
// FORMULA_SHOTS=<dir> also saves screenshots of each step.
import {
  test, expect, openFixture, storeEval, activeGraphSnapshot, nextFrames,
} from './helpers.js';

// In the small fixture's empty lower half, far enough left that a long formula
// (centred where it's asked for) fits on screen.
const BARE = { x: 780, y: 640 };
const shots = process.env.FORMULA_SHOTS;
// Shots wait out the hover transitions.
const shot = async (page, name) => {
  if (!shots) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/${name}.png` });
};

const QUADRATIC = 'x = (-b + sqrt(b^2 - 4*a*c)) / (2*a)';
const object = (page) => page.locator('svg.canvas g.formula-object');
const token = (page, text) => object(page)
  .locator('g.formula-object-token', { has: page.locator('text', { hasText: new RegExp(`^${text}$`) }) })
  .first();
// Pointer moves to a spot, never locator.hover/click: those scroll an element
// into view, and the canvas must only move through its camera.
async function pointAt(page, locator, { click = false } = {}) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (click) await page.mouse.click(x, y); else await page.mouse.move(x, y);
}
const revert = (page) => pointAt(page, object(page).locator('g.formula-object-revert circle'), { click: true });
const pillText = (page) => page.locator('.format-offer').innerText().then(t => t.replace(/\s+/g, ''));
const shownNodes = (page, ids) => page.evaluate((list) =>
  list.filter(id => document.querySelector(`svg.canvas g.node[data-instance-id="${id}"]`)).length, ids);

async function buildFormula(page, text) {
  await page.mouse.click(BARE.x, BARE.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^New Formula$/ }).click();
  const input = page.locator('.formula-composer input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await nextFrames(page, 2);
  await shot(page, '1-compose');
  await page.locator('.formula-composer-add').click();
  await expect(page.locator('.formula-composer')).toHaveCount(0);
}

test('F44 a typed formula is built as Things and shown in place as one object', async ({ page }) => {
  await openFixture(page, 'small');
  const before = await activeGraphSnapshot(page);

  await buildFormula(page, QUADRATIC);

  // 18 Things, 17 connections, one group named after the formula.
  const after = await activeGraphSnapshot(page);
  const memberIds = Object.keys(after.instances).filter(id => !before.instances[id]);
  expect(memberIds).toHaveLength(18);
  expect(after.edgeIds.length - before.edgeIds.length).toBe(17);
  expect(Object.values(after.groups).map(g => g.name)).toContain('x = (−b + √(b^2 − 4 × a × c)) ÷ (2 × a)');

  // Shown in place, and saved that way on the group: the object, not its Things.
  const formatOf = () => storeEval(page, (st) => {
    const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.name.startsWith('x = '));
    return g?.format ?? null;
  });
  expect(await formatOf()).toBe('formula');
  await expect(object(page)).toHaveCount(1);
  expect(await shownNodes(page, memberIds)).toBe(0);

  // A connection from outside lands on its Thing's token.
  const xId = await storeEval(page, (st, ids) => {
    const g = st.graphs.get(st.activeGraphId);
    return ids.find(id => st.nodePrototypes.get(g.instances.get(id).prototypeId).name === 'x');
  }, memberIds);
  await storeEval(page, (st, dest) => st.addEdge(st.activeGraphId, {
    id: 'e-alpha-x', sourceId: 'i-alpha', destinationId: dest, directionality: { arrowsToward: new Set([dest]) },
  }), xId);
  await shot(page, '2-in-place');

  // Hover an operator: it becomes its Thing, and its description shows.
  await pointAt(page, token(page, '√'));
  await expect(object(page).locator('.formula-object-chip')).toHaveText('Square Root');
  await shot(page, '3-hover-operator');
  await pointAt(page, token(page, 'x'));
  await expect(object(page).locator('.formula-object-role')).toHaveText('Operand of Equality');

  // Back to Things.
  await revert(page);
  await expect(object(page)).toHaveCount(0);
  expect(await formatOf()).toBe(null);
  // Back on the canvas (the culled ones are simply off screen).
  await expect.poll(() => shownNodes(page, memberIds)).toBeGreaterThan(0);
  await shot(page, '4-as-things');
});

test('F44 the offer shows a group in place, and its X waves it off', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  await revert(page);
  await expect(object(page)).toHaveCount(0);

  // The group is offered back.
  const pill = page.locator('.format-offer');
  await expect(pill).toBeVisible();
  await expect.poll(() => pillText(page)).toContain('a+b×c');
  await page.locator('.format-offer-main').click();
  await expect(object(page)).toHaveCount(1);
  await expect(pill).toHaveCount(0);

  await revert(page);
  await expect(pill).toBeVisible();
  await page.locator('.format-offer-dismiss').click();
  await expect(pill).toHaveCount(0);
});
