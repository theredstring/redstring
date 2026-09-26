/**
 * Connection create and delete animations, done entirely in the DOM so neither
 * the data model nor the edge renderers know about them (they only tag their
 * elements: `data-edge-id`, `data-edge-main`, `data-edge-hit`, and the
 * decorations `data-edge-label`, `data-arrow`, `data-edge-decor`).
 * EdgeTransitionLayer mounts them and owns the group they draw into.
 *
 *   - Handoff (create by drawing): the line the user drew morphs into the new
 *     connection. Its ends travel to the connection's ends, the straight line
 *     bends into the connection's curve (a quadratic, or a Lombardi arc), and
 *     its color blends into the connection's. The morph sits directly under the connection, which is
 *     hidden until the shapes match and then shown, its label and arrowheads
 *     fading in. Queued by the pointer handler on release; started in a layout
 *     effect once the connection is in the DOM, so the drawn line never
 *     disappears for a frame.
 *   - Open (create by drawing, routed with right-angle bends): a bent route
 *     can't be morphed from a straight line, so it opens from its middle out
 *     to both ends — the retract run backwards.
 *   - Trace (create a self-loop): the loop draws itself around from one end,
 *     then its label and arrowheads fade in. Queued by the self-loop dialog.
 *   - Retract (delete): a deleted connection closes from both ends into its
 *     middle while its label and arrowheads fade out. The store notifies
 *     subscribers before React commits, so the connection is still in the DOM:
 *     it is cloned and the clone is masked down to nothing, whatever did the
 *     deleting (pie, keyboard, undo, node delete).
 *
 * Decorations fade rather than being masked: a mask front slicing across a
 * label reads as the label being cut, not the line moving.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDOFF_MS = 240;
const DECOR_FADE_IN_MS = 160;
const DECOR_FADE_OUT_MS = 90;
const OPEN_MS = 260;
const TRACE_MS = 320;
const RETRACT_MS = 220;
// More deletions than this at once (a wiped graph, a big undo) just vanish.
export const MAX_RETRACTS = 40;
const ENTRANCE_QUEUE_TTL_MS = 1000;

const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeInCubic = t => t ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function animate(ms, ease, frame, done) {
  const start = performance.now();
  frame(ease(0));
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    frame(ease(t));
    if (t < 1) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
}

export const findEdgeWrapper = (host, edgeId) =>
  host.parentNode?.querySelector(`[data-edge-id="${CSS.escape(edgeId)}"]`) ?? null;

// ─── Handoff ──────────────────────────────────────────────────────────────────

const DECOR_SELECTOR = '[data-edge-label], [data-arrow], [data-endpoint-dot], [data-edge-decor]';
const decorationsOf = root => root.querySelectorAll(DECOR_SELECTOR);

function fadeIn(els, ms = DECOR_FADE_IN_MS) {
  els.forEach(el => el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' }));
}

function fadeOut(els, ms = DECOR_FADE_OUT_MS) {
  els.forEach(el => el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' }));
}

/** Connections waiting to appear in the DOM: edgeId → { kind, ...args, at }. */
export const pendingEntrances = new Map();

/**
 * Morph the drawn line (canvas coords `from` → `to`, the point released on)
 * into connection `edgeId` when it first renders.
 */
export function queueEdgeHandoff(edgeId, from, to) {
  pendingEntrances.set(edgeId, { kind: 'handoff', from, to, at: performance.now() });
}

/** Draw connection `edgeId` (a self-loop) along its own path when it first renders. */
export function queueEdgeTrace(edgeId) {
  pendingEntrances.set(edgeId, { kind: 'trace', at: performance.now() });
}

export function expireEntrances(now) {
  for (const [edgeId, h] of pendingEntrances) {
    if (now - h.at > ENTRANCE_QUEUE_TTL_MS) pendingEntrances.delete(edgeId);
  }
}

export function playEntrance(host, wrapper, entrance) {
  if (entrance.kind === 'handoff') handoffEdge(host, wrapper, entrance);
  else if (entrance.kind === 'trace') traceEdge(host, wrapper);
}

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const pt = (x, y) => ({ x, y });

/**
 * The visible stroke's shape, in a form the drawn line can be tweened into:
 * `{ kind: 'quad', s, c, e }` for a line or a Q curve, `{ kind: 'arc', s, e,
 * h, sweep }` for a Lombardi arc (h: its sagitta, how far it bows from the
 * chord), or null for anything else (a routed path with bends).
 */
