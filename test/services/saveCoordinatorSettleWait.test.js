/**
 * On a big universe, switching or opening webs waits until nothing has
 * happened for 10 s before it saves, whatever the universe saves to: every
 * save of a big universe rewrites a big file, and each click between webs used
 * to start one. An edit saves on the normal schedule and takes a waiting
 * switch with it; closing or hiding the app writes it straight away. Moving a
 * Thing is an edit: a drop saves as soon as it settles. A small universe saves
 * switches as it always has.
 *
 * A universe this big saves on its own only with Autosave set to Always
 * (autoSaveMode.js); Automatic leaves it to the user, so these run on Always.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator, LARGE_UNIVERSE_SIZE } from '../../src/services/SaveCoordinator.js';
import { markCameraMoved, __resetCameraActivity } from '../../src/services/cameraActivity.js';
import { setAutoSaveMode } from '../../src/services/autoSaveMode.js';

const SETTLE_MS = 10000;
// Worker debounce (500) + write debounce (1000) + dispatch, with room to spare.
const NORMAL_SAVE_MS = 2000;

const universe = ({ size = LARGE_UNIVERSE_SIZE, x = 0, activeGraphId = 'g1', extraName = null } = {}) => {
  const nodePrototypes = new Map(Array.from({ length: size }, (_, i) => [`p${i}`, { id: `p${i}`, name: `Thing ${i}` }]));
  if (extraName) nodePrototypes.set('extra', { id: 'extra', name: extraName });
  return {
    graphs: new Map([
      ['g1', { id: 'g1', name: 'One', instances: new Map([['i1', { id: 'i1', prototypeId: 'p1', x, y: 0, scale: 1 }]]), edgeIds: [] }],
      ['g2', { id: 'g2', name: 'Two', instances: new Map(), edgeIds: [] }],
    ]),
    nodePrototypes,
    edges: new Map(),
    openGraphIds: ['g1', 'g2'],
    activeGraphId,
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
  };
};

const SWITCH = { type: 'active_graph_change', navigationOnly: true };
const EDIT = { type: 'prototype_update', navigationOnly: false };
const DRAG = { type: 'node_position', navigationOnly: false, isDragging: true, phase: 'move' };

describe('SaveCoordinator: web switches wait on a big universe', () => {
  let fileStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    fileStorage = { saveToFile: vi.fn().mockResolvedValue({ success: true }) };
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) saveCoordinator.endLoad(token);
    saveCoordinator.cancelPendingSaves();
    saveCoordinator.saveWorker = null; // main-thread hashing, as in any test
    saveCoordinator.fileStorage = fileStorage;
    saveCoordinator.isEnabled = true;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.isSaving = false;
    saveCoordinator.isGlobalDragging = false;
    saveCoordinator._lastInteractionEndTime = 0;
    saveCoordinator.hasLoadedFromFile = true;
    saveCoordinator.nextStateToProcess = null;
    // The local file is the source of truth: no Git wait applies.
    saveCoordinator.gitSyncEngine = null;
    saveCoordinator.lastSaveHash = saveCoordinator.generateStateHash(universe());
    __resetCameraActivity();
    setAutoSaveMode('always');
  });

  afterEach(() => {
    setAutoSaveMode('auto');
    saveCoordinator.cancelPendingSaves();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('a switch waits until nothing has happened for 10 s, then saves once, without saying "Saving..."', async () => {
    const switched = universe({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(switched, SWITCH);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
    await vi.advanceTimersByTimeAsync(100 + NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(switched);
  });

  it('every switch starts the wait again', async () => {
    saveCoordinator.onStateChange(universe({ activeGraphId: 'g2' }), SWITCH);
    await vi.advanceTimersByTimeAsync(6000);
    saveCoordinator.onStateChange(universe({ activeGraphId: 'g1' }), SWITCH);
    await vi.advanceTimersByTimeAsync(6000);
    const last = universe({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(last, SWITCH);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100 + NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(last);
  });

  it('an edit saves on the normal schedule and takes the waiting switch with it', async () => {
    saveCoordinator.onStateChange(universe({ activeGraphId: 'g2' }), SWITCH);
    await vi.advanceTimersByTimeAsync(1000);
    const edited = universe({ activeGraphId: 'g2', extraName: 'New thing' });
    saveCoordinator.onStateChange(edited, EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('a drop saves as soon as the drag ends, big universe or not', async () => {
    // A drag sends positions the whole time it moves.
    for (let i = 1; i <= 10; i++) {
      saveCoordinator.onStateChange(universe({ x: i * 3 }), DRAG);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fileStorage.saveToFile).not.toHaveBeenCalled(); // never mid-drag
    saveCoordinator.signalInteractionEnd();
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    // Where it was dropped.
    expect(fileStorage.saveToFile.mock.calls[0][0].graphs.get('g1').instances.get('i1').x).toBe(30);
  });

  it('closing or hiding the app writes a waiting switch straight away', async () => {
    const switched = universe({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(switched, SWITCH);
    await vi.advanceTimersByTimeAsync(500);
    await saveCoordinator.flush('electron-quit', { terminal: true });
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(switched);
  });

  it('a small universe saves a switch as it always has', async () => {
    saveCoordinator.lastSaveHash = saveCoordinator.generateStateHash(universe({ size: 20 }));
    saveCoordinator.onStateChange(universe({ size: 20, activeGraphId: 'g2' }), SWITCH);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('a save that comes due while the camera moves waits until it stops', async () => {
    const edited = universe({ extraName: 'Edit' });
    saveCoordinator.onStateChange(edited, EDIT);
    // Panning: the camera moves every frame from just before the save is due.
    await vi.advanceTimersByTimeAsync(1200);
    for (let i = 0; i < 60; i++) {
      markCameraMoved();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    // The camera stops; the save goes once it has been still for a moment.
    await vi.advanceTimersByTimeAsync(400);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
  });

  it('closing the app mid-pan still writes straight away', async () => {
    saveCoordinator.onStateChange(universe({ extraName: 'Edit' }), EDIT);
    markCameraMoved();
    await saveCoordinator.flush('electron-quit', { terminal: true });
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });
});
