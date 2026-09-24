// F8: dragging a panel's resizer changes the panel's width.
//
// The bar the user grabs is NodeCanvas's overlay resizer (renderPanelResizers),
// not a strip inside the panel: it sits just outside the panel's inner edge and
// the panel follows it (panelWidthChanging / panelWidthChanged). It has no class
// or data attribute, so it is found by what makes it a resizer: a fixed,
// col-resize hitbox at z-index 10002 that takes pointer events (a collapsed
// panel's bar has pointer-events: none).
import {
  test, expect,
  openFixture, camera, storeEval, mouseDrag, nextFrames,
} from './helpers.js';

async function resizerCenter(page, side) {
  const handle = await page.evaluate((s) => {
    const bars = [...document.querySelectorAll('div')].filter((d) => {
      const cs = getComputedStyle(d);
      return cs.cursor === 'col-resize' && cs.position === 'fixed' && cs.zIndex === '10002' && cs.pointerEvents === 'auto';
    }).map((d) => d.getBoundingClientRect());
    const mid = window.innerWidth / 2;
    const r = bars.find((b) => (s === 'left' ? b.x < mid : b.x > mid));
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, side);
  expect(handle, `${side} resizer is on screen and live`).not.toBeNull();
  return handle;
}

const panelWidth = (page, side) => page.locator(`.panel-container.${side}`).evaluate((el) => el.getBoundingClientRect().width);

async function openPanel(page, side) {
  await storeEval(page, (st, s) => (s === 'left' ? st.setLeftPanelExpanded(true) : st.setRightPanelExpanded(true)), side);
  // The resizers fade in 180 ms after a panel opens; wait for the live one.
  await expect.poll(async () => page.evaluate((s) => [...document.querySelectorAll('div')].some((d) => {
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return cs.cursor === 'col-resize' && cs.zIndex === '10002' && cs.pointerEvents === 'auto' && cs.opacity === '1'
      && (s === 'left' ? r.x < window.innerWidth / 2 : r.x > window.innerWidth / 2);
  }), side)).toBe(true);
  // And for the panel's own slide-in to finish.
  let w = await panelWidth(page, side);
  await expect.poll(async () => { await nextFrames(page, 3); const n = await panelWidth(page, side); const same = Math.abs(n - w) < 0.5; w = n; return same; }).toBe(true);
  return w;
}

for (const [side, sign] of [['right', -1], ['left', +1]]) {
  test(`F8 dragging the ${side} panel's resizer widens and narrows it`, async ({ page }) => {
    await openFixture(page, 'small');
    const w0 = await openPanel(page, side);
    const cam0 = await camera(page);

    // Pull the bar away from the panel's outer edge: the panel gets wider by
    // the same amount (the right panel's bar moves left to widen it).
    const from = await resizerCenter(page, side);
    const widen = 150;
    await mouseDrag(page, from, { x: from.x + sign * widen, y: from.y }, { steps: 10 });
    await expect.poll(async () => Math.abs((await panelWidth(page, side)) - (w0 + widen)), { message: 'panel follows the bar' }).toBeLessThan(4);
    const w1 = await panelWidth(page, side);

    // The bar moved with the panel's edge.
    const moved = await resizerCenter(page, side);
    expect(Math.abs(moved.x - (from.x + sign * widen))).toBeLessThan(4);

    // The width is persisted, so a reload keeps it.
    const stored = await page.evaluate((s) => JSON.parse(localStorage.getItem(`panelWidth_${s}`) || 'null'), side);
    expect(Math.abs(stored - w1)).toBeLessThan(1);

    // Back the other way: narrower again.
    await mouseDrag(page, moved, { x: moved.x - sign * 100, y: moved.y }, { steps: 10 });
    await expect.poll(async () => Math.abs((await panelWidth(page, side)) - (w1 - 100))).toBeLessThan(4);

    // Resizing is not a pan.
    expect(await camera(page)).toEqual(cam0);
  });
}
