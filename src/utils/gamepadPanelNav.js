/**
 * gamepadPanelNav — the d-pad as a spatial navigator over the panels.
 *
 * WHY THIS REPLACED THE DISCOVERY WALKER. The first pass at panel support
 * found its rows by reading `cursor: pointer` off every element in the panel.
 * That was cheap and it was universal, and it was not rich enough to be worth
 * much: every clickable thing came back as one undifferentiated row, so a
 * section header, a node in a list and a close button were all "the next
 * thing down" and nothing could be done with any of them beyond clicking.
 *
 * So the panels now DECLARE what they are, with one `data-nav` attribute per
 * navigable element:
 *
 *   data-nav="tab"     a tab or view switcher
 *   data-nav="section" a collapsible section header
 *   data-nav="item"    a row/card in a list or grid
 *   data-nav="action"  a button
 *
 * The declaration is what makes the navigation rich rather than merely
 * possible. A section header knows it is a section, so left collapses it and
 * right opens it the way a tree does. An item knows it is an item, so a grid
 * of them can be crossed in two dimensions. And the attributes sit on a
 * handful of SHARED components — PanelIconButton, CollapsibleSection,
 * SavedNodeItem, GraphListItem, DraggableTab — so tagging them covered most of
 * both panels in a few lines rather than view by view.
 *
 * There is no mode. The d-pad addresses the panels and the sticks fly the
 * canvas, at the same time, always. Nothing has to be entered or left.
 *
 * Rows come from GEOMETRY, not from markup nesting: which items share a line
 * depends on the panel's width (the card grids are `repeat(auto-fill)`, and
 * the panel is user-resizable), and is not written down anywhere a navigator
 * could read it.
 */

import { FOCUS_CLASS } from './gamepadMenuNav.js';

export { FOCUS_CLASS };

/** The attribute panels use to declare a navigable element. */
export const NAV_ATTR = 'data-nav';
/** On a `section`, whether it is currently open. Drives left/right. */
export const NAV_EXPANDED_ATTR = 'data-nav-expanded';
/** The panel's own tab strip — see stepTab. */
export const TABSTRIP_ATTR = 'data-panel-tabstrip';
/** On a `tab`, whether it is the one currently showing. */
export const NAV_ACTIVE_ATTR = 'data-active';

export const PANEL_ROOTS = {
  left: '.panel-container.left',
  right: '.panel-container.right',
};

// Sub-pixel layout means elements on one visual row rarely share an exact top.
const ROW_TOLERANCE_PX = 6;
// How far to nudge a scroll container when the d-pad runs off the end of what
// is currently rendered. Roughly one item, so a held direction reads as
// scrolling rather than as jumping.
const SCROLL_STEP_PX = 64;

