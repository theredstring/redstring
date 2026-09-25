// F16: the hurtle. Expanding a node that has a definition sends an orb from
// the node to the header tab, then opens the definition graph.
//
// The orb (<div data-hurtle-orb>, components/canvas/layers/HurtleOrb.jsx) runs
// its own ~400 ms flight since P1.06. Its size is proportional to the zoom at
// launch: orbSize = max(12, 30 * zoom), ballooning to 1.9x mid-flight.
import {
  test, expect,
  openFixture, storeEval, pieButton, clickCenter, openPieMenu, camera,
} from './helpers.js';

test('F16 expanding a node with a definition hurtles into its graph', async ({ page }) => {
  await openFixture(page, 'small');
  const defGraphId = await storeEval(page, (st) => {
    st.createAndAssignGraphDefinitionWithoutActivation('p-alpha');
    const ids = window.useGraphStore.getState().nodePrototypes.get('p-alpha').definitionGraphIds;
    return ids[ids.length - 1];
  });
  expect(defGraphId).toBeTruthy();
  const fromGraph = await storeEval(page, (st) => st.activeGraphId);

  await openPieMenu(page, 'i-alpha');
  const { zoom } = await camera(page);

  // Sample the orb every frame from before the click until it's gone.
  await page.evaluate(() => {
    window.__orbSamples = [];
    const tick = () => {
      const el = document.querySelector('[data-hurtle-orb]');
      if (el) window.__orbSamples.push(el.getBoundingClientRect().width);
      if (window.__orbSamples.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await clickCenter(page, pieButton(page, 'arrow-up-from-dot'));

  await expect.poll(() => storeEval(page, (st) => st.activeGraphId), { message: 'lands on the definition graph' }).toBe(defGraphId);
  await expect(page.locator('[data-hurtle-orb]')).toHaveCount(0);
  expect(fromGraph).not.toBe(defGraphId);

  const samples = await page.evaluate(() => window.__orbSamples);
  expect(samples.length, 'the orb was on screen for several frames').toBeGreaterThan(5);
  const peak = Math.max(...samples);
  const expectedPeak = 1.9 * Math.max(12, Math.round(30 * zoom));
  expect(peak, 'the orb balloons to ~1.9x a zoom-sized orb').toBeGreaterThan(expectedPeak * 0.8);
  expect(peak).toBeLessThanOrEqual(expectedPeak + 1);
});
