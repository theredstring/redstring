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
  },
  async readFileRawWithMeta() {
    this.reads++;
    const e = new Error('File not found: x');
    e.code = 'FILE_NOT_FOUND';
    throw e;
  }
});

const storeWithNodes = (n) => {
  const nodePrototypes = new Map();
  for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i });
  return { graphs: new Map(), nodePrototypes, edges: new Map() };
};

// Raw .redstring file content as it would exist in the repo.
const remoteRedstringWithNodes = (n) => {
  const prototypes = {};
  for (let i = 0; i < n; i++) prototypes['p' + i] = { name: 'N' + i };
  return JSON.stringify({ metadata: {}, prototypeSpace: { prototypes }, spatialGraphs: {} });
};

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

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
    engine.lastKnownRemoteSha = 'sha-loaded'; // session has synced the remote
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

  it('arms the node-count floor from the remote content it reads', async () => {
    const engine = new GitSyncEngine(makeProvider(), 'git', 'u', 'u', 'u');
    engine.provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(7), sha: 'sha-r' });
    await engine.loadFromGit();
    expect(engine.lastCommittedNodeCount).toBe(7);
    expect(engine.lastKnownRemoteSha).toBe('sha-r');
  });
});

describe('first-contact gate: never write to a remote never read this session', () => {
  let provider, engine;
  beforeEach(() => {
    provider = makeProvider();
    engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastCommitTime = 0;
    // lastKnownRemoteSha stays undefined: this session never read the remote,
    // and (fresh device) no localStorage floor exists — the exact state in
    // which the mobile repo-wipe occurred.
  });

  it('reads the remote before the first write and proceeds on confirmed 404', async () => {
    const result = await engine.forceCommit(storeWithNodes(2));
    expect(result).toBe(true);
    expect(provider.reads).toBe(1);
    expect(provider.writes.length).toBe(1);
  });

  it('blocks the first write when the remote has data this session never loaded', async () => {
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(50), sha: 'sha-remote' });
    await expect(engine.forceCommit(storeWithNodes(1))).rejects.toThrow(/never loaded/);
    expect(provider.writes.length).toBe(0);
    expect(engine.remoteConflictPending).toBe(true);
    // Floor re-armed from the remote's actual contents
    expect(engine.lastCommittedNodeCount).toBe(50);
  });

  it('allows the first write when the divergence handler proves it safe', async () => {
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(3), sha: 'sha-remote' });
    engine.onRemoteDivergence = async () => 'overwrite';
    const result = await engine.forceCommit(storeWithNodes(3));
    expect(result).toBe(true);
    expect(provider.writes.length).toBe(1);
  });

  it('allows the first write over a genuinely empty universe file', async () => {
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(0), sha: 'sha-remote' });
    const result = await engine.forceCommit(storeWithNodes(2));
    expect(result).toBe(true);
    expect(provider.writes.length).toBe(1);
  });

  it('refuses to write when the remote cannot be read (not a 404)', async () => {
    provider.readFileRawWithMeta = async () => { throw new Error('500 server error'); };
    await expect(engine.forceCommit(storeWithNodes(2))).rejects.toThrow('500');
    expect(provider.writes.length).toBe(0);
  });

  it('markRemoteObserved (direct-load seeding) skips first-contact and arms the floor', async () => {
    engine.markRemoteObserved({ sha: 'sha-direct', nodeCount: 12 });
    const result = await engine.forceCommit(storeWithNodes(4));
    expect(result).toBe(true);
    expect(provider.reads).toBe(0); // no first-contact read needed
    expect(provider.writes.length).toBe(1);
    expect(engine.lastCommittedNodeCount >= 4).toBe(true);
  });

  it('invalidateRemoteObservation re-arms first-contact after a discarded load', async () => {
    engine.markRemoteObserved({ sha: 'sha-direct', nodeCount: 12 });
    engine.invalidateRemoteObservation();
    provider.readFileRawWithMeta = async () => {
      provider.reads++;
      return { content: remoteRedstringWithNodes(12), sha: 'sha-remote' };
    };
    // Remote has data the store never absorbed → conflict, not overwrite
    await expect(engine.forceCommit(storeWithNodes(1))).rejects.toThrow(/never loaded/);
    expect(provider.reads).toBe(1);
    expect(provider.writes.length).toBe(0);
  });
});

describe('remoteConflictPending blocks every push except the resolution save', () => {
  let provider, engine;
  beforeEach(() => {
    provider = makeProvider();
    engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-known';
    engine.lastCommitTime = 0;
    engine.remoteConflictPending = true;
  });

  it('forceCommit without isConflictResolution is refused', async () => {
    const result = await engine.forceCommit(storeWithNodes(5));
    expect(result).toBe(false);
    expect(provider.writes.length).toBe(0);
  });

  it('forceCommit with isConflictResolution pushes and clears the flag', async () => {
    const result = await engine.forceCommit(storeWithNodes(5), { isConflictResolution: true });
    expect(result).toBe(true);
    expect(provider.writes.length).toBe(1);
    expect(engine.remoteConflictPending).toBe(false);
  });

  it('processPendingCommits drops queued commits instead of retrying them', async () => {
    engine.pendingCommits = [{ type: 'state_update', timestamp: Date.now(), data: storeWithNodes(5), hash: 'h', isDragging: false }];
    engine.hasChanges = true;
    await engine.processPendingCommits();
    expect(provider.writes.length).toBe(0);
    expect(engine.pendingCommits.length).toBe(0);
    expect(engine.hasChanges).toBe(false);
  });
});
