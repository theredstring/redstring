/**
 * SaveCoordinator: the single debounced save pipeline.
 *
 * These tests were first written against a pre-release design (priority
 * queues in `pendingChanges`, per-priority `saveTimers`, drag inferred from
 * update frequency, direct `forceCommit` calls with a git rate limit). The
 * coordinator shipped without any of that ("SIMPLIFIED: No priorities"): every
 * change goes through one debounce, drags are announced by the change context,
 * and Git pacing belongs to the engine and GitAutosavePolicy. The intents are
 * kept and asserted against the current pipeline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

// Worker debounce (500) + write debounce (1000) + dispatch, with room to spare.
const SAVE_MS = 2000;

const makeState = (names = []) => ({
  graphs: new Map([['g1', { id: 'g1', name: 'Graph1', instances: new Map(), edgeIds: [] }]]),
  nodePrototypes: new Map(names.map((n) => [n, { id: n, name: n }])),
  edges: new Map(),
  isUniverseLoading: false,
  universeLoadingError: null,
  hasUniverseFile: true
});

describe('SaveCoordinator', () => {
  let mockFileStorage, mockGitSyncEngine;

  const resetCoordinator = () => {
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) {
      saveCoordinator.endLoad(token);
    }
    saveCoordinator.cancelPendingSaves();
    saveCoordinator.setEnabled(false);
    saveCoordinator.fileStorage = null;
    saveCoordinator.gitSyncEngine = null;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.isSaving = false;
    saveCoordinator.lastSaveHash = null;
    saveCoordinator.lastError = null;
    saveCoordinator._lastInteractionEndTime = 0;
    saveCoordinator._lastInteractionTouchTime = 0;
    saveCoordinator.nextStateToProcess = null;
    saveCoordinator.statusHandlers.clear();
  };

  // initialize() tries to start a module worker; tests hash on the main
  // thread (the same fallback mobile Safari uses) and count as loaded.
  const init = () => {
    saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine);
    saveCoordinator.saveWorker = null;
    saveCoordinator.hasLoadedFromFile = true;
  };

  beforeEach(() => {
    resetCoordinator();

    mockFileStorage = {
      saveToFile: vi.fn().mockResolvedValue({ success: true })
    };

    mockGitSyncEngine = {
      sourceOfTruth: 'local',
      updateState: vi.fn(),
      forceCommit: vi.fn().mockResolvedValue(true),
      isHealthy: vi.fn().mockReturnValue(true),
      isRunning: true
    };
  });

  afterEach(() => {
    resetCoordinator();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with dependencies', () => {
      saveCoordinator.initialize(mockFileStorage, mockGitSyncEngine);

      expect(saveCoordinator.isEnabled).toBe(true);
      expect(saveCoordinator.fileStorage).toBe(mockFileStorage);
      expect(saveCoordinator.gitSyncEngine).toBe(mockGitSyncEngine);
    });

    it('ignores every change until initialized', async () => {
      vi.useFakeTimers();
      saveCoordinator.fileStorage = mockFileStorage;
      saveCoordinator.hasLoadedFromFile = true;

      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_add' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(saveCoordinator.isEnabled).toBe(false);
      expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
      expect(mockFileStorage.saveToFile).not.toHaveBeenCalled();
    });
  });

  describe('Change classification', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      init();
    });

    it('a content change is saved to the local file and handed to Git', async () => {
      const state = makeState(['a']);
      saveCoordinator.onStateChange(state, { type: 'prototype_create' });
      expect(saveCoordinator.hasUnsavedChanges()).toBe(true);

      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
      expect(mockFileStorage.saveToFile.mock.calls[0][0]).toBe(state);
      expect(mockGitSyncEngine.updateState).toHaveBeenCalledWith(state);
      expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
    });

    it('a viewport change never starts a save', async () => {
      saveCoordinator.onStateChange(makeState(), { type: 'viewport' });
      expect(saveCoordinator.hasUnsavedChanges()).toBe(false);

      await vi.advanceTimersByTimeAsync(SAVE_MS * 2);
      expect(mockFileStorage.saveToFile).not.toHaveBeenCalled();
    });

    it('a load becomes the baseline and is not written back', async () => {
      saveCoordinator.hasLoadedFromFile = false;
      saveCoordinator.onStateChange(makeState(['a']), { type: 'load' });

      await vi.advanceTimersByTimeAsync(SAVE_MS * 2);
      expect(saveCoordinator.hasLoadedFromFile).toBe(true);
      expect(mockFileStorage.saveToFile).not.toHaveBeenCalled();
    });
  });

  describe('Change batching', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      init();
    });

    it('batches a flurry of changes into one save of the latest state', async () => {
      const state1 = makeState(['1']);
      const state2 = makeState(['1', '2']);

      saveCoordinator.onStateChange(state1, { type: 'prototype_create' });
      await vi.advanceTimersByTimeAsync(100);
      saveCoordinator.onStateChange(state2, { type: 'prototype_create' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
      expect(mockFileStorage.saveToFile.mock.calls[0][0]).toBe(state2);
    });

    it('does not write again when the content has not changed', async () => {
      const state = makeState(['a']);
      saveCoordinator.onStateChange(state, { type: 'node_update' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);
      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_update' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Drag gating', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      init();
    });

    it('holds saves while a drag is in progress', async () => {
      const context = { type: 'node_position', isDragging: true, phase: 'move' };
      saveCoordinator.onStateChange(makeState(['a']), context);
      await vi.advanceTimersByTimeAsync(50);
      saveCoordinator.onStateChange(makeState(['a', 'b']), context);

      expect(saveCoordinator.isGlobalDragging).toBe(true);
      expect(saveCoordinator.isDirty).toBe(true);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFileStorage.saveToFile).not.toHaveBeenCalled();
    });

    it('saves the final position once the drag ends', async () => {
      const move = { type: 'node_position', isDragging: true, phase: 'move' };
      saveCoordinator.onStateChange(makeState(['a']), move);
      await vi.advanceTimersByTimeAsync(50);
      const final = makeState(['a', 'b']);
      saveCoordinator.onStateChange(final, { type: 'node_position', phase: 'end' });

      expect(saveCoordinator.isGlobalDragging).toBe(false);
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
      expect(mockFileStorage.saveToFile.mock.calls[0][0]).toBe(final);
    });
  });

  describe('Force Save', () => {
    beforeEach(() => {
      init();
    });

    it('should force immediate save to both local and git', async () => {
      const mockState = makeState(['a']);

      await expect(saveCoordinator.forceSave(mockState)).resolves.toBe(true);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledWith(
        mockState, false, expect.objectContaining({ preSerialized: false })
      );
      expect(mockGitSyncEngine.updateState).toHaveBeenCalledWith(mockState);
    });

    it('should clear pending changes after force save', async () => {
      vi.useFakeTimers();
      const mockState = makeState(['a']);

      saveCoordinator.onStateChange(mockState, { type: 'node_place' });
      expect(saveCoordinator.hasUnsavedChanges()).toBe(true);

      await saveCoordinator.forceSave(mockState);

      expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
      // The debounced save it replaced does not write a second time.
      await vi.advanceTimersByTimeAsync(SAVE_MS);
      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      const mockState = makeState(['a']);
      mockFileStorage.saveToFile.mockRejectedValue(new Error('Save failed'));

      await expect(saveCoordinator.forceSave(mockState)).rejects.toThrow('Save failed');
      expect(saveCoordinator.isSaving).toBe(false);
      expect(saveCoordinator.hasUnsavedChanges()).toBe(true);
    });

    it('refuses when not initialized', async () => {
      saveCoordinator.setEnabled(false);
      await expect(saveCoordinator.forceSave(makeState(['a']))).rejects.toThrow('not initialized');
      expect(mockFileStorage.saveToFile).not.toHaveBeenCalled();
    });
  });

  describe('Git hand-off', () => {
    // Commit pacing (the old "minimum git commit interval") lives in the
    // engine and GitAutosavePolicy; the coordinator only queues state.
    beforeEach(() => {
      vi.useFakeTimers();
      init();
    });

    it('queues state with the engine and never commits directly', async () => {
      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_place' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockGitSyncEngine.updateState).toHaveBeenCalledTimes(1);
      expect(mockGitSyncEngine.forceCommit).not.toHaveBeenCalled();
    });

    it('does not hand state to an unhealthy engine, but still saves locally', async () => {
      mockGitSyncEngine.isHealthy.mockReturnValue(false);
      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_place' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockGitSyncEngine.updateState).not.toHaveBeenCalled();
      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status Reporting', () => {
    beforeEach(() => {
      init();
    });

    it('should report current status', () => {
      const status = saveCoordinator.getStatus();

      expect(status).toHaveProperty('isEnabled', true);
      expect(status).toHaveProperty('isSaving', false);
      expect(status).toHaveProperty('hasPendingSave');
      expect(status).toHaveProperty('lastError', null);
      expect(status).toHaveProperty('gitAutosavePolicy');
    });

    it('reports no pending save once the save has landed', async () => {
      vi.useFakeTimers();
      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_place' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
      expect(saveCoordinator.getStatus().hasPendingSave).toBe(false);
    });

    it('should call status handlers on status changes', () => {
      const statusHandler = vi.fn();
      saveCoordinator.onStatusChange(statusHandler);

      saveCoordinator.notifyStatus('info', 'Test message');

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          message: 'Test message'
        })
      );
    });

    it('stops calling a handler once it unsubscribes', () => {
      const statusHandler = vi.fn();
      const unsubscribe = saveCoordinator.onStatusChange(statusHandler);
      unsubscribe();

      saveCoordinator.notifyStatus('info', 'Test message');
      expect(statusHandler).not.toHaveBeenCalled();
    });
  });

  describe('Web switches after a save', () => {
    // A finished save must not leave the pipeline looking busy, or a later
    // web switch on a Git-backed universe skips its wait and rewrites the file.
    it('a web switch still waits after an earlier edit has saved', async () => {
      vi.useFakeTimers();
      mockGitSyncEngine.sourceOfTruth = 'git';
      init();

      saveCoordinator.onStateChange(makeState(['a']), { type: 'node_add' });
      await vi.advanceTimersByTimeAsync(SAVE_MS);
      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);

      const switched = { ...makeState(['a']), activeGraphId: 'g2' };
      saveCoordinator.onStateChange(switched, { type: 'active_graph_change', navigationOnly: true });
      await vi.advanceTimersByTimeAsync(SAVE_MS);

      expect(mockFileStorage.saveToFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('Hash Generation', () => {
    it('should generate consistent hashes for same content', () => {
      const state1 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1' }]]),
        nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node1' }]]),
        edges: new Map()
      };

      const state2 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1' }]]),
        nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node1' }]]),
        edges: new Map()
      };

      const hash1 = saveCoordinator.generateStateHash(state1);
      const hash2 = saveCoordinator.generateStateHash(state2);

      expect(hash1).toBe(hash2);
    });

    it('changes when content changes', () => {
      const base = { graphs: new Map(), nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node1' }]]), edges: new Map() };
      const renamed = { graphs: new Map(), nodePrototypes: new Map([['n1', { id: 'n1', name: 'Node2' }]]), edges: new Map() };

      expect(saveCoordinator.generateStateHash(base)).not.toBe(saveCoordinator.generateStateHash(renamed));
    });

    it('should ignore viewport changes in hash', () => {
      const state1 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1', panOffset: { x: 0, y: 0 }, zoomLevel: 1 }]]),
        nodePrototypes: new Map(),
        edges: new Map()
      };

      const state2 = {
        graphs: new Map([['g1', { id: 'g1', name: 'Graph1', panOffset: { x: 100, y: 100 }, zoomLevel: 2 }]]),
        nodePrototypes: new Map(),
        edges: new Map()
      };

      const hash1 = saveCoordinator.generateStateHash(state1);
      const hash2 = saveCoordinator.generateStateHash(state2);

      expect(hash1).toBe(hash2); // Should be same despite different viewport
    });
  });
});
