// F44: formulas. "New Formula" on the web menu builds a typed formula as a web
// of operations: its operands as Things, each operation a connection defined by
// the operation's Thing, each part in parentheses a nested Thing-group named
// after its term (typed Square Root, Negation... when that is what it is), all
// in the equation's own Thing-group, shown in place as the formula: one object
// on the canvas where the Things are, titled like a Thing-group, which hides
// them and the connections among them. A connection from outside lands on its
// Thing's token. A click on a token whose Thing means more than its symbol (P
// for Pressure) switches it to that Thing, drawn by name, the rest sliding
// aside (hover only lights it); a bare symbol, or a standard operation, is
// plain text. A tap
// selects the formula and brings up the group panel's format mode, whose
// arrows swap it between Things and Formula and whose toggles write this
// formula by names or every operation; a double tap on a token opens its Thing; hold-and-drag moves it (snapping to the grid when
// that's on) as one undo step. The offer pill (Back to Civilization's spot)
// shows a group as its formula, and its X waves it off. The bank under New
// Formula builds well-known equations fully formed, each symbol its concept's
// Thing, listed in the Thing's Equations section and in its discipline's web.
//
// FORMULA_SHOTS=<dir> also saves screenshots of each step.
import {
  test, expect, openFixture, storeEval, activeGraphSnapshot, nextFrames, NODE_LIFT_DELAY_MS, findBareSpot, camera,
  nodeBox, centerOf,
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
const liftedTransform = () => currentPage.locator('svg.canvas g.formula-object').evaluate(el => el.style.transform || '');
let currentPage = null;
test.beforeEach(({ page }) => { currentPage = page; });
const expanded = (page) => object(page).locator('g.formula-object-token.is-expanded');
// The group panel comes up over the lower canvas when the formula is selected: put it down.
const putPanelDown = async (page) => {
  const away = await findBareSpot(page);
  await page.mouse.click(away.x, away.y);
  await expect(panel(page)).toHaveCount(0);
};
const pillText = (page) => page.locator('.format-offer').innerText().then(t => t.replace(/\s+/g, ''));
const shownNodes = (page, ids) => page.evaluate((list) =>
  list.filter(id => document.querySelector(`svg.canvas g.node[data-instance-id="${id}"]`)).length, ids);
const formulaGroup = (page, prefix) => storeEval(page, (st, p) => {
  const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.name.startsWith(p));
  return g ? { id: g.id, format: g.format ?? null, linkedFormat: g.linkedFormat ?? null, members: [...g.memberInstanceIds] } : null;
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
  // equation's own Thing-group, named after it while it has no title.
  const after = await activeGraphSnapshot(page);
  const newIds = Object.keys(after.instances).filter(id => !before.instances[id]);
  expect(newIds).toHaveLength(14);
  const top = await formulaGroup(page, 'x = ');
  const memberIds = top.members;
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
  // The division stacked as a fraction: −b + √(…) over 2a.
  const rows = await object(page).evaluate((el) => {
    const ys = (t) => [...el.querySelectorAll('g.formula-object-token text')].filter(n => n.textContent === t).map(n => n.getBBox().y);
    return { four: ys('4')[0], two: ys('2').at(-1), divide: ys('÷').length };
  });
  expect(rows.four).toBeLessThan(rows.two);
  expect(rows.divide).toBe(0);

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

  // Typed, its letters mean nothing yet and its operations are the standard
  // ones: all of it is text, and a click switches nothing.
  await expect(object(page).locator('g.formula-object-token.is-defined')).toHaveCount(0);
  await pointAt(page, token(page, '='), { click: true });
  await page.waitForTimeout(500);
  await expect(expanded(page)).toHaveCount(0);
  await putPanelDown(page);

  // The formula's panel switches exponents to ^, an operation like the others.
  // (A bare symbol selects the formula without switching anything.)
  await pointAt(page, token(page, 'x'), { click: true });
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.piemenu-button[title="Write Every Operation"]').click();
  await expect(token(page, '^')).toHaveCount(1);
  await expect(object(page).locator('g.formula-object-token text', { hasText: /^×$/ })).toHaveCount(3);
  // The panel sits over this part of the canvas; click away to put it down and reach the token
  // (once the formula has slid out to its new width, so the spot stays bare).
  await page.waitForTimeout(400);
  const away = await findBareSpot(page);
  await page.mouse.click(away.x, away.y);
  await expect(panel(page)).toHaveCount(0);
  // Nothing hidden answers that click: not the formula's own operations, which
  // run under the empty space around it in Things mode.
  await expect(page.locator('.unified-bottom-panel.mode-connections')).toHaveCount(0);
  expect(await storeEval(page, (st) => st.selectedEdgeIds?.size ?? 0)).toBe(0);
  await shot(page, '3a-caret');
  await pointAt(page, token(page, 'x'), { click: true });
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
  await expect(panel(page).locator('.format-panel-formula')).toContainText('+');
  await shot(page, '4-panel-formula');

  // Swap to Things.
  await panel(page).locator('.piemenu-button[title="Show as Things"]').first().click();
  await expect(object(page)).toHaveCount(0);
  expect((await formulaGroup(page, 'a + b')).format).toBe(null);
  expect((await formulaGroup(page, 'a + b')).linkedFormat).toBe('formula');
  await expect.poll(() => shownNodes(page, members)).toBeGreaterThan(0);
  // As Things, the equation is the Thing-group it is: that panel, with ◀ ▶ to swap back.
  const thingGroupPanel = page.locator('.unified-bottom-panel.mode-nodegroup');
  await expect(thingGroupPanel).toBeVisible();
  for (const title of ['Open Definition', 'Open in Panel', 'Combine Into Thing', 'Edit Name', 'Change Color', 'Ungroup']) {
    await expect(thingGroupPanel.locator(`.piemenu-button[title="${title}"]`)).toHaveCount(1);
  }
  await shot(page, '5-panel-things');

  // And back.
  await thingGroupPanel.locator('.piemenu-button[title="Show as Formula"]').first().click();
  await expect(panel(page)).toBeVisible();
  await expect(object(page)).toHaveCount(1);
  expect((await formulaGroup(page, 'a + b')).id).toBe(id);
  expect((await formulaGroup(page, 'a + b')).format).toBe('formula');
  expect((await formulaGroup(page, 'a + b')).linkedFormat).toBe(null);

  // Shown as Things and let go, it is still that equation: nothing offers to make it one.
  await panel(page).locator('.piemenu-button[title="Show as Things"]').first().click();
  await expect(object(page)).toHaveCount(0);
  const away = await findBareSpot(page);
  await page.mouse.click(away.x, away.y);
  await expect(page.locator('.unified-bottom-panel')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator('.format-offer')).toHaveCount(0);
});

