// An edit made while a commit is in flight must still go out. The engine and
// the autosave policy both cleared their whole queue when a commit landed,
// so that edit waited for the next one (or was lost on quit).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { GitAutosavePolicy } from '../../src/services/GitAutosavePolicy.js';

const universe = (names) => ({
  graphs: new Map(),
  nodePrototypes: new Map(names.map((n) => [n, { id: n, name: n }])),
  edges: new Map()
});

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

describe('the engine', () => {
  it('keeps a state queued while a commit is in flight', async () => {
    let release;
    const written = [];
    const provider = {
      name: 'stub',
      async writeFileRaw(path, content) {
        written.push(content);
        if (written.length === 1) await new Promise((r) => { release = r; });
        return { content: { sha: `sha-${written.length}` } };
      }
    };
    const engine = new GitSyncEngine(provider, 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-0';

    const first = engine.forceCommit(universe(['Tree']));
    while (!release) await new Promise((r) => setTimeout(r, 5));
    engine.updateState(universe(['Tree', 'Bird'])); // what SaveCoordinator does after an edit
    release();
    await first;

    expect(engine.hasChanges).toBe(true);
    expect(engine.pendingCommits).toHaveLength(1);
    engine.lastCommitTime = 0;
    await engine.processPendingCommits();
    expect(written).toHaveLength(2);
    expect(written[1]).toContain('Bird');
    expect(engine.hasChanges).toBe(false);
  });
});

describe('the autosave policy', () => {
  let policy;
  afterEach(() => { policy?.destroy(); vi.useRealTimers(); });

  it('commits edits made while its commit was in flight', async () => {
    vi.useFakeTimers();
    let release;
    let state = universe(['Tree']);
    const commits = [];
    const engine = {
      sourceOfTruth: 'git',
      forceCommit: vi.fn(async (s) => {
        commits.push(s);
        if (commits.length === 1) await new Promise((r) => { release = r; });
        return true;
      })
    };
    policy = new GitAutosavePolicy();
    policy.initialize(engine, { getState: () => state, onStatusChange: () => {} });
    policy.getCurrentState = () => state;

    policy.onEditActivity();
    await vi.advanceTimersByTimeAsync(policy.IDLE_TIMEOUT + 10);
    expect(commits).toHaveLength(1);

    // Ana edits while the commit is in flight.
    state = universe(['Tree', 'Bird']);
    policy.onEditActivity();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(policy.currentBatch.length).toBe(1);

    await vi.advanceTimersByTimeAsync(policy.MAX_TIMEOUT + 5000);
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits.at(-1).nodePrototypes.has('Bird')).toBe(true);
  });
});
