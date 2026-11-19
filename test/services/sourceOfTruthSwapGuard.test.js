/**
 * Switching source of truth migrates the canvas INTO the new source first, so a
 * newly linked, empty repository doesn't become primary and wipe the universe.
 * That migration must never write over a destination that already holds a
 * different universe: on 2026-11-18, attaching an existing repository to a
 * local universe and making Git primary force-committed the local universe
 * over the repository's. A different destination goes to the conflict dialog;
 * one that can't be read is never written blind.
 */
import { describe, it, expect, vi } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const storeWith = (names) => {
  const nodePrototypes = new Map([
    ['base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing', definitionGraphIds: [] }],
  ]);
  names.forEach((name, i) => nodePrototypes.set(`p${i}-${name}`, { id: `p${i}-${name}`, name, color: '#8B0000', definitionGraphIds: [] }));
  return {
    graphs: new Map([['g', { id: 'g', name: 'Web', instances: new Map(), edgeIds: [], groups: new Map() }]]),
    nodePrototypes, edges: new Map(),
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(), savedGraphIds: new Set(),
  };
};

const makeBackend = ({ canvas, remote }) => {
  const universe = {
    slug: 'atlas', name: 'Atlas', sourceOfTruth: 'local',
    localFile: { enabled: true, hadFileHandle: true },
    gitRepo: { enabled: true, linkedRepo: 'someone/atlas' },
  };
  const engine = { forceCommit: vi.fn(async () => true), setSourceOfTruth: vi.fn(), getStatus: () => ({}) };
  const backend = Object.create(UniverseBackend.prototype);
  Object.assign(backend, {
    universes: new Map([['atlas', universe]]),
    gitSyncEngines: new Map([['atlas', engine]]),
    pendingConflict: null,
    pendingPrimarySelection: new Set(),
    notifications: [],
    storeOperations: { getState: () => canvas },
  });
  backend.initialize = async () => {};
  backend.getUniverse = (slug) => backend.universes.get(slug);
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.loadFromGit = vi.fn(async () => {
    if (remote instanceof Error) throw remote;
    return remote;
  });
  backend.detectSlotConflict = vi.fn(async () => ({ universeSlug: 'atlas', areIdentical: false }));
  backend.updateUniverse = vi.fn(async (slug, patch) => Object.assign(universe, patch));
  backend.ensureGitSyncEngine = vi.fn(async () => engine);
  return { backend, engine, universe };
};

describe('switching a local universe to Git as source of truth', () => {
  it('never pushes the canvas over a repository holding a different universe', async () => {
    const { backend, engine, universe } = makeBackend({
      canvas: storeWith(['Local A', 'Local B']),
      remote: storeWith(['Remote X', 'Remote Y', 'Remote Z']),
    });
    await expect(backend.setSourceOfTruth('atlas', 'git')).rejects.toMatchObject({ code: 'SWAP_DESTINATION_DIFFERS' });
    expect(engine.forceCommit).not.toHaveBeenCalled();
    expect(universe.sourceOfTruth).toBe('local');
    // The person chooses, in the conflict dialog.
    expect(backend.pendingConflict).toMatchObject({ universeSlug: 'atlas' });
    expect(backend.notifications.at(-1).message).toMatch(/already holds a different version/);
  });

  it('never writes blind when the repository cannot be read', async () => {
    const { backend, engine, universe } = makeBackend({
      canvas: storeWith(['Local A']),
      remote: new Error('network down'),
    });
    await expect(backend.setSourceOfTruth('atlas', 'git')).rejects.toMatchObject({ code: 'SWAP_DESTINATION_UNREADABLE' });
    expect(engine.forceCommit).not.toHaveBeenCalled();
    expect(universe.sourceOfTruth).toBe('local');
  });

  it('fills an empty repository, as the migration was meant to', async () => {
    const { backend, engine, universe } = makeBackend({ canvas: storeWith(['Local A']), remote: null });
    await backend.setSourceOfTruth('atlas', 'git');
    expect(engine.forceCommit).toHaveBeenCalledTimes(1);
    expect(universe.sourceOfTruth).toBe('git');
  });

  it('carries on when the repository already holds the same universe', async () => {
    const same = storeWith(['Local A', 'Local B']);
    const { backend, engine, universe } = makeBackend({ canvas: same, remote: storeWith(['Local A', 'Local B']) });
    await backend.setSourceOfTruth('atlas', 'git');
    expect(engine.forceCommit).toHaveBeenCalledTimes(1);
    expect(universe.sourceOfTruth).toBe('git');
  });
});
