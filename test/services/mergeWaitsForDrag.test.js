// A merge saved while this person is dragging is laid onto the canvas only
// once the drag ends (the remote watch already waited; this path didn't).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { saveCoordinator } from '../../src/backend/sync/index.js';
import { importFromRedstring } from '../../src/formats/redstringFormat.js';

const doc = (names) => importFromRedstring({ prototypeSpace: { prototypes: Object.fromEntries(names.map((n) => [n, { name: n }])) }, spatialGraphs: {} }).storeState;

describe('a merge during a drag', () => {
  const saved = {};
  afterEach(() => {
    saveCoordinator.isGlobalDragging = false;
    Object.assign(universeBackend, saved);
    vi.useRealTimers();
  });

  it('waits for the drag to end before touching the canvas', async () => {
    vi.useFakeTimers();
    Object.assign(saved, { activeUniverseSlug: universeBackend.activeUniverseSlug, storeOperations: universeBackend.storeOperations });
    let live = doc(['Tree']);
    const applied = [];
    universeBackend.activeUniverseSlug = 'forest';
    universeBackend.storeOperations = {
      getState: () => live,
      applyRemoteDocument: (d) => { applied.push(d); live = { ...live, ...d }; return true; }
    };
    vi.spyOn(universeBackend, '_announceRemoteChanges').mockImplementation(() => {});
    vi.spyOn(universeBackend, '_markSyncedIfShared').mockImplementation(() => {});

    saveCoordinator.isGlobalDragging = true;
    const pending = universeBackend._applyMergedState('forest', doc(['Tree']), doc(['Tree', 'Bird']), { theirs: { added: [], changed: [], deleted: [] }, conflicts: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(applied).toHaveLength(0);

    saveCoordinator.isGlobalDragging = false;
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(applied).toHaveLength(1);
    expect(live.nodePrototypes.has('Bird')).toBe(true);
  });
});