test('F44 a double tap on a token opens its Thing', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'a + b * c');
  const p = await centerOfLocator(token(page, 'b'));
  await page.mouse.dblclick(p.x, p.y);
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
  // Lifted by the canvas's own group drag, which moves it as it moves a Thing.
  await page.mouse.move(p.x - 120, p.y - 80, { steps: 10 });
  await expect.poll(liftedTransform).toContain('translate');
  // Lifted as a Thing-group is, over the group's own shadow.
  await expect(object(page).locator('[data-group-shadow="box"]')).toHaveCount(1);
  await shot(page, '6-dragging');
  await page.mouse.up();
  await expect(object(page).locator('[data-group-shadow]')).toHaveCount(0);
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
    await expect.poll(liftedTransform).toBe('');
  };
  await nudge(30, 20);
  const onGrid = await positionsOf(page, members);
  expect(onGrid).not.toEqual(start);
  await nudge(25, -20);
  expect(await positionsOf(page, members)).toEqual(onGrid);

  // Held still at the canvas's edge, the view pans and the formula keeps going with it.
  await storeEval(page, (st) => st.setGridMode('off'));
  const before = await positionsOf(page, members);
  const q = await centerOfLocator(token(page, '+'));
  const area = await page.locator('.canvas-area').boundingBox();
  const carried = () => object(page).evaluate(el => Number(/translate\(([-\d.]+)px/.exec(el.style.transform)?.[1] ?? 0));
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 120);
  await page.mouse.move(area.x + area.width - 6, q.y, { steps: 12 });
  await page.waitForTimeout(250);
  const early = await carried();
  await page.waitForTimeout(600);
  const late = await carried();
  await page.mouse.up();
  expect(late).toBeGreaterThan(early + 20);
  const after = await positionsOf(page, members);
  expect(after[0].x).toBeGreaterThan(before[0].x + late * 0.9);
});

