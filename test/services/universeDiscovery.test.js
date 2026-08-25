import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exportToRedstring } from '../../src/formats/redstringFormat.js';

/**
 * Universe Discovery Tests
 *
 * Discovery is split into a cheap listing pass and an expensive counting pass.
 * These tests pin the split: listing must not download anything, and counting
 * must skip any file whose blob sha it has already read.
 */

const store = new Map();

vi.mock('../../src/utils/storageWrapper.js', () => ({
  storageWrapper: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); }
  }
}));

const load = async () => {
  vi.resetModules();
  return {
    discovery: await import('../../src/services/universeDiscovery.js'),
    cache: (await import('../../src/services/repoDiscoveryCache.js'))
  };
};

/** Minimal .redstring bytes with a known shape. */
const universeFile = (things, webs) => {
  const graphs = new Map();
  const nodePrototypes = new Map();
  for (let i = 0; i < webs; i += 1) {
    graphs.set(`g${i}`, { id: `g${i}`, name: `Web ${i}`, instances: new Map(), edgeIds: [], definingNodeIds: [] });
  }
  for (let i = 0; i < things; i += 1) {
    nodePrototypes.set(`p${i}`, { id: `p${i}`, name: `Thing ${i}`, definitionGraphIds: [] });
  }
  return JSON.stringify(exportToRedstring({
    graphs, nodePrototypes, edges: new Map(), edgePrototypes: new Map()
  }));
};

/** Fake provider that records every call so we can assert on request counts. */
const makeProvider = (tree, contents) => {
  const reads = [];
  const lists = [];
  return {
    reads,
    lists,
    normalizePathInput: (p) => (typeof p === 'string' ? p : ''),
    async listDirectoryContents(dirPath) {
      lists.push(dirPath);
      if (!(dirPath in tree)) throw new Error('404');
      return tree[dirPath];
    },
    async readFileRaw(path) {
      reads.push(path);
      if (!(path in contents)) throw new Error(`missing ${path}`);
      return contents[path];
    }
  };
};

const SIMPLE_TREE = {
  universes: [
    { name: 'alpha', type: 'dir', path: 'universes/alpha' },
    { name: 'beta', type: 'dir', path: 'universes/beta' }
  ],
  'universes/alpha': [
    { name: 'alpha.redstring', type: 'file', path: 'universes/alpha/alpha.redstring', sha: 'sha-alpha', size: 100 }
  ],
  'universes/beta': [
    { name: 'beta.redstring', type: 'file', path: 'universes/beta/beta.redstring', sha: 'sha-beta', size: 200 }
  ]
};

const SIMPLE_CONTENTS = {
  'universes/alpha/alpha.redstring': universeFile(18, 6),
  'universes/beta/beta.redstring': universeFile(3, 1)
};

const REPO = { user: 'me', repo: 'notes' };

describe('listUniverseFiles', () => {
  beforeEach(() => store.clear());

  it('finds files without downloading any of them', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);

    const { universes } = await discovery.listUniverseFiles(provider);

    expect(universes.map(u => u.name).sort()).toEqual(['alpha', 'beta']);
    // The whole point of the split — zero file reads in the listing pass.
    expect(provider.reads).toEqual([]);
  });

  it('carries the blob sha and size through from the listing', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);

    const { universes } = await discovery.listUniverseFiles(provider);
    const alpha = universes.find(u => u.name === 'alpha');

    expect(alpha.sha).toBe('sha-alpha');
    expect(alpha.size).toBe(100);
    expect(alpha.path).toBe('universes/alpha/alpha.redstring');
  });

  it('leaves counts absent so the UI can show "?" rather than 0', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);

    const { universes } = await discovery.listUniverseFiles(provider);

    for (const u of universes) {
      expect(u.nodeCount).toBeUndefined();
      expect(u.metadata).toEqual({});
    }
  });

  it('skips backup and archive directories', async () => {
    const { discovery } = await load();
    const tree = {
      universes: [
        { name: '.backups', type: 'dir', path: 'universes/.backups' },
        { name: 'alpha', type: 'dir', path: 'universes/alpha' }
      ],
      'universes/alpha': SIMPLE_TREE['universes/alpha'],
      'universes/.backups': [
        { name: 'old.redstring', type: 'file', path: 'universes/.backups/old.redstring', sha: 'x' }
      ]
    };
    const provider = makeProvider(tree, SIMPLE_CONTENTS);

    const { universes } = await discovery.listUniverseFiles(provider);

    expect(universes.map(u => u.name)).toEqual(['alpha']);
    expect(provider.lists).not.toContain('universes/.backups');
  });
});

