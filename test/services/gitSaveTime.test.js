import { describe, it, expect, beforeEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { buildSyncInfo } from '../../src/services/universeManagerService.js';

// The universe card's "Last saved" for a repository: when this device's
// changes last reached it, kept across restarts.

const store = () => ({
  graphs: new Map(),
  nodePrototypes: new Map([['p1', { id: 'p1', name: 'Tree' }]]),
  edges: new Map()
});

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

describe('Git save time', () => {
  it('is recorded and announced when a write lands', async () => {
    const provider = {
      name: 'stub',
      async writeFileRaw() { return { content: { sha: 'sha-1' } }; }
    };
    const engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-0';
    const announced = [];
    engine.onSaved = (at) => announced.push(at);

    expect(engine.getStatus().lastSavedAt).toBe(0);
    const before = Date.now();
    await engine.forceCommit(store());

    expect(engine.getStatus().lastSavedAt).toBeGreaterThanOrEqual(before);
    expect(announced).toEqual([engine.lastSavedAt]);
  });

  it('is not moved by a write that failed', async () => {
    const provider = {
      name: 'stub',
      async writeFileRaw() { throw new Error('offline'); }
    };
    const engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-0';
    await engine.forceCommit(store()).catch(() => {});
    expect(engine.lastSavedAt).toBe(0);
  });
});

describe('the card summary', () => {
  const universe = (metadata = {}) => ({
    slug: 'forest',
    gitRepo: { enabled: true, linkedRepo: { user: 'ana', repo: 'forest' } },
    metadata
  });
  const engineStatus = (extra = {}) => ({ isRunning: false, pendingCommits: 0, isHealthy: true, ...extra });

  it('shows the engine save time while the universe is open', () => {
    const at = Date.parse('2026-10-17T10:00:00Z');
    const info = buildSyncInfo(universe(), engineStatus({ lastSavedAt: at }));
    expect(info.label).toBe('All changes saved');
    expect(info.lastSync).toBe('2026-10-17T10:00:00.000Z');
  });

  it('falls back to the save time kept from an earlier session', () => {
    const info = buildSyncInfo(
      universe({ gitLastSaved: '2026-10-16T09:00:00.000Z', lastSaved: '2026-10-17T11:00:00.000Z' }),
      engineStatus({ lastSavedAt: 0 })
    );
    expect(info.lastSync).toBe('2026-10-16T09:00:00.000Z');
  });

  it('ignores the rate-limit timestamp, which a failed write backdates', () => {
    const info = buildSyncInfo(universe(), engineStatus({ lastCommitTime: Date.now(), lastSavedAt: 0 }));
    expect(info.lastSync).toBe(null);
  });
});
