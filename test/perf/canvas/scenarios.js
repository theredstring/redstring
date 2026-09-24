// Perf scenarios S1–S13 (METRICS.md), for the profiling build (refactor P0.04).
//
// Each scenario is { id, fixtures, touch?, setup?, run }:
//   - setup(page, ctx) prepares state BEFORE measuring (open a panel, pick a
//     target, switch a setting). Its commits are not counted.
//   - run(page, ctx) performs the steps. The harness starts the probe just
//     before run and stops it once the canvas has gone quiet after it, so the
//     tail of the gesture (glide, settle, follow-up effects) is counted.
//   - It returns extras worth recording (e.g. how many nodes a marquee took).
// Targets come from the DOM, never from fixed coordinates: the medium fixture
// is a real universe whose layout nobody controls.
//
// Scenario definitions are stable (METRICS.md): change one, add a new ID.
import {
  waitForCameraSettled, nextFrames, storeEval, pieButton, marqueeModifier, findBareSpot, edgePoint,
} from '../../e2e/canvas/helpers.js';
import { touchscreen } from '../../e2e/canvas/gestures.js';

const FRAME_MS = 16;

// --- DOM helpers -----------------------------------------------------------

/** Rendered nodes whose centre is on screen, clear of the edges, and topmost there. */
export function visibleNodes(page, margin = 60) {
  return page.evaluate((m) => {
    const area = document.querySelector('.canvas-area').getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll('svg.canvas g.node[data-instance-id]')) {
      const bg = el.querySelector('.node-background') || el;
      const r = bg.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx < area.left + m || cx > area.right - m || cy < area.top + m || cy > area.bottom - m) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (hit?.closest('g.node') !== el) continue;
      out.push({ id: el.getAttribute('data-instance-id'), x: r.x, y: r.y, w: r.width, h: r.height, cx, cy });
    }
    return out;
  }, margin);
}

/** The on-screen node nearest the middle of the canvas. */
async function centralNode(page, filter = () => true) {
  const [nodes, area] = await Promise.all([visibleNodes(page, 120), page.locator('.canvas-area').boundingBox()]);
  const mid = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const pool = nodes.filter(filter);
  if (!pool.length) throw new Error('no suitable node on screen');
  pool.sort((a, b) => Math.hypot(a.cx - mid.x, a.cy - mid.y) - Math.hypot(b.cx - mid.x, b.cy - mid.y));
  return pool[0];
}

async function canvasCenter(page) {
  const a = await page.locator('.canvas-area').boundingBox();
  return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
}

/** Instance → prototype and per-instance edge counts for the active graph. */
function activeGraphInfo(page) {
  return storeEval(page, (st) => {
    const g = st.graphs.get(st.activeGraphId);
    const protoOf = {};
    const degree = {};
    for (const [id, inst] of g.instances) { protoOf[id] = inst.prototypeId; degree[id] = 0; }
    for (const eid of g.edgeIds) {
      const e = st.edges.get(eid);
      if (!e) continue;
      if (e.sourceId in degree) degree[e.sourceId] += 1;
      if (e.destinationId in degree) degree[e.destinationId] += 1;
    }
    const hasDefinition = {};
    for (const [id, pid] of Object.entries(protoOf)) {
      hasDefinition[id] = (st.nodePrototypes.get(pid)?.definitionGraphIds?.length || 0) > 0;
    }
    return { graphId: st.activeGraphId, protoOf, degree, hasDefinition };
  });
}

async function openPie(page, node) {
  await page.mouse.click(node.cx, node.cy);
  await page.locator('svg.canvas g.pie-menu').first().waitFor({ state: 'visible' });
  await waitForCameraSettled(page);
}

async function linearMove(page, from, to, { steps, stepMs = FRAME_MS }) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (stepMs) await page.waitForTimeout(stepMs);
  }
}

/** Keep a drag of `len` px from `from` inside the canvas, heading for its middle. */
async function towardMiddle(page, from, len) {
  const mid = await canvasCenter(page);
  let dx = mid.x - from.x;
  let dy = mid.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  return { x: from.x + dx * len, y: from.y + dy * len };
}