const visible = (el) => {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const fire = (el, type) => {
  if (!el) return;
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
};

/**
 * The nearest ancestor that can actually scroll in `axis`.
 *
 * Panels nest scrollers: the panel body scrolls, and inside it a virtualised
 * list has its own scroller with its own extent. Walking up from the focused
 * element finds whichever one the focused element actually lives in.
 */
const scrollParent = (el, root, axis = 'y') => {
  const overflowProp = axis === 'x' ? 'overflowX' : 'overflowY';
  let node = el?.parentElement;
  while (node && node !== root?.parentElement) {
    const style = window.getComputedStyle?.(node);
    const overflow = style?.[overflowProp];
    const extent = axis === 'x'
      ? node.scrollWidth > node.clientWidth + 1
      : node.scrollHeight > node.clientHeight + 1;
    if ((overflow === 'auto' || overflow === 'scroll') && extent) return node;
    node = node.parentElement;
  }
  return null;
};

/**
 * Every declared element in one panel, with the geometry needed to lay them
 * out in rows. DOM order is kept as the tiebreak so two elements that happen
 * to share a centre still have a stable order.
 */
/**
 * Step the panel's own tabs — the left panel's view icons, the right panel's
 * Home + open node tabs.
 *
 * Bound to the bumpers rather than to a walk up to the tab strip, because
 * switching tabs is the one panel action you want from anywhere in the panel:
 * a strip at the top that had to be walked to would put five presses between
 * you and the view next door. Stepping is done by CLICKING the neighbouring
 * tab, not by calling a store action, because the two sides hold their
 * selection in different places — the left panel's view is local component
 * state — and a click is the one instruction both of them already understand.
 *
 * @param {'left'|'right'} side
 * @param {-1|1} delta
 * @returns {boolean} whether a tab was actually stepped to
 */
export const stepTab = (side, delta) => {
  const root = document.querySelector(PANEL_ROOTS[side]);
  const strip = root?.querySelector(`[${TABSTRIP_ATTR}]`);
  if (!strip) return false;
  const tabs = Array.from(strip.querySelectorAll(`[${NAV_ATTR}="tab"]`)).filter(visible);
  if (tabs.length < 2) return false;
  // No tab marked active means the strip is mid-render; doing nothing is
  // better than stepping from a guessed origin.
  const at = tabs.findIndex(el => el.getAttribute(NAV_ACTIVE_ATTR) === 'true');
  if (at < 0) return false;
  const next = tabs[at + delta];
  if (!next) return false;
  // The right panel's strip scrolls horizontally, so the tab stepped onto is
  // routinely outside the visible run of it.
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  next.click?.();
  return true;
};

const collect = (side) => {
  const root = document.querySelector(PANEL_ROOTS[side]);
  if (!root) return { root: null, boxes: [] };
  const boxes = Array.from(root.querySelectorAll(`[${NAV_ATTR}]`))
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        el,
        kind: el.getAttribute(NAV_ATTR),
        top: r.top,
        cx: r.left + r.width / 2,
      };
    })
    .sort((a, b) => (Math.abs(a.top - b.top) <= ROW_TOLERANCE_PX ? a.cx - b.cx : a.top - b.top));
  return { root, boxes };
};

const sameRow = (boxes, top) => boxes.filter(b => Math.abs(b.top - top) <= ROW_TOLERANCE_PX);

/**
 * A single, session-long navigator. Focus is a place in the UI, not a mode: it
 * persists between presses, survives the panel re-rendering under it, and is
 * given up only when the user presses B or the thing it was on goes away.
 */
