import { describe, it, expect, beforeEach } from 'vitest';
import { GitSyncEngine, sanitizeGitFileBaseName } from '../../src/services/gitSyncEngine.js';

// Guards around the Git sync path that prevent remote data loss.
// The provider is stubbed so no network is touched.

const makeProvider = () => ({
  name: 'stub',
  authMethod: 'oauth',
  writes: [],
  reads: 0,
  async writeFileRaw(path, content) {
    this.writes.push({ path, content });
    return { content: { sha: 'sha-' + this.writes.length } };
  }
});

const storeWithNodes = (n) => {
  const nodePrototypes = new Map();
  for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i });
  return { graphs: new Map(), nodePrototypes, edges: new Map() };
};

describe('sanitizeGitFileBaseName', () => {
  it('is the single canonical sanitizer used by readers and writers', () => {
    expect(sanitizeGitFileBaseName('My Universe.redstring')).toBe('My-Universe');
    expect(sanitizeGitFileBaseName('a  b__c')).toBe('a-b__c');
  });
});

describe('3.2 forceCommit empty-state floor', () => {
  let engine, provider;
  beforeEach(() => {
    provider = makeProvider();
    engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastCommittedNodeCount = 10; // repo known-non-empty
    engine.lastCommitTime = 0;
  });

  it('refuses to commit an empty state over a non-empty repo', async () => {
    const result = await engine.forceCommit(storeWithNodes(0));
    expect(result).toBe(false);
    expect(provider.writes.length).toBe(0);
  });

  it('allows an intentional clear via allowEmpty', async () => {
    const result = await engine.forceCommit(storeWithNodes(0), { allowEmpty: true });
    expect(result).toBe(true);
    expect(provider.writes.length).toBe(1);
  });

  it('refuses state stamped for a different universe', async () => {
    const state = storeWithNodes(5);
    state._universeSlug = 'someone-else';
    const result = await engine.forceCommit(state);
    expect(result).toBe(false);
    expect(provider.writes.length).toBe(0);
  });
});

describe('3.4 loadFromGit distinguishes missing from failed', () => {
  it('returns null only on confirmed 404', async () => {
    const engine = new GitSyncEngine(makeProvider(), 'git', 'u', 'u', 'u');
    engine.provider.readFileRawWithMeta = async () => { const e = new Error('File not found: x'); e.code = 'FILE_NOT_FOUND'; throw e; };
    const result = await engine.loadFromGit();
    expect(result).toBe(null);
    expect(engine.lastKnownRemoteSha).toBe(null);
  });

  it('re-throws non-404 read failures instead of starting fresh', async () => {
    const engine = new GitSyncEngine(makeProvider(), 'git', 'u', 'u', 'u');
    engine.provider.readFileRawWithMeta = async () => { throw new Error('500 server error'); };
    await expect(engine.loadFromGit()).rejects.toThrow('500');
  });
});
