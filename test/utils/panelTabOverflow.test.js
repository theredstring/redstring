import { describe, it, expect } from 'vitest';
import { resolveTabOverflow, PANEL_TAB_WIDTH } from '../../src/utils/panelTabOverflow.js';

// The left panel's tabs as they actually ship, wizard enabled.
const TABS = ['library', 'grid', 'federation', 'semantic', 'ai', 'history'];
// The panel's toggle button is a fixed overlay covering the strip's leading edge.
const TOGGLE = 50;

const resolve = (stripWidth, activeKey = 'library') =>
  resolveTabOverflow({ tabKeys: TABS, activeKey, stripWidth, reservedWidth: TOGGLE });

describe('resolveTabOverflow', () => {
  it('shows every tab when they all fit', () => {
    // Six tabs plus the toggle button's covered strip.
    const result = resolve(TABS.length * PANEL_TAB_WIDTH + TOGGLE);
    expect(result.collapsed).toBe(false);
    expect(result.hiddenKeys.size).toBe(0);
    expect(result.overflowKeys).toEqual([]);
  });

  it('assumes everything fits before the strip has been measured', () => {
    expect(resolve(null).collapsed).toBe(false);
  });

  it('counts the toggle button as unusable, not as a slot', () => {
    // Exactly six tabs wide, but the toggle eats the first slot.
    expect(resolve(TABS.length * PANEL_TAB_WIDTH).collapsed).toBe(true);
  });

  it('collapses to the active tab plus the ellipsis, not a partial row', () => {
    // Room for five tabs: still all-or-two.
    const result = resolve(5 * PANEL_TAB_WIDTH + TOGGLE, 'grid');
    expect(result.collapsed).toBe(true);
    expect([...result.hiddenKeys]).toEqual(TABS.filter((k) => k !== 'grid'));
    expect(result.overflowKeys).not.toContain('grid');
  });

  it('drops to the ellipsis alone when under two slots', () => {
    const result = resolve(PANEL_TAB_WIDTH + TOGGLE, 'grid');
    expect(result.collapsed).toBe(true);
    // Nothing survives, so the active view is reachable through the menu.
    expect(result.overflowKeys).toEqual(TABS);
  });

  // The reason this is a pure function: views get opened from outside the strip.
  describe('views opened from elsewhere', () => {
    it('keeps the Wizard on the strip when the canvas asks for it', () => {
      // "Ask The Wizard" sets the active view to 'ai' while the panel is narrow.
      const result = resolve(3 * PANEL_TAB_WIDTH + TOGGLE, 'ai');
      expect(result.hiddenKeys.has('ai')).toBe(false);
      expect(result.overflowKeys).toEqual(TABS.filter((k) => k !== 'ai'));
    });

    it.each(['federation', 'history', 'semantic'])(
      'keeps %s on the strip when opened programmatically',
      (key) => {
        const result = resolve(2 * PANEL_TAB_WIDTH + TOGGLE, key);
        expect(result.hiddenKeys.has(key)).toBe(false);
        expect(result.overflowKeys).not.toContain(key);
      }
    );

    it('hides nothing extra when the active view is not a tab at all', () => {
      // e.g. 'ai' while the wizard flag is off: no tab to promote, so the strip
      // is the ellipsis alone rather than an arbitrary tab claiming to be active.
      const result = resolveTabOverflow({
        tabKeys: TABS.filter((k) => k !== 'ai'),
        activeKey: 'ai',
        stripWidth: 3 * PANEL_TAB_WIDTH + TOGGLE,
        reservedWidth: TOGGLE,
      });
      expect(result.overflowKeys).toEqual(TABS.filter((k) => k !== 'ai'));
    });
  });

  it('handles an empty strip', () => {
    const result = resolveTabOverflow({ tabKeys: [], activeKey: 'library', stripWidth: 100 });
    expect(result).toEqual({ hiddenKeys: new Set(), overflowKeys: [], collapsed: false });
  });
});
