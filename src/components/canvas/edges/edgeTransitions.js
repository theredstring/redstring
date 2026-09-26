/**
 * Connection create and delete animations, done entirely in the DOM so neither
 * the data model nor renderConnectionEdge knows about them (it only tags its
 * elements: `data-edge-id`, `data-edge-main`, `data-edge-hit`).
 * EdgeTransitionLayer mounts them and owns the group they draw into.
 *
 *   - Handoff (create): the line the user drew morphs into the new connection.
 *     Its ends travel to the connection's ends, the straight line bends into
 *     the connection's curve, and its color blends into the connection's. The
 *     real connection is hidden until the shapes match, then fades in over the
 *     morph (bringing its arrowheads and label with it). Queued by the pointer
 *     handler on release; started in a layout effect once the connection is in
 *     the DOM, so the drawn line never disappears for a frame.
 *   - Retract (delete): a deleted connection closes from both ends into its
 *     middle. The store notifies subscribers before React commits, so the
 *     connection is still in the DOM: it is cloned and the clone is masked down
 *     to nothing, whatever did the deleting (pie, keyboard, undo, node delete).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HANDOFF_MS = 240;
const HANDOFF_FADE_MS = 120;
const RETRACT_MS = 220;
// Wide enough to take in arrowheads and a label sitting on the line.
const MASK_WIDTH = 200;
// More deletions than this at once (a wiped graph, a big undo) just vanish.
export const MAX_RETRACTS = 40;
const HANDOFF_QUEUE_TTL_MS = 1000;

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

export const pendingHandoffs = new Map();

/**
 * Morph the drawn line (canvas coords `from` → `to`, the point released on)
 * into connection `edgeId` when it first renders.
 */
export function queueEdgeHandoff(edgeId, from, to) {
  pendingHandoffs.set(edgeId, { from, to, at: performance.now() });
}

export function expireHandoffs(now) {
  for (const [edgeId, h] of pendingHandoffs) {
    if (now - h.at > HANDOFF_QUEUE_TTL_MS) pendingHandoffs.delete(edgeId);
  }
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

export function handoffEdge(host, wrapper, { from, to }) {
  const main = wrapper.querySelector('[data-edge-main]');
  const target = main && mainGeometry(main);
  if (!target) return;

  const fromCurve = { s: from, c: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, e: to };
  const fromRgb = [0, 0, 0]; // the drawn line is black (ConnectionDrawOverlay)
  const toRgb = rgbOf(main);

  const morph = document.createElementNS(SVG_NS, 'path');
  morph.setAttribute('fill', 'none');
  morph.setAttribute('stroke-width', main.getAttribute('stroke-width'));
  const cap = main.getAttribute('stroke-linecap');
  if (cap) morph.setAttribute('stroke-linecap', cap);
  host.appendChild(morph);

  wrapper.style.opacity = '0';
  animate(HANDOFF_MS, easeOutCubic, (t) => {
    const p = k => `${lerp(fromCurve[k].x, target[k].x, t)} ${lerp(fromCurve[k].y, target[k].y, t)}`;
    morph.setAttribute('d', `M ${p('s')} Q ${p('c')} ${p('e')}`);
    const [r, g, b] = fromRgb.map((v, i) => Math.round(lerp(v, toRgb[i], t)));
    morph.setAttribute('stroke', `rgb(${r}, ${g}, ${b})`);
  }, () => {
    // Shapes match now (or, for a routed path, the ends do): bring the real
    // connection in over the morph, then drop the morph.
    wrapper.style.transition = `opacity ${HANDOFF_FADE_MS}ms ease-out`;
    wrapper.style.opacity = '1';
    if (!target.exact) {
      morph.style.transition = `opacity ${HANDOFF_FADE_MS}ms ease-out`;
      morph.style.opacity = '0';
    }
    setTimeout(() => {
      morph.remove();
      wrapper.style.transition = '';
      wrapper.style.opacity = '';
    }, HANDOFF_FADE_MS + 20);
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
  ghost.style.transition = '';
  ghost.style.pointerEvents = 'none';
  ghost.querySelectorAll('[data-edge-hit]').forEach(n => n.remove());
  ghost.querySelectorAll('[data-edge-main]').forEach(n => n.removeAttribute('data-edge-main'));
  host.appendChild(ghost);
  const mask = attachSpineMask(host, ghost, spineD);
  animate(RETRACT_MS, easeInCubic,
    q => mask.setSpan(0.5 * q, 1 - 0.5 * q),
    () => { mask.remove(); ghost.remove(); });
}
