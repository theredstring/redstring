// Shared helpers for the canvas interaction flows (P0.03).
//
// Rules these helpers follow, so the flows stay non-flaky:
//   - Wait on state (store, DOM, the camera attribute), never on a bare sleep.
//     The few fixed waits left are the app's own timers that no state reveals
//     (e.g. the 250 ms lift delay a real user must hold for) and are named.
//   - Find targets from the DOM (a node's rendered box), not from hard-coded
//     screen coordinates, so a layout or font change moves the target with it.
//   - Read the camera from the content group's transform attribute, which
//     useCanvasTransform writes synchronously on every pan/zoom frame.
//   - Never use locator actions (click/hover/fill…) on elements INSIDE the
//     canvas. Playwright scrolls a target into view first, and the canvas is a
//     100,000 px SVG inside an overflow:hidden .canvas-area, which the browser
//     will happily scroll: every node then shifts on screen while the camera
//     attribute is unchanged. Use clickCenter() (a mouse click at the box
//     centre) instead. The `test` exported here fails any flow that leaves
//     .canvas-area scrolled, whether a test or the app caused it.
import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    const scroll = await page.evaluate(() => {
      const c = document.querySelector('.canvas-area');
      return c ? [c.scrollLeft, c.scrollTop] : [0, 0];
    }).catch(() => [0, 0]);
    expect(scroll, '.canvas-area was scrolled; the canvas must only move through its camera').toEqual([0, 0]);
  },
});

// NodeCanvas canvasSize.offsetX/Y: world = (client - rect - pan) / zoom + OFFSET
export const CANVAS_OFFSET = -50000;

// Flows that reproduce a known bug are marked test.fail(EXPECT_KNOWN_BUGS, …).
// Run with CANVAS_E2E_SHOW_KNOWN_BUGS=1 to run them as ordinary tests and
// see the actual failure (to check they fail for the documented reason).
export const EXPECT_KNOWN_BUGS = !process.env.CANVAS_E2E_SHOW_KNOWN_BUGS;

// App timers, mirrored so the tests say what they are waiting out.
export const NODE_LIFT_DELAY_MS = 250; // mouseSettings.nodeLiftDelay default
export const CLICK_DELAY_MS = 180; // NodeCanvas CLICK_DELAY (single vs double click)

/** Absolute path of the local-only chambers fixture, or null when absent. */
export function chambersPath() {
  const p = process.env.REDSTRING_LOCAL_FIXTURE
    || '/Users/granteubanks/Code/redstringuireact/test/fixtures/canvas/local/claudes-chambers.redstring';
  return existsSync(p) ? p : null;
}

/**
 * Open a committed fixture and wait until the canvas is interactive: store
 * loaded, nodes painted, fonts settled, camera written.
 */
export async function openFixture(page, name = 'small', query = '') {
  // External requests are also blocked in-page by the fixture sandbox. Doing it
  // here too keeps a run independent of the network.
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.goto(`/?fixture=${name}${query}`);
  await page.waitForFunction(
    () => window.__fixture?.ready === true || !!window.__fixtureError,
    null,
    { timeout: 30_000 },
  );
  const bootError = await page.evaluate(() => window.__fixtureError || null);
  if (bootError) throw new Error(`fixture boot failed: ${bootError}`);
  await waitForCanvasReady(page);
}

/** Wait for painted nodes, loaded fonts and a written camera transform. */
export async function waitForCanvasReady(page) {
  await page.waitForFunction(() => {
    const g = document.querySelector('svg.canvas > g');
    return !!g?.getAttribute('transform') && document.querySelectorAll('svg.canvas g.node').length > 0;
  }, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await nextFrames(page, 2);
}

/** Resolve after `n` animation frames in the page. */
export async function nextFrames(page, n = 1) {
  await page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const tick = () => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), n);
}

/** Run `fn(state)` against the live graph store in the page. */
export function storeEval(page, fn, arg) {
  return page.evaluate(
    ([source, a]) => {
      // eslint-disable-next-line no-new-func
      const f = new Function(`return (${source})`)();
      return f(window.useGraphStore.getState(), a);
    },
    [fn.toString(), arg],
  );
}

/** Active graph id plus a plain copy of its instances. */
export function activeGraphSnapshot(page) {
  return storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    const instances = {};
    for (const [id, inst] of g.instances) instances[id] = { x: inst.x, y: inst.y, prototypeId: inst.prototypeId, isGroupAnchor: !!inst.isGroupAnchor };
    const groups = {};
    for (const [id, gr] of g.groups || new Map()) {
      groups[id] = { name: gr.name, memberInstanceIds: [...(gr.memberInstanceIds || [])], anchorInstanceId: gr.anchorInstanceId || null, linkedNodePrototypeId: gr.linkedNodePrototypeId || null };
    }
    return { graphId: st.activeGraphId, instances, groups, edgeIds: [...g.edgeIds] };
  });
}

