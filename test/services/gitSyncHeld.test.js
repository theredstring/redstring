/**
 * A universe grown past what Git can carry (an ontology import, say) is kept
 * on this device while the repository holds an older copy. The next load must
 * take this device's copy, not the repository's: for a universe kept only in
 * the repository, taking the repository's copy also wrote it over the browser
 * copy, and the import was gone without a word.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const buildState = (names) => {
  const nodePrototypes = new Map(
    names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]),
  );
  const instances = new Map([['i1', { id: 'i1', prototypeId: names[0], x: 10, y: 20, scale: 1 }]]);
  const graphs = new Map([
    ['g1', { id: 'g1', name: 'Main', description: '', instances, edgeIds: [], definingNodeIds: [] }],
  ]);
  const state = {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
  return importFromRedstring(exportToRedstring(state), {}).storeState;
};

const held = { gitSyncHeld: { reason: 'too-large', bytes: 60 * 1024 * 1024, at: '2026-10-09T12:00:00Z' } };

const gitOnly = (metadata = {}) => ({
  slug: 'repo-only',
  name: 'Repo Only',
  sourceOfTruth: 'git',
  localFile: { enabled: false },
  gitRepo: { enabled: true, linkedRepo: 'someone/repo' },
  browserStorage: { enabled: true, key: 'repo-only' },
  metadata,
});

const both = (metadata = {}) => ({
  ...gitOnly(metadata),
  slug: 'both',
  localFile: { enabled: true },
  browserStorage: { enabled: false, key: 'both' },
});

const makeBackend = ({ local = () => null, git, browser = () => null }) => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.fileHandles = new Map([['both', { name: 'both.redstring' }]]);
  backend.pendingConflict = null;
  backend.pendingPrimarySelection = new Set();
  backend.secondarySyncTimestamps = new Map();
  backend.notifyStatus = vi.fn();
  backend.loadFromLocalFile = vi.fn(async () => local());
  backend.loadFromGit = vi.fn(async () => git());
  backend.loadFromGitDirect = vi.fn(async () => null);
  backend.loadFromBrowserStorage = vi.fn(async () => browser());
  backend.detectSlotConflict = vi.fn(async () => null);
  backend.syncAndReturn = vi.fn(async (_u, state) => state);
  return backend;
};

describe('loading while Git holds an older copy', () => {
  let before;
  let after;
  beforeEach(() => {
    before = buildState(['water']);
    after = buildState(['water', 'oxygen', 'hydrogen']);
  });

  it('takes the browser copy of a universe kept only in the repository', async () => {
    const backend = makeBackend({ git: () => before, browser: () => after });
    const result = await backend._loadUniverseDataInner(gitOnly(held), { allowPermissionPrompt: false });
    expect(result).toBe(after);
    expect(backend.syncAndReturn.mock.calls[0][2].source).toBe('browser');
  });

  it('still takes the repository copy when Git is not held', async () => {
    const backend = makeBackend({ git: () => before, browser: () => after });
    const result = await backend._loadUniverseDataInner(gitOnly(), { allowPermissionPrompt: false });
    expect(result).toBe(before);
  });

  it('falls back to the repository when this device has no copy', async () => {
    const backend = makeBackend({ git: () => before, browser: () => null });
    const result = await backend._loadUniverseDataInner(gitOnly(held), { allowPermissionPrompt: false });
    expect(result).toBe(before);
  });

  it('takes the local file of a universe with both, without asking', async () => {
    const backend = makeBackend({ local: () => after, git: () => before });
    const result = await backend._loadUniverseDataInner(both(held), { allowPermissionPrompt: true });
    expect(result).toBe(after);
    expect(backend.detectSlotConflict).not.toHaveBeenCalled();
  });

  it('reads the browser copy even where browser storage is only a fallback', async () => {
    const universe = { ...gitOnly(held), browserStorage: { enabled: false, key: 'repo-only' } };
    const backend = makeBackend({ git: () => before, browser: () => after });
    expect(await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: false })).toBe(after);
  });
});

describe('the engine reports the hold', () => {
  const provider = () => ({
    name: 'stub',
    authMethod: 'oauth',
    async writeFileRaw() { return { content: { sha: 'sha-1' } }; },
    async readFileRawWithMeta() { const e = new Error('File not found: x'); e.code = 'FILE_NOT_FOUND'; throw e; },
  });
  const store = (n) => {
    const nodePrototypes = new Map();
    for (let i = 0; i < n; i++) nodePrototypes.set('p' + i, { id: 'p' + i, name: 'N' + i });
    return { graphs: new Map(), nodePrototypes, edges: new Map() };
  };

  it('hands over what it will not send while too large', () => {
    const engine = new GitSyncEngine(provider(), 'git', 'u', 'u', 'u');
    engine.tooLargeToSync = { bytes: 60 * 1024 * 1024, items: 1 };
    engine.onHeldState = vi.fn();
    const state = store(3);
    engine.updateState(state);
    expect(engine.onHeldState).toHaveBeenCalledWith(state);
  });

  it('clears the hold once a commit lands', async () => {
    const engine = new GitSyncEngine(provider(), 'git', 'u', 'u', 'u');
    engine.lastKnownRemoteSha = 'sha-loaded';
    engine.lastCommitTime = 0;
    engine.onSyncHeld = vi.fn();
    await engine.forceCommit(store(2));
    expect(engine.onSyncHeld).toHaveBeenCalledWith(null);
  });
});
