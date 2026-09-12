import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { walkMenu, detectOpenSelector, isColorPickerOpen, stepPanelView, FOCUS_CLASS } from '../../src/utils/gamepadMenuNav.js';

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
 * The panels are the one surface whose rows are DISCOVERED rather than named
 * by a class — see the `pointer` entries in SELECTORS. What these pin down is
 * the discovery rule itself: outermost-clickable-wins, form controls always
 * count, and the cached list gives way the moment the view under it changes.
 */
const mountPanel = (side = 'left') => {
  const container = document.createElement('div');
  container.className = `panel-container ${side}`;
  const content = document.createElement('div');
  content.className = 'panel-content';
  container.appendChild(content);
  document.body.appendChild(container);
  return { container, content };
};

/** A card: clickable itself, with clickable-looking children inside it. */
const panelCard = (label, top) => {
  const el = document.createElement('div');
  el.style.cursor = 'pointer';
  el.dataset.label = label;
  const icon = document.createElement('div');
  icon.style.cursor = 'pointer';
  el.appendChild(sized(icon, { top, left: 0, width: 20, height: 20 }));
  return sized(el, { top, left: 0, width: 200, height: 40 });
};

describe('walkMenu — panels', () => {
  it('takes the outermost clickable element, not the glyphs inside it', () => {
    const { content } = mountPanel('left');
    content.appendChild(panelCard('one', 0));
    content.appendChild(panelCard('two', 40));

    const w = walkMenu('leftPanel');
    expect(document.querySelectorAll(`.${FOCUS_CLASS}`).length).toBe(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('one');
    w.move(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('two');
  });

  it('walks a form control even though it carries no pointer cursor', () => {
    const { content } = mountPanel('right');
    const field = document.createElement('input');
    field.type = 'text';
    content.appendChild(sized(field, { top: 0, left: 0, width: 200, height: 30 }));
    content.appendChild(panelCard('after', 30));

    const w = walkMenu('rightPanel');
    expect(document.querySelector(`.${FOCUS_CLASS}`)).toBe(field);
    w.move(1);
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('after');
  });

  it('descends through non-interactive wrappers to reach the items', () => {
    const { content } = mountPanel('left');
    const section = document.createElement('div');
    section.appendChild(panelCard('nested', 0));
    content.appendChild(sized(section, { top: 0, left: 0, width: 200, height: 40 }));

    walkMenu('leftPanel');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('nested');
  });

  it('activates the focused item by clicking it', () => {
    const { content } = mountPanel('left');
    const item = panelCard('target', 0);
    const onClick = vi.fn();
    item.addEventListener('click', onClick);
    content.appendChild(item);

    walkMenu('leftPanel').activate();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /**
   * REGRESSION: the discovered row list is cached for a couple of hundred
   * milliseconds because rediscovery reads computed style for the whole panel.
   * A cache that outlived the rows it described would leave the walker
   * pointing at elements from a view the user has already left.
   */
  it('drops the cached rows when the view under them is replaced', () => {
    const { content } = mountPanel('left');
    content.appendChild(panelCard('old', 0));
    const w = walkMenu('leftPanel');
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('old');

    content.innerHTML = '';
    content.appendChild(panelCard('new', 0));
    w.sync();
    expect(document.querySelector(`.${FOCUS_CLASS}`).dataset.label).toBe('new');
  });
});

describe('stepPanelView', () => {
  const mountViews = (activeIndex) => {
    const { container } = mountPanel('left');
    const clicks = [];
    const tabs = ['library', 'grid', 'federation'].map((key, i) => {
      const el = document.createElement('div');
      el.className = 'panel-view-tab';
      el.dataset.key = key;
      if (i === activeIndex) el.dataset.active = 'true';
      el.addEventListener('click', () => clicks.push(key));
      container.appendChild(sized(el, { top: 0, left: i * 50, width: 50, height: 50 }));
      return el;
    });
    return { tabs, clicks };
  };

  it('clicks the view to either side of the active one', () => {
    const { clicks } = mountViews(1);
    expect(stepPanelView(1)).toBe(true);
    expect(stepPanelView(-1)).toBe(true);
    expect(clicks).toEqual(['federation', 'library']);
  });

  it('stops at the ends rather than wrapping', () => {
    const { clicks } = mountViews(0);
    expect(stepPanelView(-1)).toBe(false);
    expect(clicks).toEqual([]);
  });

  it('reports false when no panel is mounted', () => {
    expect(stepPanelView(1)).toBe(false);
  });
});