test('F44 a logarithm is an operation: its base a Thing of its own, lowered after log', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'y = log_2(x) + ln(x)');
  const { members } = await formulaGroup(page, 'y = ');
  // log_2(x) is 2 —Logarithm→ x, as 2^x is 2 —Exponentiation→ x; ln(x) is a
  // part typed Natural Logarithm, as √ is a part typed Square Root.
  const built = await storeEval(page, (st, ids) => {
    const g = st.graphs.get(st.activeGraphId);
    const ops = g.edgeIds.map(id => st.edges.get(id)).filter(e => ids.includes(e.sourceId))
      .map(e => st.nodePrototypes.get(e.definitionNodeIds?.[0])?.name).sort();
    const types = [...g.groups.values()].map(gr => st.nodePrototypes.get(st.nodePrototypes.get(gr.linkedNodePrototypeId)?.typeNodeId)?.name).filter(Boolean);
    return { ops, types };
  }, members);
  expect(built.ops).toEqual(['Addition', 'Equality', 'Logarithm']);
  expect(built.types).toEqual(['Natural Logarithm']);
  await expect(object(page)).toHaveCount(1);
  // The base drawn smaller than its "log", and neither switches to a name.
  const sizes = await object(page).evaluate((el) => {
    const size = (t) => Number([...el.querySelectorAll('g.formula-object-token text')].find(n => n.textContent === t)?.getAttribute('font-size'));
    return { log: size('log'), base: size('2'), ln: size('ln') };
  });
  expect(sizes.base).toBeLessThan(sizes.log);
  expect(sizes.ln).toBe(sizes.log);
  await expect(object(page).locator('g.formula-object-token.is-defined', { hasText: /^(log|ln)$/ })).toHaveCount(0);
  await shot(page, '10-logarithms');
});

