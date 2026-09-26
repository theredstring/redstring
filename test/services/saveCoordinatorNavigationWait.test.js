/**
 * Switching webs on a Git-backed universe waits before it saves.
 *
 * The file remembers which webs are open and which is active, so a switch is
 * a real change to it — but not an edit, and it rewrote the whole universe on
 * every click. On a Git-backed universe a switch now waits a few seconds, or
 * rides along with the next real edit. A universe whose local file is the
 * source of truth saves a switch straight away, as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

const WAIT_MS = 3000;
// Worker debounce (500) + write debounce (1000) + dispatch, with room to spare.
const NORMAL_SAVE_MS = 2000;

const stateWith = ({ activeGraphId = 'g1', names = ['dog'] } = {}) => ({
  graphs: new Map([
    ['g1', { id: 'g1', name: 'One', instances: new Map(), edgeIds: [] }],
    ['g2', { id: 'g2', name: 'Two', instances: new Map(), edgeIds: [] }]
  ]),
  nodePrototypes: new Map(names.map((n) => [n, { id: n, name: n }])),
  edges: new Map(),
  openGraphIds: ['g1', 'g2'],
  activeGraphId,
  isUniverseLoading: false,
  universeLoadingError: null,
  hasUniverseFile: true
});

const NAV = { type: 'active_graph_change', navigationOnly: true };
const EDIT = { type: 'node_add', navigationOnly: false };

describe('SaveCoordinator: web switches wait on a Git-backed universe', () => {
  let fileStorage;

  const useEngine = (sourceOfTruth) => {
    saveCoordinator.gitSyncEngine = {
      sourceOfTruth,
      updateState: vi.fn(),
      forceCommit: vi.fn().mockResolvedValue(true),
      isHealthy: () => true
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fileStorage = { saveToFile: vi.fn().mockResolvedValue({ success: true }) };
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) {
      saveCoordinator.endLoad(token);
    }
    saveCoordinator.cancelPendingSaves();
    saveCoordinator.saveWorker = null; // main-thread hashing, as in any test
    saveCoordinator.fileStorage = fileStorage;
    saveCoordinator.isEnabled = true;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.isSaving = false;
    saveCoordinator._lastInteractionEndTime = 0;
    saveCoordinator.hasLoadedFromFile = true;
    saveCoordinator.nextStateToProcess = null;
    // The loaded universe was last saved on g1.
    saveCoordinator.lastSaveHash = saveCoordinator.generateStateHash(stateWith());
    useEngine('git');
  });

  afterEach(() => {
    saveCoordinator.cancelPendingSaves();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not start a save, or say it is saving, during the wait', async () => {
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    await vi.advanceTimersByTimeAsync(WAIT_MS - 100);

    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });

  it('saves the switch once the wait is over', async () => {
    const switched = stateWith({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(switched, NAV);
    await vi.advanceTimersByTimeAsync(WAIT_MS + NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(switched);
    expect(saveCoordinator.hasUnsavedChanges()).toBe(false);
  });

  it('saves only once for several switches in a row', async () => {
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    await vi.advanceTimersByTimeAsync(1000);
    const last = stateWith({ activeGraphId: 'g1' });
    last.openGraphIds = ['g2', 'g1'];
    saveCoordinator.onStateChange(last, NAV);
    await vi.advanceTimersByTimeAsync(WAIT_MS + NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(last);
  });

  it('rides along with a real edit, which saves at the normal pace', async () => {
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    await vi.advanceTimersByTimeAsync(500);
    const edited = stateWith({ activeGraphId: 'g2', names: ['dog', 'cat'] });
    saveCoordinator.onStateChange(edited, EDIT);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(edited);

    // And the wait does not come back for a second write.
    await vi.advanceTimersByTimeAsync(WAIT_MS * 2);
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('never holds up an edit that is already on its way', async () => {
    saveCoordinator.onStateChange(stateWith({ names: ['dog', 'cat'] }), EDIT);
    await vi.advanceTimersByTimeAsync(100);
    const both = stateWith({ activeGraphId: 'g2', names: ['dog', 'cat'] });
    saveCoordinator.onStateChange(both, NAV);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(both);
  });

  it('is not cancelled by a camera move', async () => {
    const switched = stateWith({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(switched, NAV);
    await vi.advanceTimersByTimeAsync(1000);
    saveCoordinator.onStateChange(switched, { type: 'viewport' });
    await vi.advanceTimersByTimeAsync(WAIT_MS + NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('writes a waiting switch when the app quits', async () => {
    const switched = stateWith({ activeGraphId: 'g2' });
    saveCoordinator.onStateChange(switched, NAV);
    await vi.advanceTimersByTimeAsync(500);

    await saveCoordinator.flush('quit', { terminal: true });

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
    expect(fileStorage.saveToFile.mock.calls[0][0]).toBe(switched);
  });

  it('drops a waiting switch when the universe is switched away', async () => {
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    saveCoordinator.cancelPendingSaves();
    await vi.advanceTimersByTimeAsync(WAIT_MS + NORMAL_SAVE_MS);

    expect(saveCoordinator.navigationTimer).toBeNull();
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
  });

  it('saves straight away when the local file is the source of truth', async () => {
    useEngine('local');
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('saves straight away on a universe with no Git engine', async () => {
    saveCoordinator.gitSyncEngine = null;
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), NAV);
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });

  it('treats an unmarked change as an edit, whatever its type', async () => {
    // Only the middleware's explicit flag may make a change wait.
    saveCoordinator.onStateChange(stateWith({ activeGraphId: 'g2' }), { type: 'active_graph_change' });
    await vi.advanceTimersByTimeAsync(NORMAL_SAVE_MS);

    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);
  });
});