function mainGeometry(el) {
  if (el.tagName === 'line') {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => Number(el.getAttribute(a)));
    return { kind: 'quad', s: pt(x1, y1), c: pt((x1 + x2) / 2, (y1 + y2) / 2), e: pt(x2, y2) };
  }
  const d = el.getAttribute('d') || '';
  const cmds = d.replace(NUM, '').replace(/[\s,]/g, '').toUpperCase();
  const n = (d.match(NUM) || []).map(Number);
  if (cmds === 'MQ' && n.length === 6) {
    return { kind: 'quad', s: pt(n[0], n[1]), c: pt(n[2], n[3]), e: pt(n[4], n[5]) };
  }
  if (cmds === 'ML' && n.length === 4) {
    return { kind: 'quad', s: pt(n[0], n[1]), c: pt((n[0] + n[2]) / 2, (n[1] + n[3]) / 2), e: pt(n[2], n[3]) };
  }
  if (cmds === 'MA' && n.length === 9) {
    const [x0, y0, r, , , large, sweep, x1, y1] = n;
    const half = Math.hypot(x1 - x0, y1 - y0) / 2;
    const rise = Math.sqrt(Math.max(0, r * r - half * half));
    return { kind: 'arc', s: pt(x0, y0), e: pt(x1, y1), h: large ? r + rise : r - rise, sweep };
  }
  return null;
}

const lerpPt = (a, b, t) => `${lerp(a.x, b.x, t)} ${lerp(a.y, b.y, t)}`;

/** The path `t` of the way from the straight drawn line (from → to) to `target`. */
function morphPathAt(from, to, target, t) {
  const s = lerpPt(from, target.s, t);
  const e = lerpPt(to, target.e, t);
  if (target.kind === 'quad') {
    const mid = pt((from.x + to.x) / 2, (from.y + to.y) / 2);
    return `M ${s} Q ${lerpPt(mid, target.c, t)} ${e}`;
  }
  // Arc: grow the bow from nothing, keeping it on the same side. A radius
  // follows from chord and sagitta; past a semicircle it's the large arc.
  const h = target.h * t;
  const sx = lerp(from.x, target.s.x, t), sy = lerp(from.y, target.s.y, t);
  const ex = lerp(to.x, target.e.x, t), ey = lerp(to.y, target.e.y, t);
  const half = Math.hypot(ex - sx, ey - sy) / 2;
  if (h < 0.5 || half < 0.5) return `M ${s} L ${e}`;
  const r = (half * half + h * h) / (2 * h);
  return `M ${s} A ${r} ${r} 0 ${h > half ? 1 : 0} ${target.sweep} ${e}`;
}

