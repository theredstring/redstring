import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EDGE_GLOW_MODES,
  DEFAULT_EDGE_GLOW_MODE,
  EDGE_GLOW_FANCY_MAX_COUNT,
  EDGE_GLOW_FAST_MAX_COUNT,
  EDGE_GLOW_INTENSITY_MIN,
  EDGE_GLOW_INTENSITY_MAX,
  DEFAULT_EDGE_GLOW_INTENSITY,
  clampEdgeGlowIntensity,
  resolveEdgeGlowQuality,
} from '../../src/utils/colorUtils.js';

describe('resolveEdgeGlowQuality', () => {
  it('passes the two fixed appearances through at any size', () => {
    for (const count of [0, 1, EDGE_GLOW_FANCY_MAX_COUNT + 1, EDGE_GLOW_FAST_MAX_COUNT + 1, 50000]) {
      expect(resolveEdgeGlowQuality('fast', count)).toBe('fast');
      expect(resolveEdgeGlowQuality('fancy', count)).toBe('fancy');
      expect(resolveEdgeGlowQuality('off', count)).toBe('off');
    }
  });

  it('steps adaptive down through fancy, fast and off as the web grows', () => {
    expect(resolveEdgeGlowQuality('adaptive', 0)).toBe('fancy');
    expect(resolveEdgeGlowQuality('adaptive', EDGE_GLOW_FANCY_MAX_COUNT)).toBe('fancy');
    expect(resolveEdgeGlowQuality('adaptive', EDGE_GLOW_FANCY_MAX_COUNT + 1)).toBe('fast');
    expect(resolveEdgeGlowQuality('adaptive', EDGE_GLOW_FAST_MAX_COUNT)).toBe('fast');
    expect(resolveEdgeGlowQuality('adaptive', EDGE_GLOW_FAST_MAX_COUNT + 1)).toBe('off');
  });

  it('never yields a mode name the flare painter cannot draw', () => {
    const drawable = ['off', 'fast', 'fancy'];
    for (const mode of [...EDGE_GLOW_MODES, undefined, null, 'nonsense']) {
      expect(drawable).toContain(resolveEdgeGlowQuality(mode, 10));
    }
  });

  it('falls back to off rather than to an appearance for an unrecognised mode', () => {
    // A stale persisted value must not silently pick a cost for someone.
    expect(resolveEdgeGlowQuality('shiny', 10)).toBe('off');
  });

  it('keeps the thresholds ordered and the default a real mode', () => {
    expect(EDGE_GLOW_FANCY_MAX_COUNT).toBeLessThan(EDGE_GLOW_FAST_MAX_COUNT);
    expect(EDGE_GLOW_MODES).toContain(DEFAULT_EDGE_GLOW_MODE);
  });
});

describe('edgeGlowMode store setting', () => {
  let store;

  const freshStore = async () => {
    vi.resetModules();
    const mod = await import('../../src/store/graphStore.js');
    return mod.default;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to adaptive when nothing is persisted', async () => {
    store = await freshStore();
    expect(store.getState().edgeGlowMode).toBe(DEFAULT_EDGE_GLOW_MODE);
  });

  it('restores a persisted mode', async () => {
    localStorage.setItem('redstring_edge_glow_mode', 'fancy');
    store = await freshStore();
    expect(store.getState().edgeGlowMode).toBe('fancy');
  });

  it('carries the old on/off switch forward, but only when it was off', async () => {
    localStorage.setItem('redstring_show_edge_glow', 'false');
    store = await freshStore();
    expect(store.getState().edgeGlowMode).toBe('off');

    localStorage.clear();
    localStorage.setItem('redstring_show_edge_glow', 'true');
    store = await freshStore();
    // "On" said nothing about which appearance, so it must not pin anyone to the
    // cut-back one the switch happened to ship with.
    expect(store.getState().edgeGlowMode).toBe(DEFAULT_EDGE_GLOW_MODE);
  });

  it('ignores a persisted value that is not a mode', async () => {
    localStorage.setItem('redstring_edge_glow_mode', 'sparkly');
    store = await freshStore();
    expect(store.getState().edgeGlowMode).toBe(DEFAULT_EDGE_GLOW_MODE);
  });

  it('sets and persists each valid mode', async () => {
    store = await freshStore();
    for (const mode of EDGE_GLOW_MODES) {
      store.getState().setEdgeGlowMode(mode);
      expect(store.getState().edgeGlowMode).toBe(mode);
      expect(localStorage.getItem('redstring_edge_glow_mode')).toBe(mode);
    }
  });

  it('refuses an unknown mode rather than writing it', async () => {
    store = await freshStore();
    store.getState().setEdgeGlowMode('fancy');
    store.getState().setEdgeGlowMode('turbo');
    expect(store.getState().edgeGlowMode).toBe('fancy');
    expect(localStorage.getItem('redstring_edge_glow_mode')).toBe('fancy');
  });
});

