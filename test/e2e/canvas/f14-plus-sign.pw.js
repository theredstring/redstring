// F14: the plus sign. Clicking empty canvas shows it; clicking it opens the
// name prompt; submitting a name creates a node where the plus sign was.
import {
  test, expect, openFixture, expectBareCanvas, storeEval, clientToWorld, nodeBox, centerOf, clickCenter,
} from './helpers.js';

const findOmega = (page) => storeEval(page, (st) => {
  const proto = [...st.nodePrototypes.values()].find((p) => p.name === 'Omega');
  if (!proto) return null;
  const inst = [...st.graphs.get(st.activeGraphId).instances.values()].find((i) => i.prototypeId === proto.id);
  return inst ? { instanceId: inst.id, x: inst.x, y: inst.y } : null;
});

test('F14 click empty canvas, click the plus sign, name it: a new Thing is placed there', async ({ page }) => {
  await openFixture(page, 'small');
  const countsOf = () => storeEval(page, (st) => ({
    protos: st.nodePrototypes.size,
    instances: st.graphs.get(st.activeGraphId).instances.size,
  }));
  const before = await countsOf();

  const spot = { x: 1000, y: 620 };
  await expectBareCanvas(page, spot);
  const spotWorld = await clientToWorld(page, spot.x, spot.y);
  await page.mouse.click(spot.x, spot.y);

  const plus = page.locator('svg.canvas g[data-plus-sign="true"]');
  await expect(plus).toBeVisible();
  // Clicking the plus opens the name prompt.
  await clickCenter(page, plus);
  await expect(page.getByText('Name Your Thing')).toBeVisible();
  // The prompt is DOM outside the SVG, so locator actions are safe on it.
  const input = page.locator('input.unified-selector-control');
  await input.fill('Omega');
  await input.press('Enter');
  await expect(page.getByText('Name Your Thing')).toBeHidden();

  // The plus sign morphs into the node, which then lands in the store.
  await expect.poll(() => findOmega(page), { message: 'an "Omega" instance on the active graph', timeout: 10_000 }).not.toBeNull();
  const omega = await findOmega(page);
  expect(await countsOf()).toEqual({ protos: before.protos + 1, instances: before.instances + 1 });

  // Placed where the plus sign was: on screen, the node is centred on the
  // click point; in the store, the click point is inside the node (x/y is its
  // top-left corner).
  const c = centerOf(await nodeBox(page, omega.instanceId));
  expect(Math.hypot(c.x - spot.x, c.y - spot.y), 'node lands at the plus sign').toBeLessThan(40);
  expect(spotWorld.x).toBeGreaterThan(omega.x);
  expect(spotWorld.y).toBeGreaterThan(omega.y);
  await expect(plus).toHaveCount(0);
});
