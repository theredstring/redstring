/**
 * gamepadMenuNav — a DOM focus walker for menus that were never built to be
 * keyboard-navigable.
 *
 * WHY THIS IS DOM-DRIVEN RATHER THAN DATA-DRIVEN. RedstringMenu and the header
 * action buttons are hand-written JSX: every row is a literal <div> with its
 * own onClick, submenus open on onMouseEnter, and there is no array of items
 * anywhere to iterate. Making them controller-navigable "properly" would mean
 * extracting a menu model and rewriting both components around it — a large,
 * risky refactor of working UI for one input device.
 *
 * So instead this walks the rendered DOM: it collects rows in document order,
 * moves a focus class between them, and synthesises the exact events the mouse
 * would have produced — `mouseenter` to open a submenu, `click` to activate.
 * The menus stay completely unaware that anything but a mouse is driving them.
 *
 * The trade is that this couples to class names rather than to props. That
 * coupling is declared in one place (SELECTORS below) so a rename has one place
 * to be fixed, and everything resolves lazily so the walker survives the menu
 * mounting, re-rendering or closing underneath it.
 */

import { pulseSlider, releaseSlider } from './sliderEngagement.js';

// The class used to show which row the controller is on. Styled in
// RedstringMenu.css and index.css alongside the mouse's own hover treatment.
export const FOCUS_CLASS = 'gamepad-menu-focus';

const SELECTORS = {
  menu: {
    // The Redstring (logo) menu. Top-level rows plus whatever submenu is open;
    // document order matches visual order closely enough to walk directly.
    root: '.menu-container',
    rows: '.menu-item, .submenu-item',
    // A row that opens a nested submenu rather than performing an action.
    parent: '.has-submenu',
    // Header owns `isMenuOpen` in local state with no external entry point, so
    // the walker opens the menu by clicking the logo — the same thing a mouse
    // would do — rather than reaching into that state.
    opener: '.header-logo-button',
  },
  // The unified selector and the node-selection grid. Both are GRIDS, so they
  // are walked in two dimensions (see moveGrid) rather than as a flat list.
  // Neither has an opener: they appear as the result of some other action, and
  // the controller takes them over as soon as they are on screen.
  selector: {
    // Deliberately `body`, not '.unified-selector-overlay'. That class is on
    // TWO elements — the backdrop and the content box — and querySelector
    // returns the first, which is the backdrop and holds no cards. Rooting
    // there found zero rows every time, which is why the selector appeared to
    // have no controller support at all.
    root: 'body',
    // The top dialog's controls as well as the grid's cards, so the walker can
    // reach the name field, the palette and the create button — not just the
    // list. Document order puts the dialog first, and moveGrid groups by
    // geometry, so the two read as one column of rows.
    rows: '.unified-selector-control, .unified-selector-card',
    parent: null,
    opener: null,
    grid: true,
    // The backdrop closes on a click whose target is itself, which is exactly
    // what element.click() produces. It is the first match, as above.
    closer: '.unified-selector-overlay',
    // Y opens the colour picker from here.
    palette: '.unified-selector-color-button',
  },
  nodeGrid: {
    root: '.node-selection-grid-container',
    rows: '.node-grid-item',
    parent: null,
    opener: null,
    grid: true,
    closer: null,
  },
  // The stuck-loading escape hatch ("Go to Universes" / "Reload"). A short
  // vertical list, not a grid. Scoped tightly to its own container because
  // `.panel-icon-button` is used all over the app — including by the settings
  // modal's option groups.
  loading: {
    root: '.canvas-loading-actions',
    rows: '.panel-icon-button',
    parent: null,
    opener: null,
    grid: false,
    closer: null,
  },
  // The colour picker, which sits ON TOP of the selector. Rows are its three
  // sliders plus the non-slider controls between them (the eyedropper, the hex
  // field) — up and down move between those levels, and left/right either
  // drives the focused slider or steps along a row of buttons.
  colorPicker: {
    root: '.color-picker-panel',
    rows: 'input[type="range"], input[type="text"], .panel-icon-button',
    parent: null,
    opener: null,
    grid: true,
    // The picker has no close control of its own. When it was opened from the
    // unified selector, the button that opened it toggles it shut, and routing
    // B and Y back to that button is both the cleanest close and the one that
    // leaves the selector underneath still open.
    //
    // Opened from anywhere else — a pie menu's palette, a panel swatch — that
    // button is not in the DOM at all, which is why B used to do nothing there.
    // The fallback is what a mouse does instead: click somewhere else. The
    // picker listens on the document for any click outside its own box, from
    // every one of its call sites, so this closes it wherever it came from.
    closer: '.unified-selector-color-button',
    closeAway: true,
    palette: '.unified-selector-color-button',
  },
  // The bottom control panel — the row of actions that appears for a selected
  // group, a node-group, or a multi-selection. Not a pie menu despite the class
  // name: it is one linear row, so it is stepped rather than aimed at.
  //
  // Its buttons raise the same label chip the pie menu's do, through their own
  // onMouseEnter — so the walker's synthesised hover gets the controller the
  // hover vision aid here for free, with nothing extra wired.
  bottomPanel: {
    root: '.unified-bottom-panel',
    rows: '.piemenu-button',
    parent: null,
    opener: null,
    grid: false,
    // Dismissal belongs to whoever owns the selection this panel is about, so
    // the pad clears that directly instead of clicking something here.
    closer: null,
  },
  actions: {
    // The header's action buttons. In wide layout these are inline in the
    // header bar and always mounted; below EXCLUSIVE_PANEL_MODE_THRESHOLD they
    // collapse into the hamburger column. One selector covers both — only the
    // opener differs, and clicking it is skipped when the buttons are already
    // on screen.
    root: 'body',
    rows: '.header-action-btn',
    parent: null,
    opener: '.header-hamburger-button',
  },
};

