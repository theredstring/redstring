import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  walkMenu,
  detectOpenSelector,
  isColorPickerOpen,
  isContextMenuOpen,
  isEyedropperPicking,
  aimEyedropper,
  commitEyedropper,
  cancelEyedropper,
  FOCUS_CLASS,
} from '../../src/utils/gamepadMenuNav.js';

/**
 * The walker is DOM-coupled by design (see the header in gamepadMenuNav.js), so
 * these tests build the real markup shapes it has to survive rather than
 * mocking it away. The shapes are the whole risk: every bug this file has had
 * came from the markup not being what the selector assumed.
 */

// jsdom gives every element a zero-size rect, and the walker filters rows on
// visibility — so anything that should count as visible needs a size.
const sized = (el, rect = { top: 0, left: 0, width: 100, height: 40 }) => {
  el.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {},
  });
  return el;
};

const card = (id, rect) => {
  const el = document.createElement('div');
  el.className = 'unified-selector-card';
  el.dataset.id = id;
  return sized(el, rect);
};

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

/**
 * The real UnifiedSelector renders TWO elements carrying
 * `.unified-selector-overlay`: a backdrop, and the content box that actually
 * holds the cards. The backdrop comes first in the DOM.
 */
const mountSelector = (cardRects) => {
  const backdrop = document.createElement('div');
  backdrop.className = 'unified-selector-overlay';
  backdrop.dataset.role = 'backdrop';
  document.body.appendChild(sized(backdrop, { top: 0, left: 0, width: 1000, height: 800 }));

  const content = document.createElement('div');
  content.className = 'unified-selector-overlay';
  content.dataset.role = 'content';
  document.body.appendChild(sized(content, { top: 0, left: 0, width: 1000, height: 800 }));

  const cards = cardRects.map((rect, i) => {
    const el = card(`c${i}`, rect);
    content.appendChild(el);
    return el;
  });
  return { backdrop, content, cards };
};

describe('detectOpenSelector', () => {
  it('finds nothing on a bare page', () => {
    expect(detectOpenSelector()).toBeNull();
  });

  it('REGRESSION: finds the selector even though the backdrop shares its class', () => {
    // The bug: rooting at '.unified-selector-overlay' resolved to the BACKDROP,
    // which holds no cards, so the selector looked empty and got no controller
    // support at all.
    mountSelector([{ top: 0, left: 0, width: 100, height: 40 }]);
    expect(document.querySelectorAll('.unified-selector-overlay').length).toBe(2);
    expect(detectOpenSelector()).toBe('selector');
  });

  it('ignores an overlay that has no visible rows yet', () => {
    // Mid-transition: the overlay is mounted but empty.
    const backdrop = document.createElement('div');
    backdrop.className = 'unified-selector-overlay';
    document.body.appendChild(sized(backdrop));
    expect(detectOpenSelector()).toBeNull();
  });

  it('finds the loading escape hatch', () => {
    const root = document.createElement('div');
    root.className = 'canvas-loading-actions';
    for (const label of ['Go to Universes', 'Reload']) {
      const b = document.createElement('div');
      b.className = 'panel-icon-button';
      b.textContent = label;
      root.appendChild(sized(b));
    }
    document.body.appendChild(root);
    expect(detectOpenSelector()).toBe('loading');
  });

  it('does not mistake unrelated panel-icon-buttons for the loading screen', () => {
    // `.panel-icon-button` is used all over the app, including by the settings
    // modal's option groups — the container class is what scopes it.
    const stray = document.createElement('div');
    stray.className = 'panel-icon-button';
    document.body.appendChild(sized(stray));
    expect(detectOpenSelector()).toBeNull();
  });
});