test('F44 a function is a Thing that says what it is, and a Thing of the same name keeps its own words', async ({ page }) => {
  await openFixture(page, 'small');
  // A cos the universe already has, described its own way.
  await storeEval(page, (st) => st.addNodePrototype({
    id: 'own-cos', name: 'cos', color: '#8B0000', description: 'My own cos.', typeNodeId: null, definitionGraphIds: [],
  }));
  await buildFormula(page, 'y = sin(x) + cos(x)');
  const said = await storeEval(page, (st) => Object.fromEntries(
    [...st.nodePrototypes.values()].filter(p => p.name === 'sin' || p.name === 'cos').map(p => [p.name, p.description]),
  ));
  expect(said.sin).toMatch(/^Sine: /);
  expect(said.cos).toBe('My own cos.');
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

const openComposer = async (page, at = BARE) => {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.locator('.context-menu-item', { hasText: /^New Formula$/ }).click();
  await expect(page.locator('.formula-composer input')).toBeFocused();
};
const protosNamed = (page, name) => storeEval(page, (st, n) => [...st.nodePrototypes.values()].filter(p => p.name === n).length, name);

test('F44 the bank builds an equation fully formed, each symbol its concept', async ({ page }) => {
  await openFixture(page, 'small');
  await openComposer(page);
  await shot(page, '9-bank');
  // Disciplines from Wikidata, the largest open, each listing its best known first.
  await expect(page.locator('.format-bank-choice.is-on', { hasText: /^Physics$/ })).toHaveCount(1);
  await expect(page.locator('.format-bank-row', { hasText: "Ohm's Law" })).toHaveCount(1);
  // Typed words find an equation by title.
  await page.locator('.formula-composer input').fill('ideal gas law');
  await page.locator('.format-bank-row', { hasText: 'Ideal Gas Law' }).click();
  await expect(page.locator('.formula-composer')).toHaveCount(0);

  // Titled like a Thing-group, written by symbol, the way Wikidata writes it.
  await expect(object(page)).toHaveCount(1);
  await expect(object(page).locator('.formula-object-title')).toContainText('Ideal Gas Law');
  const texts = await object(page).locator('g.formula-object-token text').allTextContents();
  expect(texts.join(' ')).toBe('p V = n R T');
  // Its bio is the item's description, and it links to where it came from.
  expect(await storeEval(page, (st) => {
    const p = [...st.nodePrototypes.values()].find(x => x.name === 'Ideal Gas Law');
    return { description: p.description, links: p.externalLinks };
  })).toEqual({ description: 'Equation of state of a hypothetical ideal gas.', links: ['http://www.wikidata.org/entity/Q191785'] });

  // Each symbol is its concept's Thing, written by its symbol.
  const bound = await storeEval(page, (st) => {
    const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.format === 'formula');
    const inst = st.graphs.get(st.activeGraphId).instances;
    return g.memberInstanceIds.map(id => st.nodePrototypes.get(inst.get(id).prototypeId))
      .map(p => `${p.labels?.formula}:${p.name}`).sort();
  });
  expect(bound).toEqual(['R:Molar Gas Constant', 'T:Thermodynamic Temperature', 'V:Volume', 'n:Amount of Substance', 'p:Pressure']);

  // A click writes it by its real name, the rest sliding aside; again, back.
  const vBefore = (await centerOfLocator(token(page, 'V'))).x;
  await pointAt(page, token(page, 'p'), { click: true });
  await expect(token(page, 'Pressure')).toHaveCount(1);
  await expect.poll(async () => (await centerOfLocator(token(page, 'V'))).x).toBeGreaterThan(vBefore + 40);
  // The equals sign is the standard one: nothing to switch.
  await expect(object(page).locator('g.formula-object-token.is-defined', { has: page.locator('text', { hasText: /^=$/ }) })).toHaveCount(0);
  await putPanelDown(page);
  await shot(page, '10-switched');
  await pointAt(page, token(page, 'Pressure'), { click: true });
  await expect(token(page, 'p')).toHaveCount(1);
  await putPanelDown(page);
  // A double tap opens it, and switches nothing.
  const p = await centerOfLocator(token(page, 'p'));
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(() => storeEval(page, (st) => {
    const tab = st.rightPanelTabs.find(t => t.isActive);
    return tab?.nodeId ? st.nodePrototypes.get(tab.nodeId)?.name : null;
  })).toBe('Pressure');
  await page.waitForTimeout(500);
  await expect(expanded(page)).toHaveCount(0);
  // The panel lists the equations it is in.
  const row = page.locator('.equations-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('in Ideal Gas Law');
  await expect(page.locator('.equations-written-as input')).toHaveValue('p');
  await page.locator('.equations-section').scrollIntoViewIfNeeded();
  await shot(page, '11-equations-section');

  // Its section gathers it, and the discipline its section.
  const webOf = (name) => storeEval(page, (st, n) => {
    const d = [...st.nodePrototypes.values()].find(x => x.name === n);
    const web = d && st.graphs.get(d.definitionGraphIds[0]);
    return web ? [...web.instances.values()].map(i => st.nodePrototypes.get(i.prototypeId).name) : null;
  }, name);
  expect(await webOf('Physics')).toEqual(['Thermodynamics']);
  expect(await webOf('Thermodynamics')).toEqual(['Ideal Gas Law']);
  expect(await storeEval(page, (st) => [...st.nodePrototypes.values()].find(x => x.name === 'Thermodynamics').externalLinks))
    .toEqual(['http://www.wikidata.org/entity/Q11473']);

  // A second equation from the bank finds the same Pressure; a Thing of the
  // user's that is merely called Pressure is never taken over.
  await storeEval(page, (st) => st.addNodePrototype({ id: 'mine-pressure', name: 'Pressure', color: '#336699', definitionGraphIds: [] }));
  const spot = await findBareSpot(page);
  await openComposer(page, spot);
  await page.locator('.formula-composer input').fill('definition of enthalpy');
  await page.locator('.format-bank-row', { hasText: 'Definition of Enthalpy' }).click();
  await expect(object(page)).toHaveCount(2);
  expect(await protosNamed(page, 'Pressure')).toBe(2);
  await expect(page.locator('.equations-row')).toHaveCount(2);

  // The same equation again is the same Thing with the same definition, not a second copy of it.
  const definitions = () => storeEval(page, (st) => [...st.nodePrototypes.values()]
    .filter(x => x.name === 'Ideal Gas Law').map(x => x.definitionGraphIds.length));
  expect(await definitions()).toEqual([1]);
  await page.evaluate(async () => {
    const { buildBankEquation } = await import('/src/components/canvas/formats/formula/buildFormula.js');
    const { loadFormulaBank } = await import('/src/components/canvas/formats/formula/bank/formulaBank.js');
    const d = (await loadFormulaBank()).disciplines.find(x => x.id === 'physics');
    const st = window.useGraphStore.getState();
    buildBankEquation(d, d.equations.find(e => e.id === 'Q191785'), st.activeGraphId, { x: -2000, y: -2000 });
  });
  await expect(object(page)).toHaveCount(3);
  expect(await definitions()).toEqual([1]);
  expect(await storeEval(page, (st) => [...st.graphs.get(st.activeGraphId).groups.values()]
    .filter(g => g.format === 'formula' && st.nodePrototypes.get(g.linkedNodePrototypeId)?.name === 'Ideal Gas Law')
    .map(g => g.linkedDefinitionIndex))).toEqual([0, 0]);
});

test('F44 the bank\'s choices stay in its header; its sections group the list, which the wheel scrolls', async ({ page }) => {
  await openFixture(page, 'small');
  await openComposer(page);
  const top = page.locator('.format-bank-top');
  const body = page.locator('.format-bank-body');
  // Physics, grouped by section, each section's name over its best known.
  await expect(page.locator('.format-bank-group-head', { hasText: 'Thermodynamics' })).toHaveCount(1);
  await shot(page, '9a-bank-discipline');
  // The wheel scrolls the list, not the canvas; the header stays where it is.
  const before = await camera(page);
  const topBox = await top.boundingBox();
  const at = await body.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await page.waitForTimeout(300);
  expect(await camera(page)).toEqual(before);
  expect((await top.boundingBox()).y).toBe(topBox.y);
  // A section's name opens it: its equations, then what it knows of and doesn't write yet.
  await top.locator('.format-bank-choice', { hasText: /^Thermodynamics$/ }).click();
  await expect(top.locator('.format-bank-choice.is-on', { hasText: /^Thermodynamics$/ })).toHaveCount(1);
  await expect(body.locator('.format-bank-row', { hasText: 'Ideal Gas Law' })).toBeVisible();
  await expect(body.locator('.format-bank-row', { hasText: "Ohm's Law" })).toHaveCount(0);
  await expect(body.locator('.format-bank-known-row').first()).toBeVisible();
  await shot(page, '9b-bank-section');
  // A discipline with nothing written yet still says what its sections know of.
  await top.locator('.format-bank-choice', { hasText: /^Economics$/ }).click();
  await expect(body).toContainText('No equations written here yet.');
  // A section with nothing written yet says what it knows of.
  await top.locator('.format-bank-choice', { hasText: /^Biology$/ }).click();
  await top.locator('.format-bank-choice', { hasText: /^Population Genetics$/ }).click();
  await expect(body.locator('.format-bank-known-row', { hasText: 'Hardy–Weinberg Principle' })).toContainText('Wikidata has no formula for it');
  await shot(page, '9c-bank-known');
});

test('F44 MathModDB fills in a discipline: its model under each equation, its quantities Things of their own', async ({ page }) => {
  await openFixture(page, 'small');
  await openComposer(page);
  const top = page.locator('.format-bank-top');
  const body = page.locator('.format-bank-body');
  await top.locator('.format-bank-choice', { hasText: /^Epidemiology$/ }).click();
  const row = body.locator('.format-bank-row', { hasText: 'Rate of Change of Removed in the SIR Model' });
  await expect(row).toContainText('Susceptible Infectious Removed Model');
  await shot(page, '9d-bank-mathmoddb');
  await row.click();
  await expect(object(page)).toHaveCount(1);
  expect((await object(page).locator('g.formula-object-token text').allTextContents()).join(' ')).toBe('d R d t = γ I');
  const things = await storeEval(page, (st) => {
    const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.format === 'formula');
    const inst = st.graphs.get(st.activeGraphId).instances;
    return g.memberInstanceIds.map(id => st.nodePrototypes.get(inst.get(id).prototypeId))
      .filter(p => p.labels?.formula)
      .map(p => `${p.labels.formula}:${p.name}:${p.externalLinks?.[0] || ''}`).sort();
  });
  // Time is Wikidata's; the rest are MathModDB's own, linked there.
  expect(things).toEqual([
    'I:Number of Infectious Individuals:https://portal.mardi4nfdi.de/entity/Q6673881',
    'R:Number of Removed Individuals:https://portal.mardi4nfdi.de/entity/Q6673895',
    't:Time:http://www.wikidata.org/entity/Q11471',
    'γ:Relative Removal Rate:https://portal.mardi4nfdi.de/entity/Q6673878',
  ]);
  // Its bio says what model it is part of.
  expect(await storeEval(page, (st) => [...st.nodePrototypes.values()]
    .find(p => p.name === 'Rate of Change of Removed in the SIR Model')?.description))
    .toBe('Rate of change of removed individuals in the continuous-time SIR model. Part of the Susceptible Infectious Removed Model.');
});

test('F44 a formula takes connections like a node group, and its hidden Things take none', async ({ page }) => {
  await openFixture(page, 'small');
  // The Ideal Gas Law, built from the bank below Epsilon.
  await page.evaluate(async () => {
    const { buildBankEquation } = await import('/src/components/canvas/formats/formula/buildFormula.js');
    const { loadFormulaBank } = await import('/src/components/canvas/formats/formula/bank/formulaBank.js');
    const d = (await loadFormulaBank()).disciplines.find(x => x.id === 'physics');
    const st = window.useGraphStore.getState();
    const near = st.graphs.get(st.activeGraphId).instances.get('i-epsilon');
    buildBankEquation(d, d.equations.find(e => e.id === 'Q191785'), st.activeGraphId, { x: near.x + 380, y: near.y + 520 });
  });
  await expect(object(page)).toHaveCount(1);
  await page.waitForTimeout(800); // past the entrance
  const formula = await storeEval(page, (st) => {
    const g = [...st.graphs.get(st.activeGraphId).groups.values()].find(x => x.format === 'formula');
    return { anchorId: g.anchorInstanceId, members: [...g.memberInstanceIds] };
  });
  const edgesNow = () => storeEval(page, (st) => [...st.edges.values()].map(e => `${e.sourceId}>${e.destinationId}`));
  const before = new Set(await edgesNow());
  const drawFrom = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
    await page.mouse.up();
  };

  // Onto it, anywhere on it: the connection is to the equation's Thing, and stops at its band.
  const box = await object(page).boundingBox();
  const onFormula = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
  await drawFrom(centerOf(await nodeBox(page, 'i-gamma')), onFormula);
  await expect.poll(edgesNow).toContain(`i-gamma>${formula.anchorId}`);
  await shot(page, '16-connected-to-formula');
  const edgeId = await storeEval(page, (st, a) => [...st.edges.values()].find(e => e.sourceId === 'i-gamma' && e.destinationId === a).id, formula.anchorId);
  const line = await page.locator(`svg.canvas [data-edge-id="${edgeId}"]`).first().boundingBox();
  // Its end is at the formula, not where the group's title would have been.
  const end = await object(page).boundingBox();
  expect(line.x + line.width).toBeGreaterThan(end.x - 30);
  expect(line.y + line.height).toBeGreaterThan(end.y - 30);

  // From it: a quick drag off the formula draws a connection from the equation's Thing.
  await drawFrom({ x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 }, centerOf(await nodeBox(page, 'i-alpha')));
  await expect.poll(edgesNow).toContain(`${formula.anchorId}>i-alpha`);
  // Those two and nothing else: never from or to one of its hidden Things.
  expect((await edgesNow()).filter(e => !before.has(e)).sort())
    .toEqual([`${formula.anchorId}>i-alpha`, `i-gamma>${formula.anchorId}`].sort());

  // Its Things can't be selected where they used to be: not by a selection, the keyboard or by type.
  expect(await page.evaluate(async (ids) => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().setSelectedInstanceIds(new Set(ids));
    return ui.getState().selectedInstanceIds.size;
  }, formula.members)).toBe(0);

  // A Thing dropped on it isn't offered as one of its Things.
  expect(await page.evaluate(async () => {
    const { findGroupDropTarget } = await import('/src/components/canvas/groups/groupDropTarget.js');
    const st = window.useGraphStore.getState();
    const g = st.graphs.get(st.activeGraphId);
    const nodes = [...g.instances.values()];
    const f = [...g.groups.values()].find(x => x.format === 'formula');
    const m = g.instances.get(f.memberInstanceIds[0]);
    return findGroupDropTarget({ point: { x: m.x + 10, y: m.y + 10 }, groups: [...g.groups.values()], nodes, groupDepths: new Map(), gridSize: 200 })?.id === f.id;
  })).toBe(false);
});

