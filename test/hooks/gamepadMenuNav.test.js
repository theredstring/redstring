import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { walkMenu, detectOpenSelector, isColorPickerOpen, isContextMenuOpen, FOCUS_CLASS } from '../../src/utils/gamepadMenuNav.js';

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
