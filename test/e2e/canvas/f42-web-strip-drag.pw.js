// F42: open webs are reordered by dragging, in the header strip and in the left
// panel's Open Webs list, by finger as well as by mouse; and a drag held at the
// list's edge scrolls it, with its own position thumb standing in for the
// panel's scrollbar while it runs.
//
// Touch goes through CDP (gestures.js), the same input the device emulator
// sends. Until the drag backend's transitions were fixed (bootApp.jsx) none of
// these could drag by finger: the touch backend never switched on.
import { test, expect, openFixture, storeEval, nextFrames } from './helpers.js';
import { touchscreen } from './gestures.js';

// bootApp.jsx: a press must rest this long before the touch backend lets it drag.
const TOUCH_DRAG_DELAY_MS = 200;

const openOrder = (page) => storeEval(page, (st) => st.openGraphIds.slice());

/** Opens every web in the fixture (at least `min`, making more if needed) and returns the order. */
async function openWebs(page, min) {
  await storeEval(page, (st, n) => {
    // `st` is a snapshot; the count has to be read live as webs open.
    const live = () => window.useGraphStore.getState();
    for (const g of st.graphs.values()) if (g.definingNodeIds?.length) st.openGraphTab(g.id);
    for (let i = live().openGraphIds.length; i < n; i += 1) {
      st.createNewGraph({ name: `Extra ${i}`, typeNodeId: null, color: '#5a2a2a' });
    }
  }, min);
  await storeEval(page, (st) => st.setActiveGraphTab(st.openGraphIds[0]));
  return openOrder(page);
}

async function showOpenWebsList(page) {
  await storeEval(page, (st) => st.setLeftPanelExpanded(true));
  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().openLeftPanelView('grid');
  });
  await expect(page.locator('h2', { hasText: 'Open Webs' })).toBeVisible();
  // The panel slides in and its rows grow open over ~300 ms; a row measured
  // mid-animation is pressed somewhere it no longer is.
  // Settled = the rows and the list's scroll hold still for half a second: the
  // slide can start a beat after the view switches, and the panel may scroll
  // the active row into view once it has.
  let last = '';
  let still = 0;
  await expect.poll(async () => {
    const now = JSON.stringify(await page.locator('.panel-content [data-graph-id]').evaluateAll((els) => [
      els[0]?.closest('.panel-content')?.scrollTop,
      ...els.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.height]; }),
    ]));
    still = now === last ? still + 1 : 0;
    last = now;
    return still >= 4;
  }, { intervals: [120] }).toBe(true);
}

const box = async (locator) => {
  const b = await locator.boundingBox();
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
};

/** A finger held long enough to drag, then moved to `to` and lifted. */
async function touchDrag(page, from, to, { steps = 16, holdAtEndMs = 0 } = {}) {
  const ts = await touchscreen(page);
  await ts.start([from]);
  await page.waitForTimeout(TOUCH_DRAG_DELAY_MS + 80);
  for (let i = 1; i <= steps; i += 1) {
    await ts.move([{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    await nextFrames(page, 1);
  }
  if (holdAtEndMs) await page.waitForTimeout(holdAtEndMs);
  await ts.end([]);
}

test.describe('by touch', () => {
  test.use({ hasTouch: true });

  test('F42a a header tab dragged past its neighbour swaps with it', async ({ page }) => {
    await openFixture(page, 'small');
    const [a, b, ...rest] = await openWebs(page, 3);
    const tabA = await box(page.locator(`[data-header-tab-id="${a}"]`));
    const tabB = await box(page.locator(`[data-header-tab-id="${b}"]`));

    await touchDrag(page, { x: tabA.cx, y: tabA.cy }, { x: tabB.x + tabB.width * 0.85, y: tabB.cy });

    await expect.poll(() => openOrder(page)).toEqual([b, a, ...rest]);
  });

  test('F42b an Open Webs row dragged past its neighbour swaps with it', async ({ page }) => {
    await openFixture(page, 'small');
    const [a, b, ...rest] = await openWebs(page, 3);
    await showOpenWebsList(page);
    const rowA = await box(page.locator(`.panel-content [data-graph-id="${a}"]`));
    const rowB = await box(page.locator(`.panel-content [data-graph-id="${b}"]`));

    await touchDrag(page, { x: rowA.cx, y: rowA.cy }, { x: rowB.cx, y: rowB.y + rowB.height * 0.85 });

    await expect.poll(() => openOrder(page)).toEqual([b, a, ...rest]);
  });

  test('F42c a drag held past the bottom of Open Webs scrolls it, with its own thumb', async ({ page }) => {
    await openFixture(page, 'small');
    const order = await openWebs(page, 14);
    await showOpenWebsList(page);
    const scroller = page.locator('.panel-content').filter({ has: page.locator('h2', { hasText: 'Open Webs' }) });
    const area = await box(scroller);
    const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const row = await box(page.locator(`.panel-content [data-graph-id="${order[0]}"]`));

    const ts = await touchscreen(page);
    await ts.start([{ x: row.cx, y: row.cy }]);
    await page.waitForTimeout(TOUCH_DRAG_DELAY_MS + 80);
    // Into the list, then down past its bottom edge (the window ends first
    // when the panel is flush with it).
    const below = Math.min(area.y + area.height + 30, page.viewportSize().height - 2);
    const steps = 16;
    for (let i = 1; i <= steps; i += 1) {
      await ts.move([{ x: row.cx, y: row.cy + ((below - row.cy) * i) / steps }]);
      await nextFrames(page, 1);
    }
    await expect.poll(scrollTop, { timeout: 3_000 }).toBeGreaterThan(40);
    // The native thumb steps aside for the drawn one while it runs.
    await expect(scroller).toHaveAttribute('data-edge-autoscrolling', '');
    await ts.end([]);
    await expect(scroller).not.toHaveAttribute('data-edge-autoscrolling');
  });
});

test('F42d by mouse: an Open Webs row dragged past its neighbour swaps with it', async ({ page }) => {
  await openFixture(page, 'small');
  const [a, b, ...rest] = await openWebs(page, 3);
  await showOpenWebsList(page);
  const rowA = await box(page.locator(`.panel-content [data-graph-id="${a}"]`));
  const rowB = await box(page.locator(`.panel-content [data-graph-id="${b}"]`));

  await page.mouse.move(rowA.cx, rowA.cy);
  await page.mouse.down();
  // One move a frame, as a hand moves: native drag events delivered faster
  // than the page renders can arrive before the drag has started.
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(rowA.cx, rowA.cy + ((rowB.y + rowB.height * 0.85 - rowA.cy) * i) / 12);
    await nextFrames(page, 1);
  }
  await page.mouse.up();

  await expect.poll(() => openOrder(page)).toEqual([b, a, ...rest]);
});