describe('walkMenu — selector grid', () => {
  // A 3-wide grid over two rows.
  const GRID = [
    { top: 0, left: 0, width: 90, height: 40 },
    { top: 0, left: 100, width: 90, height: 40 },
    { top: 0, left: 200, width: 90, height: 40 },
    { top: 50, left: 0, width: 90, height: 40 },
    { top: 50, left: 100, width: 90, height: 40 },
  ];

  const focusedId = () => document.querySelector(`.${FOCUS_CLASS}`)?.dataset.id ?? null;

  it('focuses the first card on open', () => {
    mountSelector(GRID);
    walkMenu('selector');
    expect(focusedId()).toBe('c0');
  });

  it('walks a row horizontally', () => {
    mountSelector(GRID);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    expect(focusedId()).toBe('c1');
    w.moveGrid(-1, 0);
    expect(focusedId()).toBe('c0');
  });

  it('stops at the end of a row rather than wrapping into the next', () => {
    mountSelector(GRID);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    w.moveGrid(1, 0);
    expect(focusedId()).toBe('c2');
    w.moveGrid(1, 0);
    expect(focusedId()).toBe('c2');
  });

  it('keeps its column when changing row', () => {
    mountSelector(GRID);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);        // c1, second column
    w.moveGrid(0, 1);        // down a row
    expect(focusedId()).toBe('c4'); // second column of row two, not its first
  });

  it('lands on the nearest column when the next row is shorter', () => {
    mountSelector(GRID);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    w.moveGrid(1, 0);        // c2, third column
    w.moveGrid(0, 1);        // row two has only two columns
    expect(focusedId()).toBe('c4');
  });

  it('activates by clicking the focused card', () => {
    const { cards } = mountSelector(GRID);
    const onClick = vi.fn();
    cards[1].addEventListener('click', onClick);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    w.activate();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('closes by clicking the backdrop, which is what dismisses it', () => {
    const { backdrop } = mountSelector(GRID);
    const onClick = vi.fn();
    backdrop.addEventListener('click', onClick);
    walkMenu('selector').close();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('moves focus with matching mouseenter/mouseleave so hover styling follows', () => {
    // Header and the selector cards both apply hover by writing inline styles
    // in an onMouseEnter handler; a move without a matching leave strands the
    // old row looking hovered.
    const { cards } = mountSelector(GRID);
    const enters = [];
    const leaves = [];
    cards.forEach((c, i) => {
      c.addEventListener('mouseenter', () => enters.push(i));
      c.addEventListener('mouseleave', () => leaves.push(i));
    });
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    expect(enters).toEqual([0, 1]);
    expect(leaves).toEqual([0]);
  });

  it('only one card carries the focus class at a time', () => {
    mountSelector(GRID);
    const w = walkMenu('selector');
    w.moveGrid(1, 0);
    w.moveGrid(0, 1);
    expect(document.querySelectorAll(`.${FOCUS_CLASS}`).length).toBe(1);
  });
});

describe('walkMenu — palette hierarchy', () => {
  it('reports and toggles the colour button when the selector has one', () => {
    mountSelector([{ top: 0, left: 0, width: 90, height: 40 }]);
    const btn = document.createElement('button');
    btn.className = 'unified-selector-color-button';
    const onClick = vi.fn();
    btn.addEventListener('click', onClick);
    document.body.appendChild(sized(btn));

    const w = walkMenu('selector');
    expect(w.hasPalette()).toBe(true);
    expect(w.togglePalette()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reports no palette when the button is absent', () => {
    mountSelector([{ top: 0, left: 0, width: 90, height: 40 }]);
    const w = walkMenu('selector');
    expect(w.hasPalette()).toBe(false);
    expect(w.togglePalette()).toBe(false);
  });
});

describe('isColorPickerOpen', () => {
  it('is false with no picker mounted', () => {
    expect(isColorPickerOpen()).toBe(false);
  });

  it('is true once the picker panel is on screen', () => {
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    document.body.appendChild(panel);
    expect(isColorPickerOpen()).toBe(true);
  });
});

describe('walkMenu — sliders', () => {
  const mountPicker = () => {
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    document.body.appendChild(sized(panel, { top: 0, left: 0, width: 300, height: 400 }));

    const hue = document.createElement('input');
    hue.type = 'range';
    hue.min = '0'; hue.max = '360'; hue.step = '1'; hue.value = '180';
    panel.appendChild(sized(hue, { top: 100, left: 0, width: 280, height: 20 }));

    const sat = document.createElement('input');
    sat.type = 'range';
    sat.min = '0'; sat.max = '100'; sat.step = '1'; sat.value = '50';
    panel.appendChild(sized(sat, { top: 150, left: 0, width: 280, height: 20 }));

    const hex = document.createElement('input');
    hex.type = 'text';
    panel.appendChild(sized(hex, { top: 200, left: 0, width: 280, height: 30 }));

    return { panel, hue, sat, hex };
  };

  it('reports whether the focused row is a slider', () => {
    const { hue } = mountPicker();
    const w = walkMenu('colorPicker');
    expect(w.isSliderFocused()).toBe(true);
    w.moveGrid(0, 1);
    w.moveGrid(0, 1);
    expect(w.isSliderFocused()).toBe(false); // the hex field
  });

  it('drives the focused slider and fires a React-visible change', () => {
    const { hue } = mountPicker();
    const onInput = vi.fn();
    hue.addEventListener('input', onInput);
    const w = walkMenu('colorPicker');
    w.nudgeSlider(0.1); // a tenth of 0-360
    expect(Number(hue.value)).toBe(216);
    expect(onInput).toHaveBeenCalled();
  });

  it('moves in both directions and clamps to the ends', () => {
    const { hue } = mountPicker();
    const w = walkMenu('colorPicker');
    w.nudgeSlider(-0.1);
    expect(Number(hue.value)).toBe(144);
    w.nudgeSlider(-10);
    expect(Number(hue.value)).toBe(0);
    w.nudgeSlider(10);
    expect(Number(hue.value)).toBe(360);
  });

  it('carries sub-step remainders so small deflections still move', () => {
    // The reason nudgeSlider keeps a carry: a fraction that rounds to zero on
    // its own would otherwise make a barely-tilted stick do nothing at all,
    // forever.
    const { sat } = mountPicker();  // range 0-100, step 1
    const w = walkMenu('colorPicker');
    w.moveGrid(0, 1); // focus saturation
    const tiny = 0.004; // 0.4 of a step per call
    for (let i = 0; i < 2; i++) w.nudgeSlider(tiny);
    expect(Number(sat.value)).toBe(50); // not yet a whole step
    w.nudgeSlider(tiny);
    expect(Number(sat.value)).toBe(51); // the carry crossed one
  });

  it('drops the carry when focus moves to another slider', () => {
    const { hue, sat } = mountPicker();
    const w = walkMenu('colorPicker');
    w.nudgeSlider(0.002);   // builds a partial step on hue
    w.moveGrid(0, 1);       // focus saturation
    w.nudgeSlider(0.002);   // must not inherit hue's remainder
    expect(Number(sat.value)).toBe(50);
    expect(Number(hue.value)).toBe(180);
  });

  it('refuses to drive a non-slider row', () => {
    const { hex } = mountPicker();
    const w = walkMenu('colorPicker');
    w.moveGrid(0, 1);
    w.moveGrid(0, 1);
    expect(w.nudgeSlider(0.5)).toBe(false);
    expect(hex.value).toBe('');
  });

  it('closes through the button that opened it', () => {
    mountPicker();
    const btn = document.createElement('button');
    btn.className = 'unified-selector-color-button';
    const onClick = vi.fn();
    btn.addEventListener('click', onClick);
    document.body.appendChild(sized(btn));
    walkMenu('colorPicker').close();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * The eyedropper. These assert against the listeners the real ColorPicker
 * attaches while it is armed — window-capture pointer handlers and a
 * window-capture Escape — because that is the whole contract: the pad has to
 * produce events those handlers accept, and must not produce ones the rest of
 * the app also acts on.
 */
describe('eyedropper', () => {
  const armPicker = () => {
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    panel.dataset.picking = 'true';
    document.body.appendChild(sized(panel, { top: 0, left: 0, width: 300, height: 400 }));
    return panel;
  };

  // The picker's own listeners: capture on window, and every pointer event
  // swallowed so nothing underneath sees the press that was only a sample.
  const listen = (types) => {
    const seen = [];
    const handler = (e) => {
      seen.push({ type: e.type, key: e.key, x: e.clientX, y: e.clientY });
      e.preventDefault();
      e.stopPropagation();
    };
    types.forEach(t => window.addEventListener(t, handler, true));
    return {
      seen,
      stop: () => types.forEach(t => window.removeEventListener(t, handler, true)),
    };
  };

  it('is armed only while the picker says it is', () => {
    expect(isEyedropperPicking()).toBe(false);
    const panel = armPicker();
    expect(isEyedropperPicking()).toBe(true);
    delete panel.dataset.picking;
    expect(isEyedropperPicking()).toBe(false);
  });

  it('moves the sample point with a pointer move at the given point', () => {
    armPicker();
    const l = listen(['pointermove']);
    expect(aimEyedropper(120, 340)).toBe(true);
    l.stop();
    expect(l.seen).toEqual([{ type: 'pointermove', key: undefined, x: 120, y: 340 }]);
  });

  it('commits with a press and a release, which is what the picker samples on', () => {
    armPicker();
    const l = listen(['pointerdown', 'pointerup']);
    expect(commitEyedropper(10, 20)).toBe(true);
    l.stop();
    expect(l.seen.map(e => e.type)).toEqual(['pointerdown', 'pointerup']);
    expect(l.seen.every(e => e.x === 10 && e.y === 20)).toBe(true);
  });

  it('does nothing at all once the eyedropper is disarmed', () => {
    const l = listen(['pointermove', 'pointerdown', 'pointerup']);
    expect(aimEyedropper(1, 2)).toBe(false);
    expect(commitEyedropper(1, 2)).toBe(false);
    expect(cancelEyedropper()).toBe(false);
    l.stop();
    expect(l.seen).toEqual([]);
  });

  it('cancels with an Escape the picker can see', () => {
    armPicker();
    const l = listen(['keydown']);
    expect(cancelEyedropper()).toBe(true);
    l.stop();
    expect(l.seen.map(e => e.key)).toEqual(['Escape']);
  });

  /**
   * The reason cancel is dispatched on the panel and not on window. The app's
   * other Escape handlers are bubble-phase listeners on window; with the panel
   * as the target, the picker's capture handler stops the event before the
   * bubble phase exists, and they never run. Targeting window instead would put
   * every one of them AT the target, and Escape would clear the selection
   * behind the picker on the way out of a pick.
   */
  it('keeps Escape away from the app-wide handlers behind the picker', () => {
    armPicker();
    const capture = listen(['keydown']); // stands in for the picker's own
    const appWide = vi.fn();
    window.addEventListener('keydown', appWide);

    cancelEyedropper();

    window.removeEventListener('keydown', appWide);
    capture.stop();
    expect(capture.seen.map(e => e.key)).toEqual(['Escape']);
    expect(appWide).not.toHaveBeenCalled();
  });
});

describe('selector rows include the top dialog', () => {
  it('walks the dialog controls as well as the grid cards', () => {
    const { content } = mountSelector([]);
    const input = document.createElement('input');
    input.className = 'unified-selector-control';
    input.dataset.id = 'name';
    content.appendChild(sized(input, { top: 0, left: 0, width: 200, height: 30 }));

    const c = card('card0', { top: 100, left: 0, width: 90, height: 40 });
    content.appendChild(c);

    const w = walkMenu('selector');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.id).toBe('name');
    w.moveGrid(0, 1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.id).toBe('card0');
  });
});

describe('walkMenu — activating a text field', () => {
  it('focuses and selects a text input rather than clicking it', () => {
    const { content } = mountSelector([]);
    const input = document.createElement('input');
    input.className = 'unified-selector-control';
    input.type = 'text';
    input.value = 'Thing';
    const onClick = vi.fn();
    input.addEventListener('click', onClick);
    content.appendChild(sized(input, { top: 0, left: 0, width: 200, height: 30 }));

    walkMenu('selector').activate();
    expect(document.activeElement).toBe(input);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('blurs the field when focus moves off it', () => {
    // Otherwise a stray keypress lands in a box the user has visibly left — and
    // any onBlur commit (the picker's hex field has one) never fires.
    const { content } = mountSelector([]);
    const input = document.createElement('input');
    input.className = 'unified-selector-control';
    input.type = 'text';
    content.appendChild(sized(input, { top: 0, left: 0, width: 200, height: 30 }));
    const c = card('card0', { top: 100, left: 0, width: 90, height: 40 });
    content.appendChild(c);

    const w = walkMenu('selector');
    w.activate();
    expect(document.activeElement).toBe(input);
    w.moveGrid(0, 1);
    expect(document.activeElement).not.toBe(input);
  });

  it('still clicks a button row', () => {
    const { content } = mountSelector([]);
    const btn = document.createElement('button');
    btn.className = 'unified-selector-control';
    const onClick = vi.fn();
    btn.addEventListener('click', onClick);
    content.appendChild(sized(btn, { top: 0, left: 0, width: 40, height: 40 }));

    walkMenu('selector').activate();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * A colour picker can be opened from the unified selector, from a pie menu's
 * palette, or from a swatch in a panel. Only the first of those puts a button
 * in the DOM that toggles it shut, which is why B used to do nothing in the
 * other two.
 */
describe('walkMenu — closing a colour picker from anywhere', () => {
  const mountPicker = () => {
    const panel = document.createElement('div');
    panel.className = 'color-picker-panel';
    document.body.appendChild(panel);
    return panel;
  };

  it('prefers the button that opened it, leaving the selector underneath alone', () => {
    mountPicker();
    const opener = document.createElement('button');
    opener.className = 'unified-selector-color-button';
    const openerClicks = vi.fn();
    opener.addEventListener('click', openerClicks);
    document.body.appendChild(sized(opener, { top: 0, left: 0, width: 30, height: 30 }));

    const away = vi.fn();
    document.addEventListener('click', away);
    walkMenu('colorPicker').close();
    document.removeEventListener('click', away);

    expect(openerClicks).toHaveBeenCalledTimes(1);
  });

  it('clicks away when there is no such button — a picker from a pie menu or a panel', () => {
    mountPicker();
    // The picker's own dismissal is a document-level click listener that fires
    // whenever the target is outside its box.
    const outsideClicks = [];
    const listener = (e) => outsideClicks.push(e.target);
    document.addEventListener('click', listener);

    expect(walkMenu('colorPicker').close()).toBe(true);
    document.removeEventListener('click', listener);

    expect(outsideClicks).toContain(document.body);
  });

  it('reports nothing to do for a surface with no dismissal at all', () => {
    const grid = document.createElement('div');
    grid.className = 'node-selection-grid-container';
    document.body.appendChild(grid);
    expect(walkMenu('nodeGrid').close()).toBe(false);
  });
});

/**
 * The bottom control panel is the surface a selected group, a node-group, and
 * a multi-selection all raise. Its buttons carry their own onMouseEnter that
 * raises the same label chip the canvas pie menu uses, so the walker's
 * synthesised hover gets the controller that vision aid with nothing extra
 * wired — which is what these pin down.
 */
describe('walkMenu — the bottom control panel', () => {
  const mountPanel = (labels) => {
    const panel = document.createElement('div');
    panel.className = 'unified-bottom-panel';
    document.body.appendChild(panel);
    const hovered = [];
    const clicked = [];
    labels.forEach((label, i) => {
      const btn = document.createElement('div');
      btn.className = 'piemenu-button';
      btn.dataset.label = label;
      btn.addEventListener('mouseenter', () => hovered.push(label));
      btn.addEventListener('click', () => clicked.push(label));
      panel.appendChild(sized(btn, { top: 0, left: i * 50, width: 44, height: 44 }));
    });
    return { panel, hovered, clicked };
  };

  it('steps the row and activates the focused action', () => {
    const { clicked } = mountPanel(['Group Selection', 'Copy', 'Delete']);
    const w = walkMenu('bottomPanel');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Group Selection');
    w.move(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Copy');
    w.activate();
    expect(clicked).toEqual(['Copy']);
  });

  it('raises each button label chip on the way past', () => {
    const { hovered } = mountPanel(['Ungroup', 'Edit', 'Color']);
    const w = walkMenu('bottomPanel');
    w.move(1);
    w.move(1);
    expect(hovered).toEqual(['Ungroup', 'Edit', 'Color']);
  });

  /**
   * The panel re-renders constantly — every selection change rebuilds its
   * button row — so the walker has to find its rows on whichever later frame
   * they appear rather than capturing them when it was built.
   */
  it('picks up buttons that mount after it was created', () => {
    const panel = document.createElement('div');
    panel.className = 'unified-bottom-panel';
    document.body.appendChild(panel);

    const w = walkMenu('bottomPanel');
    expect(document.querySelector(`.${FOCUS_CLASS}`)).toBeNull();

    const btn = document.createElement('div');
    btn.className = 'piemenu-button';
    btn.dataset.label = 'late';
    panel.appendChild(sized(btn, { top: 0, left: 0, width: 44, height: 44 }));
    w.sync();
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('late');
  });

  it('has no dismissal of its own — the selection owns that', () => {
    mountPanel(['Copy']);
    expect(walkMenu('bottomPanel').close()).toBe(false);
  });
});

/**
 * The canvas context menu — the right-click menu, which the pad raises with a
 * tap of the left trigger on empty canvas. Its markup is ContextMenu.jsx: a
 * backdrop, then a box of rows, with disabled rows carrying data-disabled.
 */
const mountContextMenu = (labels) => {
  const backdrop = document.createElement('div');
  backdrop.className = 'context-menu-backdrop';
  document.body.appendChild(sized(backdrop, { top: 0, left: 0, width: 1000, height: 800 }));

  const box = document.createElement('div');
  document.body.appendChild(box);

  const rows = labels.map((entry, i) => {
    const label = typeof entry === 'string' ? entry : entry.label;
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.dataset.label = label;
    if (typeof entry !== 'string' && entry.disabled) el.dataset.disabled = 'true';
    box.appendChild(sized(el, { top: i * 32, left: 0, width: 160, height: 32 }));
    return el;
  });
  return { backdrop, rows };
};

describe('context menu walker', () => {
  it('is not open on a bare page', () => {
    expect(isContextMenuOpen()).toBe(false);
  });

  it('is open once rows are mounted', () => {
    mountContextMenu(['Auto Layout Web']);
    expect(isContextMenuOpen()).toBe(true);
  });

  it('lands on the first row and steps down it', () => {
    mountContextMenu(['Auto Layout Web', 'Snap to Grid', 'Merge Duplicates']);
    const w = walkMenu('context');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Auto Layout Web');
    w.move(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Snap to Grid');
    w.move(-1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Auto Layout Web');
  });

  /**
   * A pad has no way to show that pressing A on a row will do nothing, so a
   * disabled row must not be somewhere the stick can come to rest at all.
   */
  it('skips disabled rows entirely', () => {
    mountContextMenu([{ label: 'No Tools Here...', disabled: true }, 'Snap to Grid']);
    const w = walkMenu('context');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Snap to Grid');
    w.move(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Snap to Grid');
  });

  it('activates the focused row with a click, as the mouse does', () => {
    const clicked = [];
    const { rows } = mountContextMenu(['Auto Layout Web', 'Snap to Grid']);
    rows.forEach(r => r.addEventListener('click', () => clicked.push(r.dataset.label)));
    const w = walkMenu('context');
    w.move(1);
    w.activate();
    expect(clicked).toEqual(['Snap to Grid']);
  });

  it('dismisses through the backdrop', () => {
    let closed = false;
    const { backdrop } = mountContextMenu(['Auto Layout Web']);
    backdrop.addEventListener('click', () => { closed = true; });
    expect(walkMenu('context').close()).toBe(true);
    expect(closed).toBe(true);
  });

  /**
   * The menu mounts a React commit or two after the trigger release that asked
   * for it, so the walker is built against an empty page and has to find its
   * rows later — the same lazy-resolution contract the bottom panel relies on.
   */
  it('picks up rows that mount after it was created', () => {
    const w = walkMenu('context');
    expect(document.querySelector(`.${FOCUS_CLASS}`)).toBeNull();
    mountContextMenu(['Paste Web']);
    w.sync();
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('Paste Web');
  });
});

/**
 * Every dialog in the app is one shell (components/shared/Dialog.jsx), so these
 * fixtures build that shell's real shape — a scrim, a frame, a body of declared
 * parts and a footer ROW of pills — rather than any one dialog's content. What
 * is under test is the contract between the shell and the walker: the parts
 * carry `data-nav`, and everything else follows from that.
 */
const mountDialog = ({ body = [], footer = [], dismissable = true } = {}) => {
  const scrim = document.createElement('div');
  scrim.className = 'rs-dialog-scrim';
  document.body.appendChild(sized(scrim, { top: 0, left: 0, width: 1000, height: 800 }));

  const frame = document.createElement('div');
  frame.setAttribute('role', 'dialog');
  scrim.appendChild(sized(frame, { top: 100, left: 300, width: 400, height: 300 }));

  let closed = false;
  if (dismissable) scrim.addEventListener('click', () => { closed = true; });

  // A paragraph of message text: present, and deliberately NOT walkable.
  const prose = document.createElement('p');
  prose.dataset.label = 'message';
  frame.appendChild(sized(prose, { top: 140, left: 320, width: 360, height: 40 }));

  const part = (label, { top, left, width = 360, height = 36, disabled = false, tag = 'button' }) => {
    const el = document.createElement(tag);
    el.setAttribute('data-nav', 'action');
    el.dataset.label = label;
    if (disabled) el.setAttribute('disabled', '');
    frame.appendChild(sized(el, { top, left, width, height }));
    return el;
  };

  // Body parts stack; footer pills sit side by side on one line.
  const bodyEls = body.map((spec, i) => part(spec.label ?? spec, {
    top: 200 + i * 50,
    left: 320,
    tag: spec.tag,
    disabled: spec.disabled,
  }));
  const footerEls = footer.map((spec, i) => part(spec.label ?? spec, {
    top: 360,
    left: 400 + i * 120,
    width: 100,
    disabled: spec.disabled,
  }));

  return { scrim, frame, bodyEls, footerEls, wasClosed: () => closed };
};

const focusedLabel = () => document.querySelector(`.${FOCUS_CLASS}`)?.dataset.label ?? null;

describe('the dialog surface', () => {
  it('takes over the moment a dialog is on screen', () => {
    expect(detectOpenSelector()).toBeNull();
    mountDialog({ footer: ['Cancel', 'Confirm'] });
    expect(detectOpenSelector()).toBe('dialog');
  });

  /**
   * Rows-as-evidence is how the selector and the grid are detected, and it
   * would be wrong here: a dialog that is all body text still owns the input,
   * and a pad that did not take it over would be looking at a box it could not
   * dismiss.
   */
  it('takes over a dialog that has no walkable part in it at all', () => {
    mountDialog();
    expect(detectOpenSelector()).toBe('dialog');
  });

  // A confirm raised from a linking modal sits on top of it, and the thing on
  // top is the thing the pad has to be in.
  it('drives the LAST dialog when two are stacked', () => {
    mountDialog({ footer: ['Underneath'] });
    const top = mountDialog({ footer: ['On top'] });
    const w = walkMenu('dialog');
    expect(focusedLabel()).toBe('On top');
    w.close();
    expect(top.wasClosed()).toBe(true);
  });

  it('walks the declared parts and skips the prose', () => {
    mountDialog({ body: ['Name'], footer: ['Cancel', 'Confirm'] });
    const w = walkMenu('dialog');
    expect(focusedLabel()).toBe('Name');
    w.moveGrid(0, 1);
    expect(focusedLabel()).toBe('Cancel');
  });

  // The footer is a ROW, which is the whole reason this surface is walked in
  // two dimensions: Cancel and Confirm sit side by side, not one under the
  // other.
  it('steps along the footer row', () => {
    mountDialog({ footer: ['Cancel', 'Confirm'] });
    const w = walkMenu('dialog');
    expect(focusedLabel()).toBe('Cancel');
    w.moveGrid(1, 0);
    expect(focusedLabel()).toBe('Confirm');
    w.moveGrid(-1, 0);
    expect(focusedLabel()).toBe('Cancel');
  });

  /**
   * A pad cannot tell from the outside that pressing A will do nothing, so a
   * Confirm that is blocked until its field has something in it must not be a
   * place the stick can come to rest.
   */
  it('refuses to land on a disabled control', () => {
    mountDialog({ footer: ['Cancel', { label: 'Confirm', disabled: true }] });
    const w = walkMenu('dialog');
    expect(focusedLabel()).toBe('Cancel');
    w.moveGrid(1, 0);
    expect(focusedLabel()).toBe('Cancel');
  });

  it('activates the focused control with a click', () => {
    const clicked = [];
    const { footerEls } = mountDialog({ footer: ['Cancel', 'Confirm'] });
    footerEls.forEach(el => el.addEventListener('click', () => clicked.push(el.dataset.label)));
    const w = walkMenu('dialog');
    w.moveGrid(1, 0);
    w.activate();
    expect(clicked).toEqual(['Confirm']);
  });

  // A pad cannot type, so handing the box to the keyboard IS the activation.
  it('puts the caret in a text field rather than clicking it', () => {
    const { bodyEls } = mountDialog({ body: [{ label: 'Name', tag: 'input' }] });
    const w = walkMenu('dialog');
    w.activate();
    expect(document.activeElement).toBe(bodyEls[0]);
  });

  it('dismisses by clicking the scrim, the way a mouse does', () => {
    const d = mountDialog({ footer: ['Cancel'] });
    expect(walkMenu('dialog').close()).toBe(true);
    expect(d.wasClosed()).toBe(true);
  });

  /**
   * A dialog that refuses dismissal (a working phase) simply has no handler on
   * its scrim. B clicking it is then a no-op, which is the intended answer
   * rather than a gap — nothing else must happen instead.
   */
  it('does nothing on a dialog that refuses to be dismissed', () => {
    const d = mountDialog({ footer: ['Cancel'], dismissable: false });
    walkMenu('dialog').close();
    expect(d.wasClosed()).toBe(false);
    expect(document.querySelector('.rs-dialog-scrim')).not.toBeNull();
  });

  // A dialog opening over a selector must win: it is the thing on top.
  it('outranks a selector underneath it', () => {
    mountSelector([{ top: 0, left: 0, width: 100, height: 40 }]);
    expect(detectOpenSelector()).toBe('selector');
    mountDialog({ footer: ['Cancel'] });
    expect(detectOpenSelector()).toBe('dialog');
  });
});

/**
 * A surface whose opener is not in the DOM does not exist on this platform.
 *
 * The Redstring menu is browser-only: on Electron the application menu bar
 * covers it, and Header drops both the menu and the logo's
 * `.header-logo-button` handle. Without this, Start found the empty menu
 * anyway, entered MENU mode and left the pad in a surface with no rows in it
 * and only B to get out.
 */
describe('walkMenu — a surface that is not on this platform', () => {
  it('returns null when nothing is showing and the opener is absent', () => {
    expect(walkMenu('menu')).toBeNull();
  });

  it('still opens the menu when the logo handle is there', () => {
    const logo = document.createElement('img');
    logo.className = 'header-logo-button';
    document.body.appendChild(sized(logo));

    const opened = vi.fn();
    logo.addEventListener('click', opened);

    expect(walkMenu('menu')).not.toBeNull();
    expect(opened).toHaveBeenCalled();
  });

  /**
   * The header's action buttons are always mounted in the wide layout, where
   * the hamburger opener does NOT exist. Rows-on-screen has to win over the
   * missing opener, or the pad loses Select on every desktop window.
   */
  it('does not refuse a surface whose rows are already on screen', () => {
    const btn = document.createElement('div');
    btn.className = 'header-action-btn';
    document.body.appendChild(sized(btn));

    expect(document.querySelector('.header-hamburger-button')).toBeNull();
    expect(walkMenu('actions')).not.toBeNull();
  });
});
