import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Connection-view preferences must survive a reload.
 *
 * The defaults are read at module-init time, so "reload" is simulated by
 * resetting the module registry and re-importing the store — that re-runs
 * getDefaultAutoLayoutSettings() against whatever is in localStorage, exactly
 * as a fresh page load would.
 */
const freshStore = async () => {
  vi.resetModules();
  const mod = await import('../../src/store/graphStore.js');
  return mod.default ?? mod.useGraphStore;
};

const settings = (store) => store.getState().autoLayoutSettings;

describe('connection view preferences persist', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to straight routing on a clean profile', async () => {
    const store = await freshStore();
    expect(settings(store).routingStyle).toBe('straight');
    expect(settings(store).manhattanBends).toBe('auto');
    expect(settings(store).cleanLaneSpacing).toBe(200);
    expect(settings(store).enableAutoRouting).toBe(true);
  });

  it('restores routing style after a reload', async () => {
    const store = await freshStore();
    store.getState().setRoutingStyle('lombardi');
    expect(settings(store).routingStyle).toBe('lombardi');

    // Reload.
    const reloaded = await freshStore();
    expect(settings(reloaded).routingStyle).toBe('lombardi');
  });

  it('restores every connection-view preference after a reload', async () => {
    const store = await freshStore();
    store.getState().setRoutingStyle('clean');
    store.getState().setCleanLaneSpacing(340);
    store.getState().setManhattanBends('two');
    store.getState().setLombardiCurvature(1.75);
    store.getState().toggleEnableAutoRouting();
    const before = settings(store).enableAutoRouting;

    const reloaded = await freshStore();
    expect(settings(reloaded).routingStyle).toBe('clean');
    expect(settings(reloaded).cleanLaneSpacing).toBe(340);
    expect(settings(reloaded).manhattanBends).toBe('two');
    expect(settings(reloaded).lombardiCurvature).toBe(1.75);
    expect(settings(reloaded).enableAutoRouting).toBe(before);
  });

  it('clamps a restored lane spacing that is out of range', async () => {
    localStorage.setItem('redstring_clean_lane_spacing', '99999');
    const store = await freshStore();
    expect(settings(store).cleanLaneSpacing).toBe(400);
  });

  it('ignores a corrupt or unknown stored routing style', async () => {
    localStorage.setItem('redstring_routing_style', 'not-a-real-style');
    const store = await freshStore();
    expect(settings(store).routingStyle).toBe('straight');
  });

  it('ignores a non-numeric stored lane spacing', async () => {
    localStorage.setItem('redstring_clean_lane_spacing', 'banana');
    const store = await freshStore();
    expect(settings(store).cleanLaneSpacing).toBe(200);
  });

  it('rejects an invalid routing style rather than storing it', async () => {
    const store = await freshStore();
    store.getState().setRoutingStyle('clean');
    store.getState().setRoutingStyle('nonsense');
    expect(settings(store).routingStyle).toBe('clean');

    const reloaded = await freshStore();
    expect(settings(reloaded).routingStyle).toBe('clean');
  });

  it('falls back to defaults when reading these keys throws', async () => {
    // Scoped to the connection-view keys on purpose. A dozen other reads in
    // this store are still unguarded, so a globally-throwing localStorage
    // takes store construction down for unrelated reasons — that is a separate
    // pre-existing problem, not something this test should assert away.
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (String(key).startsWith('redstring_routing')
        || String(key).startsWith('redstring_clean_lane')
        || String(key).startsWith('redstring_manhattan')
        || String(key).startsWith('redstring_enable_auto_routing')) {
        throw new Error('denied');
      }
      return original.call(this, key);
    };
    try {
      const store = await freshStore();
      expect(settings(store).routingStyle).toBe('straight');
      expect(settings(store).cleanLaneSpacing).toBe(200);
      expect(settings(store).manhattanBends).toBe('auto');
      expect(settings(store).enableAutoRouting).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
