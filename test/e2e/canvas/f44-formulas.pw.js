// F44: formulas. "New Formula" on the web menu builds a typed formula as a web
// of operations: its operands as Things, each operation a connection defined by
// the operation's Thing, each part in parentheses a nested Thing-group named
// after its term (typed Square Root, Negation... when that is what it is), all
// in a group shown in place as the formula: one object on the canvas where the
// Things are, which hides them and the connections among them. A connection
// from outside lands on its Thing's token. A hovered token becomes its Thing; a
// tap selects the formula and brings up the group panel's format mode, whose
// arrows swap it between Things and Formula; a double tap on a token opens its
// Thing; hold-and-drag moves it (snapping to the grid when that's on) as one
// undo step. The offer pill (Back to Civilization's spot) shows a group as its
// formula, and its X waves it off.
//
// FORMULA_SHOTS=<dir> also saves screenshots of each step.
import {
  test, expect, openFixture, storeEval, activeGraphSnapshot, nextFrames, NODE_LIFT_DELAY_MS, findBareSpot,
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
const panel = (page) => page.locator('.unified-bottom-panel.mode-format');
const token = (page, text) => object(page)
  .locator('g.formula-object-token', { has: page.locator('text', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
  .first();
// Pointer moves to a spot, never locator.hover/click: those scroll an element
// into view, and the canvas must only move through its camera.
async function centerOfLocator(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function pointAt(page, locator, { click = false } = {}) {
  const { x, y } = await centerOfLocator(locator);
  if (click) await page.mouse.click(x, y); else await page.mouse.move(x, y);
}
const pillText = (page) => page.locator('.format-offer').innerText().then(t => t.replace(/\s+/g, ''));
const shownNodes = (page, ids) => page.evaluate((list) =>
  list.filter(id => document.querySelector(`svg.canvas g.node[data-instance-id="${id}"]`)).length, ids);
const formulaGroup = (page, prefix) => storeEval(page, (st, p) => {
  const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.name.startsWith(p));
  return g ? { id: g.id, format: g.format ?? null, members: [...g.memberInstanceIds] } : null;
}, prefix);
const positionsOf = (page, ids) => storeEval(page, (st, list) => {
  const g = st.graphs.get(st.activeGraphId);
  return list.map(id => ({ x: g.instances.get(id).x, y: g.instances.get(id).y }));
}, ids);

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

  // 9 operands and 4 parts (each a Thing-group's Thing), 8 operations, and the
  // formula's group named after it.
  const after = await activeGraphSnapshot(page);
  const memberIds = Object.keys(after.instances).filter(id => !before.instances[id]);
  expect(memberIds).toHaveLength(13);
  expect(after.edgeIds.length - before.edgeIds.length).toBe(8);
  const names = Object.values(after.groups).map(g => g.name);
  expect(names).toContain('x = (−b + √(b ^ 2 − 4 × a × c)) ÷ (2 × a)');
  expect(names).toEqual(expect.arrayContaining(['−b + √(b ^ 2 − 4 × a × c)', '2 × a', '−b', '√(b ^ 2 − 4 × a × c)']));
  // Each operation is a connection defined by its Thing.
  const operations = await storeEval(page, (st, ids) => {
    const g = st.graphs.get(st.activeGraphId);
    return g.edgeIds.map(id => st.edges.get(id))
      .filter(e => ids.includes(e.sourceId))
      .map(e => st.nodePrototypes.get(e.definitionNodeIds?.[0])?.name).sort();
  }, memberIds);
  expect(operations).toEqual(['Addition', 'Division', 'Equality', 'Exponentiation', 'Multiplication', 'Multiplication', 'Multiplication', 'Subtraction']);

  // Shown in place, and saved that way on the group: the object, not its Things.
  expect((await formulaGroup(page, 'x = ')).format).toBe('formula');
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

  // Standard notation by default: no ^ (the exponent smaller and lifted) and no
  // × where math multiplies side by side (4ac, 2a).
  await expect(object(page).locator('g.formula-object-token text', { hasText: /^×$/ })).toHaveCount(0);
  // Exponents: no ^, the exponent smaller and lifted.
  await expect(object(page).locator('g.formula-object-token text', { hasText: /^\^$/ })).toHaveCount(0);
  const sizeOf = (loc) => loc.locator('text').getAttribute('font-size').then(Number);
  const tokenTexts = object(page).locator('g.formula-object-token');
  const bSize = await sizeOf(token(page, 'b'));
  const twos = tokenTexts.filter({ has: page.locator('text', { hasText: /^2$/ }) });
  expect(await sizeOf(twos.first())).toBeLessThan(bSize);

  // Hover lights only that token, as its Thing; a part's sign lights with its parentheses.
  const lit = object(page).locator('g.formula-object-token rect:not([fill="transparent"])');
  await pointAt(page, token(page, 'x'));
  await expect(lit).toHaveCount(1);
  await shot(page, '3-hover-operand');
  await pointAt(page, token(page, '√'));
  await expect(lit).toHaveCount(3);
  await shot(page, '3b-hover-part');

  // The formula's panel switches exponents to ^, an operation like the others.
  await pointAt(page, token(page, '='), { click: true });
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.piemenu-button[title="Write Every Operation"]').click();
  await expect(token(page, '^')).toHaveCount(1);
  await expect(object(page).locator('g.formula-object-token text', { hasText: /^×$/ })).toHaveCount(3);
  // The panel sits over this part of the canvas; click away to put it down and reach the token.
  const away = await findBareSpot(page);
  await page.mouse.click(away.x, away.y);
  await expect(panel(page)).toHaveCount(0);
  // Nothing hidden answers that click: not the formula's own operations, which
  // run under the empty space around it in Things mode.
  await expect(page.locator('.unified-bottom-panel.mode-connections')).toHaveCount(0);
  expect(await storeEval(page, (st) => st.selectedEdgeIds?.size ?? 0)).toBe(0);
  await pointAt(page, token(page, '^'));
  await expect(lit).toHaveCount(1);
  await shot(page, '3a-caret');
  await pointAt(page, token(page, '='), { click: true });
  await panel(page).locator('.piemenu-button[title="Standard Notation"]').click();
  await expect(object(page).locator('g.formula-object-token text', { hasText: /^\^$/ })).toHaveCount(0);

  // As Things: the web of operations, its parts nested Thing-groups.
  const { id } = await formulaGroup(page, 'x = ');
  await storeEval(page, (st, gid) => st.updateGroup(st.activeGraphId, gid, (g) => { delete g.format; }), id);
  await expect(object(page)).toHaveCount(0);
  await page.mouse.move(5, 400);
  await shot(page, '3c-as-things');
  if (shots) {
    // The same, zoomed out to the whole formula.
    await page.keyboard.press('ControlOrMeta+-');
    await page.waitForTimeout(400);
    await shot(page, '3d-as-things-wide');
  }
});

test('F44 a tap selects the formula; its panel swaps it to Things and back', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  const { id, members } = await formulaGroup(page, 'a + b');

  await pointAt(page, token(page, '+'), { click: true });
  await expect(object(page)).toHaveClass(/is-selected/);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.format-panel-chip')).toContainText('+');
  await shot(page, '4-panel-formula');

  // Swap to Things.
  await panel(page).locator('.piemenu-button[title="Show as Things"]').first().click();
  await expect(object(page)).toHaveCount(0);
  expect((await formulaGroup(page, 'a + b')).format).toBe(null);
  await expect.poll(() => shownNodes(page, members)).toBeGreaterThan(0);
  await expect(panel(page)).toBeVisible();
  await shot(page, '5-panel-things');

  // And back.
  await panel(page).locator('.piemenu-button[title="Show as Formula"]').first().click();
  await expect(object(page)).toHaveCount(1);
  expect((await formulaGroup(page, 'a + b')).id).toBe(id);
  expect((await formulaGroup(page, 'a + b')).format).toBe('formula');
});

test('F44 a double tap on a token opens its Thing', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  const p = await centerOfLocator(token(page, 'b'));
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => storeEval(page, (st) => {
    const tab = st.rightPanelTabs.find(t => t.isActive);
    return tab?.nodeId ? st.nodePrototypes.get(tab.nodeId)?.name : null;
  })).toBe('b');
});

