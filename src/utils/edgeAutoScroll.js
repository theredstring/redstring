/**
 * Edge auto-scroll for drags: hold a drag near the edge of a scroller and it
 * scrolls that way. Used by the header strip and the Open Webs list, where a
 * slot off-screen is otherwise unreachable (on touch there is no second pointer
 * to scroll with).
 *
 * Each edge's zone straddles it: a strip just inside, where the scroll starts
 * gently, and a reach past it, where it builds to full depth and stays there —
 * overshooting the edge never stops the scroll. A small inside strip keeps the
 * edge from being touchy; the reach past it is where travel happens.
 *
 * The scroll always starts from rest and rises at a limited rate to a modest
 * top speed — every time it starts moving in a direction, not just the first —
 * and drops back quickly when the pointer pulls out of the zone. How deep the
 * pointer sits only sets the speed it is rising toward, so a jittery finger
 * can't make it surge and stall. Time-based rather than per-frame, so a 120Hz
 * display scrolls no faster than a 60Hz one.
 */

export const EDGE_SCROLL_DEFAULTS = Object.freeze({
  /** Each edge's zone: px inside the edge, px of reach past it. */
  zones: Object.freeze({
    start: Object.freeze({ inside: 40, outside: 56 }),
    end: Object.freeze({ inside: 40, outside: 56 }),
  }),
  /** Top speed, at full depth, px/s. */
  maxSpeed: 300,
  /** How fast it rises toward that, px/s per second: ~1s from rest to top speed. */
  accel: 300,
  /** How fast it drops when the target falls or flips, px/s per second: ~0.12s to rest. */
  decel: 2500,
});

// A frame gap longer than this (a hidden tab, a GC pause) counts as this, so the
// scroller doesn't leap on the next frame.
const MAX_FRAME_MS = 64;

/**
 * The speed a pointer at `depth` asks for, px/s (unsigned).
 *
 * @param {number} depth - 0 at the zone's inner border to 1 at full reach.
 * @param {Object} [opts] - maxSpeed (EDGE_SCROLL_DEFAULTS).
 */
export function edgeScrollTargetSpeed(depth, opts = EDGE_SCROLL_DEFAULTS) {
  const { maxSpeed } = { ...EDGE_SCROLL_DEFAULTS, ...opts };
  const d = Math.max(0, Math.min(1, depth));
  // Eased in, so the inner part of the zone creeps and the edge itself travels.
  return maxSpeed * d * d * (3 - 2 * d);
}

/**
 * One frame of the scroll's velocity: it moves toward `target` (signed px/s),
 * rising no faster than `accel` and falling no faster than `decel`. Rising
 * means growing in the direction of travel; slowing, or turning round (which
 * passes through rest), is falling.
 *
 * @param {number} velocity - Current signed velocity, px/s.
 * @param {number} target - Signed velocity the pointer asks for, px/s.
 * @param {number} dtMs - Frame time.
 * @param {Object} [opts] - accel, decel (EDGE_SCROLL_DEFAULTS).
 * @returns {number} The new signed velocity.
 */
export function stepEdgeScrollVelocity(velocity, target, dtMs, opts = EDGE_SCROLL_DEFAULTS) {
  const { accel, decel } = { ...EDGE_SCROLL_DEFAULTS, ...opts };
  const dt = dtMs / 1000;
  const rising = Math.sign(target) !== 0
    && (velocity === 0 || Math.sign(velocity) === Math.sign(target))
    && Math.abs(target) > Math.abs(velocity);
  if (rising) {
    const next = velocity + Math.sign(target) * accel * dt;
    return Math.abs(next) > Math.abs(target) ? target : next;
  }
  // Falling: toward the target if it lies the same way, else toward rest first.
  const floor = Math.sign(target) === Math.sign(velocity) ? target : 0;
  const next = velocity - Math.sign(velocity) * decel * dt;
  return Math.sign(velocity) > 0 ? Math.max(floor, next) : Math.min(floor, next);
}

/**
 * Which way a pointer scrolls and how deep into the zone it is.
 *
 * The reach past an edge is cut short where the screen ends — a panel flush
 * with the bottom of the window has no room below it — so full depth is always
 * reachable, at worst at the screen edge itself.
 *
 * @param {number} pointer - Pointer position along the scroll axis.
 * @param {{lo: number, hi: number}} bounds - The scroller's visible span on that axis.
 * @param {{lo: number, hi: number}} screen - The window's span on that axis.
 * @param {Object} [zones] - As EDGE_SCROLL_DEFAULTS.zones.
 * @returns {{dir: -1|0|1, depth: number}}
 */
