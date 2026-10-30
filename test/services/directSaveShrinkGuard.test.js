/**
 * The saves that skip autosave (the one before a universe switch, merges, the
 * bridge's) refuse a collapsed state the way autosave does, and a switch whose
 * save was refused says so instead of dropping the edits quietly.
 *
 * Before: the switch called saveActiveUniverse, which had no shrinkage check,
 * so a state autosave had refused reached the file and Git on a switch. And a
 * save refused for any reason returned its errors without throwing, so the
 * switch logged "Saved", then cancelled the pending saves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { saveCoordinator } from '../../src/backend/sync/index.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;
const SLUG = 'garden';

const stateWith = (nodes, graphs = 1) => {
  const nodePrototypes = new Map();
  for (let i = 0; i < nodes; i++) nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i, definitionGraphIds: [] });
  const g = new Map();
  for (let i = 0; i < graphs; i++) g.set('g' + i, { id: 'g' + i, name: 'W' + i, instances: new Map(), edgeIds: [] });
  return { _universeSlug: SLUG, graphs: g, nodePrototypes, edges: new Map(), hasUniverseFile: true };
};

const universe = {
  slug: SLUG,
  name: 'Garden',
  localFile: { enabled: true },
  gitRepo: { enabled: false },
  browserStorage: { enabled: false },
  metadata: {},
};

const makeBackend = () => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.isInitialized = true;
  backend.universes = new Map([[SLUG, universe], ['other', { ...universe, slug: 'other', name: 'Other' }]]);
  backend.activeUniverseSlug = SLUG;
  backend.fileHandles = new Map([[SLUG, { name: 'garden.redstring' }]]);
  backend.gitSyncEngines = new Map();
  backend.pendingConflict = null;
  backend.loadsInFlight = 0;
  backend.notifications = [];
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.saveToLinkedLocalFile = vi.fn(async () => ({ success: true }));
  backend._persistPostSaveTelemetry = vi.fn(async () => {});
  return backend;
};

describe('saves that skip autosave', () => {
  let saved;
  beforeEach(() => {
    saved = { baseline: saveCoordinator.dataBaseline, slug: saveCoordinator.activeUniverseSlugForGuard };
    saveCoordinator.activeUniverseSlugForGuard = SLUG;
    saveCoordinator.dataBaseline = { nodes: 120, graphs: 4 };
  });
  afterEach(() => {
    saveCoordinator.dataBaseline = saved.baseline;
    saveCoordinator.activeUniverseSlugForGuard = saved.slug;
  });

  it('refuse a state that collapsed against the last saved copy', async () => {
    const backend = makeBackend();
    const result = await backend.saveActiveUniverseInternal(stateWith(1));
    expect(result).toMatchObject({ results: [] });
    expect(result.errors[0]).toMatch(/shrank/);
    expect(backend.saveToLinkedLocalFile).not.toHaveBeenCalled();
  });

  it('still write an ordinary state', async () => {
    const backend = makeBackend();
    const result = await backend.saveActiveUniverseInternal(stateWith(118, 4));
    expect(result).toEqual(['local']);
    expect(backend.saveToLinkedLocalFile).toHaveBeenCalledTimes(1);
  });

  it('still write a conflict resolution, which is a chosen state', async () => {
    const backend = makeBackend();
    const result = await backend.saveActiveUniverseInternal(stateWith(1), { isConflictResolution: true });
    expect(result).toEqual(['local']);
  });

  it('a switch whose save was refused says so', async () => {
    const backend = makeBackend();
    backend.saveActiveUniverse = vi.fn(async () => ({ results: [], errors: ['Save suppressed: data shrank unexpectedly'] }));
    backend.loadUniverseData = vi.fn(async () => { throw new Error('stop here'); });

    await backend.switchActiveUniverse('other').catch(() => {});

    const warning = backend.notifications.find((n) => n.level === 'warning');
    expect(warning?.message).toMatch(/"Garden" wasn't saved before switching \(data shrank unexpectedly\)/);
  });
});
