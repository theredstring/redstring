/**
 * A universe linked to both a local file and a repository is read once per
 * load, not twice.
 *
 * The conflict check reads both copies to compare them; the load then used to
 * throw those reads away and make them again. With `cache: 'no-store'` on the
 * GitHub reads (the 2026-09-12 fix, which must stay), the second repository
 * read was a second full download of a multi-megabyte universe on every
 * launch. And when the check had just proved the two copies identical, the
 * load still re-exported and rewrote the whole local file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const buildState = (names) => {
  const nodePrototypes = new Map(
    names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]),
  );
  const instances = names.length > 0
    ? new Map([['i1', { id: 'i1', prototypeId: names[0], x: 10, y: 20, scale: 1 }]])
    : new Map();
  const graphs = new Map([
    ['g1', { id: 'g1', name: 'Main', description: '', instances, edgeIds: [], definingNodeIds: [] }],
  ]);
  const state = {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
  // As a load would see it: through the file format.
  return importFromRedstring(exportToRedstring(state), {}).storeState;
};

const universe = {
  slug: 'both-linked',
  name: 'Both Linked',
  sourceOfTruth: 'git',
  localFile: { enabled: true },
  gitRepo: { enabled: true, linkedRepo: 'someone/repo' },
  browserStorage: { enabled: false },
};

const makeBackend = ({ local, git }) => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.fileHandles = new Map([[universe.slug, { name: 'both-linked.redstring' }]]);
  backend.pendingConflict = null;
  backend.pendingPrimarySelection = new Set();
  backend.secondarySyncTimestamps = new Map();
  backend.notifyStatus = vi.fn();
  backend.loadFromLocalFile = vi.fn(async () => local());
  backend.loadFromGit = vi.fn(async () => git());
  backend.loadFromGitDirect = vi.fn(async () => null);
  backend.saveToLinkedLocalFile = vi.fn(async () => {});
  return backend;
};

describe('loading a universe linked to both a file and a repository', () => {
  let localState;
  let gitState;
  beforeEach(() => {
    localState = buildState(['dog', 'cat']);
    gitState = buildState(['dog', 'cat']);
  });

  it('reads each copy once when they hold the same knowledge', async () => {
    const backend = makeBackend({ local: () => localState, git: () => gitState });

    const result = await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: false });

    expect(result).toBe(gitState);
    expect(backend.loadFromLocalFile).toHaveBeenCalledTimes(1);
    expect(backend.loadFromGit).toHaveBeenCalledTimes(1);
  });

  // Both write tests allow prompts: with prompts off the fake file handle
  // fails the permission check, and the write would be skipped for that
  // reason instead.
  it('does not rewrite a local file it just proved identical', async () => {
    const backend = makeBackend({ local: () => localState, git: () => gitState });

    await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: true });

    expect(backend.saveToLinkedLocalFile).not.toHaveBeenCalled();
  });

  it('still writes the local file when it is behind the repository', async () => {
    // Local empty beside a populated git primary: no conflict, and the file
    // needs the repository's content.
    localState = buildState([]);
    const backend = makeBackend({ local: () => localState, git: () => gitState });

    const result = await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: true });

    expect(result).toBe(gitState);
    expect(backend.loadFromGit).toHaveBeenCalledTimes(1);
    expect(backend.saveToLinkedLocalFile).toHaveBeenCalledTimes(1);
    expect(backend.saveToLinkedLocalFile.mock.calls[0][1]).toBe(gitState);
  });

  it('reads the repository again when the check could not', async () => {
    // A failed read is not reused: the load needs its error, or a second try.
    let gitCalls = 0;
    const backend = makeBackend({
      local: () => localState,
      git: () => {
        gitCalls += 1;
        if (gitCalls === 1) throw new Error('network blip');
        return gitState;
      }
    });

    const result = await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: false });

    expect(backend.loadFromGit).toHaveBeenCalledTimes(2);
    expect(result).toBe(gitState);
  });

  it('reads the local file again when the check could not', async () => {
    let localCalls = 0;
    const backend = makeBackend({
      local: () => {
        localCalls += 1;
        if (localCalls === 1) throw new Error('permission not granted yet');
        return localState;
      },
      git: () => gitState
    });

    await backend._loadUniverseDataInner(universe, { allowPermissionPrompt: true });

    expect(backend.loadFromLocalFile).toHaveBeenCalledTimes(2);
    // The second read is the load's own, and may prompt.
    expect(backend.loadFromLocalFile.mock.calls[1][1]).toEqual({ allowPermissionPrompt: true });
  });
});