describe('hydrateUniverseCounts', () => {
  beforeEach(() => store.clear());

  it('reads each file once and reports real counts', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);
    const { universes } = await discovery.listUniverseFiles(provider);

    const { files, downloads, cacheHits } = await discovery.hydrateUniverseCounts(provider, REPO, universes);

    expect(downloads).toBe(2);
    expect(cacheHits).toBe(0);

    const alpha = files.find(f => f.name === 'alpha');
    expect(alpha.nodeCount).toBe(18);
    expect(alpha.graphCount).toBe(6);
    // Mirrored so both `file.x` and `file.metadata.x` readers agree.
    expect(alpha.metadata.nodeCount).toBe(18);
  });

  it('downloads nothing on a second pass when the shas are unchanged', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);
    const { universes } = await discovery.listUniverseFiles(provider);

    await discovery.hydrateUniverseCounts(provider, REPO, universes);
    provider.reads.length = 0;

    const second = await discovery.hydrateUniverseCounts(provider, REPO, universes);

    expect(provider.reads).toEqual([]);
    expect(second.downloads).toBe(0);
    expect(second.cacheHits).toBe(2);
    expect(second.files.find(f => f.name === 'alpha').nodeCount).toBe(18);
  });

  it('re-reads only the file whose sha changed', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);
    const { universes } = await discovery.listUniverseFiles(provider);
    await discovery.hydrateUniverseCounts(provider, REPO, universes);
    provider.reads.length = 0;

    // beta edited upstream: new sha, new content.
    const edited = universes.map(u => (u.name === 'beta' ? { ...u, sha: 'sha-beta-2' } : u));
    provider.readFileRaw = async (path) => {
      provider.reads.push(path);
      return path.includes('beta') ? universeFile(9, 2) : SIMPLE_CONTENTS[path];
    };

    const result = await discovery.hydrateUniverseCounts(provider, REPO, edited);

    expect(provider.reads).toEqual(['universes/beta/beta.redstring']);
    expect(result.downloads).toBe(1);
    expect(result.cacheHits).toBe(1);
    expect(result.files.find(f => f.name === 'beta').nodeCount).toBe(9);
    expect(result.files.find(f => f.name === 'alpha').nodeCount).toBe(18);
  });

  it('leaves counts absent for an unreadable file instead of reporting zero', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, {
      'universes/alpha/alpha.redstring': SIMPLE_CONTENTS['universes/alpha/alpha.redstring']
      // beta deliberately missing
    });
    const { universes } = await discovery.listUniverseFiles(provider);

    const { files } = await discovery.hydrateUniverseCounts(provider, REPO, universes);

    const beta = files.find(f => f.name === 'beta');
    expect(beta.nodeCount).toBeUndefined();
    expect(files.find(f => f.name === 'alpha').nodeCount).toBe(18);
  });

  it('leaves counts absent for a file that is not valid JSON', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, {
      ...SIMPLE_CONTENTS,
      'universes/beta/beta.redstring': 'not json at all'
    });
    const { universes } = await discovery.listUniverseFiles(provider);

    const { files } = await discovery.hydrateUniverseCounts(provider, REPO, universes);

    expect(files.find(f => f.name === 'beta').nodeCount).toBeUndefined();
  });

  it('reports progress per file so rows can lose their "?" one at a time', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);
    const { universes } = await discovery.listUniverseFiles(provider);

    const snapshots = [];
    await discovery.hydrateUniverseCounts(provider, REPO, universes, (partial, progress) => {
      snapshots.push({
        done: progress.done,
        resolved: partial.filter(f => f.nodeCount !== undefined).length
      });
    });

    expect(snapshots).toEqual([
      { done: 1, resolved: 1 },
      { done: 2, resolved: 2 }
    ]);
  });

  it('still counts a file with no sha, it just cannot cache it', async () => {
    const { discovery } = await load();
    const provider = makeProvider(SIMPLE_TREE, SIMPLE_CONTENTS);
    const files = [{ name: 'alpha', path: 'universes/alpha/alpha.redstring', sha: null, metadata: {} }];

    const first = await discovery.hydrateUniverseCounts(provider, REPO, files);
    expect(first.files[0].nodeCount).toBe(18);

    const second = await discovery.hydrateUniverseCounts(provider, REPO, files);
    expect(second.downloads).toBe(1); // no sha, so no cache key — re-read
  });
});
