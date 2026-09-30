// F41: a Thing morphs into its box when it opens in place, and folds back into
// its node when the box is combined (groups/boxMorph.js). The store changes at
// once; a stand-in carries the eye while the real box waits hidden, then hands
// over and leaves nothing behind.
//
// The page clock is slowed while a morph runs, so the middle of it can be
// checked without racing a 380 ms animation.
import {
  test, expect, storeEval, openFixture, pieButton, openPieMenu, waitForCameraSettled, nextFrames,
} from './helpers.js';

const WEB = 'g-small-a';
const CLUSTER = '00000000-0000-4000-8100-000000000005';
const OLD_COPY_GROUP = '00000000-0000-4000-8100-000000000006';
const ZETA = '00000000-0000-4000-8100-000000000009';

async function slowableClock(page) {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let slow = 1, base = 0, virtual = 0;
    window.__setClockSlowdown = (k) => { virtual = performance.now(); base = realNow(); slow = k; };
    performance.now = () => virtual + (realNow() - base) / slow;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
  });
}

const morphState = (page) => page.evaluate((zeta) => {
  const standIn = document.querySelector('[data-box-morphs]')?.firstElementChild;
  const zetaNode = document.querySelector(`svg.canvas g.node[data-instance-id="${zeta}"]`);
  return {
    standIn: !!standIn,
    // The stand-in's content group: the copy it carries (the preview's drawing, or the box's inside).
    carries: (standIn?.querySelector('[data-morph-part="content"]')?.childElementCount ?? 0) > 0,
    hideRules: document.querySelectorAll('style[data-box-morph]').length,
    zeta: zetaNode ? getComputedStyle(zetaNode).visibility : 'absent',
  };
}, ZETA);

const settled = { standIn: false, carries: false, hideRules: 0 };

async function openClusterPreview(page) {
  await openFixture(page, 'small');
  // The fixture's Cluster starts as an old copy-style box; close it first (as F39 does).
  await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  await waitForCameraSettled(page);
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click(); // Decompose: the preview
  await nextFrames(page, 30);
  await waitForCameraSettled(page);
}

test('F41 Decompose Further morphs the preview into the box, then hands over to it', async ({ page }) => {
  await slowableClock(page);
  await openClusterPreview(page);

  await page.evaluate(() => window.__setClockSlowdown(20));
  await pieButton(page, 'package-open').click(); // Decompose Further
  // The definition is open at once; the stand-in carries the preview's drawing while
  // the real box's nodes wait hidden.
  expect(await storeEval(page, (st, [w, c]) => !!st.graphs.get(w).instances.get(c).openDefinition, [WEB, CLUSTER])).toBe(true);
  await expect.poll(() => morphState(page)).toEqual({ standIn: true, carries: true, hideRules: 1, zeta: 'hidden' });

  await page.evaluate(() => window.__setClockSlowdown(1));
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'visible' });
});

test('F41 combining the box folds it back into its node', async ({ page }) => {
  await slowableClock(page);
  await openClusterPreview(page);
  await pieButton(page, 'package-open').click();
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'visible' });
  await waitForCameraSettled(page);

  await page.evaluate(() => window.__setClockSlowdown(20));
  await page.locator('[title="Combine Into Thing"]').first().click();
  // Closed at once: Zeta is gone from the web and Cluster is back, hidden under a
  // stand-in that carries the box's inside down into it.
  await expect.poll(() => morphState(page)).toEqual({ standIn: true, carries: true, hideRules: 1, zeta: 'absent' });
  expect(await storeEval(page, (st, [w, c]) => !st.graphs.get(w).instances.get(c).openDefinition, [WEB, CLUSTER])).toBe(true);
  const clusterVisibility = () => page.evaluate((id) => getComputedStyle(document.querySelector(`svg.canvas g.node[data-instance-id="${id}"]`)).visibility, CLUSTER);
  expect(await clusterVisibility()).toBe('hidden');

  await page.evaluate(() => window.__setClockSlowdown(1));
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'absent' });
  expect(await clusterVisibility()).toBe('visible');
});

test('F41 with reduced motion, nothing morphs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openClusterPreview(page);
  await page.evaluate(() => {
    window.__standInsSeen = 0;
    new MutationObserver((records) => { window.__standInsSeen += records.reduce((n, r) => n + r.addedNodes.length, 0); })
      .observe(document.querySelector('[data-box-morphs]'), { childList: true });
  });
  await pieButton(page, 'package-open').click();
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'visible' });
  expect(await page.evaluate(() => window.__standInsSeen)).toBe(0);
});

// Connections crossing the box's edge: two to Cluster itself (one with an arrow,
// one without), one from Beta to Zeta, inside Cluster's definition, and one from
// a node far off screen, which the canvas culls and so never draws.
const CROSSING = ['e-f41-to-thing', 'e-f41-from-thing', 'e-f41-to-zeta', 'e-f41-far'];

async function addCrossingConnections(page) {
  await storeEval(page, (st, [w, c, z]) => {
    const plain = (id, sourceId, destinationId, arrowsToward) => st.addEdge(w, {
      id, sourceId, destinationId, typeNodeId: 'base-connection-prototype', directionality: { arrowsToward: new Set(arrowsToward) },
    });
    const gamma = st.graphs.get(w).instances.get('i-gamma');
    st.addNodeInstance(w, gamma.prototypeId, { x: gamma.x - 9000, y: gamma.y + 6000 }, 'i-f41-far');
    plain('e-f41-far', 'i-f41-far', c, [c]);
    plain('e-f41-to-thing', 'i-gamma', c, [c]);
    plain('e-f41-from-thing', c, 'i-epsilon', []);
    // Made with the box open, as drawing it would be: it lives on web A, reaching Zeta through Cluster.
    st.openDefinitionInPlace(w, c, 0);
    plain('e-f41-to-zeta', 'i-beta', z, [z]);
    st.closeDefinitionInPlace(w, c);
  }, [WEB, CLUSTER, ZETA]);
  await nextFrames(page, 5);
}