test('F44 hold and drag moves the formula, snapping to the grid, as one undo step', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  const { members } = await formulaGroup(page, 'a + b');
  const start = await positionsOf(page, members);

  // A press that moves before the lift does nothing.
  const p = await centerOfLocator(token(page, '+'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y, { steps: 4 });
  await page.mouse.up();
  expect(await positionsOf(page, members)).toEqual(start);

  // Hold, then drag: the Things move with it (grid off: by the drag exactly).
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 120);
  await expect(object(page)).toHaveClass(/is-lifted/);
  await page.mouse.move(p.x - 120, p.y - 80, { steps: 10 });
  await shot(page, '6-dragging');
  await page.mouse.up();
  const moved = await positionsOf(page, members);
  const dx = moved[0].x - start[0].x;
  const dy = moved[0].y - start[0].y;
  expect(dx).toBeLessThan(-20);
  expect(dy).toBeLessThan(-10);
  moved.forEach((m, i) => {
    expect(m.x - start[i].x).toBeCloseTo(dx, 3);
    expect(m.y - start[i].y).toBeCloseTo(dy, 3);
  });

  // One undo puts it back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => positionsOf(page, members)).toEqual(start);

  // With the grid on, the Things land on the grid: once there, a drag of less
  // than half a cell leaves every one of them where it is.
  await storeEval(page, (st) => st.setGridMode('always'));
  const nudge = async (ddx, ddy) => {
    const q = await centerOfLocator(token(page, '+'));
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.waitForTimeout(NODE_LIFT_DELAY_MS + 120);
    await page.mouse.move(q.x + ddx, q.y + ddy, { steps: 6 });
    await page.mouse.up();
    await expect(object(page)).not.toHaveClass(/is-lifted/);
  };
  await nudge(30, 20);
  const onGrid = await positionsOf(page, members);
  expect(onGrid).not.toEqual(start);
  await nudge(25, -20);
  expect(await positionsOf(page, members)).toEqual(onGrid);
});

