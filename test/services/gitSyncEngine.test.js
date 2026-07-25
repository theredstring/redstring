import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

const buildStoreState = () => {
  const graphs = new Map();
  const nodePrototypes = new Map();
  nodePrototypes.set('p1', { id: 'p1', name: 'N1' });
  const edges = new Map();
  const graphId = 'g1';
  graphs.set(graphId, {
    id: graphId,
    name: 'G',
    description: '',
    instances: new Map(),
    edgeIds: [],
    definingNodeIds: []
  });
  return {
    graphs,
    nodePrototypes,
    edges,
    openGraphIds: [],
    activeGraphId: null,
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false
  };
};

describe('GitSyncEngine', () => {
  let provider;

  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
    const notFound = () => { const e = new Error('File not found: x'); e.code = 'FILE_NOT_FOUND'; throw e; };
    provider = {
      name: 'mock',
      writeFileRaw: vi.fn(),
      readFileRaw: vi.fn(),
      readFileRawWithMeta: vi.fn().mockImplementation(async () => notFound())
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forceCommit writes the universe file', async () => {
    const engine = new GitSyncEngine(provider);
    const state = buildStoreState();

    provider.writeFileRaw.mockResolvedValueOnce({ ok: true });

    const ok = await engine.forceCommit(state);
    expect(ok).toBe(true);
    expect(provider.writeFileRaw).toHaveBeenCalledTimes(1);
    expect(provider.writeFileRaw.mock.calls[0][0]).toBe('universes/default/universe.redstring');
  });

  it('loadFromGit returns parsed data when file exists', async () => {
    const engine = new GitSyncEngine(provider);
    const serialized = JSON.stringify({ hello: 'world', metadata: {}, prototypeSpace: {}, spatialGraphs: {}, relationships: {} });
    provider.readFileRawWithMeta.mockResolvedValueOnce({ content: serialized, sha: 'sha-1' });

    const data = await engine.loadFromGit();
    expect(data).toBeDefined();
    expect(data.hello).toBe('world');
    expect(provider.readFileRawWithMeta).toHaveBeenCalledWith('universes/default/universe.redstring');
    expect(engine.lastKnownRemoteSha).toBe('sha-1');
  });

  it('processPendingCommits keeps queue on 409 conflict and retries later', async () => {
    vi.useFakeTimers();
    const engine = new GitSyncEngine(provider);
    const state = buildStoreState();

    // Prepare local state update
    engine.updateState(state);

    // First write throws 409 error
    provider.writeFileRaw.mockRejectedValueOnce(new Error('409 Conflict'));

    await engine.processPendingCommits();

    // Should not clear hasChanges on 409
    expect(engine.hasChanges).toBe(true);

    // Advance time to allow retry window
    vi.advanceTimersByTime(2500);

    // Next attempt succeeds
    provider.writeFileRaw.mockResolvedValueOnce({ ok: true });

    await engine.processPendingCommits();

    expect(engine.hasChanges).toBe(false);
  });

  it('prevents overlapping commits with internal lock', async () => {
    const engine = new GitSyncEngine(provider);
    const state = buildStoreState();
    engine.updateState(state);

    // Stall first write
    let resolveWrite;
    const writePromise = new Promise(res => { resolveWrite = res; });
    provider.writeFileRaw.mockReturnValueOnce(writePromise);

    // Kick off first commit
    const p1 = engine.processPendingCommits();

    // Immediately attempt a second commit cycle
    engine.updateState(state);
    const p2 = engine.processPendingCommits();

    // Unblock first write and complete both
    resolveWrite({ ok: true });

    await Promise.all([p1, p2]);

    // One write despite two cycles: the second cycle hit the in-progress lock
    expect(provider.writeFileRaw).toHaveBeenCalledTimes(1);
  });
});
