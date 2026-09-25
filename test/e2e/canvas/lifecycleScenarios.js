// Scenarios for the pie / carousel lifecycle reference (P5.02 step 0).
//
// Each scenario opens the committed `small` fixture, starts a lifecycle trace
// (lifecycleTrace.js), drives one interaction and returns the distinct-snapshot
// trace. Every step waits for the lifecycle to settle before the next one, so a
// scenario does not depend on how fast the machine runs, and two runs on the
// same code give the same trace. The flows F33–F37 assert on these traces; the
// baseline recorder (zz-lifecycle-baseline.pw.js) writes them to JSON so a later
// refactor step can be checked "trace-equal".
//
// The F6/F9/F29/F31 scenarios here are trace-only versions of those flows'
// interactions (their own specs keep asserting what they assert).
import { expect } from '@playwright/test';
import {
  openFixture, openPieMenu, pieButton, clickCenter, waitForCameraSettled, expectBareCanvas,
} from './helpers.js';
import { startLifecycleTrace, waitForQuiet } from './lifecycleTrace.js';

const BARE = { x: 1000, y: 650 }; // the small fixture's empty lower-right quarter (F12)

const carouselLevels = (page) => page.evaluate(() => [...document.querySelectorAll('[data-carousel-level]')]
  .map((g) => ({ level: Number(g.getAttribute('data-carousel-level')), opacity: Number(getComputedStyle(g).opacity) })));

/** Level of the carousel entry at full opacity, once exactly one is. */
export async function focusedLevel(page) {
  const full = (await carouselLevels(page)).filter((e) => e.opacity > 0.99);
  return full.length === 1 ? full[0].level : null;
}

/** One canvasUIStore field, read in the page. */
export const uiField = (page, name) => page.evaluate(async (n) => {
  const { default: ui } = await import('/src/store/canvasUIStore.js');
  return ui.getState()[n];
}, name);

/**
 * Open the fixture and start tracing from a settled canvas. `nodePanel: true`
 * turns on the single-node control panel (off by default, so the default
 * scenarios never show it) to bring its latches into the trace.
 */
async function begin(page, { nodePanel = false } = {}) {
  await openFixture(page, 'small');
  if (nodePanel) {
    await page.evaluate(() => {
      const st = window.useGraphStore.getState();
      if (!st.showNodeControlPanel) st.toggleShowNodeControlPanel();
    });
  }
  const trace = await startLifecycleTrace(page);
  await waitForQuiet(page);
  return trace;
}

/** Click a node, wait for its pie and the focus-on-select framing, then settle. */
async function openPie(page, instanceId = 'i-alpha') {
  await openPieMenu(page, instanceId);
  await waitForQuiet(page);
}

/** From an open pie: Abstraction → carousel, framed and settled at level 0. */
async function openCarousel(page) {
  await clickCenter(page, pieButton(page, 'layers'));
  await expect.poll(() => focusedLevel(page)).toBe(0);
  await expect(pieButton(page, 'arrow-left')).toBeVisible();
  await waitForCameraSettled(page);
  await waitForQuiet(page);
}

async function wheelStep(page, dy, level) {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, dy);
  await expect.poll(() => focusedLevel(page)).toBe(level);
  await waitForQuiet(page);
}

/** Stage 1 → stage 2 with the carousel's Create Definition (plus) button. */
async function toStage2(page) {
  await clickCenter(page, pieButton(page, 'plus'));
  await expect(pieButton(page, 'corner-up-left')).toBeVisible();
  await waitForQuiet(page);
}

async function clickBack(page) {
  await clickCenter(page, pieButton(page, 'arrow-left'));
  await waitForQuiet(page);
}

