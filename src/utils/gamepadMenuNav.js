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

const fire = (el, type) => {
  if (!el) return;
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
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

  // Header applies its hover treatment by writing inline styles in an
  // onMouseEnter handler, so leaving a row without a matching mouseleave
  // strands it looking hovered. Every focus change unhovers the row it left.
  const clearFocus = () => {
    if (!focused) return;
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
      if (focused) focused.click?.();
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