export function edgeScrollDepth(pointer, bounds, screen, zones = EDGE_SCROLL_DEFAULTS.zones) {
  const { start, end } = { ...EDGE_SCROLL_DEFAULTS.zones, ...zones };
  const startInner = bounds.lo + start.inside;
  if (pointer < startInner) {
    const span = start.inside + Math.max(0, Math.min(start.outside, bounds.lo - screen.lo));
    return { dir: -1, depth: span > 0 ? Math.min(1, (startInner - pointer) / span) : 1 };
  }
  const endInner = bounds.hi - end.inside;
  if (pointer > endInner) {
    const span = end.inside + Math.max(0, Math.min(end.outside, screen.hi - bounds.hi));
    return { dir: 1, depth: span > 0 ? Math.min(1, (pointer - endInner) / span) : 1 };
  }
  return { dir: 0, depth: 0 };
}

/**
 * A running edge scroller. Feed it the pointer with `update`; it keeps
 * scrolling between updates (touch sends none while the finger is still)
 * until `stop`.
 *
 * @param {Object} options
 * @param {() => HTMLElement|null} options.getElement - The scroller.
 * @param {'x'|'y'} options.axis
 * @param {() => {lo: number, hi: number}} [options.getBounds] - The scroller's
 *   visible span on the axis, when something covers part of it; defaults to its rect.
 * @param {(pointer: number) => void} [options.onScroll] - After each step that moved the scroller.
 * @param {() => void} [options.onStop] - On stop, only if this run scrolled at all.
 * @returns {{ update: (clientPos: number) => void, stop: () => void }}
 */
export function createEdgeAutoScroll({ getElement, axis, getBounds, onScroll, onStop, zones, ...speedOpts }) {
  let raf = null;
  let pointer = null;
  let lastTime = 0;
  let velocity = 0;
  // Distance owed but not yet applied: a slow scroll moves less than the
  // browser's scroll step per frame, so it banks until the step lands.
  let carry = 0;
  let scrolled = false;

  const frame = (now) => {
    const el = getElement();
    if (!el || pointer == null) { raf = null; return; }
    const dt = lastTime ? Math.min(MAX_FRAME_MS, now - lastTime) : 16;
    lastTime = now;

    let bounds = getBounds?.();
    if (!bounds) {
      const rect = el.getBoundingClientRect();
      bounds = axis === 'x' ? { lo: rect.left, hi: rect.right } : { lo: rect.top, hi: rect.bottom };
    }
    const screen = { lo: 0, hi: axis === 'x' ? window.innerWidth : window.innerHeight };
    const { dir, depth } = edgeScrollDepth(pointer, bounds, screen, zones);
    velocity = stepEdgeScrollVelocity(velocity, dir * edgeScrollTargetSpeed(depth, speedOpts), dt, speedOpts);
    if (velocity === 0) carry = 0;

    if (velocity !== 0) {
      carry += velocity * dt / 1000;
      const before = axis === 'x' ? el.scrollLeft : el.scrollTop;
      // Fractional, and the remainder kept from what actually moved: the
      // browser rounds to its own step (a device pixel, or a whole one), and
      // rounding here as well made slow scrolls stutter.
      if (axis === 'x') el.scrollLeft = before + carry; else el.scrollTop = before + carry;
      const after = axis === 'x' ? el.scrollLeft : el.scrollTop;
      const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      if (after !== before) {
        carry -= after - before;
        scrolled = true;
        onScroll?.(pointer);
      } else if ((velocity < 0 && after <= 0) || (velocity > 0 && after >= max - 1)) {
        // Against the end of the content: rest, so pulling back the other way
        // rises from nothing instead of from a banked speed.
        velocity = 0;
        carry = 0;
      }
    }
    raf = requestAnimationFrame(frame);
  };

  return {
    update(clientPos) {
      pointer = clientPos;
      if (!raf) { lastTime = 0; raf = requestAnimationFrame(frame); }
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      pointer = null;
      velocity = 0;
      carry = 0;
      const didScroll = scrolled;
      scrolled = false;
      if (didScroll) onStop?.();
    },
  };
}