export const createPanelNavigator = () => {
  let side = null;
  let focused = null;

  const clearFocus = () => {
    if (!focused) return;
    focused.classList.remove(FOCUS_CLASS);
    // Panel rows apply their hover treatment in onMouseEnter handlers, so a
    // row left without a matching leave stays looking hovered forever.
    fire(focused, 'mouseout');
    fire(focused, 'mouseleave');
    focused = null;
  };

  const setFocus = (el, nextSide) => {
    if (!el) return false;
    if (el === focused) return true;
    clearFocus();
    focused = el;
    side = nextSide ?? side;
    focused.classList.add(FOCUS_CLASS);
    // Hovering is how these rows reveal their inline controls and their
    // labels, so the navigator hovers exactly as a mouse would.
    fire(focused, 'mouseenter');
    fire(focused, 'mouseover');
    focused.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  };

  /** Seat focus at the top of a panel, or at the row nearest a given y. */
  const seat = (nextSide, nearTop = null) => {
    const { boxes } = collect(nextSide);
    if (!boxes.length) return false;
    if (nearTop === null) return setFocus(boxes[0].el, nextSide);
    const best = boxes.reduce((a, b) => (
      Math.abs(b.top - nearTop) < Math.abs(a.top - nearTop) ? b : a
    ), boxes[0]);
    return setFocus(best.el, nextSide);
  };

  return {
    side: () => side,
    element: () => focused,
    kind: () => focused?.getAttribute(NAV_ATTR) ?? null,
    hasFocus: () => Boolean(focused && focused.isConnected),

    /**
     * Called every frame. A panel re-renders constantly — a tab switch throws
     * away its whole body — so the element focus was sitting on is routinely
     * replaced by an equivalent one. Rather than track identity across that,
     * focus re-seats at the same height in the same panel, which is where the
     * user was looking.
     */
    sync: () => {
      if (!focused) return;
      if (focused.isConnected && visible(focused)) return;
      const top = focused.getBoundingClientRect?.().top ?? null;
      const lost = side;
      clearFocus();
      if (lost) seat(lost, top);
    },

    clear: clearFocus,

    /** Put focus into a panel that has none. Returns false if it has no rows. */
    enter: (nextSide) => seat(nextSide),

    /**
     * Move one step.
     *
     * @returns {'moved'|'scrolled'|'edge'|'none'} 'edge' means the caller
     *   should consider handing off to a neighbouring region — there was
     *   nothing further in this panel in that direction. 'scrolled' means the
     *   list moved under the focus instead: more rows may exist on the next
     *   press, which is how virtualised lists are walked past their rendered
     *   window.
     */
    move: (dx, dy) => {
      if (!focused || !side) return 'none';
      const { root, boxes } = collect(side);
      if (!boxes.length) return 'none';
      const at = boxes.findIndex(b => b.el === focused);
      if (at < 0) return 'none';
      const cur = boxes[at];

      if (dx) {
        // A section header takes left/right as open/close, the way a tree
        // does. Only when the gesture would do nothing — closing what is
        // already closed — does it fall through to movement, so the same
        // press can still carry you out of a collapsed section.
        if (cur.kind === 'section') {
          const expanded = focused.getAttribute(NAV_EXPANDED_ATTR) === 'true';
          if ((dx < 0 && expanded) || (dx > 0 && !expanded)) {
            focused.click?.();
            return 'moved';
          }
        }
        const row = sameRow(boxes, cur.top);
        const idx = row.findIndex(b => b.el === focused);
        const next = row[idx + dx];
        if (next) return setFocus(next.el) ? 'moved' : 'none';
        // The right panel's tab strip scrolls sideways, so running out of row
        // is not the same as running out of tabs — the same distinction the
        // vertical branch makes for virtualised lists, for the same reason.
        const across = scrollParent(focused, root, 'x');
        if (across) {
          const room = dx > 0
            ? across.scrollWidth - across.clientWidth - across.scrollLeft
            : across.scrollLeft;
          if (room > 1) {
            across.scrollLeft += dx * Math.min(SCROLL_STEP_PX, room);
            return 'scrolled';
          }
        }
        return 'edge';
      }

      // Vertical: the nearest row on the requested side, then whichever
      // element in it is closest by centre-x — which is what makes a column
      // feel like a column even when the rows are ragged.
      const candidates = boxes.filter(b => (dy > 0
        ? b.top > cur.top + ROW_TOLERANCE_PX
        : b.top < cur.top - ROW_TOLERANCE_PX));
      if (candidates.length) {
        const nearestTop = candidates.reduce((best, b) => (
          Math.abs(b.top - cur.top) < Math.abs(best.top - cur.top) ? b : best
        ), candidates[0]).top;
        const row = sameRow(candidates, nearestTop);
        const best = row.reduce((bestBox, b) => (
          Math.abs(b.cx - cur.cx) < Math.abs(bestBox.cx - cur.cx) ? b : bestBox
        ), row[0]);
        return setFocus(best.el) ? 'moved' : 'none';
      }

      // Nothing rendered beyond this row — but "not rendered" is not "not
      // there". The saved-things grid is virtualised, so the rows below the
      // fold do not exist as DOM until its scroller has been moved. Scrolling
      // and letting the next press find them is what walks such a list.
      const scroller = scrollParent(focused, root);
      if (scroller) {
        const room = dy > 0
          ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
          : scroller.scrollTop;
        if (room > 1) {
          scroller.scrollTop += dy * Math.min(SCROLL_STEP_PX, room);
          return 'scrolled';
        }
      }
      return 'edge';
    },

    /**
     * Act on the focused element.
     *
     * A text field's activation is getting the caret, not being clicked — a
     * pad cannot type, so this hands the field to the keyboard, which is the
     * correct outcome rather than a shortfall.
     */
    activate: () => {
      if (!focused) return false;
      const tag = focused.tagName;
      if (tag === 'INPUT' && focused.type !== 'range') {
        focused.focus?.();
        focused.select?.();
        return true;
      }
      if (tag === 'TEXTAREA') { focused.focus?.(); return true; }
      focused.click?.();
      return true;
    },
  };
};

export default createPanelNavigator;