function rgbOf(el) {
  const m = getComputedStyle(el).stroke.match(/[\d.]+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : [0, 0, 0];
}

function handoffEdge(host, wrapper, { from, to }) {
  const main = wrapper.querySelector('[data-edge-main]');
  if (!main) return;
  const target = mainGeometry(main);
  if (!target) {
    openEdge(host, wrapper);
    return;
  }

  const fromRgb = [0, 0, 0]; // the drawn line is black (ConnectionDrawOverlay)
  const toRgb = rgbOf(main);

  const morph = document.createElementNS(SVG_NS, 'path');
  morph.setAttribute('fill', 'none');
  morph.setAttribute('stroke-width', main.getAttribute('stroke-width'));
  morph.style.pointerEvents = 'none';
  const cap = main.getAttribute('stroke-linecap');
  if (cap) morph.setAttribute('stroke-linecap', cap);
  // Directly under the connection (same z, beneath its label), not in the
  // transitions group above every connection. React only ever inserts before
  // its own nodes and removes its own nodes, so a foreign sibling for a
  // quarter-second is safe.
  wrapper.parentNode.insertBefore(morph, wrapper);

  wrapper.style.opacity = '0';
  animate(HANDOFF_MS, easeOutCubic, (t) => {
    morph.setAttribute('d', morphPathAt(from, to, target, t));
    const [r, g, b] = fromRgb.map((v, i) => Math.round(lerp(v, toRgb[i], t)));
    morph.setAttribute('stroke', `rgb(${r}, ${g}, ${b})`);
  }, () => {
    // The morph has landed on the connection's own shape: swap without a seam.
    wrapper.style.opacity = '';
    morph.remove();
    fadeIn(decorationsOf(wrapper));
  });
}

/** Reveal the line along its spine by `spanAt(p)`, then fade its decorations in. */
function revealEdge(host, wrapper, ms, spanAt) {
  const spineD = spineOf(wrapper);
  if (!spineD) return;
  const decor = decorationsOf(wrapper);
  decor.forEach(el => { el.style.visibility = 'hidden'; });
  const mask = attachSpineMask(host, wrapper, spineD);
  animate(ms, easeOutCubic,
    p => mask.setSpan(...spanAt(p)),
    () => {
      mask.remove();
      decor.forEach(el => { el.style.visibility = ''; });
      fadeIn(decor);
    });
}

const openEdge = (host, wrapper) => revealEdge(host, wrapper, OPEN_MS, p => [0.5 - 0.5 * p, 0.5 + 0.5 * p]);

const traceEdge = (host, wrapper) => revealEdge(host, wrapper, TRACE_MS, p => [0, p]);

// ─── Retract ──────────────────────────────────────────────────────────────────

/** The connection's spine: its hit path, or for a self-loop, its first path. */
function spineOf(wrapper) {
  const el = wrapper.querySelector('[data-edge-hit]') || wrapper.querySelector('path:not([data-shell-clip])');
  if (!el) return null;
  if (el.tagName === 'line') {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => el.getAttribute(a));
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  return el.getAttribute('d');
}

let maskSeq = 0;

/**
 * Twice the widest visible stroke: covers the line and its hover/selection
 * glow, but no wider, so on a tight curve the mask can't reach across the bend
 * and uncover a stretch that should still be hidden. Decorations (labels,
 * arrowheads) aren't masked at all; they fade.
 */
function maskWidthFor(wrapper) {
  let w = 0;
  wrapper.querySelectorAll('path, line').forEach((el) => {
    if (el.getAttribute('stroke') === 'transparent' || el.closest(DECOR_SELECTOR)) return;
    w = Math.max(w, Number(el.getAttribute('stroke-width')) || 0);
  });
  return Math.max(24, 2 * w);
}

/** Mask `target` to a stretch of `spineD`; setSpan(a, b) takes fractions of its length. */
function attachSpineMask(host, target, spineD) {
  const id = `edge-transition-mask-${++maskSeq}`;
  const width = maskWidthFor(target);
  const box = target.getBBox();
  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.setAttribute('id', id);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', box.x - width);
  mask.setAttribute('y', box.y - width);
  mask.setAttribute('width', box.width + 2 * width);
  mask.setAttribute('height', box.height + 2 * width);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', spineD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'white');
  path.setAttribute('stroke-width', width);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('pathLength', '1');
  mask.appendChild(path);
  host.appendChild(mask);
  target.setAttribute('mask', `url(#${id})`);
  return {
    setSpan(a, b) {
      path.setAttribute('stroke-dasharray', `${Math.max(0, b - a)} 2`);
      path.setAttribute('stroke-dashoffset', `${-a}`);
    },
    remove: () => mask.remove(),
  };
}

export function retractEdge(host, wrapper) {
  const spineD = spineOf(wrapper);
  if (!spineD) return;
  const ghost = wrapper.cloneNode(true);
  ghost.removeAttribute('data-edge-id');
  ghost.style.opacity = '';
  ghost.style.pointerEvents = 'none';
  ghost.querySelectorAll('[data-edge-hit]').forEach(n => n.remove());
  ghost.querySelectorAll('[data-edge-main]').forEach(n => n.removeAttribute('data-edge-main'));
  host.appendChild(ghost);
  // The ghost stands in for the original from here. The original can outlive
  // its deletion by a render (the on-screen edge list lags the routing, so a
  // Lombardi connection comes back straight for a frame, its tangents already
  // gone): keep it hidden, and give it back only if it somehow survives.
  wrapper.style.visibility = 'hidden';
  fadeOut(decorationsOf(ghost));
  const mask = attachSpineMask(host, ghost, spineD);
  animate(RETRACT_MS, easeInCubic,
    q => mask.setSpan(0.5 * q, 1 - 0.5 * q),
    () => {
      mask.remove();
      ghost.remove();
      if (wrapper.isConnected) wrapper.style.visibility = '';
    });
}
