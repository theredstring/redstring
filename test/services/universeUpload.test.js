/**
 * Uploading a .redstring file to a repository (Attach Repository > Upload
 * Universe File). The file is written by whoever wrote it, so what matters here
 * is what gets refused, what gets cleaned, where it lands, and that the universe
 * open at the time doesn't get written into the new file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universeBackend } from '../../src/services/universeBackend.js';
import { freeRepoTarget, readUniverseUpload } from '../../src/services/universeUpload.js';
import { parseRedstringBytes } from '../../src/formats/universeBytes.js';
import { exportToRedstring, importFromRedstring } from '../../src/formats/redstringFormat.js';
import { GIT_WRITE_CAP_BYTES } from '../../src/services/gitSyncEngine.js';

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;

const baseState = () => ({
  graphs: new Map([['g1', { id: 'g1', name: 'Main', description: '', instances: new Map(), edgeIds: [], definingNodeIds: [] }]]),
  nodePrototypes: new Map([['dog', { id: 'dog', name: 'Dog', description: '', definitionGraphIds: [], abstractionChains: {} }]]),
  edges: new Map(),
  openGraphIds: ['g1'],
  activeGraphId: 'g1',
  activeDefinitionNodeId: null,
  expandedGraphIds: new Set(),
  rightPanelTabs: [],
  savedNodeIds: new Set(),
  savedGraphIds: new Set(),
  showConnectionNames: false,
});

// What the picker hands over, as far as the reader uses it (jsdom's File has no
// arrayBuffer).
const fileOf = (content, name = 'Ideas.redstring') => {
  const bytes = new TextEncoder().encode(typeof content === 'string' ? content : JSON.stringify(content));
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
};

describe('readUniverseUpload', () => {
  it('reads a real universe and names it after the file', async () => {
    const upload = await readUniverseUpload(fileOf(exportToRedstring(baseState())));
    expect(upload.name).toBe('Ideas');
    expect(upload.thingCount).toBe(1);
    expect(upload.webCount).toBe(1);
    expect(upload.storeState.nodePrototypes.get('dog').name).toBe('Dog');
  });

  it('refuses anything that is not a .redstring document, and says so plainly', async () => {
    const refusals = [
      fileOf(exportToRedstring(baseState()), 'Ideas.json'),
      fileOf('{ not json'),
      fileOf({ sha: 'abc', content: 'a GitHub envelope, not a universe' }),
      fileOf([1, 2, 3]),
    ];
    for (const file of refusals) {
      await expect(readUniverseUpload(file)).rejects.toThrow(`${file.name} isn't a valid .redstring file.`);
    }
    await expect(readUniverseUpload(fileOf('   '))).rejects.toThrow('Ideas.redstring is empty.');
  });

  it('refuses a file with nothing in it rather than writing an empty universe', async () => {
    const empty = exportToRedstring({ ...baseState(), graphs: new Map(), nodePrototypes: new Map(), openGraphIds: [], activeGraphId: null });
    await expect(readUniverseUpload(fileOf(empty))).rejects.toThrow('has no things or webs');
  });

  it('refuses a newer major format', async () => {
    const future = { ...exportToRedstring(baseState()), format: 'redstring-v99.0.0' };
    await expect(readUniverseUpload(fileOf(future))).rejects.toThrow('newer version of Redstring');
  });

  it('refuses a file over what a repository can carry without reading it', async () => {
    const file = { ...fileOf(exportToRedstring(baseState())), size: GIT_WRITE_CAP_BYTES + 1, arrayBuffer: vi.fn() };
    await expect(readUniverseUpload(file)).rejects.toThrow('a repository can carry');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not call a file invalid when it just could not be read', async () => {
    const file = { ...fileOf('{}'), arrayBuffer: async () => { throw new Error('The file could not be read'); } };
    await expect(readUniverseUpload(file)).rejects.toThrow('The file could not be read');
  });

  describe('a hostile file', () => {
    const hostile = () => {
      const state = baseState();
      Object.assign(state.nodePrototypes.get('dog'), {
        color: 'url(javascript:alert(1))',
        imageSrc: 'javascript:alert(1)',
        externalLinks: ['javascript:alert(1)', 'https://example.org/fine', 'doi:10.1000/182'],
      });
      const doc = exportToRedstring(state);
      // The export is honest about what it was given, so these really are in the file.
      expect(JSON.stringify(doc)).toContain('javascript:alert(1)');
      doc.prototypeSpace.prototypes.dog['redstring:agentConfig'] = { prompt: 'kept', apiKey: 'sk-stolen', nested: { accessToken: 'stolen' } };
      // JSON text, because an object literal's __proto__ would set the prototype.
      return JSON.stringify(doc).replace(
        '"prototypeSpace":{',
        '"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototypeSpace":{',
      );
    };

    it('comes out clean, and so does the file written from it', async () => {
      const { storeState } = await readUniverseUpload(fileOf(hostile()));
      const dog = storeState.nodePrototypes.get('dog');

      expect({}.polluted).toBeUndefined();
      expect(dog.color).toBe('#8B0000');
      expect(dog.imageSrc).toBeUndefined();
      expect(dog.externalLinks).toEqual(['https://example.org/fine', 'doi:10.1000/182']);
      expect(dog.agentConfig).toEqual({ prompt: 'kept', nested: {} });

      const written = JSON.stringify(exportToRedstring(storeState));
      expect(written).not.toContain('javascript:');
      expect(written).not.toContain('polluted');
    });

    it('pollutes nothing through the streaming parser big files take', async () => {
      const parsed = await parseRedstringBytes(new TextEncoder().encode(hostile()), { streamAt: 0 });
      const { storeState } = importFromRedstring(parsed);
      expect({}.polluted).toBeUndefined();
      expect(storeState.polluted).toBeUndefined();
      expect(JSON.stringify(exportToRedstring(storeState))).not.toContain('javascript:');
    });
  });
});

describe('freeRepoTarget', () => {
  it('is where a new universe file goes when nothing is there', () => {
    expect(freeRepoTarget('ideas', [])).toEqual({ folder: 'ideas', file: 'ideas.redstring' });
  });

  it('numbers past what the repository already holds, ignoring case', () => {
    const discovered = [
      { path: 'universes/Ideas/Ideas.redstring' },
      { path: 'universes/ideas-1/ideas-1.redstring' },
    ];
    expect(freeRepoTarget('ideas', discovered)).toEqual({ folder: 'ideas-2', file: 'ideas-2.redstring' });
  });
});

describe('addUploadedUniverseToRepository', () => {
  const repoConfig = { user: 'someone', repo: 'things', authMethod: 'oauth' };
  let backend;
  let order;
  let store;
  let engine;

  beforeEach(() => {
    order = [];
    store = { current: null };
    engine = {
      forceCommit: vi.fn(async () => { order.push('commit'); return { commitHash: 'abc' }; }),
    };

    backend = Object.create(UniverseBackend.prototype);
    backend.universes = new Map();
    backend.fileHandles = new Map();
    backend.gitSyncEngines = new Map();
    backend.isInitialized = true;
    backend.initialize = vi.fn(async () => {});
    backend.saveToStorage = vi.fn();
    backend.notifyStatus = vi.fn();
    backend.trackGitOperationStart = vi.fn();
    backend.trackGitOperationComplete = vi.fn();
    backend.syncSecondaryStorage = vi.fn(async () => {});
    backend._persistPostSaveTelemetry = vi.fn(async () => {});
    backend.saveActiveUniverse = vi.fn(async () => { order.push('browser-save'); return []; });
    backend.ensureGitSyncEngine = vi.fn(async () => engine);
    backend.discoverUniversesInRepository = vi.fn(async () => { order.push('list'); return []; });
    backend._releaseOutgoingUniverse = vi.fn(async () => { order.push('release'); });
    backend.storeOperations = {
      getState: () => store.current,
      loadUniverseFromFile: vi.fn((state) => { store.current = state; order.push(`load:${state.nodePrototypes?.size ?? 0}`); return true; }),
    };
  });

  const upload = () => readUniverseUpload(fileOf(exportToRedstring(baseState())));

  it('releases what is open, then commits the uploaded state to the path a new file gets', async () => {
    const { storeState } = await upload();
    const result = await backend.addUploadedUniverseToRepository(storeState, 'Ideas', repoConfig);

    expect(result).toEqual({ slug: 'ideas', gitError: null });
    expect(order.indexOf('list')).toBeLessThan(order.indexOf('release'));
    expect(order.indexOf('release')).toBeLessThan(order.indexOf('commit'));

    const universe = backend.getUniverse('ideas');
    expect(universe.gitRepo.linkedRepo).toMatchObject({ user: 'someone', repo: 'things' });
    expect(universe.gitRepo.universeFolder).toBe('ideas');
    expect(universe.gitRepo.universeFile).toBe('ideas.redstring');
    expect(universe.sourceOfTruth).toBe('git');

    expect(engine.forceCommit).toHaveBeenCalledTimes(1);
    const committed = engine.forceCommit.mock.calls[0][0];
    expect(committed.nodePrototypes.get('dog').name).toBe('Dog');
    expect(committed._universeSlug).toBe('ideas');
  });

  it('keeps a name that tries to walk out of the universes folder inside it', async () => {
    const { storeState } = await upload();
    await backend.addUploadedUniverseToRepository(storeState, '../../.github/workflows/x', repoConfig);
    const [universe] = backend.universes.values();
    expect(universe.gitRepo.universeFolder).toMatch(/^[a-z0-9_-]+$/);
    expect(universe.gitRepo.universeFile).toMatch(/^[a-z0-9_-]+\.redstring$/);
  });

  it('does not land on a file the repository already has', async () => {
    backend.discoverUniversesInRepository = vi.fn(async () => [{ path: 'universes/ideas/ideas.redstring' }]);
    const { storeState } = await upload();
    await backend.addUploadedUniverseToRepository(storeState, 'Ideas', repoConfig);
    expect(backend.getUniverse('ideas').gitRepo.universeFolder).toBe('ideas-1');
    expect(backend.getUniverse('ideas').gitRepo.universeFile).toBe('ideas-1.redstring');
  });

  it('changes nothing when the repository cannot be listed', async () => {
    backend.discoverUniversesInRepository = vi.fn(async () => { throw new Error('rate limited'); });
    const { storeState } = await upload();
    await expect(backend.addUploadedUniverseToRepository(storeState, 'Ideas', repoConfig)).rejects.toThrow('rate limited');
    expect(backend._releaseOutgoingUniverse).not.toHaveBeenCalled();
    expect(backend.universes.size).toBe(0);
  });

  it('reports a repository write that failed, keeping the universe open', async () => {
    engine.forceCommit = vi.fn(async () => { throw new Error('REMOTE_CONFLICT'); });
    const { storeState } = await upload();
    const result = await backend.addUploadedUniverseToRepository(storeState, 'Ideas', repoConfig);
    expect(result).toEqual({ slug: 'ideas', gitError: 'REMOTE_CONFLICT' });
    expect(backend.getUniverse('ideas')).toBeTruthy();
    expect(store.current.nodePrototypes.get('dog').name).toBe('Dog');
  });
});
