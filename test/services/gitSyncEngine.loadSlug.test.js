import { describe, it, expect, vi } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';

describe('GitSyncEngine loadFromGit with slug', () => {
  it('loads from universes/{slug}/universe.redstring', async () => {
    const json = JSON.stringify({ metadata: {}, prototypeSpace: {}, spatialGraphs: {}, relationships: {} });
    const provider = {
      name: 'mock',
      readFileRaw: vi.fn().mockResolvedValue(json)
    };
    const engine = new GitSyncEngine(provider, 'local', 'slugx');

    const data = await engine.loadFromGit();
    expect(data).toBeDefined();
    expect(provider.readFileRaw).toHaveBeenCalledWith('universes/slugx/universe.redstring');
  });
});