/** Camera as NodeCanvas holds it: { pan: {x,y}, zoom }. */
export async function camera(page) {
  const t = await page.locator('svg.canvas > g').first().getAttribute('transform');
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)\s*scale\(\s*([-\d.e]+)\s*\)/.exec(t || '');
  if (!m) throw new Error(`unexpected content transform: ${t}`);
  const tx = Number(m[1]);
  const ty = Number(m[2]);
  const zoom = Number(m[3]);
  return { pan: { x: tx + CANVAS_OFFSET * zoom, y: ty + CANVAS_OFFSET * zoom }, zoom };
}

/** Wait until the camera stops changing for `quietMs`. Returns the final camera. */
export async function waitForCameraSettled(page, { quietMs = 250, timeout = 8_000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = await camera(page);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await nextFrames(page, 2);
    const cur = await camera(page);
    const same = Math.abs(cur.pan.x - last.pan.x) < 0.01 && Math.abs(cur.pan.y - last.pan.y) < 0.01 && Math.abs(cur.zoom - last.zoom) < 1e-6;
    if (!same) { last = cur; stableSince = Date.now(); } else if (Date.now() - stableSince >= quietMs) return cur;
  }
  throw new Error('camera did not settle');
}

/** Canvas container rect (the element clientToCanvasCoordinates measures). */
export async function canvasRect(page) {
  return page.locator('.canvas-area').boundingBox();
}

/** Client point → world point, using the same maths as NodeCanvas. */
export async function clientToWorld(page, x, y) {
  const [rect, cam] = await Promise.all([canvasRect(page), camera(page)]);
  return {
    x: (x - rect.x - cam.pan.x) / cam.zoom + CANVAS_OFFSET,
    y: (y - rect.y - cam.pan.y) / cam.zoom + CANVAS_OFFSET,
  };
}

/** World point → client point. */
export async function worldToClient(page, x, y) {
  const [rect, cam] = await Promise.all([canvasRect(page), camera(page)]);
  return {
    x: rect.x + cam.pan.x + (x - CANVAS_OFFSET) * cam.zoom,
    y: rect.y + cam.pan.y + (y - CANVAS_OFFSET) * cam.zoom,
  };
}

/** A node's rendered background box (client coords). */
export async function nodeBox(page, instanceId) {
  const loc = page.locator(`svg.canvas g.node[data-instance-id="${instanceId}"] .node-background`).first();
  await expect(loc).toBeVisible();
  return loc.boundingBox();
}

export const centerOf = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * Click the centre of an element with the mouse, without Playwright's
 * scroll-into-view (see the note at the top of this file). Waits for the
 * element to be visible and for its box to hold still for two frames, which is
 * what Playwright's own "stable" check would have done.
 */
export async function clickCenter(page, locator, { modifiers = [] } = {}) {
  await expect(locator).toBeVisible();
  let box = await locator.boundingBox();
  for (let i = 0; i < 30; i++) {
    await nextFrames(page, 2);
    const next = await locator.boundingBox();
    if (next && box && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5
      && Math.abs(next.width - box.width) < 0.5 && Math.abs(next.height - box.height) < 0.5) break;
    box = next;
  }
  const c = centerOf(box);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(c.x, c.y);
  for (const m of modifiers.slice().reverse()) await page.keyboard.up(m);
}

/** Instance ids of nodes currently rendered with the `selected` class. */
export function selectedNodeIds(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('svg.canvas g.node.selected'))
    .map((el) => el.getAttribute('data-instance-id')).sort());
}

/**
 * Assert that (x, y) is bare canvas: what a click there hits is the canvas
 * itself, not a node, edge, group, label or overlay.
 */
export async function expectBareCanvas(page, point) {
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'nothing';
    if ((el.tagName === 'svg' && el.classList.contains('canvas')) || (el.tagName === 'DIV' && el.classList.contains('canvas-area'))) return 'bare';
    return `${el.tagName.toLowerCase()}.${el.getAttribute('class') || ''}`;
  }, point);
  expect(hit, `expected bare canvas at ${point.x},${point.y}`).toBe('bare');
}

/**
 * Find a point of bare canvas with a clear patch around it (`halfW` x `halfH`
 * all bare) that is as far as possible from any rendered node. For flows on
 * real data, where no layout is known in advance. Stays clear of the header,
 * the bottom bar and the panel toggles.
 */
