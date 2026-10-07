import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LIFTED_THING_SHADOW_MODES,
  DEFAULT_LIFTED_THING_SHADOW,
  LIFTED_THING_SHADOW_FAST_LAYERS,
} from '../../src/utils/colorUtils.js';

describe('lifted Thing shadow appearance', () => {
  it('defaults to fast, a real mode', () => {
    expect(DEFAULT_LIFTED_THING_SHADOW).toBe('fast');
    expect(LIFTED_THING_SHADOW_MODES).toContain(DEFAULT_LIFTED_THING_SHADOW);
  });

  it('builds the fast shadow from widening, translucent layers', () => {
    const spreads = LIFTED_THING_SHADOW_FAST_LAYERS.map(l => l.spread);
    expect([...spreads].sort((a, b) => a - b)).toEqual(spreads);
    for (const { alpha } of LIFTED_THING_SHADOW_FAST_LAYERS) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    }
  });
});

describe('liftedThingShadow store setting', () => {
  let store;

  const freshStore = async () => {
    vi.resetModules();
    const mod = await import('../../src/store/graphStore.js');
    return mod.default;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to fast when nothing is persisted', async () => {
    store = await freshStore();
    expect(store.getState().liftedThingShadow).toBe(DEFAULT_LIFTED_THING_SHADOW);
  });

  it('restores a persisted mode', async () => {
    localStorage.setItem('redstring_lifted_thing_shadow', 'fancy');
    store = await freshStore();
    expect(store.getState().liftedThingShadow).toBe('fancy');
  });

  it('ignores a persisted value that is not a mode', async () => {
    localStorage.setItem('redstring_lifted_thing_shadow', 'dramatic');
    store = await freshStore();
    expect(store.getState().liftedThingShadow).toBe(DEFAULT_LIFTED_THING_SHADOW);
  });

  it('sets and persists each valid mode', async () => {
    store = await freshStore();
    for (const mode of LIFTED_THING_SHADOW_MODES) {
      store.getState().setLiftedThingShadow(mode);
      expect(store.getState().liftedThingShadow).toBe(mode);
      expect(localStorage.getItem('redstring_lifted_thing_shadow')).toBe(mode);
    }
  });

  it('refuses an unknown mode rather than writing it', async () => {
    store = await freshStore();
    store.getState().setLiftedThingShadow('off');
    store.getState().setLiftedThingShadow('turbo');
    expect(store.getState().liftedThingShadow).toBe('off');
    expect(localStorage.getItem('redstring_lifted_thing_shadow')).toBe('off');
  });
});