describe('clampEdgeGlowIntensity', () => {
  it('passes values inside the range through untouched', () => {
    for (const v of [EDGE_GLOW_INTENSITY_MIN, 0.5, 1, 1.35, EDGE_GLOW_INTENSITY_MAX]) {
      expect(clampEdgeGlowIntensity(v)).toBe(v);
    }
  });

  it('clamps rather than rejecting, so an out-of-range value still lands usably', () => {
    expect(clampEdgeGlowIntensity(-4)).toBe(EDGE_GLOW_INTENSITY_MIN);
    expect(clampEdgeGlowIntensity(99)).toBe(EDGE_GLOW_INTENSITY_MAX);
  });

  it('never lets the slider become a fourth way to turn the flares off', () => {
    expect(EDGE_GLOW_INTENSITY_MIN).toBeGreaterThan(0);
    expect(clampEdgeGlowIntensity(0)).toBeGreaterThan(0);
  });

  it('falls back to the default for anything that is not a number', () => {
    for (const v of [undefined, null, NaN, 'loud', {}]) {
      expect(clampEdgeGlowIntensity(v)).toBe(DEFAULT_EDGE_GLOW_INTENSITY);
    }
  });
});

describe('edgeGlowIntensity store setting', () => {
  const freshStore = async () => {
    vi.resetModules();
    const mod = await import('../../src/store/graphStore.js');
    return mod.default;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the neutral gain when nothing is persisted', async () => {
    const store = await freshStore();
    expect(store.getState().edgeGlowIntensity).toBe(DEFAULT_EDGE_GLOW_INTENSITY);
  });

  it('restores and persists a chosen strength', async () => {
    const store = await freshStore();
    store.getState().setEdgeGlowIntensity(1.6);
    expect(store.getState().edgeGlowIntensity).toBe(1.6);
    expect(localStorage.getItem('redstring_edge_glow_intensity')).toBe('1.6');

    const reloaded = await freshStore();
    expect(reloaded.getState().edgeGlowIntensity).toBe(1.6);
  });

  it('clamps a persisted value from a build with a different range', async () => {
    localStorage.setItem('redstring_edge_glow_intensity', '50');
    const store = await freshStore();
    expect(store.getState().edgeGlowIntensity).toBe(EDGE_GLOW_INTENSITY_MAX);
  });

  it('falls back to the default for unparseable persisted text', async () => {
    localStorage.setItem('redstring_edge_glow_intensity', 'bright');
    const store = await freshStore();
    expect(store.getState().edgeGlowIntensity).toBe(DEFAULT_EDGE_GLOW_INTENSITY);
  });

  it('clamps on the way in rather than storing an unusable value', async () => {
    const store = await freshStore();
    store.getState().setEdgeGlowIntensity(0);
    expect(store.getState().edgeGlowIntensity).toBe(EDGE_GLOW_INTENSITY_MIN);
    expect(localStorage.getItem('redstring_edge_glow_intensity')).toBe(String(EDGE_GLOW_INTENSITY_MIN));
  });
});
