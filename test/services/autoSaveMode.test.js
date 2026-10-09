/**
 * Autosave: Automatic (on while a universe is under 5,000 Things plus webs and
 * 100 MB), Always, or Never (Settings → Data). With autosave off, changes are
 * still noticed but nothing is written until the user saves (saveNow: the
 * indicator's Save, the Universes panel, Cmd+S, "Save" when closing); hiding
 * the app doesn't save; closing or switching universes asks first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';
import { __resetCameraActivity } from '../../src/services/cameraActivity.js';
import {
  setAutoSaveMode, getAutoSaveMode, autoSaves, AUTO_SAVE_MAX_ITEMS, AUTO_SAVE_MAX_BYTES, DEFAULT_AUTO_SAVE_MODE
} from '../../src/services/autoSaveMode.js';
import { resolveSaveStatus } from '../../src/utils/saveStatus.js';
import {
  settleUnsavedChanges, answerUnsavedChanges, hasChangesOnlyASaveKeeps, setUnsavedChangesDialogMounted
} from '../../src/components/canvas/dialogs/unsavedChanges.js';
import { useCanvasDialogStore } from '../../src/components/canvas/dialogs/canvasDialogs.js';

// Worker debounce (500) + write debounce (1000) + dispatch, with room to spare.
const NORMAL_SAVE_MS = 2000;

const universe = ({ size = 10, name = 'Thing', activeGraphId = 'g1' } = {}) => ({
  graphs: new Map([
    ['g1', { id: 'g1', name: 'One', instances: new Map(), edgeIds: [] }],
    ['g2', { id: 'g2', name: 'Two', instances: new Map(), edgeIds: [] }],
  ]),
  nodePrototypes: new Map(Array.from({ length: size }, (_, i) => [`p${i}`, { id: `p${i}`, name: `${name} ${i}` }])),
  edges: new Map(),
  openGraphIds: ['g1', 'g2'],
  activeGraphId,
  isUniverseLoading: false,
  universeLoadingError: null,
  hasUniverseFile: true,
});

const EDIT = { type: 'prototype_update', navigationOnly: false };

describe('autoSaves', () => {
  it('Automatic saves on its own below both limits only; Always and Never ignore size', () => {
    expect(DEFAULT_AUTO_SAVE_MODE).toBe('auto');
    expect(autoSaves('auto', { items: AUTO_SAVE_MAX_ITEMS - 1, bytes: AUTO_SAVE_MAX_BYTES - 1 })).toBe(true);
    expect(autoSaves('auto', { items: AUTO_SAVE_MAX_ITEMS, bytes: 0 })).toBe(false);
    expect(autoSaves('auto', { items: 10, bytes: AUTO_SAVE_MAX_BYTES })).toBe(false);
    expect(autoSaves('always', { items: 1e6, bytes: 1e10 })).toBe(true);
    expect(autoSaves('off', { items: 1, bytes: 1 })).toBe(false);
  });
});

describe('SaveCoordinator with autosave off', () => {
  let fileStorage;
  let base;

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
    saveCoordinator.gitSyncEngine = null;
    saveCoordinator.lastFileBytes = 0;
    base = universe();
    saveCoordinator.lastSaveHash = saveCoordinator.generateStateHash(base);
    __resetCameraActivity();
    setAutoSaveMode('off');
  });

  afterEach(() => {
    setAutoSaveMode('auto');
    saveCoordinator.cancelPendingSaves();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('notices an edit but writes nothing, and hiding the app writes nothing', async () => {
    saveCoordinator.onStateChange(universe({ name: 'Edited' }), EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS * 5);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(saveCoordinator.hasUnsavedChanges()).toBe(true);
    expect(await saveCoordinator.flush('tab-hidden')).toBe(false);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(hasChangesOnlyASaveKeeps()).toBe(true);
  });

  it('saveNow writes the newest state once and leaves nothing unsaved', async () => {
    const edited = universe({ name: 'Edited' });
    saveCoordinator.onStateChange(edited, EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    const saving = saveCoordinator.saveNow();
    expect(saveCoordinator.manualSaveRequested).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(await saving).toBe(true);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
    expect(saveCoordinator.manualSaveRequested).toBe(false);
    // Nothing else follows on its own.
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS * 5);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('saveNow straight after an edit, before it has been hashed, still writes that edit', async () => {
    const edited = universe({ name: 'Edited' });
    saveCoordinator.onStateChange(edited, EDIT);
    const saving = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(await saving).toBe(true);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
  });

  it('saveNow writes the newest state when a pan came after the edit', async () => {
    saveCoordinator.onStateChange(universe({ name: 'Edited' }), EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    const panned = universe({ name: 'Edited' });
    saveCoordinator.onStateChange(panned, { type: 'viewport' });
    const saving = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(await saving).toBe(true);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(panned);
  });

  it('through the worker: writes the worker\'s bytes for the newest state, a pan included', async () => {
    // A stand-in worker: replies with the state's hash and bytes naming the pass.
    let pass = 0;
    saveCoordinator.saveWorker = {
      terminate: () => {},
      postMessage: () => {
        const state = saveCoordinator.lastState;
        const n = ++pass;
        setTimeout(() => saveCoordinator.handleWorkerMessage({ data: {
          type: 'save_processed', success: true,
          hash: saveCoordinator.generateStateHash(state),
          jsonBytes: new TextEncoder().encode(`pass ${n}`),
        } }), 50);
      },
    };
    saveCoordinator.onStateChange(universe({ name: 'Edited' }), EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(pass).toBe(1);
    const panned = universe({ name: 'Edited' });
    saveCoordinator.onStateChange(panned, { type: 'viewport' });
    const saving = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(200);
    expect(await saving).toBe(true);
    expect(pass).toBe(2);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    const [written, , options] = fileStorage.saveToFile.mock.calls[0];
    expect(written).toBe(panned);
    expect(new TextDecoder().decode(options.serializedData)).toBe('pass 2');
    expect(saveCoordinator.lastFileBytes).toBe(6);
  });

  it('saveNow with nothing changed writes nothing and says saved', async () => {
    saveCoordinator.lastState = base;
    expect(await saveCoordinator.saveNow()).toBe(true);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
  });

  it('a save that fails says so, keeps the changes, and is not retried on its own', async () => {
    fileStorage.saveToFile.mockResolvedValueOnce({ failed: true, reason: 'disk full' });
    saveCoordinator.onStateChange(universe({ name: 'Edited' }), EDIT);
    const saving = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(await saving).toBe(false);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(120000);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    // The next Save goes through.
    const again = saveCoordinator.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(await again).toBe(true);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });

  it('turning autosave back on writes what was waiting', async () => {
    const edited = universe({ name: 'Edited' });
    saveCoordinator.onStateChange(edited, EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    setAutoSaveMode('always');
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);
  });

  it('Automatic autosaves a small universe and not one past the limits', async () => {
    setAutoSaveMode('auto');
    saveCoordinator.onStateChange(universe({ name: 'Edited' }), EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);

    saveCoordinator.onStateChange(universe({ size: AUTO_SAVE_MAX_ITEMS, name: 'Big' }), EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS * 3);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(true);
    expect(saveCoordinator.autoSaveActive()).toBe(false);

    // A small universe whose file is past 100 MB (images) waits too.
    saveCoordinator.lastFileBytes = AUTO_SAVE_MAX_BYTES;
    expect(saveCoordinator.autoSaveActive(universe())).toBe(false);
  });
});

describe('the indicator with autosave off', () => {
  it('offers Save instead of "Saving...", and never calls holding changes a stall', () => {
    const base = { universeReady: true, hasUnsavedChanges: true, manualSave: true };
    expect(resolveSaveStatus(base)).toMatchObject({ text: 'Save', isCTA: true, action: 'save' });
    expect(resolveSaveStatus({ ...base, dirtyStalled: true }).text).toBe('Save');
    expect(resolveSaveStatus({ ...base, isSaving: true }).text).toBe('Saving...');
    expect(resolveSaveStatus({ ...base, isInteracting: true }).text).toBe(null);
    expect(resolveSaveStatus({ ...base, blockedReason: 'refused' }).text).toBe('Not saved');
    expect(resolveSaveStatus({ ...base, hasUnsavedChanges: false }).text).toBe('Saved');
    expect(resolveSaveStatus({ ...base, manualSave: false }).text).toBe('Saving...');
  });
});

describe('"Save changes?" before closing or switching', () => {
  let saveNow;
  let hasUnsaved;
  let autoSaveActive;

  beforeEach(() => {
    saveNow = vi.spyOn(saveCoordinator, 'saveNow').mockResolvedValue(true);
    hasUnsaved = vi.spyOn(saveCoordinator, 'hasUnsavedChanges').mockReturnValue(true);
    autoSaveActive = vi.spyOn(saveCoordinator, 'autoSaveActive').mockReturnValue(false);
    setUnsavedChangesDialogMounted(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesDialogMounted(false);
    useCanvasDialogStore.setState({ unsavedChangesDialog: null });
  });

  const answered = async (action, choice) => {
    const outcome = settleUnsavedChanges(action);
    await Promise.resolve();
    expect(useCanvasDialogStore.getState().unsavedChangesDialog?.action).toBe(action);
    answerUnsavedChanges(choice);
    return outcome;
  };

  it('asks nothing with autosave on, or with nothing unsaved', async () => {
    autoSaveActive.mockReturnValue(true);
    expect(await settleUnsavedChanges('quit')).toBe('none');
    autoSaveActive.mockReturnValue(false);
    hasUnsaved.mockReturnValue(false);
    expect(await settleUnsavedChanges('quit')).toBe('none');
    expect(useCanvasDialogStore.getState().unsavedChangesDialog).toBe(null);
  });

  it('Save saves (committing to Git on quit), Don\'t Save and Cancel don\'t', async () => {
    expect(await answered('quit', 'save')).toBe('saved');
    expect(saveNow).toHaveBeenCalledWith({ terminal: true });
    expect(await answered('switch', 'discard')).toBe('discard');
    expect(await answered('switch', 'cancel')).toBe('cancel');
    expect(saveNow).toHaveBeenCalledTimes(1);
  });

  it('a chosen save that doesn\'t land cancels, so nothing is left behind', async () => {
    saveNow.mockResolvedValue(false);
    expect(await answered('quit', 'save')).toBe('cancel');
  });

  it('with no dialog to answer, saves rather than waiting forever', async () => {
    setUnsavedChangesDialogMounted(false);
    expect(await settleUnsavedChanges('quit')).toBe('saved');
    expect(saveNow).toHaveBeenCalledTimes(1);
  });
});

describe('the setting', () => {
  it('remembers the choice on this device', () => {
    setAutoSaveMode('off');
    expect(getAutoSaveMode()).toBe('off');
    expect(localStorage.getItem('redstring_auto_save_mode')).toBe('off');
    setAutoSaveMode('nonsense');
    expect(getAutoSaveMode()).toBe('off');
    setAutoSaveMode('auto');
  });
});
