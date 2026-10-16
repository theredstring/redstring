import { describe, it, expect, vi } from 'vitest';
import useGraphStore, { onUniverseLoaded } from '../../src/store/graphStore.js';
import { universeBackend } from '../../src/services/universeBackend.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const emptyState = () => ({
  graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), edgePrototypes: new Map(),
  openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null, expandedGraphIds: new Set(),
  rightPanelTabs: [], savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
});

describe('every universe load is announced (shared-universe lineage)', () => {
  it('the store calls listeners with what it loaded', () => {
    const listener = vi.fn();
    const off = onUniverseLoaded(listener);
    const state = emptyState();
    expect(useGraphStore.getState().loadUniverseFromFile(state)).toBe(true);
    off();
    expect(listener).toHaveBeenCalledWith(state);
  });

  it('a load the backend did not make clears the active universe\'s merge base', () => {
    // Second review: the menu's Open and "Use Linked File" replaced the store
    // without telling sync, so the old base merged the new content's gaps as deletions.
    const backend = Object.create(UniverseBackend.prototype);
    const engine = { adoptBase: vi.fn(), invalidateRemoteObservation: vi.fn() };
    backend.activeUniverseSlug = 'shared';
    backend.gitSyncEngines = new Map([['shared', engine]]);
    backend.remoteObservations = new Map([['shared', { sha: 'old' }]]);
    backend._onStoreLoaded(emptyState());
    expect(engine.adoptBase).toHaveBeenCalledWith(null);
    expect(engine.invalidateRemoteObservation).toHaveBeenCalled();
    expect(backend.remoteObservations.has('shared')).toBe(false);
  });

  it('the backend\'s own loads are left to its wrapper', () => {
    const backend = Object.create(UniverseBackend.prototype);
    const engine = { adoptBase: vi.fn(), invalidateRemoteObservation: vi.fn() };
    backend.activeUniverseSlug = 'shared';
    backend.gitSyncEngines = new Map([['shared', engine]]);
    backend.remoteObservations = new Map();
    const state = emptyState();
    backend._wrapperLoadState = state;
    backend._onStoreLoaded(state);
    expect(engine.adoptBase).not.toHaveBeenCalled();
  });
});
