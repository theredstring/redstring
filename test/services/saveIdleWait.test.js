/**
 * Saves wait for the person to be idle: no change and the camera still for a
 * moment, before the local write starts, and longer before a Git commit. A
 * save that started the moment something changed ran under the next pan or
 * edit on a big universe. None of this may cost a save: someone who never
 * stops is still saved, a save they ask for doesn't wait, closing or hiding
 * the app writes straight away, and a clock set back stalls nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';
import { markCameraMoved, markEdited, __resetCameraActivity } from '../../src/services/cameraActivity.js';
import { setAutoSaveMode } from '../../src/services/autoSaveMode.js';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { GitAutosavePolicy } from '../../src/services/GitAutosavePolicy.js';

// Idle window (1500) + write debounce (1000) + dispatch, with room to spare.
const SAVE_MS = 3000;

const universe = ({ x = 0, extraName = null } = {}) => {
  const nodePrototypes = new Map([['p1', { id: 'p1', name: 'Thing' }]]);
  if (extraName) nodePrototypes.set('extra', { id: 'extra', name: extraName });
  return {
    graphs: new Map([
      ['g1', { id: 'g1', name: 'One', instances: new Map([['i1', { id: 'i1', prototypeId: 'p1', x, y: 0, scale: 1 }]]), edgeIds: [] }],
    ]),
    nodePrototypes,
    edges: new Map(),
    openGraphIds: ['g1'],
    activeGraphId: 'g1',
    isUniverseLoading: false,
    universeLoadingError: null,
    hasUniverseFile: true,
  };
};

const EDIT = { type: 'prototype_update', navigationOnly: false };

// Pan for `ms`: the camera moves every frame.
const pan = async (ms) => {
  for (let t = 0; t < ms; t += 50) {
    markCameraMoved();
    await vi.advanceTimersByTimeAsync(50);
  }
};

describe('SaveCoordinator: the local write waits for the person to be idle', () => {
  let fileStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    fileStorage = { saveToFile: vi.fn().mockResolvedValue({ success: true }) };
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) saveCoordinator.endLoad(token);
    saveCoordinator.cancelPendingSaves();
    saveCoordinator.saveWorker = null;
    saveCoordinator.fileStorage = fileStorage;
    saveCoordinator.isEnabled = true;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.isSaving = false;
    saveCoordinator.isGlobalDragging = false;
    saveCoordinator._lastInteractionEndTime = 0;
    saveCoordinator.hasLoadedFromFile = true;
    saveCoordinator.nextStateToProcess = null;
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

  it('nothing starts within the idle window of an edit', async () => {
    saveCoordinator.onStateChange(universe({ extraName: 'Edit' }), EDIT);
    await vi.advanceTimersByTimeAsync(1400);
    expect(saveCoordinator.lastState).toBeNull(); // not even the worker's pass
    expect(saveCoordinator.hasUnsavedChanges()).toBe(true); // the indicator says "Saving..."
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('panning after an edit holds the save until the camera has been still for the window', async () => {
    const edited = universe({ extraName: 'Edit' });
    saveCoordinator.onStateChange(edited, EDIT);
    await pan(5000);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(saveCoordinator.isWaitingForQuiet()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
  });

  it('panning alone saves nothing', async () => {
    const panned = universe();
    await pan(1000);
    saveCoordinator.onStateChange(panned, { type: 'viewport' });
    await vi.advanceTimersByTimeAsync(SAVE_MS * 3);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });

  it('someone who never stops editing is still saved', async () => {
    for (let i = 1; i <= 50; i++) {
      saveCoordinator.onStateChange(universe({ extraName: `Edit ${i}` }), EDIT);
      await vi.advanceTimersByTimeAsync(400);
    }
    // 20 s of edits 0.4 s apart: never idle, saved anyway, every
    // MAX_QUIET_WAIT_MS or so.
    expect(fileStorage.saveToFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    // And once they stop, the last edit is saved too.
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    const calls = fileStorage.saveToFile.mock.calls;
    expect(calls[calls.length - 1][0].nodePrototypes.get('extra').name).toBe('Edit 50');
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });

  it('a save the person asks for does not wait', async () => {
    const edited = universe({ extraName: 'Edit' });
    saveCoordinator.onStateChange(edited, EDIT);
    const saving = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(await saving).toBe(true);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
  });

  it('closing the app while a save waits writes straight away', async () => {
    const edited = universe({ extraName: 'Edit' });
    saveCoordinator.onStateChange(edited, EDIT);
    markCameraMoved();
    await saveCoordinator.flush('electron-quit', { terminal: true });
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
    expect(saveCoordinator.isWaitingForQuiet()).toBe(false);
  });

  it('a clock set back does not stall a save', async () => {
    saveCoordinator.onStateChange(universe({ extraName: 'Edit' }), EDIT);
    markCameraMoved();
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });
});

describe('Git commits wait for the person to be idle', () => {
  const store = (names) => ({
    graphs: new Map(),
    nodePrototypes: new Map(names.map((n) => [n, { id: n, name: n }])),
    edges: new Map()
  });

  let written;
  let engine;

  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
    __resetCameraActivity();
    written = [];
    const provider = {
      name: 'stub',
      async writeFileRaw(path, content) {
        written.push(content);
        return { content: { sha: `sha-${written.length}` } };
      }
    };
    engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-0';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('the background commit waits until the person has been idle', async () => {
    markEdited();
    engine.updateState(store(['Tree']));
    engine.lastCommitTime = 0;
    await vi.advanceTimersByTimeAsync(1000);
    await engine.processPendingCommits();
    expect(written).toHaveLength(0);
    await pan(1500);
    await engine.processPendingCommits();
    expect(written).toHaveLength(0);
    expect(engine.hasChanges).toBe(true); // kept, not dropped
    await vi.advanceTimersByTimeAsync(3000);
    await engine.processPendingCommits();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('Tree');
    expect(engine.hasChanges).toBe(false);
  });

  it('someone who never stops is committed once a change has waited long enough', async () => {
    engine.updateState(store(['Tree']));
    engine.lastCommitTime = 0;
    for (let i = 0; i < 31; i++) {
      markEdited();
      await vi.advanceTimersByTimeAsync(1000);
      await engine.processPendingCommits();
    }
    expect(written).toHaveLength(1);
  });

  it('a hidden app commits straight away', async () => {
    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
      || Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      markEdited();
      engine.updateState(store(['Tree']));
      engine.lastCommitTime = 0;
      await engine.processPendingCommits();
      expect(written).toHaveLength(1);
    } finally {
      delete document.visibilityState;
      if (visibility && !Object.getOwnPropertyDescriptor(document, 'visibilityState')) {
        expect(document.visibilityState).toBe('visible');
      }
    }
  });

  it('a commit the person asks for does not wait', async () => {
    markEdited();
    markCameraMoved();
    expect(await engine.forceCommit(store(['Tree']))).toBe(true);
    expect(written).toHaveLength(1);
  });

  it('the autosave policy waits too, then commits', async () => {
    const commits = [];
    const policyEngine = {
      sourceOfTruth: 'git',
      isIdleEnoughToCommit: engine.isIdleEnoughToCommit.bind(engine),
      forceCommit: vi.fn(async (s) => { commits.push(s); })
    };
    const policy = new GitAutosavePolicy();
    policy.getCurrentState = () => store(['Tree']);
    policy.checkFileSize = () => true;
    policy.initialize(policyEngine, null);
    markEdited();
    policy.onEditActivity();
    // Its 10 s idle timer comes due mid-pan.
    await vi.advanceTimersByTimeAsync(9000);
    await pan(4000);
    expect(commits).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(commits).toHaveLength(1);
    policy.destroy();
  });
});
