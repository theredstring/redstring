/**
 * `_decideRemoteDivergence` decides whether we may push our local state over a
 * remote that moved since we last synced. It may only say 'overwrite' on
 * positive evidence that nothing is lost.
 *
 * The method is exercised on a bare prototype instance so the 6800-line
 * universeBackend class (timers, auth, storage) never boots.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import UniverseBackendDefault, { universeBackend } from '../../src/services/universeBackend.js';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend || UniverseBackendDefault).constructor;

const storeWith = (n) => {
  const nodePrototypes = new Map();
  for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, {
    id: 'p' + i, name: 'N' + i, color: '#8B0000', definitionGraphIds: []
  });
  return {
    graphs: new Map(), nodePrototypes, edges: new Map(),
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(), savedGraphIds: new Set()
  };
};

/** The contents-API envelope Chromium's cache served in place of the file. */
const ENVELOPE = {
  name: 'claude-s-chambers-2.redstring',
  path: 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring',
  sha: 'd2e961555ac8180c4e4332de0d453ec29c47184d',
  size: 6916496, type: 'file', content: '', encoding: 'none'
};

describe('_decideRemoteDivergence', () => {
  let backend;
  beforeEach(() => {
    backend = Object.create(UniverseBackend.prototype);
  });

  it('refuses to overwrite a remote it could not import', async () => {
    // Previously returned 'overwrite' reasoning that git history retains the
    // blob. On 2026-09-12 the unimportable thing WAS the real universe.
    const verdict = await backend._decideRemoteDivergence(storeWith(3), ENVELOPE);
    expect(verdict.decision).toBe('conflict');
    expect(verdict.remoteState).toBe(null);
  });

  it('refuses when the remote holds data ours does not', async () => {
    const remote = exportToRedstring(storeWith(50));
    const verdict = await backend._decideRemoteDivergence(storeWith(3), remote);
    expect(verdict.decision).toBe('conflict');
    expect(verdict.remoteState).toBeTruthy();
  });

  it('allows the push when the remote is readable and holds no user data', async () => {
    const remote = exportToRedstring(storeWith(0));
    const verdict = await backend._decideRemoteDivergence(storeWith(3), remote);
    expect(verdict.decision).toBe('overwrite');
  });

  it('allows the push when both sides carry the same knowledge', async () => {
    const state = storeWith(4);
    const verdict = await backend._decideRemoteDivergence(state, exportToRedstring(state));
    expect(verdict.decision).toBe('overwrite');
  });

  it('treats a missing local state as a conflict', async () => {
    const verdict = await backend._decideRemoteDivergence(null, exportToRedstring(storeWith(1)));
    expect(verdict.decision).toBe('conflict');
  });

  it('a remote holding only base prototypes counts as empty', async () => {
    const withBases = storeWith(0);
    withBases.nodePrototypes.set('base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing', definitionGraphIds: [] });
    withBases.nodePrototypes.set('base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection', definitionGraphIds: [] });

    const verdict = await backend._decideRemoteDivergence(storeWith(5), exportToRedstring(withBases));
    expect(verdict.decision).toBe('overwrite');
  });
});