/**
 * A bare spot to press on. A dense graph (the large fixture) may have no big
 * empty patch on screen, so fall back to smaller ones.
 */
async function bareSpot(page) {
  for (const [halfW, halfH] of [[110, 70], [40, 30], [14, 14]]) {
    try { return await findBareSpot(page, { halfW, halfH }); } catch { /* try a smaller patch */ }
  }
  throw new Error('no bare canvas on screen');
}

/** The bare-canvas point nearest `pt`, searching rings of 6 px out to `maxR`. */
async function nearestBare(page, pt, maxR = 150) {
  const found = await page.evaluate(({ x0, y0, R }) => {
    const isBare = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return !!el && ((el.tagName === 'svg' && el.classList.contains('canvas')) || (el.tagName === 'DIV' && el.classList.contains('canvas-area')));
    };
    if (isBare(x0, y0)) return { x: x0, y: y0 };
    for (let r = 6; r <= R; r += 6) {
      for (let a = 0; a < 360; a += 15) {
        const x = x0 + r * Math.cos((a * Math.PI) / 180);
        const y = y0 + r * Math.sin((a * Math.PI) / 180);
        if (isBare(x, y)) return { x, y };
      }
    }
    return null;
  }, { x0: pt.x, y0: pt.y, R: maxR });
  if (!found) throw new Error(`no bare canvas within ${maxR}px of ${Math.round(pt.x)},${Math.round(pt.y)}`);
  return found;
}

const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** 20 setImage calls, one per frame, each with a distinct src so none is skipped as a no-op. */
function thumbnailBurst(page, protoIds) {
  return page.evaluate(async ({ ids, src }) => {
    const cache = window.__imageCache.getState();
    for (let i = 0; i < ids.length; i++) {
      cache.setImage(ids[i], { thumbnailSrc: `${src}#perf${i}`, imageAspectRatio: 1 });
      await new Promise(requestAnimationFrame);
    }
  }, { ids: protoIds, src: PLACEHOLDER });
}

// --- Scenarios -------------------------------------------------------------

const MEDIUM = ['medium'];
const BOTH = ['medium', 'large'];

