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

  it('allows an intentional clear via allowEmpty when the destination is absent', async () => {
    // The stub provider 404s, so the destination check reports
    // 'destination-absent' and the clear proceeds.
    const result = await engine.forceCommit(storeWithNodes(0), { allowEmpty: true });
    expect(result).toBe(true);
    expect(provider.writes.length).toBe(1);
  });

  it('allowEmpty does NOT let an empty state clear a destination that holds data', async () => {
    // allowEmpty waives the remembered floor. It must not waive the read of
    // the file itself — that is the only check that cannot be stale.
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(1822), sha: 'sha-loaded' });

    await expect(engine.forceCommit(storeWithNodes(0), { allowEmpty: true }))
      .rejects.toMatchObject({ code: 'EMPTY_WRITE_BLOCKED' });
    expect(provider.writes.length).toBe(0);
  });

  it('counts only USER prototypes, so a re-seeded base Thing is still empty', async () => {
    // 2026-09-12: the universe was wiped, the UI re-added base-thing-prototype,
    // and this floor read 1 !== 0 and let the commit through.
    const reSeeded = { graphs: new Map(), edges: new Map(), nodePrototypes: new Map([
      ['base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing' }],
      ['base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection' }]
    ]) };

    const result = await engine.forceCommit(reSeeded);
    expect(result).toBe(false);
    expect(provider.writes.length).toBe(0);
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

  it('arms the floor from USER prototypes only', async () => {
    const engine = new GitSyncEngine(makeProvider(), 'git', 'u', 'u', 'u');
    engine.provider.readFileRawWithMeta = async () => ({
      content: JSON.stringify({
        metadata: {},
        prototypeSpace: { prototypes: {
          'base-thing-prototype': {}, 'base-connection-prototype': {}, p0: {}, p1: {}, p2: {}
        } },
        spatialGraphs: { graphs: {} }
      }),
      sha: 'sha-r'
    });
    await engine.loadFromGit();
    expect(engine.lastCommittedNodeCount).toBe(3);
  });
});

describe('the 2026-09-12 wipe: an unreadable remote is never overwritten', () => {
  // The GitHub contents-API envelope that Chromium's cache served in place of
  // the 6.9 MB universe file.
  const ENVELOPE = JSON.stringify({
    name: 'claude-s-chambers-2.redstring',
    path: 'universes/claude-s-chambers-2/claude-s-chambers-2.redstring',
    sha: 'd2e961555ac8180c4e4332de0d453ec29c47184d',
    size: 6916496,
    type: 'file',
    content: '',
    encoding: 'none'
  });

  let provider, engine;
  beforeEach(() => {
    provider = makeProvider();
    engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastCommitTime = 0;
  });

  it('first contact refuses to overwrite a remote that is not a Redstring document', async () => {
    provider.readFileRawWithMeta = async () => ({ content: ENVELOPE, sha: 'sha-remote' });

    await expect(engine.forceCommit(storeWithNodes(2)))
      .rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });
    expect(provider.writes.length).toBe(0);
    expect(engine.remoteConflictPending).toBe(true);
  });

  it('dismissing the conflict dialog does NOT unblock the overwrite', async () => {
    // The refusal must not be a one-shot. Recording the remote's SHA before
    // throwing would satisfy the first-contact gate for the rest of the
    // session, so a dismissed dialog plus one edit would be enough to
    // overwrite the unread file on the next autosave.
    provider.readFileRawWithMeta = async () => {
      provider.reads++;
      return { content: ENVELOPE, sha: 'sha-remote' };
    };

    await expect(engine.forceCommit(storeWithNodes(2))).rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });
    expect(engine.lastKnownRemoteSha).toBeUndefined(); // first contact stays armed

    // The user dismisses the dialog (universeBackend.cancelPendingConflict).
    engine.remoteConflictPending = false;

    // ...and keeps working, so the state is no longer empty.
    await expect(engine.forceCommit(storeWithNodes(5))).rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });
    expect(provider.writes.length).toBe(0);
    expect(provider.reads).toBe(2); // re-read, re-refused
  });

  it('recovers on its own once the remote becomes readable again', async () => {
    provider.readFileRawWithMeta = async () => ({ content: ENVELOPE, sha: 'sha-bad' });
    await expect(engine.forceCommit(storeWithNodes(2))).rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });

    // The bad read was transient; the real file is there on the next attempt.
    engine.remoteConflictPending = false;
    engine.lastCommitTime = 0;
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(0), sha: 'sha-good' });

    await expect(engine.forceCommit(storeWithNodes(2))).resolves.toBe(true);
    expect(provider.writes.length).toBe(1);
    expect(engine.remoteUnrecognized).toBe(false);
  });

  it('an unparseable remote is also refused, not overwritten', async () => {
    provider.readFileRawWithMeta = async () => ({ content: '{"prototypeSpace": {truncated', sha: 'sha-remote' });
    await expect(engine.forceCommit(storeWithNodes(2))).rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });
    expect(provider.writes.length).toBe(0);
  });

  it('an unrecognized remote is not handed to the divergence handler', async () => {
    provider.readFileRawWithMeta = async () => ({ content: ENVELOPE, sha: 'sha-remote' });
    let handlerCalled = false;
    engine.onRemoteDivergence = async () => { handlerCalled = true; return 'overwrite'; };

    await expect(engine.forceCommit(storeWithNodes(2))).rejects.toMatchObject({ code: 'REMOTE_UNRECOGNIZED' });
    expect(handlerCalled).toBe(false);
    expect(provider.writes.length).toBe(0);
  });

  // What the app actually held after importing the envelope: nothing but the
  // base prototypes the store and UI re-seed on their own.
  const wipedStore = () => ({
    graphs: new Map(),
    edges: new Map(),
    nodePrototypes: new Map([['base-thing-prototype', { id: 'base-thing-prototype', name: 'Thing' }]])
  });

  it('end to end: the wiped store never reaches a repo this session never read', async () => {
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(1822), sha: 'sha-remote' });

    // Save Now / quit-flush: first contact finds 1822 things this session
    // never loaded, so the push becomes a conflict for the user to resolve.
    await expect(engine.forceCommit(wipedStore())).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    expect(provider.writes.length).toBe(0);
    expect(engine.lastCommittedNodeCount).toBe(1822); // floor re-armed from truth
    expect(engine.remoteConflictPending).toBe(true);

    // And with the conflict pending, every later push is refused outright.
    engine.updateState(wipedStore());
    await engine.processPendingCommits();
    await expect(engine.forceCommit(wipedStore())).resolves.toBe(false);
    expect(provider.writes.length).toBe(0);
  });

  it('end to end: the wiped store never reaches a repo this session DID read', async () => {
    // The harder case: the session legitimately read the remote, so first
    // contact is satisfied and only the empty-write guards stand.
    provider.readFileRawWithMeta = async () => ({ content: remoteRedstringWithNodes(1822), sha: 'sha-remote' });
    engine.markRemoteObserved({ sha: 'sha-remote', nodeCount: 1822 });

    engine.updateState(wipedStore());
    await engine.processPendingCommits();
    expect(provider.writes.length).toBe(0);

    // Floor refuses it outright (0 user prototypes vs a floor of 1822).
    await expect(engine.forceCommit(wipedStore())).resolves.toBe(false);
    expect(provider.writes.length).toBe(0);

    // Even waiving the floor, the destination read stops it.
    await expect(engine.forceCommit(wipedStore(), { allowEmpty: true }))
      .rejects.toMatchObject({ code: 'EMPTY_WRITE_BLOCKED' });
    expect(provider.writes.length).toBe(0);
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