test('F44 connections on a formula follow it while it is dragged, to another formula too', async ({ page }) => {
  await openFixture(page, 'small');
  await page.evaluate(async () => {
    const { buildBankEquation } = await import('/src/components/canvas/formats/formula/buildFormula.js');
    const { loadFormulaBank } = await import('/src/components/canvas/formats/formula/bank/formulaBank.js');
    const d = (await loadFormulaBank()).disciplines.find(x => x.id === 'physics');
    const st = window.useGraphStore.getState();
    const near = st.graphs.get(st.activeGraphId).instances.get('i-epsilon');
    buildBankEquation(d, d.equations.find(e => e.id === 'Q191785'), st.activeGraphId, { x: near.x + 380, y: near.y + 520 });
    buildBankEquation(d, d.equations.find(e => e.id === 'Q41591'), st.activeGraphId, { x: near.x + 1400, y: near.y + 520 });
    const s2 = window.useGraphStore.getState();
    const [a, b] = [...s2.graphs.get(s2.activeGraphId).groups.values()].filter(g => g.format === 'formula');
    s2.addEdge(s2.activeGraphId, { id: 'e-ff', sourceId: a.anchorInstanceId, destinationId: b.anchorInstanceId });
    s2.addEdge(s2.activeGraphId, { id: 'e-fn', sourceId: a.anchorInstanceId, destinationId: 'i-gamma' });
  });
  await expect(object(page)).toHaveCount(2);
  await page.waitForTimeout(800); // past the entrances
  const d = (id) => page.locator(`svg.canvas [data-edge-id="${id}"] path`).first().getAttribute('d');
  const before = [await d('e-ff'), await d('e-fn')];
  const box = await object(page).filter({ hasText: 'Ideal Gas Law' }).boundingBox();
  const at = { x: box.x + box.width / 2, y: box.y + 20 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(NODE_LIFT_DELAY_MS + 150);
  for (let i = 1; i <= 10; i++) await page.mouse.move(at.x, at.y + i * 12);
  await page.waitForTimeout(100);
  // Mid-drag, both have moved with it: to the other formula, and to a Thing.
  expect([await d('e-ff'), await d('e-fn')].map((x, i) => x !== before[i])).toEqual([true, true]);
  await shot(page, '17-dragging-connected');
  await page.mouse.up();
});

test('F44 the panel deletes a formula, its Things and its parts, playing its entrance backwards, as one undo step', async ({ page }) => {
  await openFixture(page, 'small');
  await buildFormula(page, 'x = (a + b) * c');
  const { id, members } = await formulaGroup(page, 'x = (a + b)');
  const before = await activeGraphSnapshot(page);
  const anchorId = await storeEval(page, (st, gid) => st.graphs.get(st.activeGraphId).groups.get(gid).anchorInstanceId, id);
  await storeEval(page, (st, a) => st.addEdge(st.activeGraphId, { id: 'e-out', sourceId: a, destinationId: 'i-gamma' }), anchorId);
  await page.waitForTimeout(800); // past the entrance

  await pointAt(page, token(page, '='), { click: true });
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.piemenu-button[title="Delete"]').click();
  // Its exit plays where it was, and takes no input meanwhile.
  await expect(page.locator('svg.canvas g.formula-object.is-leaving')).toHaveCount(1);
  await page.waitForTimeout(150);
  await shot(page, '18-deleting');
  await expect(page.locator('svg.canvas g.formula-object')).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  // Gone: the group, its part, its Things and anchors, and the connection to Gamma; Gamma stays.
  const after = await storeEval(page, (st, gid) => {
    const g = st.graphs.get(st.activeGraphId);
    return { group: g.groups.has(gid), groups: [...g.groups.keys()].sort(), instances: [...g.instances.keys()], edge: st.edges.has('e-out') };
  }, id);
  expect(after.group).toBe(false);
  expect(after.edge).toBe(false);
  expect(after.instances.filter(i => members.includes(i) || i === anchorId)).toEqual([]);
  expect(after.instances).toContain('i-gamma');
  // Every other group stays; its part, (a + b), went with it.
  const others = Object.keys(before.groups).filter(gid => gid !== id
    && !before.groups[gid].memberInstanceIds.every(m => members.includes(m))).sort();
  expect(Object.keys(before.groups).length - others.length).toBe(2);
  expect(after.groups).toEqual(others);
  // One undo brings all of it back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(object(page)).toHaveCount(1);
  expect(await storeEval(page, (st, gid) => st.graphs.get(st.activeGraphId).groups.get(gid)?.format, id)).toBe('formula');
  expect(await storeEval(page, () => window.useGraphStore.getState().edges.has('e-out'))).toBe(true);
});

test('F44 a bank this device kept in an older shape gives way to the one shipped', async ({ page }) => {
  await openFixture(page, 'small');
  // What an update before sections existed left on the device: four disciplines, no sections.
  await page.evaluate(async () => {
    const { writeDeviceBank } = await import('/src/components/canvas/formats/formula/bank/population/deviceBank.js');
    const old = ['Physics', 'Mathematics', 'Computing', 'Chemistry'].map(name => ({ id: name.toLowerCase(), name, equations: [] }));
    await writeDeviceBank({ bank: { source: 'old', fetchedAt: '2026-10-19T00:00:00Z', disciplines: old, concepts: {} }, report: {}, known: {}, classes: {} });
  });
  await openFixture(page, 'small');
  await openComposer(page);
  await expect(page.locator('.format-bank-top .format-bank-choice', { hasText: /^Biology$/ })).toHaveCount(1);
  await expect(page.locator('.format-bank-group-head', { hasText: 'Thermodynamics' })).toHaveCount(1);
  // Cleared, so nothing on the device stands over the shipped bank again.
  expect(await page.evaluate(async () => {
    const { readDeviceBank } = await import('/src/components/canvas/formats/formula/bank/population/deviceBank.js');
    return readDeviceBank('bank');
  })).toBe(null);
});

test('F44 the bank writes calculus as the textbook does, and a concept two ways where an equation does', async ({ page }) => {
  await openFixture(page, 'small');
  const build = (id, at) => page.evaluate(async ({ q, dx, dy }) => {
    const { buildBankEquation } = await import('/src/components/canvas/formats/formula/buildFormula.js');
    const { loadFormulaBank } = await import('/src/components/canvas/formats/formula/bank/formulaBank.js');
    const d = (await loadFormulaBank()).disciplines.find(x => x.id === 'physics');
    const st = window.useGraphStore.getState();
    const near = [...st.graphs.get(st.activeGraphId).instances.values()]
      .find(i => st.nodePrototypes.get(i.prototypeId)?.name === 'Epsilon');
    buildBankEquation(d, d.equations.find(e => e.id === q), st.activeGraphId, { x: near.x + dx, y: near.y + dy });
  }, { q: id, ...at });
  // P = dE/dt: a fraction whose bar is the derivative.
  await build('Q25342', { dx: 380, dy: 300 });
  await expect(object(page)).toHaveCount(1);
  expect((await object(page).locator('g.formula-object-token text').allTextContents()).join(' ')).toBe('P = d E d t');
  expect((await centerOfLocator(token(page, 'E'))).y).toBeLessThan((await centerOfLocator(token(page, 't'))).y - 20);
  expect(await storeEval(page, (st) => [...st.nodePrototypes.values()].some(p => p.name === 'Derivative'
    && /How fast the first changes/.test(p.description)))).toBe(true);
  await shot(page, '14-derivative');
  // Coulomb's law: q₁ and q₂ are both Electric Charge, which the bank writes Q.
  await build('Q11773690', { dx: 380, dy: 900 });
  await expect(object(page)).toHaveCount(2);
  const charges = await storeEval(page, (st) => {
    const g = [...st.graphs.get(st.activeGraphId).groups.values()]
      .find(x => x.format === 'formula' && st.nodePrototypes.get(x.linkedNodePrototypeId)?.name === 'Definition of Coulomb Force');
    const inst = st.graphs.get(st.activeGraphId).instances;
    return g.memberInstanceIds.map(id => inst.get(id))
      .filter(i => st.nodePrototypes.get(i.prototypeId)?.name === 'Electric Charge')
      .map(i => `${i.labels?.formula}/${st.nodePrototypes.get(i.prototypeId).labels?.formula}`).sort();
  });
  expect(charges).toEqual(['q_1/Q', 'q_2/Q']);
  await expect(protosNamed(page, 'Electric Charge')).resolves.toBe(1);
  await shot(page, '15-two-ways');
});

test('F44 the formula panel writes it with names instead of symbols', async ({ page }) => {
  await openFixture(page, 'small');
  await openComposer(page);
  await page.locator('.formula-composer input').fill('ohm');
  await page.locator('.format-bank-row', { hasText: "Ohm's Law" }).click();
  await pointAt(page, token(page, '='), { click: true });
  await expect(panel(page)).toBeVisible();
  await panel(page).locator('.piemenu-button[title="Show Names"]').click();
  const line = () => object(page).locator('g.formula-object-token text').allTextContents().then(t => t.join(' '));
  // I = V/R, a fraction: its bar has no text.
  await expect.poll(line).toBe('Electric Current = Voltage Electrical Resistance');
  // Only this formula: its names are its own.
  await shot(page, '12-names');
  await panel(page).locator('.piemenu-button[title="Show Symbols"]').click();
  await expect.poll(line).toBe('I = V R');
});

test.describe('by touch', () => {
  test.use({ hasTouch: true });

  test('F44 a tap switches a token to its Thing, and another tap switches it back', async ({ page }) => {
    await openFixture(page, 'small');
    // Built the way the bank builds it (a touch device opens the web menu by a long press instead).
    await page.evaluate(async (at) => {
      const { buildBankEquation } = await import('/src/components/canvas/formats/formula/buildFormula.js');
      const { loadFormulaBank } = await import('/src/components/canvas/formats/formula/bank/formulaBank.js');
      const d = (await loadFormulaBank()).disciplines.find(x => x.id === 'physics');
      const st = window.useGraphStore.getState();
      // In the empty space below and right of Epsilon, on screen.
      const near = [...st.graphs.get(st.activeGraphId).instances.values()]
        .find(i => st.nodePrototypes.get(i.prototypeId)?.name === 'Epsilon');
      buildBankEquation(d, d.equations.find(e => e.id === 'Q41591'), st.activeGraphId, { x: near.x + at.dx, y: near.y + at.dy });
    }, { dx: 380, dy: 300 });
    await expect(object(page)).toHaveCount(1);
    const p = await centerOfLocator(token(page, 'V'));
    await page.touchscreen.tap(p.x, p.y);
    await expect(token(page, 'Voltage')).toHaveCount(1);
    await shot(page, '13-touch-switched');
    const q = await centerOfLocator(token(page, 'Voltage'));
    await page.touchscreen.tap(q.x, q.y);
    await expect(token(page, 'V')).toHaveCount(1);
    await expect(expanded(page)).toHaveCount(0);
  });
});

test('F44 Data settings show where the formula bank came from, and what it left out and why', async ({ page }) => {
  await openFixture(page, 'small');
  await page.evaluate(() => window.dispatchEvent(new Event('openSettingsModal')));
  await expect(page.locator('.canvas-modal')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('openSettingsModal', { detail: { section: 'data' } })));
  const source = page.locator('.settings-row', { hasText: 'Update from Wikidata and MathModDB' });
  await expect(source).toContainText(/^Update from Wikidata and MathModDB[\s\S]*\d+ from Wikidata and MathModDB, with the app/);
  await page.locator('.settings-row', { hasText: 'Left Out' }).getByRole('button', { name: 'Show' }).click();
  const reason = page.getByRole('button', { name: /^Formula not writable yet/ });
  await expect(reason).toBeVisible();
  await reason.click();
  // Each item left out says why, and opens where it came from.
  await expect(page.locator('.formula-bank-left-out', { hasText: /^sample variance/ })).toContainText("can't write accents");
  // No device bank yet: nothing to go back from.
  await expect(page.locator('.settings-row', { hasText: 'Use the Built-In Bank' })).toHaveCount(0);
});
