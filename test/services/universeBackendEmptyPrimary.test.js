/**
 * An empty primary must never be applied while the other slot holds data, and
 * a conflict must never be "resolved" onto the empty side while silently
 * writing nothing.
 *
 * Exercised on a bare prototype instance so the universeBackend singleton
 * (timers, auth, storage) never boots.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const storeWith = (n) => {
  const nodePrototypes = new Map([['base-thing-prototype', { id: 'base-thing-prototype' }]]);
  for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i });
  return { graphs: new Map(), nodePrototypes, edges: new Map() };
};

const makeBackend = () => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.pendingPrimarySelection = new Set();
  backend.pendingConflict = null;
  backend.universes = new Map();
  backend.notifications = [];
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.storeOperations = { loadUniverseFromFile: vi.fn() };
  backend.updateUniverse = vi.fn().mockResolvedValue(undefined);
  backend.saveActiveUniverse = vi.fn().mockResolvedValue(undefined);
  return backend;
};

const universe = { slug: 'claude-s-chambers-2', name: "Claude's Chambers" };

describe('_surfaceEmptyPrimaryConflict', () => {
  let backend, events;

  beforeEach(() => {
    backend = makeBackend();
    events = [];
    vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
      if (event?.type === 'redstring:slot-conflict') events.push(event.detail);
      return true;
    });
  });

  it('returns the POPULATED slot when the git primary is empty', () => {
    const local = storeWith(1822);
    const git = storeWith(0);

    const result = backend._surfaceEmptyPrimaryConflict(universe, 'git', git, local, 'local');

    expect(result).toBe(local); // never the empty primary
    expect(events).toHaveLength(1);
    expect(events[0].riskOverwriteEmptyPrimary).toBe(true);
    expect(events[0].localData.userNodeCount).toBe(1822);
    expect(events[0].gitData.userNodeCount).toBe(0);
  });

  it('works in the mirrored direction: an empty LOCAL primary', () => {
    const local = storeWith(0);
    const git = storeWith(500);

    const result = backend._surfaceEmptyPrimaryConflict(universe, 'local', local, git, 'git');

    expect(result).toBe(git);
    expect(events[0].localData.userNodeCount).toBe(0);
    expect(events[0].gitData.userNodeCount).toBe(500);
    expect(backend.notifications[0].message).toMatch(/local file looks empty/i);
  });

  it('puts the slot states in the right fields regardless of which is empty', () => {
    const local = storeWith(7);
    const git = storeWith(0);
    backend._surfaceEmptyPrimaryConflict(universe, 'git', git, local, 'local');

    // The dialog reads localData/gitData by name — swapping them would show
    // the user the opposite of the truth.
    expect(events[0].localData.storeState).toBe(local);
    expect(events[0].gitData.storeState).toBe(git);
  });

  it('marks the conflict pending so autosave stays blocked', () => {
    backend._surfaceEmptyPrimaryConflict(universe, 'git', storeWith(0), storeWith(9), 'local');
    expect(backend.pendingConflict).toBeTruthy();
    expect(backend.pendingPrimarySelection.has(universe.slug)).toBe(true);
  });
});

describe('resolveConflict onto an empty slot', () => {
  let backend;

  beforeEach(() => {
    backend = makeBackend();
    backend.universes.set(universe.slug, universe);
  });

  const pending = (localNodes, gitNodes) => ({
    universeSlug: universe.slug,
    localData: { storeState: storeWith(localNodes) },
    gitData: { storeState: storeWith(gitNodes) }
  });

  it('refuses rather than reporting a success that never happened', async () => {
    // Every write guard refuses an empty state over a destination with data,
    // so this used to skip both writes, clear the conflict, and toast
    // "Conflict resolved using git data" with the store left empty.
    backend.pendingConflict = pending(1822, 0);

    await expect(backend.resolveConflict(universe.slug, 'git'))
      .rejects.toMatchObject({ code: 'EMPTY_RESOLUTION_REFUSED' });

    expect(backend.saveActiveUniverse).not.toHaveBeenCalled();
    expect(backend.storeOperations.loadUniverseFromFile).not.toHaveBeenCalled();
    expect(backend.updateUniverse).not.toHaveBeenCalled();
    // The conflict stays open so the user can still pick the other side.
    expect(backend.pendingConflict).toBeTruthy();
    expect(backend.notifications.some((n) => n.level === 'success')).toBe(false);
  });

  it('refuses in the mirrored direction too', async () => {
    backend.pendingConflict = pending(0, 400);
    await expect(backend.resolveConflict(universe.slug, 'local'))
      .rejects.toMatchObject({ code: 'EMPTY_RESOLUTION_REFUSED' });
    expect(backend.saveActiveUniverse).not.toHaveBeenCalled();
  });

  it('allows choosing the populated side', async () => {
    backend.pendingConflict = pending(1822, 0);

    const result = await backend.resolveConflict(universe.slug, 'local');

    expect(result).toBeTruthy();
    expect(backend.saveActiveUniverse).toHaveBeenCalledWith(null, { isConflictResolution: true });
    expect(backend.pendingConflict).toBe(null);
  });

  it('allows a normal resolution when both sides hold data', async () => {
    backend.pendingConflict = pending(50, 60);
    await expect(backend.resolveConflict(universe.slug, 'git')).resolves.toBeTruthy();
    expect(backend.saveActiveUniverse).toHaveBeenCalled();
  });

  it('allows resolution when BOTH sides are empty (nothing to lose)', async () => {
    backend.pendingConflict = pending(0, 0);
    await expect(backend.resolveConflict(universe.slug, 'git')).resolves.toBeTruthy();
  });
});
