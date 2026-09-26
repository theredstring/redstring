/**
 * Connection create and delete animations, done entirely in the DOM so neither
 * the data model nor the edge renderers know about them (they only tag their
 * elements: `data-edge-id`, `data-edge-main`, `data-edge-hit`, and the
 * decorations `data-edge-label`, `data-arrow`, `data-edge-decor`).
 * EdgeTransitionLayer mounts them and owns the group they draw into.
 *
 *   - Handoff (create by drawing): the line the user drew morphs into the new
 *     connection. Its ends travel to the connection's ends, the straight line
 *     bends into the connection's curve, and its color blends into the
 *     connection's. The morph sits directly under the connection, which is
 *     hidden until the shapes match and then shown, its label and arrowheads
 *     fading in. Queued by the pointer handler on release; started in a layout
 *     effect once the connection is in the DOM, so the drawn line never
 *     disappears for a frame.
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
const TRACE_MS = 320;
const RETRACT_MS = 220;
// Wide enough to take in arrowheads and a label sitting on the line.
const MASK_WIDTH = 200;
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

/**
 * The visible stroke as a quadratic { s, c, e }, and whether that is exactly
 * its shape (a line or a Q curve) or only its end-to-end chord (a routed path).
 */
function mainGeometry(el) {
  const pt = (x, y) => ({ x, y });
  if (el.tagName === 'line') {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => Number(el.getAttribute(a)));
    return { s: pt(x1, y1), c: pt((x1 + x2) / 2, (y1 + y2) / 2), e: pt(x2, y2), exact: true };
  }
  const d = el.getAttribute('d') || '';
  const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  if (/^\s*M[^A-Za-z]*Q[^A-Za-z]*$/i.test(d) && nums.length === 6) {
    return { s: pt(nums[0], nums[1]), c: pt(nums[2], nums[3]), e: pt(nums[4], nums[5]), exact: true };
  }
  if (/^\s*M[^A-Za-z]*L[^A-Za-z]*$/i.test(d) && nums.length === 4) {
    return { s: pt(nums[0], nums[1]), c: pt((nums[0] + nums[2]) / 2, (nums[1] + nums[3]) / 2), e: pt(nums[2], nums[3]), exact: true };
  }
  try {
    const total = el.getTotalLength();
    const a = el.getPointAtLength(0);
    const b = el.getPointAtLength(total);
    return { s: pt(a.x, a.y), c: pt((a.x + b.x) / 2, (a.y + b.y) / 2), e: pt(b.x, b.y), exact: false };
  } catch {
    return null;
  }
}

function rgbOf(el) {
  const m = getComputedStyle(el).stroke.match(/[\d.]+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : [0, 0, 0];
}

function handoffEdge(host, wrapper, { from, to }) {
  const main = wrapper.querySelector('[data-edge-main]');
  const target = main && mainGeometry(main);
  if (!target) return;

  const fromCurve = { s: from, c: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, e: to };
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
    const p = k => `${lerp(fromCurve[k].x, target[k].x, t)} ${lerp(fromCurve[k].y, target[k].y, t)}`;
    morph.setAttribute('d', `M ${p('s')} Q ${p('c')} ${p('e')}`);
    const [r, g, b] = fromRgb.map((v, i) => Math.round(lerp(v, toRgb[i], t)));
    morph.setAttribute('stroke', `rgb(${r}, ${g}, ${b})`);
  }, () => {
    wrapper.style.opacity = '';
    fadeIn(decorationsOf(wrapper));
    if (target.exact) {
      // The connection's line is the morph's final shape: swap without a seam.
      morph.remove();
    } else {
      // Only the ends matched (a routed path): cross-fade the line itself.
      fadeIn([main]);
      morph.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DECOR_FADE_IN_MS, fill: 'forwards' })
        .onfinish = () => morph.remove();
    }
  });
}

function traceEdge(host, wrapper) {
  const spineD = spineOf(wrapper);
  if (!spineD) return;
  const decor = decorationsOf(wrapper);
  decor.forEach(el => { el.style.visibility = 'hidden'; });
  const mask = attachSpineMask(host, wrapper, spineD);
  animate(TRACE_MS, easeOutCubic,
    p => mask.setSpan(0, p),
    () => {
      mask.remove();
      decor.forEach(el => { el.style.visibility = ''; });
      fadeIn(decor);
    });
}

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

/** Mask `target` to a stretch of `spineD`; setSpan(a, b) takes fractions of its length. */
function attachSpineMask(host, target, spineD) {
  const id = `edge-transition-mask-${++maskSeq}`;
  const box = target.getBBox();
  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.setAttribute('id', id);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', box.x - MASK_WIDTH);
  mask.setAttribute('y', box.y - MASK_WIDTH);
  mask.setAttribute('width', box.width + 2 * MASK_WIDTH);
  mask.setAttribute('height', box.height + 2 * MASK_WIDTH);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', spineD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'white');
  path.setAttribute('stroke-width', MASK_WIDTH);
  path.setAttribute('stroke-linejoin', 'round');
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
  fadeOut(decorationsOf(ghost));
  const mask = attachSpineMask(host, ghost, spineD);
  animate(RETRACT_MS, easeInCubic,
    q => mask.setSpan(0.5 * q, 1 - 0.5 * q),
    () => { mask.remove(); ghost.remove(); });
}