export async function findBareSpot(page, { halfW = 110, halfH = 70 } = {}) {
  const spot = await page.evaluate(({ hw, hh }) => {
    const area = document.querySelector('.canvas-area').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('svg.canvas g.node')].map((n) => n.getBoundingClientRect());
    const isBare = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return !!el && ((el.tagName === 'svg' && el.classList.contains('canvas')) || (el.tagName === 'DIV' && el.classList.contains('canvas-area')));
    };
    let best = null;
    for (let y = area.top + 60 + hh; y < area.bottom - 70 - hh; y += 25) {
      for (let x = area.left + 60 + hw; x < area.right - 60 - hw; x += 25) {
        let clear = true;
        for (let dy = -hh; dy <= hh && clear; dy += hh / 2) {
          for (let dx = -hw; dx <= hw && clear; dx += hw / 2) clear = isBare(x + dx, y + dy);
        }
        if (!clear) continue;
        let d = Infinity;
        for (const b of boxes) {
          const ex = Math.max(b.left - x, 0, x - b.right);
          const ey = Math.max(b.top - y, 0, y - b.bottom);
          d = Math.min(d, Math.hypot(ex, ey));
        }
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    return best;
  }, { hw: halfW, hh: halfH });
  if (!spot) throw new Error('no bare patch of canvas on screen');
  return { x: spot.x, y: spot.y };
}

/**
 * Press, optionally hold still, move in steps, release. `holdMs` is how long
 * the pointer rests after the press before moving (0 = move immediately).
 */
export async function mouseDrag(page, from, to, { steps = 12, holdMs = 0, stepDelayMs = 0, modifiers = [] } = {}) {
  await page.mouse.move(from.x, from.y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (stepDelayMs) await page.waitForTimeout(stepDelayMs);
  }
  await page.mouse.up();
  for (const m of modifiers.slice().reverse()) await page.keyboard.up(m);
}

/**
 * A client point on an edge's hit stroke ([data-edge-hit], a <path> or
 * <line>) where the edge is the topmost thing, nearest to fraction `t` along
 * it. Edges are drawn centre to centre, under their nodes, so a fixed
 * fraction can land inside a node; this samples along the stroke and keeps
 * the first visible point. Hover and click hit-tests both resolve to it.
 */
export async function edgePoint(page, edgeId, t = 0.5) {
  const pt = await page.evaluate(({ id, frac }) => {
    const el = document.querySelector(`svg.canvas [data-edge-id="${id}"] [data-edge-hit]`);
    if (!el) return { error: 'no [data-edge-hit]' };
    const len = el.getTotalLength();
    const m = el.getScreenCTM();
    const candidates = [];
    for (let f = 0.1; f <= 0.9001; f += 0.025) candidates.push(f);
    candidates.sort((a, b) => Math.abs(a - frac) - Math.abs(b - frac));
    for (const f of candidates) {
      const p = el.getPointAtLength(len * f);
      const x = m.a * p.x + m.c * p.y + m.e;
      const y = m.b * p.x + m.d * p.y + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest('[data-edge-id]')?.getAttribute('data-edge-id') === id) return { x, y };
    }
    return { error: 'no visible point along the edge' };
  }, { id: edgeId, frac: t });
  if (pt.error) throw new Error(`edge ${edgeId}: ${pt.error}`);
  return pt;
}

/**
 * An edge's highlight: 'hover', 'selected', or null. Hovered and selected
 * edges draw a glow stroke (drop-shadow) under the line; renderConnectionEdge
 * gives it opacity 0.2 when hovered and 0.3 when selected.
 */
export function edgeGlow(page, edgeId) {
  return page.evaluate((id) => {
    const glow = document.querySelector(`svg.canvas [data-edge-id="${id}"] [style*="drop-shadow"][opacity]`);
    if (!glow) return null;
    return glow.getAttribute('opacity') === '0.3' ? 'selected' : 'hover';
  }, edgeId);
}

/** Store-side edge selection: the union NodeCanvas renders as selected. */
export function selectedEdgeIds(page) {
  return storeEval(page, (st) => {
    const ids = new Set(st.selectedEdgeIds);
    if (st.selectedEdgeId) ids.add(st.selectedEdgeId);
    return [...ids].sort();
  });
}

/** A pie-menu button, found by its lucide icon (`svg.lucide-<icon>`). */
export const pieButton = (page, icon) => page.locator(`svg.canvas g.pie-menu svg.lucide-${icon}`).first();

/**
 * Click a node and wait for its pie menu. Selection lands after the click
 * delay; the pie opens for a single selection; focus-on-select (default on)
 * re-frames the camera, so wait for that to finish too.
 */
export async function openPieMenu(page, instanceId) {
  const c = centerOf(await nodeBox(page, instanceId));
  await page.mouse.click(c.x, c.y);
  await expect.poll(() => selectedNodeIds(page)).toEqual([instanceId]);
  await expect(page.locator('svg.canvas g.pie-menu')).toHaveCount(1);
  await waitForCameraSettled(page);
}

/** Modifier NodeCanvas treats as "marquee": Cmd on Mac user agents, Ctrl elsewhere. */
export async function marqueeModifier(page) {
  const isMac = await page.evaluate(() => /Mac/i.test(navigator.userAgent));
  return isMac ? 'Meta' : 'Control';
}