export const scenarios = {
  // F6: click a node → pie opens; click bare canvas → pie closes.
  async F6(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await expectBareCanvas(page, BARE);
    await page.mouse.click(BARE.x, BARE.y);
    await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F6 second click (T2 / A-2 probe): pie open on Alpha → click another node.
  // A mouse click adds to the selection (pointerHandlers toggles membership),
  // so this does NOT retarget the pie: two nodes are selected and it closes.
  async F6_secondClick(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    // The first other node whose centre is clickable (not under the pie).
    const other = await page.evaluate(() => {
      for (const g of document.querySelectorAll('svg.canvas g.node[data-instance-id]')) {
        const id = g.getAttribute('data-instance-id');
        if (id === 'i-alpha') continue;
        const r = g.querySelector('.node-background')?.getBoundingClientRect();
        if (!r) continue;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (hit?.closest('g.node')?.getAttribute('data-instance-id') === id) return id;
      }
      return null;
    });
    expect(other, 'a clickable second node').toBeTruthy();
    await clickCenter(page, page.locator(`svg.canvas g.node[data-instance-id="${other}"] .node-background`).first());
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('svg.canvas g.node.selected').length)).toBe(2);
    await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F9: pie → carousel, step up and back down, Back closes it.
  async F9(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await wheelStep(page, 120, 1);
    await wheelStep(page, -120, 0);
    await clickBack(page);
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F29: pie → carousel, one step up (the pie follows the focused node).
  async F29(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await wheelStep(page, 120, 1);
    return trace.stop({ raw: true });
  },

  // F31: carousel → stage 2 → Add Above → name it → submit.
  async F31(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await toStage2(page);
    await clickCenter(page, pieButton(page, 'corner-up-left'));
    const input = page.locator('input.unified-selector-control[type="text"]:visible');
    await expect(input).toBeVisible();
    await waitForQuiet(page);
    await input.fill('Letter');
    await input.press('Enter');
    await expect.poll(() => page.locator('[data-carousel-level]').count()).toBe(3);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F33 (T4/T5): pie → Decompose (preview) → Compose back.
  async F33(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await clickCenter(page, pieButton(page, 'package-open'));
    await expect.poll(() => uiField(page, 'previewingNodeId')).toBe('i-alpha');
    await expect(pieButton(page, 'package')).toBeVisible();
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    await clickCenter(page, pieButton(page, 'package'));
    await expect(pieButton(page, 'layers')).toBeVisible();
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F34a (T7): carousel stage 1 → plus → stage 2 → Back → stage 1.
  async F34_stageBack(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await toStage2(page);
    await clickBack(page); // carousel-back-stage2
    await expect(pieButton(page, 'send-to-back')).toBeVisible(); // stage-1 Swap
    return trace.stop({ raw: true });
  },

  // F34b (T8 cancel, NEW-2): stage 2 → Add Above → cancel the prompt → Back.
  // Since NEW-2's fix one Back closes the carousel; before it, the first Back
  // swapped to stage 2, so Back is pressed until the carousel is gone (at most 3).
  async F34_cancelBack(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await toStage2(page);
    await clickCenter(page, pieButton(page, 'corner-up-left'));
    await expect(page.locator('input.unified-selector-control[type="text"]:visible')).toBeVisible();
    await waitForQuiet(page);
    // Cancel with the dialog's X. (Escape would also reach the carousel's own
    // document keydown listener and close the carousel.)
    await page.locator('.unified-selector-overlay').getByTitle('Close', { exact: true }).click();
    await expect(page.locator('input.unified-selector-control[type="text"]')).toHaveCount(0);
    await waitForQuiet(page);
    for (let i = 0; i < 3 && await page.locator('[data-carousel-level]').count(); i++) {
      await clickBack(page);
      await waitForQuiet(page);
    }
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F35a (T9): carousel open → Escape → carousel closes, pie returns.
  async F35_escape(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F35b (T9, NEW-1): carousel open → mouse click on bare canvas away from it.
  async F35_clickAway(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await expectBareCanvas(page, BARE);
    await page.mouse.click(BARE.x, BARE.y);
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F36 (T10): carousel → step up to Thing → Swap: Alpha's instance becomes a Thing.
  async F36(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await wheelStep(page, 120, 1);
    await clickCenter(page, pieButton(page, 'send-to-back'));
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F37 (§4.9): pie open on Alpha in web A → switch to web B from the header tab.
  async F37(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    // Header tabs are DOM outside the canvas: a locator click is safe (F15).
    await page.getByTitle('Small Web B', { exact: true }).first().click();
    await expect(page.locator('svg.canvas g.node[data-instance-id="i-lambda"]')).toBeVisible();
    await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(0);
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },

  // F35c (NEW-4): Escape from stage 2, then open the carousel again.
  async F35_stage2Escape(page, opts = {}) {
    const trace = await begin(page, opts);
    await openPie(page);
    await openCarousel(page);
    await toStage2(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-carousel-level]')).toHaveCount(0);
    await expect(pieButton(page, 'layers')).toBeVisible();
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    await clickCenter(page, pieButton(page, 'layers'));
    await expect.poll(() => focusedLevel(page)).toBe(0);
    await waitForCameraSettled(page);
    await waitForQuiet(page);
    return trace.stop({ raw: true });
  },
};

// The same interactions with the single-node control panel on, so the node
// panel's show / hide / cut latches are in the trace too.
for (const name of ['F6', 'F33', 'F35_escape', 'F37']) {
  scenarios[`${name}_nodePanel`] = (page) => scenarios[name](page, { nodePanel: true });
}
