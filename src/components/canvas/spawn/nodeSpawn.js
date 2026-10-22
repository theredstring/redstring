/**
 * Many Things arriving at once (a paste, an import, anything that adds a
 * batch): each grows out of a point, the nearest first, and the connections
 * among them fade in as the last of them lands.
 *
 * Done in the DOM, like the connection entrances (edges/edgeTransitions.js):
 * the store changes at once and nothing else knows. The caller queues the ids
 * with the store write; NodeSpawnLayer plays them in the commit that first
 * draws them, before it paints, so they never show at full size first. A node
 * (`.node[data-instance-id]`) carries no transform of its own outside a drag,
 * so the animation's transform has the element to itself.
 *
 *   queueNodeSpawn({ instanceIds, edgeIds, origin })
 *
 * `origin` (canvas coords) is where they come from: the plus sign, the point
 * pasted at. Without it each grows from its own middle.
 */
import { prefersReducedMotion } from '../edges/edgeTransitions.js';

const GROW_MS = 340;
const EDGE_FADE_MS = 200;
// Between one Thing starting and the next; the whole stagger stays under
// STAGGER_TOTAL_MS however many there are.
const STAGGER_MS = 35;
const STAGGER_TOTAL_MS = 320;
// More than this at once just appear (a whole web loaded is not an entrance).
export const MAX_SPAWNS = 150;
// A queued id that never reaches the DOM (culled, undone) is dropped after this.
const QUEUE_TTL_MS = 1000;
const EASE_POP = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

/** Things waiting to be drawn: instanceId → { origin, delay, at }. */
export const pendingNodeSpawns = new Map();
/** Connections among them: edgeId → { delay, at }. */
export const pendingEdgeFades = new Map();

/**
 * Say these Things (and connections among them) were just added, so they come
 * in rather than appear. Call with the store write that adds them.
 */
export function queueNodeSpawn({ instanceIds = [], edgeIds = [], origin = null, positions = null } = {}) {
  if (!instanceIds.length || instanceIds.length > MAX_SPAWNS || prefersReducedMotion()) return;
  const at = performance.now();
  // Nearest the origin first, when there is one and their places are known.
  const order = origin && positions
    ? [...instanceIds].sort((a, b) => dist(positions.get(a), origin) - dist(positions.get(b), origin))
    : instanceIds;
  const step = Math.min(STAGGER_MS, STAGGER_TOTAL_MS / Math.max(1, order.length - 1));
  order.forEach((id, i) => pendingNodeSpawns.set(id, { origin, delay: i * step, at }));
  const last = (order.length - 1) * step + GROW_MS * 0.6;
  edgeIds.forEach(id => pendingEdgeFades.set(id, { delay: last, at }));
}

const dist = (p, o) => (p ? Math.hypot(p.x - o.x, p.y - o.y) : Infinity);

function expire(map, now) {
  for (const [id, entry] of map) if (now - entry.at > QUEUE_TTL_MS) map.delete(id);
}

/** Play every queued entrance whose element `root` now holds. */
export function playQueuedSpawns(root) {
  if (!root || (pendingNodeSpawns.size === 0 && pendingEdgeFades.size === 0)) return;
  for (const [id, entry] of pendingNodeSpawns) {
    const el = root.querySelector(`.node[data-instance-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    pendingNodeSpawns.delete(id);
    growNode(el, entry);
  }
  for (const [id, entry] of pendingEdgeFades) {
    const el = root.querySelector(`[data-edge-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    pendingEdgeFades.delete(id);
    el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: EDGE_FADE_MS, delay: entry.delay, easing: 'ease-out', fill: 'backwards',
    });
  }
  const now = performance.now();
  expire(pendingNodeSpawns, now);
  expire(pendingEdgeFades, now);
}

function growNode(el, { origin, delay }) {
  if (!el.animate) return;
  const box = el.getBBox?.();
  if (!box) return;
  // Grows about its own middle (in canvas px, as the drag lifts it), from the
  // origin to where it is.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = origin ? origin.x - cx : 0;
  const dy = origin ? origin.y - cy : 0;
  el.style.transformOrigin = `${cx}px ${cy}px`;
  const animation = el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(0)`, opacity: 0 },
    { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(0.5)`, opacity: 1, offset: 0.35 },
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
  ], { duration: GROW_MS, delay, easing: EASE_POP, fill: 'backwards' });
  // Pressed while still growing: it is where it lands now, so a drag that
  // starts here moves the Thing, not the animation.
  const settle = () => {
    el.removeEventListener('pointerdown', finishNow, true);
    // A drag writes its own transform and origin; leave those be.
    if (!el.style.transform) el.style.transformOrigin = '';
  };
  const finishNow = () => { animation.finish(); settle(); };
  el.addEventListener('pointerdown', finishNow, true);
  animation.onfinish = settle;
  animation.oncancel = settle;
}
