import { describe, it, expect, vi } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

const buildState = () => {
  const nodePrototypes = new Map();
  nodePrototypes.set('p1', { id: 'p1', name: 'N1' });
  return {
    graphs: new Map(),
    nodePrototypes,
    edges: new Map(),
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

describe('GitSyncEngine universe slug paths', () => {
  it('writes to universes/{slug}/universe.redstring', async () => {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
    const provider = {
      name: 'mock',
      writeFileRaw: vi.fn().mockResolvedValue({ ok: true }),
      readFileRawWithMeta: vi.fn().mockImplementation(async () => {
        const e = new Error('File not found: x');
        e.code = 'FILE_NOT_FOUND';
        throw e;
      })
    };
    const engine = new GitSyncEngine(provider, 'local', 'myslug');
    const state = buildState();

    await engine.forceCommit(state);

    const paths = provider.writeFileRaw.mock.calls.map(c => c[0]);
    expect(paths).toEqual(['universes/myslug/universe.redstring']);
  });
});
