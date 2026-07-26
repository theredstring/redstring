/**
 * Load gate: no write of any kind may happen while a universe read is in
 * flight.
 *
 * The bug this pins is mobile/tablet + Git specific. universeBackend's boot
 * path timeboxes the initial load to LOAD_TIMEOUT_MS (5s) and, on timeout,
 * calls setUniverseLoaded(true, true) to free the UI spinner while the Git
 * fetch keeps running in the background. A cold cellular fetch routinely
 * exceeds 5s, so the app spends real time in a state where:
 *
 *   - isUniverseLoading is false (released early, by design)
 *   - the store still holds pre-load content
 *   - every other guard is device-local and reads clean on a fresh browser
 *
 * Every previous fix inferred "is the store loaded?" from state shape. These
 * tests assert the positive signal instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveCoordinator } from '../../src/services/SaveCoordinator.js';

const emptyState = (overrides = {}) => ({
  graphs: new Map(),
  nodePrototypes: new Map(),
  edges: new Map(),
  isUniverseLoading: false,
  universeLoadingError: null,
  hasUniverseFile: true,
  ...overrides
});

describe('SaveCoordinator load gate', () => {
  let fileStorage;
  let gitSyncEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    fileStorage = { saveToFile: vi.fn().mockResolvedValue({ success: true }) };
    gitSyncEngine = {
      updateState: vi.fn(),
      forceCommit: vi.fn().mockResolvedValue(true),
      invalidateRemoteObservation: vi.fn(),
      isHealthy: () => true
    };

    // Fresh gate state between tests (the coordinator is a singleton).
    for (const token of Array.from(saveCoordinator._loadGateTokens.keys())) {
      saveCoordinator.endLoad(token);
    }
    saveCoordinator.fileStorage = fileStorage;
    saveCoordinator.gitSyncEngine = gitSyncEngine;
    saveCoordinator.isEnabled = true;
    saveCoordinator.swapInProgress = false;
    saveCoordinator.isSaving = false;
    saveCoordinator.isDirty = false;
    saveCoordinator.isGlobalDragging = false;
    saveCoordinator._lastInteractionEndTime = 0;
    saveCoordinator.hasLoadedFromFile = true;
    saveCoordinator.lastState = null;
    saveCoordinator.pendingString = null;
    saveCoordinator.pendingHash = null;
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('refcounts overlapping loads (the boot race runs two at once)', () => {
    const a = saveCoordinator.beginLoad('boot');
    const b = saveCoordinator.beginLoad('boot-background');
    expect(saveCoordinator.loadInFlight).toBe(2);

    saveCoordinator.endLoad(a);
    expect(saveCoordinator.loadInFlight).toBe(1);

    saveCoordinator.endLoad(b);
    expect(saveCoordinator.loadInFlight).toBe(0);
  });

  it('does not dispatch a save for a store mutation during a load', () => {
    const token = saveCoordinator.beginLoad('slow-git-fetch');

    // isUniverseLoading is false here on purpose: this is exactly the state
    // the LOAD_TIMEOUT_MS fast path leaves behind while the fetch continues.
    saveCoordinator.onStateChange(emptyState(), { type: 'node_create' });
    vi.advanceTimersByTime(60000);

    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(gitSyncEngine.updateState).not.toHaveBeenCalled();

    saveCoordinator.endLoad(token);
  });

  it('does not let a save timer armed before the load fire into it', () => {
    saveCoordinator.lastState = emptyState();
    saveCoordinator.isDirty = true;
    saveCoordinator.scheduleSave();

    const token = saveCoordinator.beginLoad('load-started-after-timer');
    vi.advanceTimersByTime(60000);

    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    saveCoordinator.endLoad(token);
  });

  it('refuses flush() mid-load, including the terminal quit-flush', async () => {
    saveCoordinator.lastState = emptyState();
    saveCoordinator.isDirty = true;

    const token = saveCoordinator.beginLoad('load');
    await expect(saveCoordinator.flush('tab-hidden')).resolves.toBe(false);
    await expect(saveCoordinator.flush('quit', { terminal: true })).resolves.toBe(false);

    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
    expect(gitSyncEngine.forceCommit).not.toHaveBeenCalled();
    saveCoordinator.endLoad(token);
  });

  it('refuses forceSave() mid-load but allows it for conflict resolution', async () => {
    const token = saveCoordinator.beginLoad('load');

    await expect(saveCoordinator.forceSave(emptyState())).rejects.toThrow(/still loading/i);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();

    await saveCoordinator.forceSave(emptyState(), { allowDuringLoad: true });
    expect(fileStorage.saveToFile).toHaveBeenCalledTimes(1);

    saveCoordinator.endLoad(token);
  });

  it('flushes state queued during the load once the gate opens', () => {
    const token = saveCoordinator.beginLoad('load');
    saveCoordinator.onStateChange(emptyState(), { type: 'node_create' });
    expect(saveCoordinator.nextStateToProcess).toBeTruthy();

    const scheduleSave = vi.spyOn(saveCoordinator, 'scheduleSave');
    saveCoordinator.endLoad(token);

    expect(scheduleSave).toHaveBeenCalled();
    scheduleSave.mockRestore();
  });

  it('watchdog will NOT open the gate for a universe that never loaded', () => {
    // There is an existing universe to read and we never got it. The store
    // holds pre-load content. No amount of elapsed time makes that safe to
    // write, so the gate stays shut — indefinitely.
    saveCoordinator.hasLoadedFromFile = false;
    saveCoordinator.beginLoad('hung-fetch-never-loaded');

    vi.advanceTimersByTime(120001);
    expect(saveCoordinator.loadInFlight).toBe(1);

    vi.advanceTimersByTime(120001 * 10);
    expect(saveCoordinator.loadInFlight).toBe(1);

    saveCoordinator.onStateChange(emptyState({ nodePrototypes: new Map([['n1', {}]]) }), { type: 'node_create' });
    vi.advanceTimersByTime(60000);
    expect(fileStorage.saveToFile).not.toHaveBeenCalled();
  });

  it('watchdog releases a stuck token once the universe IS loaded', () => {
    // The boot race: loadUniverseData runs twice past LOAD_TIMEOUT_MS, the
    // background one lands and applies, the first one hangs forever. The
    // universe is open and working — a dead token must not block saving for
    // the rest of the session.
    saveCoordinator.hasLoadedFromFile = false;
    const hung = saveCoordinator.beginLoad('boot-load-that-hangs');
    const background = saveCoordinator.beginLoad('boot-load-background');

    saveCoordinator.onStateChange(
      emptyState({ nodePrototypes: new Map([['n1', {}]]) }),
      { type: 'load' }
    );
    expect(saveCoordinator.hasLoadedFromFile).toBe(true);
    saveCoordinator.endLoad(background);
    expect(saveCoordinator.loadInFlight).toBe(1); // hung token still held

    vi.advanceTimersByTime(120001);
    expect(saveCoordinator.loadInFlight).toBe(0);
    expect(saveCoordinator._loadGateTokens.has(hung)).toBe(false);
  });
});

describe('SaveCoordinator persisted guard state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('never restores hasLoadedFromFile from a previous session', () => {
    window.localStorage.setItem(
      'redstring-savecoord-guard:mobile-universe',
      JSON.stringify({
        dataBaseline: { nodes: 42, graphs: 3 },
        lastSaveHash: 'abc123',
        hasLoadedFromFile: true,
        ts: Date.now()
      })
    );

    saveCoordinator.hasLoadedFromFile = false;
    saveCoordinator.dataBaseline = { nodes: 0, graphs: 0 };
    saveCoordinator._restoreGuardState('mobile-universe');

    // The shrinkage floor is durable and restores — it only ratchets
    // protection up.
    expect(saveCoordinator.dataBaseline).toEqual({ nodes: 42, graphs: 3 });
    // "This session observed a load" is not durable. Restoring it disarmed the
    // empty-state guard on every returning device.
    expect(saveCoordinator.hasLoadedFromFile).toBe(false);
  });
});
