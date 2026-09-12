import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPanelNavigator, stepTab, FOCUS_CLASS } from '../../src/utils/gamepadPanelNav.js';

/**
 * The navigator reads declared structure (`data-nav`) and real geometry, so
 * these tests build both: the attributes the panels now carry, and the
 * bounding boxes that decide what counts as a row. jsdom reports every element
 * as zero-sized, so every fixture states its own rect — which is no loss,
 * since the layout is the thing under test.
 */
const at = (el, { top, left, width = 100, height = 30 }) => {
  el.getBoundingClientRect = () => ({
    top, left, width, height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  });
  return el;
};

const mountPanel = (side) => {
  const container = document.createElement('div');
  container.className = `panel-container ${side}`;
  document.body.appendChild(container);
  return container;
};

const nav = (parent, kind, label, rect) => {
  const el = document.createElement('div');
  el.setAttribute('data-nav', kind);
  el.dataset.label = label;
  parent.appendChild(el);
  return at(el, rect);
};

const focusedLabel = () => document.querySelector(`.${FOCUS_CLASS}`)?.dataset.label ?? null;

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('panel navigator — movement', () => {
  it('walks a single column top to bottom', () => {
    const panel = mountPanel('left');
    nav(panel, 'tab', 'tabs', { top: 0, left: 0 });
    nav(panel, 'section', 'section', { top: 40, left: 0 });
    nav(panel, 'item', 'item', { top: 80, left: 0 });

    const n = createPanelNavigator();
    expect(n.enter('left')).toBe(true);
    expect(focusedLabel()).toBe('tabs');
    expect(n.move(0, 1)).toBe('moved');
    expect(focusedLabel()).toBe('section');
    expect(n.move(0, 1)).toBe('moved');
    expect(focusedLabel()).toBe('item');
  });

  /**
   * Rows come from geometry because the panels are user-resizable and their
   * card grids are `repeat(auto-fill)` — how many items share a line is not
   * written down anywhere in the markup.
   */
  it('treats items that share a top edge as one row', () => {
    const panel = mountPanel('left');
    nav(panel, 'item', 'a', { top: 0, left: 0, width: 100 });
    nav(panel, 'item', 'b', { top: 2, left: 110, width: 100 }); // 2px off: same row
    nav(panel, 'item', 'c', { top: 40, left: 0, width: 100 });

    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(1, 0)).toBe('moved');
    expect(focusedLabel()).toBe('b');
    expect(n.move(1, 0)).toBe('edge'); // nothing further right in this row
  });

  it('keeps its column when moving between ragged rows', () => {
    const panel = mountPanel('left');
    nav(panel, 'item', 'a', { top: 0, left: 0, width: 100 });
    nav(panel, 'item', 'b', { top: 0, left: 110, width: 100 });
    nav(panel, 'item', 'c', { top: 40, left: 0, width: 100 });
    nav(panel, 'item', 'd', { top: 40, left: 110, width: 100 });

    const n = createPanelNavigator();
    n.enter('left');
    n.move(1, 0);                // on 'b', the right-hand column
    expect(n.move(0, 1)).toBe('moved');
    expect(focusedLabel()).toBe('d'); // stays in the right-hand column
  });

  it('reports an edge at the top and bottom rather than wrapping', () => {
    const panel = mountPanel('left');
    nav(panel, 'item', 'only', { top: 0, left: 0 });
    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(0, -1)).toBe('edge');
    expect(n.move(0, 1)).toBe('edge');
    expect(focusedLabel()).toBe('only');
  });
});

