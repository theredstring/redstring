/**
 * One state for every scrollbar in the app (index.css): faint at rest, full
 * while its region is scrolling, while the pointer is on the bar, and while
 * the bar is held for a drag. The scroller carries data-rs-scrollbar="active"
 * then and "rest" after; a scroller never touched carries nothing and stays
 * faint.
 *
 * An attribute, not a class: React rewrites className whenever a component's
 * own class string changes, which would drop it mid-drag.
 */

const ATTR = 'data-rs-scrollbar';
// How long after the last scroll event a region still counts as scrolling.
const SCROLL_LINGER_MS = 800;
// Overlay scrollbars (macOS "show when scrolling") take no layout width, so
// the bar is taken to be at least this wide along the edge it sits on.
const MIN_BAR_PX = 16;

const states = new WeakMap();

const stateOf = (el) => {
  let s = states.get(el);
  if (!s) {
    s = { scrollTimer: null, hover: false, held: false };
    states.set(el, s);
  }
  return s;
};

const apply = (el) => {
  const s = stateOf(el);
  const next = (s.scrollTimer || s.hover || s.held) ? 'active' : 'rest';
  if (el.getAttribute(ATTR) !== next) el.setAttribute(ATTR, next);
};

const scrollsY = (el, cs) => el.scrollHeight > el.clientHeight
  && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
const scrollsX = (el, cs) => el.scrollWidth > el.clientWidth
  && (cs.overflowX === 'auto' || cs.overflowX === 'scroll');

/** Is (x, y) on one of `el`'s scrollbars? */
const isOnScrollbar = (el, x, y) => {
  const root = document.scrollingElement || document.documentElement;
  if (el === root) {
    const cs = getComputedStyle(root);
    if (cs.overflow === 'hidden' || cs.overflow === 'clip') return false;
    const barY = Math.max(window.innerWidth - root.clientWidth, MIN_BAR_PX);
    const barX = Math.max(window.innerHeight - root.clientHeight, MIN_BAR_PX);
    return (root.scrollHeight > root.clientHeight && x >= window.innerWidth - barY)
      || (root.scrollWidth > root.clientWidth && y >= window.innerHeight - barX);
  }
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const br = parseFloat(cs.borderRightWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const bb = parseFloat(cs.borderBottomWidth) || 0;
  if (scrollsY(el, cs)) {
    const bar = Math.max(el.offsetWidth - el.clientWidth - bl - br, MIN_BAR_PX);
    const right = r.right - br;
    if (x >= right - bar && x <= right) return true;
  }
  if (scrollsX(el, cs)) {
    const bar = Math.max(el.offsetHeight - el.clientHeight - bt - bb, MIN_BAR_PX);
    const bottom = r.bottom - bb;
    if (y >= bottom - bar && y <= bottom) return true;
  }
  return false;
};

/** The scroller whose bar is under (x, y), from `target` outward. */
const scrollerAt = (target, x, y) => {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (isOnScrollbar(el, x, y)) return el;
  }
  return null;
};

export function installScrollbarActivity() {
  if (typeof window === 'undefined' || window.__rsScrollbarActivity) return;
  window.__rsScrollbarActivity = true;

  let hovered = null;
  let held = null;

  const setHovered = (el) => {
    if (el === hovered) return;
    const prev = hovered;
    hovered = el;
    if (prev) { stateOf(prev).hover = false; apply(prev); }
    if (el) { stateOf(el).hover = true; apply(el); }
  };

  const release = () => {
    if (!held) return;
    const el = held;
    held = null;
    stateOf(el).held = false;
    apply(el);
  };

  document.addEventListener('scroll', (e) => {
    const el = e.target === document
      ? (document.scrollingElement || document.documentElement)
      : e.target;
    if (!(el instanceof Element)) return;
    const s = stateOf(el);
    if (s.scrollTimer) clearTimeout(s.scrollTimer);
    s.scrollTimer = setTimeout(() => { s.scrollTimer = null; apply(el); }, SCROLL_LINGER_MS);
    apply(el);
  }, { capture: true, passive: true });

  // Hover, read once a frame.
  let frame = 0;
  let last = null;
  document.addEventListener('mousemove', (e) => {
    // A release the page never heard (it can go to the scrollbar instead).
    if (held && !(e.buttons & 1)) release();
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      setHovered(scrollerAt(last.target, last.clientX, last.clientY));
    });
  }, { capture: true, passive: true });

  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) setHovered(null); // left the window
  }, { capture: true, passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const el = scrollerAt(e.target, e.clientX, e.clientY);
    if (!el) return;
    release();
    held = el;
    stateOf(el).held = true;
    apply(el);
  }, { capture: true, passive: true });

  window.addEventListener('pointerup', release, { capture: true, passive: true });
  window.addEventListener('mouseup', release, { capture: true, passive: true });
  window.addEventListener('blur', () => { release(); setHovered(null); });
}
