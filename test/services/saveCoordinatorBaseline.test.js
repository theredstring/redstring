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

/**
 * The floor belongs to one universe. On 2026-09-26 a universe created from the
 * welcome screen, after a large one had been open, kept the large one's floor:
 * its first three things read as a 99% collapse, every save was refused
 * ("Unsaved"), and a reload found it empty. The `type:'load'` notice that
 * should have reset the floor had been replaced in the store's batch, so the
 * guard now follows the state's own universe stamp.
 */
describe('SaveCoordinator guard follows the universe', () => {
  beforeEach(() => {
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
    saveCoordinator.activeUniverseSlugForGuard = null;
    saveCoordinator.lastBlockReason = null;
    saveCoordinator.nextStateToProcess = null;
    try { window.localStorage.clear(); } catch { /* no storage */ }
  });

  afterEach(() => {
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
    saveCoordinator.activeUniverseSlugForGuard = null;
    saveCoordinator.lastBlockReason = null;
    saveCoordinator.nextStateToProcess = null;
    saveCoordinator.pendingHash = null;
    saveCoordinator.isDirty = false;
  });

  it('a new universe does not inherit the previous universe\'s floor', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'big-universe';
    saveCoordinator.dataBaseline = { nodes: 2001, graphs: 1 };
    const fresh = state(3, { slug: 'universe' });

    saveCoordinator._syncGuardUniverse(fresh._universeSlug);

    expect(saveCoordinator.activeUniverseSlugForGuard).toBe('universe');
    expect(saveCoordinator._isCatastrophicShrinkage(fresh)).toBe(false);
  });

  it('switching back restores that universe\'s own saved floor', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'big-universe';
    saveCoordinator.dataBaseline = { nodes: 2001, graphs: 1 };
    saveCoordinator._persistGuardState('big-universe');

    saveCoordinator._syncGuardUniverse('universe');
    expect(saveCoordinator.dataBaseline).toEqual({ nodes: 0, graphs: 0 });

    saveCoordinator._syncGuardUniverse('big-universe');
    expect(saveCoordinator.dataBaseline.nodes).toBe(2001);
    expect(saveCoordinator._isCatastrophicShrinkage(state(0, { slug: 'big-universe' }))).toBe(true);
  });

  it('the same universe keeps its floor, so a bad empty read is still refused', () => {
    saveCoordinator.activeUniverseSlugForGuard = 'claude-s-chambers-2';
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };

    saveCoordinator._syncGuardUniverse('claude-s-chambers-2');

    expect(saveCoordinator._isCatastrophicShrinkage(state(0))).toBe(true);
  });

  it('a floor set before any universe was known is kept, only tagged', () => {
    saveCoordinator.dataBaseline = { nodes: 1822, graphs: 191 };

    saveCoordinator._syncGuardUniverse('claude-s-chambers-2');

    expect(saveCoordinator.activeUniverseSlugForGuard).toBe('claude-s-chambers-2');
    expect(saveCoordinator.dataBaseline.nodes).toBe(1822);
  });

  it('a save made outside autosave (Save Now) clears what autosave was holding', () => {
    const saved = state(3, { slug: 'universe' });
    saveCoordinator.activeUniverseSlugForGuard = 'universe';
    saveCoordinator.dataBaseline = { nodes: 50, graphs: 1 };
    saveCoordinator.nextStateToProcess = saved;
    saveCoordinator.pendingHash = 'abc';
    saveCoordinator.isDirty = true;
    saveCoordinator.lastBlockReason = 'refused';

    saveCoordinator.markSavedExternally(saved);

    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
    expect(saveCoordinator.lastBlockReason).toBeNull();
    // A deliberate write becomes the floor, so autosave stops refusing it.
    expect(saveCoordinator._isCatastrophicShrinkage(saved)).toBe(false);
  });

  it('a newer edit made during Save Now is still saved by autosave', () => {
    const saved = state(3, { slug: 'universe' });
    const newer = state(4, { slug: 'universe' });
    saveCoordinator.activeUniverseSlugForGuard = 'universe';
    saveCoordinator.nextStateToProcess = newer;
    saveCoordinator.pendingHash = 'newer';
    saveCoordinator.isDirty = true;

    saveCoordinator.markSavedExternally(saved);

    expect(saveCoordinator.hasUnsavedChanges()).toBe(true);
  });
});