test('F44 the offer shows a group in place, and its X waves it off', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  const { id } = await formulaGroup(page, 'a + b');
  await storeEval(page, (st, gid) => st.updateGroup(st.activeGraphId, gid, (g) => { delete g.format; }), id);
  await expect(object(page)).toHaveCount(0);

  // The group is offered back.
  const pill = page.locator('.format-offer');
  await expect(pill).toBeVisible();
  await expect.poll(() => pillText(page)).toContain('a+bc');
  await page.locator('.format-offer-main').click();
  await expect(object(page)).toHaveCount(1);
  await expect(pill).toHaveCount(0);

  await storeEval(page, (st, gid) => st.updateGroup(st.activeGraphId, gid, (g) => { delete g.format; }), id);
  await expect(pill).toBeVisible();
  await page.locator('.format-offer-dismiss').click();
  await expect(pill).toHaveCount(0);
});

test('F44 New Formula reads typing as math or as programming, and Enter adds it', async ({ page }) => {
  await openFixture(page, 'small');
  await page.mouse.click(BARE.x, BARE.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^New Formula$/ }).click();
  const input = page.locator('.formula-composer input');
  const preview = page.locator('.formula-composer-preview');
  const add = page.locator('.formula-composer-add');
  const option = (name) => page.locator('.format-slider-option', { hasText: name });
  const previewText = () => preview.innerText().then(t => t.replace(/\s+/g, ''));

  // Math by default: mc is m times c, written the standard way.
  await expect(option('Math')).toHaveAttribute('aria-checked', 'true');
  await input.fill('e = mc^2');
  await expect.poll(previewText).toBe('e=mc2');
  await shot(page, '7-compose-math');

  // Programming: whole-word names, and side by side is a mistake there.
  await option('Code').click();
  await expect(option('Code')).toHaveAttribute('aria-checked', 'true');
  await expect(input).toBeFocused();
  await input.fill('e = m c');
  await expect(preview).toContainText('*');
  await expect(add).toBeDisabled();
  await input.fill('energy = mass * c**2');
  await expect.poll(previewText).toBe('energy=mass×c2');
  await shot(page, '8-compose-programming');

  // Enter adds it.
  await input.press('Enter');
  await expect(page.locator('.formula-composer')).toHaveCount(0);
  await expect(object(page)).toHaveCount(1);
  expect((await formulaGroup(page, 'energy = ')).format).toBe('formula');

  // The choice is remembered for next time.
  const again = await findBareSpot(page);
  await page.mouse.click(again.x, again.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^New Formula$/ }).click();
  await expect(option('Code')).toHaveAttribute('aria-checked', 'true');
});
