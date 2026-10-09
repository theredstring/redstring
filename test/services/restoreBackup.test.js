/**
 * Restoring a backup from this device (History → Backups): what is open is
 * kept as a backup first, then the backup is loaded and saved through the
 * normal write path. Exercised on a bare prototype instance, as in
 * universeBackendDivergence, so the backend never boots.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const backups = vi.hoisted(() => ({
  readBackup: vi.fn(),
  backUpNow: vi.fn(),
  noteUniverseSaved: vi.fn()
}));
vi.mock('../../src/services/universeBackups.js', () => backups);

const { universeBackend } = await import('../../src/services/universeBackend.js');
const { exportToRedstring } = await import('../../src/formats/redstringFormat.js');
const { serializeRedstring, parseRedstringBytes } = await import('../../src/formats/universeBytes.js');

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const storeWith = (n, name = 'N') => {
  const nodePrototypes = new Map();
  for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, {
    id: 'p' + i, name: name + i, color: '#8B0000', definitionGraphIds: []
  });
  return {
    graphs: new Map(), nodePrototypes, edges: new Map(),
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(), savedGraphIds: new Set()
  };
};

const universe = { slug: 'ideas', name: 'Ideas' };

describe('restoreUniverseBackup', () => {
  let backend;
  let order;
  let current;

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    current = storeWith(3, 'Now');
    backend = Object.create(UniverseBackend.prototype);
    backend.getUniverse = () => universe;
    backend.getActiveUniverse = () => universe;
    backend.pendingConflict = null;
    backend.notifyStatus = vi.fn();
    backend.storeOperations = {
      getState: () => current,
      loadUniverseFromFile: vi.fn((state) => { order.push('load'); current = state; return true; })
    };
    backend.saveActiveUniverse = vi.fn(async () => { order.push('save'); });
    backups.readBackup.mockResolvedValue(serializeRedstring(exportToRedstring(storeWith(5, 'Then'))));
    backups.backUpNow.mockImplementation(async () => { order.push('backup'); return { id: 'x' }; });
  });

  it('keeps what is open, then loads and saves the backup', async () => {
    const result = await backend.restoreUniverseBackup('ideas', '20261009T143000000Z');

    expect(order).toEqual(['backup', 'load', 'save']);
    const kept = await parseRedstringBytes(backups.backUpNow.mock.calls[0][1].content);
    expect(JSON.stringify(kept)).toContain('Now0');
    expect(backend.storeOperations.loadUniverseFromFile.mock.calls[0][0]._universeSlug).toBe('ideas');
    expect(current.nodePrototypes.size).toBe(5);
    expect(result.nodeCount).toBe(5);
  });

  it('changes nothing when the copy of what is open could not be kept', async () => {
    backups.backUpNow.mockRejectedValue(new Error('disk full'));
    await expect(backend.restoreUniverseBackup('ideas', '20261009T143000000Z')).rejects.toThrow(/disk full/);
    expect(backend.storeOperations.loadUniverseFromFile).not.toHaveBeenCalled();
    expect(backend.saveActiveUniverse).not.toHaveBeenCalled();
  });

  it('refuses a backup with nothing in it', async () => {
    backups.readBackup.mockResolvedValue(serializeRedstring(exportToRedstring(storeWith(0))));
    await expect(backend.restoreUniverseBackup('ideas', '20261009T143000000Z')).rejects.toThrow(/nothing in it/);
    expect(backups.backUpNow).not.toHaveBeenCalled();
  });

  it('only restores into the open universe, and not while a conflict waits', async () => {
    backend.getActiveUniverse = () => ({ slug: 'other' });
    await expect(backend.restoreUniverseBackup('ideas', 'x')).rejects.toThrow(/Open this universe/);
    backend.getActiveUniverse = () => universe;
    backend.pendingConflict = { universeSlug: 'ideas' };
    await expect(backend.restoreUniverseBackup('ideas', 'x')).rejects.toThrow(/Choose which copy/);
    expect(backups.readBackup).not.toHaveBeenCalled();
  });
});