describe('panel navigator — sections', () => {
  const section = (panel, expanded) => {
    const el = nav(panel, 'section', 'sec', { top: 0, left: 0 });
    el.setAttribute('data-nav-expanded', String(expanded));
    const clicks = vi.fn();
    el.addEventListener('click', clicks);
    return { el, clicks };
  };

  it('collapses an open section with left', () => {
    const panel = mountPanel('left');
    const { clicks } = section(panel, true);
    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(-1, 0)).toBe('moved');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('expands a closed section with right', () => {
    const panel = mountPanel('left');
    const { clicks } = section(panel, false);
    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(1, 0)).toBe('moved');
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  /**
   * The gesture that would do nothing falls through to movement instead, so
   * pressing left twice on a collapsed section still carries you out of the
   * panel rather than sticking.
   */
  it('falls through to movement when the toggle would be a no-op', () => {
    const panel = mountPanel('left');
    const { clicks } = section(panel, false);
    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(-1, 0)).toBe('edge');
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe('panel navigator — scrolling past what is rendered', () => {
  /**
   * REGRESSION: the saved-things grid is virtualised, so the rows below the
   * fold are not in the DOM at all. A navigator that treated "no row below" as
   * "end of list" could never reach them.
   */
  it('scrolls its container instead of reporting an edge', () => {
    const panel = mountPanel('left');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    scroller.scrollTop = 0;
    panel.appendChild(at(scroller, { top: 0, left: 0, width: 200, height: 200 }));
    nav(scroller, 'item', 'last', { top: 0, left: 0 });

    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(0, 1)).toBe('scrolled');
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(focusedLabel()).toBe('last'); // focus stays put; new rows arrive later
  });

  it('reports an edge once the container is at its end', () => {
    const panel = mountPanel('left');
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    panel.appendChild(at(scroller, { top: 0, left: 0, width: 200, height: 200 }));
    nav(scroller, 'item', 'last', { top: 0, left: 0 });

    const n = createPanelNavigator();
    n.enter('left');
    expect(n.move(0, 1)).toBe('edge');
  });
});

describe('panel navigator — focus lifecycle', () => {
  it('re-seats at the same height when the view is replaced underneath it', () => {
    const panel = mountPanel('right');
    nav(panel, 'item', 'old-top', { top: 0, left: 0 });
    const n = createPanelNavigator();
    n.enter('right');
    expect(focusedLabel()).toBe('old-top');

    panel.innerHTML = '';
    nav(panel, 'item', 'new-top', { top: 0, left: 0 });
    n.sync();
    expect(focusedLabel()).toBe('new-top');
    expect(n.side()).toBe('right');
  });

  it('unhovers the row it leaves', () => {
    const panel = mountPanel('left');
    const a = nav(panel, 'item', 'a', { top: 0, left: 0 });
    nav(panel, 'item', 'b', { top: 40, left: 0 });
    const left = vi.fn();
    a.addEventListener('mouseleave', left);

    const n = createPanelNavigator();
    n.enter('left');
    n.move(0, 1);
    expect(left).toHaveBeenCalled();
    expect(a.classList.contains(FOCUS_CLASS)).toBe(false);
  });

  it('activates by clicking, and puts the caret in a text field instead', () => {
    const panel = mountPanel('left');
    const item = nav(panel, 'item', 'a', { top: 0, left: 0 });
    const clicks = vi.fn();
    item.addEventListener('click', clicks);

    const n = createPanelNavigator();
    n.enter('left');
    n.activate();
    expect(clicks).toHaveBeenCalledTimes(1);

    const field = document.createElement('input');
    field.type = 'text';
    field.setAttribute('data-nav', 'action');
    panel.appendChild(at(field, { top: 40, left: 0 }));
    n.move(0, 1);
    n.activate();
    expect(document.activeElement).toBe(field);
  });

  it('has nothing to move when no panel is mounted', () => {
    const n = createPanelNavigator();
    expect(n.enter('left')).toBe(false);
    expect(n.hasFocus()).toBe(false);
    expect(n.move(0, 1)).toBe('none');
  });
});

/**
 * The right panel's tab strip scrolls sideways, so "no tab further along this
 * row" is not "no further tabs" — the same distinction the vertical walk makes
 * for the virtualised grids.
 */
describe('panel navigator — scrolling sideways', () => {
  const mountStrip = (side, { scrollWidth, clientWidth }) => {
    const panel = mountPanel(side);
    const strip = document.createElement('div');
    strip.style.overflowX = 'auto';
    Object.defineProperty(strip, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: clientWidth, configurable: true });
    strip.scrollLeft = 0;
    panel.appendChild(at(strip, { top: 0, left: 0, width: clientWidth, height: 50 }));
    return strip;
  };

  it('scrolls the strip instead of reporting an edge', () => {
    const strip = mountStrip('right', { scrollWidth: 800, clientWidth: 200 });
    nav(strip, 'tab', 'last-rendered', { top: 0, left: 0, width: 60, height: 50 });

    const n = createPanelNavigator();
    n.enter('right');
    expect(n.move(1, 0)).toBe('scrolled');
    expect(strip.scrollLeft).toBeGreaterThan(0);
    expect(focusedLabel()).toBe('last-rendered');
  });

  it('reports an edge once the strip is at its end', () => {
    const strip = mountStrip('right', { scrollWidth: 200, clientWidth: 200 });
    nav(strip, 'tab', 'only', { top: 0, left: 0, width: 60, height: 50 });

    const n = createPanelNavigator();
    n.enter('right');
    expect(n.move(1, 0)).toBe('edge');
  });
});

describe('stepping the panel tabs', () => {
  const mountTabs = (side, active) => {
    const panel = mountPanel(side);
    const strip = document.createElement('div');
    strip.setAttribute('data-panel-tabstrip', 'true');
    panel.appendChild(at(strip, { top: 0, left: 0, width: 200, height: 50 }));
    return ['one', 'two', 'three'].map((label, i) => {
      const el = nav(strip, 'tab', label, { top: 0, left: i * 50, width: 50, height: 50 });
      el.setAttribute('data-active', String(label === active));
      el.click = vi.fn();
      return el;
    });
  };

  it('clicks the next tab along', () => {
    const [, two, three] = mountTabs('left', 'two');
    expect(stepTab('left', 1)).toBe(true);
    expect(three.click).toHaveBeenCalledTimes(1);
    expect(two.click).not.toHaveBeenCalled();
  });

  it('clicks the previous tab', () => {
    const [one, two] = mountTabs('right', 'two');
    expect(stepTab('right', -1)).toBe(true);
    expect(one.click).toHaveBeenCalledTimes(1);
    expect(two.click).not.toHaveBeenCalled();
  });

  /**
   * Stopping at the ends rather than wrapping, and saying so — the caller
   * falls back to stepping WEBS when the tabs have nothing left to give, so a
   * wrap would make the far end of a strip a place you could never leave.
   */
  it('stops at the ends instead of wrapping', () => {
    mountTabs('left', 'three');
    expect(stepTab('left', 1)).toBe(false);
  });

  it('does nothing while no tab is marked active', () => {
    const tabs = mountTabs('left', 'none-of-them');
    expect(stepTab('left', 1)).toBe(false);
    tabs.forEach(t => expect(t.click).not.toHaveBeenCalled());
  });

  /**
   * A view can carry its own sub-tabs (LeftHistoryView does), and those are
   * not the panel's tabs. Only the declared strip counts.
   */
  it('ignores tabs outside the panel’s own strip', () => {
    const tabs = mountTabs('left', 'two');
    const panel = document.querySelector('.panel-container.left');
    const stray = nav(panel, 'tab', 'sub-tab', { top: 200, left: 0 });
    stray.setAttribute('data-active', 'true');
    stray.click = vi.fn();

    expect(stepTab('left', 1)).toBe(true);
    expect(tabs[2].click).toHaveBeenCalledTimes(1);
    expect(stray.click).not.toHaveBeenCalled();
  });

  it('has no tabs to step when the panel is not mounted', () => {
    expect(stepTab('right', 1)).toBe(false);
  });
});