// A row that is in the DOM but collapsed (the hamburger column before it
// opens) must not be walked onto. Zero-size is the reliable tell; the columns
// animate in from scale/opacity but only occupy space once open.
const visible = (el) => {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

// No `view` on purpose: nothing downstream reads it, and passing it makes the
// constructor environment-dependent (it throws outright under jsdom). Bubbling
// and cancelable are all these synthetic hovers and clicks actually need.
const isRange = (el) => el && el.tagName === 'INPUT' && el.type === 'range';

/**
 * Write a value into a React-controlled input so React actually sees it.
 *
 * Assigning `el.value` directly is not enough: React caches the last value it
 * set on the node and treats an identical-looking assignment as a no-op, so its
 * onChange never fires and the slider snaps back on the next render. Going
 * through the prototype's native setter defeats that cache, which is the
 * standard way to drive a controlled input from outside React.
 */
const setNativeValue = (el, value) => {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  if (desc && desc.set) desc.set.call(el, String(value));
  else el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

const fire = (el, type) => {
  if (!el) return;
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
};

/**
 * Opens (if needed) and returns a walker over one of the known menus.
 *
 * Everything resolves lazily. The opener's click commits on a LATER React
 * frame, so the rows almost never exist at the moment this returns — a walker
 * that captured its root up front would come back empty, the caller would
 * refuse to change mode, and the menu would be left open with nothing driving
 * it. Instead the walker is always returned and finds its rows on whichever
 * later frame they appear; the caller drives that with `sync()`.
 *
 * @param {'menu'|'actions'} kind which surface to walk
 * @returns {null | {
 *   sync: () => void,
 *   move: (delta: number) => void,
 *   enter: () => void,
 *   back: () => void,
 *   activate: () => void,
 *   isAlive: () => boolean,
 *   dispose: () => void,
 * }}
 */
/**
 * Which modal-ish surface, if any, is currently on screen.
 *
 * These appear as a CONSEQUENCE of other things — Swap, node creation, node
 * typing, or a universe that failed to load — so the controller has to notice
 * them arriving rather than be told. Presence of a VISIBLE row is the test: the
 * overlay can exist mid-transition with nothing in it yet.
 *
 * The loading escape hatch is in here for a reason that is easy to miss: it is
 * one of the few screens with no canvas behind it, so it is exactly where a pad
 * user is most stuck if nothing takes over.
 *
 * @returns {'selector'|'nodeGrid'|'loading'|null}
 */
/**
 * Is a colour picker open on top of whatever else is up?
 *
 * Used for B's hierarchy: the innermost thing closes first, so B over an open
 * picker shuts the picker rather than the selector holding it.
 */
export const isColorPickerOpen = () => Boolean(document.querySelector('.color-picker-panel'));

export const detectOpenSelector = () => {
  for (const kind of ['selector', 'nodeGrid', 'loading']) {
    const config = SELECTORS[kind];
    const root = document.querySelector(config.root);
    if (root && Array.from(root.querySelectorAll(config.rows)).some(visible)) return kind;
  }
  return null;
};

export const walkMenu = (kind) => {
  const config = SELECTORS[kind];
  if (!config) return null;

  const getRoot = () => document.querySelector(config.root);
  const rows = () => {
    const root = getRoot();
    if (!root) return [];
    return Array.from(root.querySelectorAll(config.rows)).filter(visible);
  };

  // Open the surface if nothing is showing yet, by clicking whatever a mouse
  // would have clicked. Uses the visibility-filtered list so a collapsed
  // hamburger column (present in the DOM but zero-size) still counts as shut.
  let opened = false;
  if (rows().length === 0 && config.opener) {
    document.querySelector(config.opener)?.click?.();
    opened = true;
  }

  let index = 0;
  let focused = null;
  let disposed = false;
  // Sub-step remainder for analog slider drive. A stick barely off centre moves
  // the value by a fraction of a step each frame; without carrying that
  // remainder it rounds to zero every time and the slider simply never moves at
  // low deflection. Reset whenever focus lands somewhere else.
  let sliderCarry = 0;
  let sliderCarryEl = null;

  // Header applies its hover treatment by writing inline styles in an
  // onMouseEnter handler, so leaving a row without a matching mouseleave
  // strands it looking hovered. Every focus change unhovers the row it left.
  const clearFocus = () => {
    if (!focused) return;
    if (document.activeElement === focused) focused.blur?.();
    // Stepping off a slider ends any drive that was still pulsing on it, so a
    // released one can't be left lit behind the walker.
    releaseSlider(focused);
    focused.classList.remove(FOCUS_CLASS);
    fire(focused, 'mouseout');
    fire(focused, 'mouseleave');
    focused = null;
  };

  const applyFocus = () => {
    const list = rows();
    if (!list.length) { clearFocus(); return; }
    index = Math.max(0, Math.min(list.length - 1, index));
    const next = list[index];
    if (next === focused) return;
    clearFocus();
    focused = next;
    sliderCarry = 0;
    sliderCarryEl = null;
    focused.classList.add(FOCUS_CLASS);
    // Hovering is how these menus reveal their submenus and their labels, so
    // the walker hovers exactly as the mouse would.
    fire(focused, 'mouseenter');
    fire(focused, 'mouseover');
    focused.scrollIntoView?.({ block: 'nearest' });
  };

  applyFocus();

  return {
    // Called every frame. Picks up rows that appeared after the opener's click
    // committed, and re-seats focus if the surface re-rendered under us.
    sync: () => {
      if (disposed) return;
      if (!focused || !focused.isConnected) {
        focused = null;
        applyFocus();
      }
    },
    move: (delta) => {
      const list = rows();
      if (!list.length) return;
      // Wrap, so holding a direction cycles rather than sticking at the end.
      index = (index + delta + list.length) % list.length;
      applyFocus();
    },
    /**
     * Two-dimensional movement for grid surfaces.
     *
     * Rows are discovered from GEOMETRY, not from markup: the card grids use
     * `repeat(auto-fill, ...)`, so how many fit per row depends on the viewport
     * and is not written down anywhere a walker could read. Grouping by the
     * elements' actual top edge is the only description that stays true at
     * every width.
     *
     * Vertical moves keep the horizontal position, landing on whichever card in
     * the next row is nearest by centre-x, which is what makes a column feel
     * like a column even when rows are ragged.
     */
    moveGrid: (dx, dy) => {
      const list = rows();
      if (!list.length) return;
      const current = list[Math.max(0, Math.min(list.length - 1, index))];
      if (!current) return;

      const boxes = list.map(el => {
        const r = el.getBoundingClientRect();
        return { el, top: r.top, cx: r.left + r.width / 2 };
      });
      // Tolerance, not equality: sub-pixel layout means cards on one visual row
      // rarely share an exact top.
      const ROW_TOLERANCE_PX = 4;
      const cur = boxes[index];

      if (dx) {
        const inRow = boxes.filter(b => Math.abs(b.top - cur.top) <= ROW_TOLERANCE_PX)
          .sort((a, b) => a.cx - b.cx);
        const at = inRow.findIndex(b => b.el === current);
        const next = inRow[at + dx];
        if (next) index = boxes.indexOf(next);
      } else if (dy) {
        // Candidate rows on the requested side, nearest first.
        const candidates = boxes.filter(b => (dy > 0
          ? b.top > cur.top + ROW_TOLERANCE_PX
          : b.top < cur.top - ROW_TOLERANCE_PX));
        if (candidates.length) {
          const nearestTop = candidates.reduce((best, b) => (
            Math.abs(b.top - cur.top) < Math.abs(best.top - cur.top) ? b : best
          ), candidates[0]).top;
          const row = candidates.filter(b => Math.abs(b.top - nearestTop) <= ROW_TOLERANCE_PX);
          const best = row.reduce((bestEl, b) => (
            Math.abs(b.cx - cur.cx) < Math.abs(bestEl.cx - cur.cx) ? b : bestEl
          ), row[0]);
          index = boxes.indexOf(best);
        }
      }
      applyFocus();
    },
    /** True when the focused row is a slider, which makes left/right analog. */
    isSliderFocused: () => isRange(focused),
    /**
     * Drive the focused slider by a fraction of its full range.
     *
     * Analog rather than stepped: a slider's whole point is that it is
     * continuous, and stepping one notch per repeat-tick would make crossing a
     * 0-360 hue range take the better part of a minute.
     *
     * @param {number} fraction signed portion of (max - min) to move this frame
     * @returns {boolean} true if a slider consumed the input
     */
    nudgeSlider: (fraction) => {
      if (!isRange(focused)) return false;
      // Ring the handle for as long as the stick keeps arriving. Outside the
      // deadzone this is called every frame, so the mark stays up while you
      // drive and lets go shortly after you stop — a stick has no event for
      // "released this control". Raised even on a frame the carry rounds to
      // zero: you are pushing it, the value is simply still catching up.
      pulseSlider(focused);
      if (sliderCarryEl !== focused) { sliderCarryEl = focused; sliderCarry = 0; }
      const min = Number(focused.min || 0);
      const max = Number(focused.max === '' || focused.max == null ? 100 : focused.max);
      const step = Number(focused.step) || 1;
      sliderCarry += fraction * (max - min);
      // Only whole steps are applied; the rest is carried to the next frame.
      const whole = Math.trunc(sliderCarry / step) * step;
      if (whole === 0) return true;
      sliderCarry -= whole;
      const next = Math.max(min, Math.min(max, Number(focused.value) + whole));
      if (next !== Number(focused.value)) setNativeValue(focused, next);
      return true;
    },
    /**
     * Dismiss the surface the way a mouse would.
     *
     * A named closer is preferred where one exists, because clicking the exact
     * control a mouse would click keeps whatever is underneath untouched. The
     * click-away fallback is for surfaces whose only dismissal IS clicking off
     * them; it is dispatched on `document.body` so the target is demonstrably
     * outside the surface, which is the test those listeners apply.
     */
    close: () => {
      const closer = config.closer ? document.querySelector(config.closer) : null;
      if (closer) { closer.click?.(); return true; }
      if (config.closeAway) {
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    },
    /**
     * Toggle this surface's colour picker, if it has one. The same button both
     * opens and closes it (see handleColorPickerToggle), so one call serves as
     * both — which is what lets B close the picker without closing the selector
     * underneath it.
     */
    togglePalette: () => {
      if (!config.palette) return false;
      const btn = document.querySelector(config.palette);
      if (!btn) return false;
      btn.click?.();
      return true;
    },
    hasPalette: () => Boolean(config.palette && document.querySelector(config.palette)),
    isGrid: () => config.grid === true,
    enter: () => {
      // Only a submenu parent has anywhere to go; hovering it opened the
      // submenu already, so stepping forward lands on its first child.
      if (!focused || !config.parent || !focused.matches(config.parent)) return;
      const list = rows();
      const at = list.indexOf(focused);
      if (at >= 0 && at + 1 < list.length) {
        index = at + 1;
        applyFocus();
      }
    },
    back: () => {
      const list = rows();
      if (!list.length) return;
      index = Math.max(0, index - 1);
      applyFocus();
    },
    activate: () => {
      if (!focused) return;
      // A text field's "activation" is getting the caret, not being clicked —
      // the selector's name box and the picker's hex box are both things you
      // land on in order to type into. A real keypress afterwards hands control
      // back to the keyboard anyway, which is exactly right: a pad cannot type.
      const tag = focused.tagName;
      if (tag === 'INPUT' && focused.type !== 'range') {
        focused.focus?.();
        focused.select?.();
        return;
      }
      if (tag === 'TEXTAREA') { focused.focus?.(); return; }
      focused.click?.();
    },
    // Alive until disposed. The root is resolved lazily and `body` is always
    // present, so liveness is about this walker's own lifetime, not the DOM's —
    // the caller ends the mode explicitly with B / Start / Select.
    isAlive: () => !disposed,
    dispose: () => {
      disposed = true;
      clearFocus();
      // Leave the surface as we found it: if opening it was our doing, shut it.
      if (opened) document.querySelector(config.opener)?.click?.();
    },
  };
};

export default walkMenu;
