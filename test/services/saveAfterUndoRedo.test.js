// Edit, undo inside the save delay, then redo: the redo must be saved. The
// coordinator recorded the undone change's hash as saved (it was waiting
// when the content went back), so the redo looked like nothing new and
// neither the file nor Git ever got it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

// Idle window (1500) + write debounce (1000) + dispatch, with room to spare.
const SAVE_MS = 3000;
const makeState = (names) => ({
  graphs: new Map([['g1', { id: 'g1', name: 'Graph1', instances: new Map(), edgeIds: [] }]]),
  nodePrototypes: new Map(names.map((n) => [n, { id: n, name: n }])),
  edges: new Map(),
  isUniverseLoading: false,
  universeLoadingError: null,
  hasUniverseFile: true
});

describe('save after edit, undo, redo', () => {
  let fileStorage, git;
  const reset = () => {
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) saveCoordinator.endLoad(token);
    saveCoordinator.cancelPendingSaves();
    saveCoordinator.setEnabled(false);
    Object.assign(saveCoordinator, { fileStorage: null, gitSyncEngine: null, swapInProgress: false, isSaving: false, lastSaveHash: null, lastError: null, _lastInteractionEndTime: 0, _lastInteractionTouchTime: 0, nextStateToProcess: null });
    saveCoordinator.pendingHash = null;
    saveCoordinator.statusHandlers.clear();
  };
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
    fileStorage = { saveToFile: vi.fn().mockResolvedValue({ success: true }) };
    git = { sourceOfTruth: 'local', updateState: vi.fn(), forceCommit: vi.fn().mockResolvedValue(true), isHealthy: () => true, isRunning: true };
    saveCoordinator.initialize(fileStorage, git);
    saveCoordinator.saveWorker = null; // main-thread hashing, as on mobile Safari
    saveCoordinator.hasLoadedFromFile = true;
  });
  afterEach(() => { reset(); vi.clearAllTimers(); vi.useRealTimers(); });

  it('the redo is written and handed to Git', async () => {
    saveCoordinator.onStateChange(makeState(['Tree']), { type: 'prototype_create' });
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);

    // Edit, then undo before the save delay runs out.
    saveCoordinator.onStateChange(makeState(['Tree', 'Bird']), { type: 'prototype_create' });
    await vi.advanceTimersByTimeAsync(600);
    saveCoordinator.onStateChange(makeState(['Tree']), { type: 'undo' });
    await vi.advanceTimersByTimeAsync(SAVE_MS);

    // Redo.
    const redone = makeState(['Tree', 'Bird']);
    saveCoordinator.onStateChange(redone, { type: 'redo' });
    await vi.advanceTimersByTimeAsync(SAVE_MS);

    expect(fileStorage.saveToFile.mock.calls.at(-1)[0]).toBe(redone);
    expect(git.updateState).toHaveBeenLastCalledWith(redone);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });
});