export const SCENARIOS = [
  {
    id: 'S1',
    name: 'Drag-pan, 2 s, momentum included',
    fixtures: BOTH,
    async setup(page, ctx) { ctx.from = await bareSpot(page); },
    async run(page, { from }) {
      const to = await towardMiddle(page, from, 360);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await linearMove(page, from, to, { steps: 120 });
      await page.mouse.up();
      await waitForCameraSettled(page);
      return {};
    },
  },
  {
    id: 'S1t',
    name: 'Touch pan, 2 s',
    fixtures: MEDIUM,
    touch: true,
    async setup(page, ctx) { ctx.from = await bareSpot(page); ctx.touch = await touchscreen(page); },
    async run(page, { from, touch }) {
      const to = await towardMiddle(page, from, 360);
      await touch.start([from]);
      const steps = 120;
      for (let i = 1; i <= steps; i++) {
        await touch.move([{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
        await page.waitForTimeout(FRAME_MS);
      }
      await touch.end();
      await waitForCameraSettled(page);
      return {};
    },
  },
  {
    id: 'S2',
    name: 'Wheel zoom, 10 notches in then 10 out',
    fixtures: MEDIUM,
    async setup(page, ctx) { ctx.at = await canvasCenter(page); ctx.mod = await marqueeModifier(page); },
    async run(page, { at, mod }) {
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down(mod);
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, dir * 100); await nextFrames(page, 2); }
      }
      await page.keyboard.up(mod);
      await waitForCameraSettled(page);
      return {};
    },
  },
  {
    id: 'S3',
    name: 'Trackpad-style zoom, Ctrl+wheel fractional deltas at 60 Hz for 1.5 s',
    fixtures: MEDIUM,
    async setup(page, ctx) { ctx.at = await canvasCenter(page); },
    async run(page, { at }) {
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < 90; i++) {
        await page.mouse.wheel(0, i < 45 ? -2.5 : 2.5);
        await page.waitForTimeout(FRAME_MS);
      }
      await page.keyboard.up('Control');
      await waitForCameraSettled(page);
      return {};
    },
  },
  {
    id: 'S4',
    name: 'Node drag, 400 px over 1 s',
    fixtures: BOTH,
    async setup(page, ctx) { ctx.node = await centralNode(page); },
    async run(page, { node }) {
      const from = { x: node.cx, y: node.cy };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(400); // past the 250 ms lift delay
      const to = await towardMiddle(page, { x: from.x + 1, y: from.y }, 400);
      await linearMove(page, from, to, { steps: 60 });
      await page.mouse.up();
      await waitForCameraSettled(page);
      return {};
    },
  },
  {
    id: 'S5',
    name: 'Marquee across about 30 nodes',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      const nodes = (await visibleNodes(page, 30)).sort((a, b) => a.cx - b.cx);
      const take = nodes.slice(0, Math.min(30, nodes.length));
      const minX = Math.min(...take.map((n) => n.x));
      const minY = Math.min(...take.map((n) => n.y));
      const maxX = Math.max(...take.map((n) => n.x + n.w));
      const maxY = Math.max(...take.map((n) => n.y + n.h));
      const area = await page.locator('.canvas-area').boundingBox();
      // The press must land on bare canvas or it is a node press, not a marquee.
      ctx.from = await nearestBare(page, { x: Math.max(area.x + 8, minX - 15), y: Math.max(area.y + 60, minY - 15) });
      ctx.to = { x: Math.min(area.x + area.width - 8, maxX + 5), y: Math.min(area.y + area.height - 70, maxY + 15) };
      ctx.mod = await marqueeModifier(page);
    },
    async run(page, { from, to, mod }) {
      await page.mouse.move(from.x, from.y);
      await page.keyboard.down(mod);
      await page.mouse.down();
      await linearMove(page, from, to, { steps: 45 });
      await page.mouse.up();
      await page.keyboard.up(mod);
      const selected = await page.evaluate(() => document.querySelectorAll('svg.canvas g.node.selected').length);
      return { selected };
    },
  },
  {
    id: 'S6',
    name: 'Pie menu open, then click empty canvas',
    fixtures: BOTH,
    async setup(page, ctx) { ctx.node = await centralNode(page); },
    async run(page, { node }) {
      await openPie(page, node);
      // Found only now: opening the pie re-frames the camera on the node.
      const off = await bareSpot(page);
      await page.mouse.click(off.x, off.y);
      await page.locator('svg.canvas g.pie-menu').first().waitFor({ state: 'detached' });
      await waitForCameraSettled(page);
      return {};
    },
  },
  ...['lombardi', 'manhattan'].map((style) => ({
    id: `S7-${style}`,
    name: `Select a node, labels on, ${style} routing`,
    fixtures: BOTH,
    async setup(page, ctx) {
      await storeEval(page, (st, s) => {
        st.setRoutingStyle(s);
        if (!st.showConnectionNames) st.toggleShowConnectionNames();
      }, style);
      await nextFrames(page, 4);
      const info = await activeGraphInfo(page);
      ctx.node = await centralNode(page, (n) => (info.degree[n.id] || 0) > 0);
    },
    async run(page, { node }) {
      await openPie(page, node);
      return {};
    },
  })),
  {
    id: 'S8',
    name: 'Hover sweep, 10 edges and 10 nodes, 200 ms each',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      const edgeIds = await page.evaluate(() => [...new Set([...document.querySelectorAll('svg.canvas [data-edge-id]')].map((el) => el.getAttribute('data-edge-id')))]);
      const edgePts = [];
      for (const id of edgeIds) {
        if (edgePts.length >= 10) break;
        try { edgePts.push(await edgePoint(page, id)); } catch { /* not hoverable on screen */ }
      }
      const nodes = (await visibleNodes(page)).slice(0, 10).map((n) => ({ x: n.cx, y: n.cy }));
      ctx.points = [];
      for (let i = 0; i < 10; i++) {
        if (edgePts[i]) ctx.points.push(edgePts[i]);
        if (nodes[i]) ctx.points.push(nodes[i]);
      }
      ctx.rest = await bareSpot(page);
      await page.mouse.move(ctx.rest.x, ctx.rest.y);
    },
    async run(page, { points, rest }) {
      for (const p of points) { await page.mouse.move(p.x, p.y, { steps: 4 }); await page.waitForTimeout(200); }
      await page.mouse.move(rest.x, rest.y, { steps: 4 });
      return { targets: points.length };
    },
  },
  {
    id: 'S9',
    name: 'Right panel resizer, 300 px',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      await storeEval(page, (st) => st.setRightPanelExpanded(true));
      await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => {
        const cs = getComputedStyle(d);
        return cs.cursor === 'col-resize' && cs.zIndex === '10002' && cs.pointerEvents === 'auto' && cs.opacity === '1'
          && d.getBoundingClientRect().x > window.innerWidth / 2;
      }));
      await page.waitForTimeout(400); // the panel's slide-in
      ctx.from = await page.evaluate(() => {
        const bar = [...document.querySelectorAll('div')].find((d) => {
          const cs = getComputedStyle(d);
          return cs.cursor === 'col-resize' && cs.zIndex === '10002' && cs.pointerEvents === 'auto' && d.getBoundingClientRect().x > window.innerWidth / 2;
        });
        const r = bar.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    },
    async run(page, { from }) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await linearMove(page, from, { x: from.x - 300, y: from.y }, { steps: 60 });
      await page.mouse.up();
      return {};
    },
  },
  {
    id: 'S10a',
    name: '20 thumbnail writes, prototypes on the active graph',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      const info = await activeGraphInfo(page);
      ctx.ids = [...new Set(Object.values(info.protoOf))].slice(0, 20);
    },
    async run(page, { ids }) { await thumbnailBurst(page, ids); return { writes: ids.length }; },
  },
  {
    id: 'S10b',
    name: '20 thumbnail writes, prototypes not on the active graph',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      ctx.ids = await storeEval(page, (st) => {
        const onGraph = new Set([...st.graphs.get(st.activeGraphId).instances.values()].map((i) => i.prototypeId));
        return [...st.nodePrototypes.keys()].filter((id) => !onGraph.has(id)).slice(0, 20);
      });
    },
    async run(page, { ids }) { await thumbnailBurst(page, ids); return { writes: ids.length }; },
  },
  {
    id: 'S11',
    name: '10 updateGraph calls on a graph that is not active',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      ctx.graphId = await storeEval(page, (st) => [...st.graphs.keys()].find((id) => id !== st.activeGraphId));
    },
    async run(page, { graphId }) {
      await page.evaluate(async (gid) => {
        const st = window.useGraphStore.getState();
        for (let i = 0; i < 10; i++) {
          st.updateGraph(gid, (g) => { g.description = `perf ${i}`; });
          await new Promise(requestAnimationFrame);
        }
      }, graphId);
      return {};
    },
  },
  {
    id: 'S12',
    name: 'Carousel: open, 3 steps, close',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      const node = await centralNode(page);
      await openPie(page, node);
    },
    async run(page) {
      const layers = pieButton(page, 'layers');
      const b = await layers.boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.locator('[data-carousel-level]').first().waitFor();
      await waitForCameraSettled(page);
      const mid = await canvasCenter(page);
      await page.mouse.move(mid.x, mid.y);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(450); }
      await page.keyboard.press('Escape');
      await page.locator('[data-carousel-level]').first().waitFor({ state: 'detached' });
      return {};
    },
  },
  {
    id: 'S13',
    name: 'Hurtle into a definition graph from the pie menu',
    fixtures: MEDIUM,
    async setup(page, ctx) {
      const info = await activeGraphInfo(page);
      const node = await centralNode(page, (n) => info.hasDefinition[n.id]);
      ctx.fromGraph = info.graphId;
      await openPie(page, node);
    },
    async run(page, { fromGraph }) {
      const expand = pieButton(page, 'arrow-up-from-dot');
      const b = await expand.boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForFunction((g) => window.useGraphStore.getState().activeGraphId !== g, fromGraph, { timeout: 15_000 });
      await page.waitForFunction(() => document.querySelectorAll('svg.canvas g.node').length > 0);
      await waitForCameraSettled(page);
      return {};
    },
  },
];

