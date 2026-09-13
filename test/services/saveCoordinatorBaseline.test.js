/**
 * The shrinkage baseline must never be lowered to zero by a bad load.
 *
 * `_isCatastrophicShrinkage` compares the outgoing state against
 * `dataBaseline`. On 2026-09-12 a bad read applied an empty universe, the
 * coordinator adopted `{nodes: 0}` as the new baseline, and with the floor at
 * zero the guard could never fire again — the real local file was overwritten
 * sixteen seconds later.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

const state = (nodes = 0, { slug = 'claude-s-chambers-2', baseSeeded = false } = {}) => {
  const nodePrototypes = new Map();
  if (baseSeeded) {
    nodePrototypes.set('base-thing-prototype', { id: 'base-thing-prototype' });
    nodePrototypes.set('base-connection-prototype', { id: 'base-connection-prototype' });
  }
  for (let i = 0; i < nodes; i++) nodePrototypes.set('p' + i, { id: 'p' + i });
  return {
    graphs: new Map(),
    nodePrototypes,
    edges: new Map(),
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
    _universeSlug: slug
  };
};

describe('SaveCoordinator shrinkage baseline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) {
      saveCoordinator.endLoad(token);
    }
    saveCoordinator.isEnabled = true;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.hasLoadedFromFile = true;
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
    saveCoordinator.activeUniverseSlugForGuard = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
    saveCoordinator.activeUniverseSlugForGuard = null;
  });

  it('counts user prototypes only, ignoring the seeded base types', () => {
    expect(saveCoordinator._countDataItems(state(0, { baseSeeded: true })))
      .toEqual({ nodes: 0, graphs: 0 });
    expect(saveCoordinator._countDataItems(state(3, { baseSeeded: true })).nodes).toBe(3);
  });

  it('keeps the higher baseline when a load lands empty for the same universe', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };

    const adopted = saveCoordinator._adoptBaseline(
      { nodes: 0, graphs: 0 },
      state(0, { baseSeeded: true }),
      'load'
    );

    expect(adopted.nodes).toBe(1822);
    expect(adopted.graphs).toBe(191);
  });

  it('the shrinkage guard still fires after such a load', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };
    saveCoordinator.dataBaseline = saveCoordinator._adoptBaseline(
      { nodes: 0, graphs: 0 }, state(0, { baseSeeded: true }), 'load'
    );

    expect(saveCoordinator._isCatastrophicShrinkage(state(0, { baseSeeded: true }))).toBe(true);
  });

  it('a DIFFERENT universe still gets a fresh baseline', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };

    const adopted = saveCoordinator._adoptBaseline(
      { nodes: 0, graphs: 0 },
      state(0, { slug: 'a-brand-new-universe' }),
      'load'
    );

    expect(adopted).toEqual({ nodes: 0, graphs: 0 });
  });

  it('a genuinely small universe is not inflated by the ratchet', () => {
    // Below the 5-node threshold the ratchet does not engage, so loading a
    // 2-thing universe after a 3-thing one behaves normally.
    saveCoordinator.dataBaseline = { nodes: 3, graphs: 1 };
    expect(saveCoordinator._adoptBaseline({ nodes: 0, graphs: 0 }, state(0), 'load'))
      .toEqual({ nodes: 0, graphs: 0 });
  });

  it('a normal load adopts its own counts, including a legitimate SHRINK', () => {
    // The ratchet must only catch a drop to ZERO. A universe that went from
    // 1822 to 900 things is ordinary editing, and pinning the baseline high
    // there would block saves forever.
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };
    expect(saveCoordinator._adoptBaseline({ nodes: 900, graphs: 100 }, state(900), 'load'))
      .toEqual({ nodes: 900, graphs: 100 });
  });

  it('counts flow from the real state, not from the caller', () => {
    // _adoptBaseline is always fed _countDataItems(state); this pins that the
    // pair agree, so the ratchet sees what the store actually holds.
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };

    const wiped = state(0, { baseSeeded: true });
    const adopted = saveCoordinator._adoptBaseline(saveCoordinator._countDataItems(wiped), wiped, 'load');
    expect(adopted.nodes).toBe(1822);

    const real = state(12);
    expect(saveCoordinator._adoptBaseline(saveCoordinator._countDataItems(real), real, 'load'))
      .toEqual({ nodes: 12, graphs: 0 });
  });
});