const crossingState = (page) => page.evaluate((ids) => {
  // Under the stand-in's frame and over it: the stand-in's connections, each drawn with a stroke…
  const drawn = [...document.querySelectorAll('[data-box-morphs] [data-morph-part="connections"] > g')]
    .filter(g => g.querySelector('line, path')).length;
  // …and their labels, which travel with them (the node's and the box's, crossfading).
  const labels = document.querySelectorAll('[data-box-morphs] [data-morph-part="labels"] > g').length > 0;
  return {
    drawn,
    labels,
    real: ids.map(id => {
      const el = document.querySelector(`svg.canvas [data-edge-id="${id}"]`);
      return el ? getComputedStyle(el).visibility : 'absent';
    }),
  };
}, CROSSING);

test('F41 connections crossing the box stay attached while it opens and folds', async ({ page }) => {
  await slowableClock(page);
  await openFixture(page, 'small');
  await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  await addCrossingConnections(page);
  await waitForCameraSettled(page);
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click();
  await nextFrames(page, 30);
  await waitForCameraSettled(page);

  // Opening: the stand-in draws all three while the real ones wait hidden…
  await page.evaluate(() => window.__setClockSlowdown(20));
  await pieButton(page, 'package-open').click();
  await expect.poll(() => crossingState(page)).toEqual({ drawn: 4, labels: true, real: ['hidden', 'hidden', 'hidden', 'hidden'] });
  // …then hands them back.
  await page.evaluate(() => window.__setClockSlowdown(1));
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'visible' });
  expect(await crossingState(page)).toEqual({ drawn: 0, labels: false, real: ['visible', 'visible', 'visible', 'visible'] });
  await waitForCameraSettled(page);

  // Folding: the same, onto Cluster.
  await page.evaluate(() => window.__setClockSlowdown(20));
  await page.locator('[title="Combine Into Thing"]').first().click();
  await expect.poll(() => crossingState(page)).toEqual({ drawn: 4, labels: true, real: ['hidden', 'hidden', 'hidden', 'hidden'] });
  await page.evaluate(() => window.__setClockSlowdown(1));
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'absent' });
  expect(await crossingState(page)).toEqual({ drawn: 0, labels: false, real: ['visible', 'visible', 'visible', 'visible'] });
});

// ─── The camera ───────────────────────────────────────────────────────────────

const DEF = '00000000-0000-4000-8100-000000000004';
const ETA = '00000000-0000-4000-8100-00000000000a';

/** The opened box's shell on screen, and whether it sits wholly inside the canvas. */
const boxOnScreen = (page) => page.evaluate((cluster) => {
  const band = document.querySelector(`svg.canvas .node-group-bg[data-group-id="open:${cluster}"] > rect`);
  const r = band?.getBoundingClientRect();
  const canvas = document.querySelector('svg.canvas').getBoundingClientRect();
  return r ? { inside: r.left >= canvas.left && r.top >= canvas.top && r.right <= canvas.right && r.bottom <= canvas.bottom } : null;
}, CLUSTER);

async function decomposeFurther(page) {
  await pieButton(page, 'package-open').click();
  await expect.poll(() => morphState(page)).toEqual({ ...settled, zeta: 'visible' });
  return waitForCameraSettled(page);
}

test('F41 a box that fits at the current zoom keeps the zoom and is only nudged into view', async ({ page }) => {
  await openClusterPreview(page);
  const before = await waitForCameraSettled(page);
  const after = await decomposeFurther(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(Math.hypot(after.pan.x - before.pan.x, after.pan.y - before.pan.y)).toBeLessThan(120);
  expect(await boxOnScreen(page)).toEqual({ inside: true });
});

test('F41 a box too big for the view zooms out until it fits, never in', async ({ page }) => {
  await openFixture(page, 'small');
  await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  // Spread Cluster's definition wide, so its box outgrows the view.
  await storeEval(page, (st, [d, eta]) => st.updateNodeInstance(d, eta, (inst) => { inst.x += 4000; inst.y += 1500; }), [DEF, ETA]);
  await waitForCameraSettled(page);
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click();
  await nextFrames(page, 30);
  const before = await waitForCameraSettled(page);
  const after = await decomposeFurther(page);
  expect(after.zoom).toBeLessThan(before.zoom);
  expect(await boxOnScreen(page)).toEqual({ inside: true });
});

test('F41 with focus-on-select off, Compose leaves the camera where it is', async ({ page }) => {
  await openFixture(page, 'small');
  await storeEval(page, (st, [w, g]) => st.collapseNodeGroupIntoDefinition(w, g), [WEB, OLD_COPY_GROUP]);
  await openPieMenu(page, CLUSTER);
  await pieButton(page, 'package-open').click();
  await nextFrames(page, 30);
  await storeEval(page, (st) => { if (st.focusOnSelectEnabled !== false) st.toggleFocusOnSelectEnabled(); });
  const before = await waitForCameraSettled(page);
  await pieButton(page, 'package').click(); // Compose
  await expect.poll(() => page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return ui.getState().previewingNodeId;
  })).toBe(null);
  const after = await waitForCameraSettled(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.pan.x).toBeCloseTo(before.pan.x, 1);
});
