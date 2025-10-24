import { describe, it, expect, vi } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

const buildState = () => ({
  graphs: new Map(),
  nodePrototypes: new Map(),
  edges: new Map(),
  openGraphIds: [],
  activeGraphId: null,
  activeDefinitionNodeId: null,
  expandedGraphIds: new Set(),
  rightPanelTabs: [],
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  showConnectionNames: false
});

describe('GitSyncEngine universe slug paths', () => {
  it('writes to universes/{slug}/universe.redstring and backups folder', async () => {
    const provider = { name: 'mock', writeFileRaw: vi.fn() };
    const engine = new GitSyncEngine(provider, 'local', 'myslug');
    const state = buildState();

    provider.writeFileRaw.mockResolvedValue({ ok: true });

    await engine.forceCommit(state);

    const paths = provider.writeFileRaw.mock.calls.map(c => c[0]);
    expect(paths[0]).toBe('universes/myslug/universe.redstring');
    expect(paths[1].startsWith('universes/myslug/backups/')).toBe(true);
    expect(paths[1].endsWith('.redstring')).toBe(true);
  });
});


