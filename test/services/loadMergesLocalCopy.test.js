/**
 * At load, this device's saved copy and the repository's differ: edits made
 * offline (or not pushed before the app closed) on one side, others' saves on
 * the other. With a known base the load merges them. It used to pick one —
 * a universe with Git as its source of truth silently mirrored the
 * repository over the local copy, dropping the offline edits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const buildDoc = (names) => {
  const nodePrototypes = new Map(names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]));
  const instances = new Map(names.map((n, i) => [`i-${n}`, { id: `i-${n}`, prototypeId: n, x: i * 10, y: 0, scale: 1 }]));
  return exportToRedstring({
    graphs: new Map([['g1', { id: 'g1', name: 'Main', description: '', instances, edgeIds: [], definingNodeIds: [] }]]),
    nodePrototypes,
    edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false
  });
};
const buildState = (names) => importFromRedstring(buildDoc(names)).storeState;
const names = (state) => [...state.nodePrototypes.keys()].sort();

const BOTH = {
  slug: 'both-linked',
  name: 'Both Linked',
  sourceOfTruth: 'git',
  localFile: { enabled: true },
  gitRepo: { enabled: true, linkedRepo: 'someone/repo' },
  browserStorage: { enabled: false }
};
const GIT_ONLY = {
  slug: 'git-only',
  name: 'Git Only',
  sourceOfTruth: 'git',
  localFile: { enabled: false },
  gitRepo: { enabled: true, linkedRepo: 'someone/repo' },
  browserStorage: { enabled: true, key: 'universe_git-only' }
};

function makeBackend(universe, { local, git, browser, baseDoc }) {
  const backend = Object.create(UniverseBackend.prototype);
  backend.fileHandles = new Map([[universe.slug, { name: `${universe.slug}.redstring` }]]);
  backend.pendingConflict = null;
  backend.pendingPrimarySelection = new Set();
  backend.secondarySyncTimestamps = new Map();
  backend.gitSyncEngines = new Map();
  backend.notifyStatus = vi.fn();
  backend.loadFromLocalFile = vi.fn(async () => local?.());
  backend.loadFromGit = vi.fn(async () => {
    const state = git();
    backend._tagGitObservation(state, universe.slug, { sha: 'sha-remote', nodeCount: state.nodePrototypes.size });
    return state;
  });
  backend.loadFromGitDirect = vi.fn(async () => null);
  backend.loadFromBrowserStorage = vi.fn(async () => browser?.());
  backend.syncSecondaryStorage = vi.fn(async () => {});
  backend.saveToLinkedLocalFile = vi.fn(async () => {});
  backend.createProviderForUniverse = vi.fn(async () => ({
    readFileAtSha: vi.fn(async (path, sha) => {
      expect(sha).toBe('sha-base');
      expect(path).toBe(`universes/${universe.slug}/${universe.slug}.redstring`);
      return JSON.stringify(baseDoc);
    })
  }));
  return backend;
}

const setBase = (slug, sha) => window.localStorage.setItem(GitSyncEngine.syncBaseStorageKey(slug), JSON.stringify({ sha }));

beforeEach(() => window.localStorage.clear());

describe('load: a universe linked to a file and a repository', () => {
  it('merges the file\'s offline edits with what others saved', async () => {
    setBase(BOTH.slug, 'sha-base');
    const backend = makeBackend(BOTH, {
      local: () => buildState(['cat', 'dog', 'fox']), // fox: added offline here
      git: () => buildState(['cat', 'dog', 'owl']), // owl: someone else
      baseDoc: buildDoc(['cat', 'dog'])
    });
    const result = await backend._loadUniverseDataInner(BOTH, { allowPermissionPrompt: false });
    expect(names(result)).toEqual(['cat', 'dog', 'fox', 'owl']);
    expect(backend.pendingConflict).toBeNull();
    // The merge is built on the repository's version, and still has to be pushed.
    expect(result._gitObservation).toMatchObject({ sha: 'sha-remote', unpushed: true });
    expect(backend._pendingPushAfterLoad.has(BOTH.slug)).toBe(true);
    // Both copies get the merge.
    expect(backend.syncSecondaryStorage).toHaveBeenCalledWith(BOTH, result, expect.objectContaining({ source: 'git' }));
  });

  it('honours deletions made offline', async () => {
    setBase(BOTH.slug, 'sha-base');
    const backend = makeBackend(BOTH, {
      local: () => buildState(['cat']), // dog deleted offline
      git: () => buildState(['cat', 'dog', 'owl']),
      baseDoc: buildDoc(['cat', 'dog'])
    });
    const result = await backend._loadUniverseDataInner(BOTH, { allowPermissionPrompt: false });
    expect(names(result)).toEqual(['cat', 'owl']);
  });

  it('with no known base it falls back to the old decision', async () => {
    const backend = makeBackend(BOTH, {
      local: () => buildState(['cat', 'dog', 'fox']),
      git: () => buildState(['cat', 'dog', 'owl']),
      baseDoc: buildDoc(['cat', 'dog'])
    });
    await backend._loadUniverseDataInner(BOTH, { allowPermissionPrompt: false });
    expect(backend.createProviderForUniverse).not.toHaveBeenCalled();
    expect(backend._pendingPushAfterLoad?.has(BOTH.slug)).toBeFalsy();
  });

  it('a mass deletion is not merged at load', async () => {
    setBase(BOTH.slug, 'sha-base');
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    const backend = makeBackend(BOTH, {
      local: () => buildState(['cat']),
      git: () => buildState([...many, 'owl']),
      baseDoc: buildDoc(many)
    });
    const result = await backend._loadUniverseDataInner(BOTH, { allowPermissionPrompt: false });
    expect(backend._pendingPushAfterLoad?.has(BOTH.slug)).toBeFalsy();
    expect(result.nodePrototypes.size).toBeGreaterThan(1);
  });

  it('when only this device moved, its copy is the merge (no base download)', async () => {
    setBase(BOTH.slug, 'sha-remote');
    const backend = makeBackend(BOTH, {
      local: () => buildState(['cat', 'dog', 'fox']),
      git: () => buildState(['cat', 'dog']),
      baseDoc: buildDoc(['cat', 'dog'])
    });
    const result = await backend._loadUniverseDataInner(BOTH, { allowPermissionPrompt: false });
    expect(names(result)).toEqual(['cat', 'dog', 'fox']);
    expect(backend.createProviderForUniverse).not.toHaveBeenCalled();
  });
});

describe('load: a Git-only universe (browser copy is the local copy)', () => {
  it('merges the browser copy\'s unpushed edits instead of mirroring Git over them', async () => {
    setBase(GIT_ONLY.slug, 'sha-base');
    const backend = makeBackend(GIT_ONLY, {
      browser: () => buildState(['cat', 'dog', 'fox']),
      git: () => buildState(['cat', 'owl']), // dog deleted by someone, owl added
      baseDoc: buildDoc(['cat', 'dog'])
    });
    const result = await backend._loadUniverseDataInner(GIT_ONLY, { allowPermissionPrompt: false });
    expect(names(result)).toEqual(['cat', 'fox', 'owl']);
    expect(backend._pendingPushAfterLoad.has(GIT_ONLY.slug)).toBe(true);
  });

  it('identical copies load the repository version as before', async () => {
    setBase(GIT_ONLY.slug, 'sha-base');
    const backend = makeBackend(GIT_ONLY, {
      browser: () => buildState(['cat', 'dog']),
      git: () => buildState(['cat', 'dog']),
      baseDoc: buildDoc(['cat'])
    });
    const result = await backend._loadUniverseDataInner(GIT_ONLY, { allowPermissionPrompt: false });
    expect(names(result)).toEqual(['cat', 'dog']);
    expect(backend._pendingPushAfterLoad?.has(GIT_ONLY.slug)).toBeFalsy();
  });
});
