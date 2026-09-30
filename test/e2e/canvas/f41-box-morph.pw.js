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
    carries: standIn ? [...standIn.children].some(child => child.tagName === 'g' && child.childElementCount > 0) : false,
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
