/**
 * A linked local file that is there but can't be read (half-synced by a cloud
 * drive, cut off mid-write, written by a newer Redstring) is never saved over.
 *
 * The load used to treat a parse failure like "no local copy": it opened the
 * repository's copy and wrote it back over the file, and every autosave after
 * did the same, so edits the file held since the last push were lost. Now the
 * repository copy still opens, but nothing writes to the file until it reads
 * again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const disk = { bytes: null, writes: [] };
vi.mock('../../src/utils/fileAccessAdapter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readFileBytes: vi.fn(async () => disk.bytes),
  fileExists: vi.fn(async () => true),
  writeFile: vi.fn(async (_handle, content) => { disk.writes.push(content); }),
}));
vi.mock('../../src/services/fileHandlePersistence.js', async (importOriginal) => ({
  ...(await importOriginal()),
  touchFileHandle: vi.fn(async () => {}),
  checkFileHandlePermission: vi.fn(async () => 'granted'),
}));

const { universeBackend } = await import('../../src/services/universeBackend.js');
const { exportToRedstring, importFromRedstring } = await import('../../src/formats/redstringFormat.js');
const { serializeRedstring } = await import('../../src/formats/universeBytes.js');

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;
const SLUG = 'field-notes';

const buildState = (names) => {
  const nodePrototypes = new Map(
    names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]),
  );
  const graphs = new Map([
    ['g1', { id: 'g1', name: 'Main', description: '', instances: new Map([['i1', { id: 'i1', prototypeId: names[0], x: 0, y: 0, scale: 1 }]]), edgeIds: [], definingNodeIds: [] }],
  ]);
  const state = {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
  };
  return importFromRedstring(exportToRedstring(state), {}).storeState;
};

const bytesOf = (state) => {
  const s = serializeRedstring(exportToRedstring(state));
  return typeof s === 'string' ? new TextEncoder().encode(s) : s;
};

const makeBackend = (universe, gitState) => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.universes = new Map([[SLUG, universe]]);
  backend.activeUniverseSlug = SLUG;
  backend.fileHandles = new Map([[SLUG, { name: 'field-notes.redstring' }]]);
  backend.unreadableLocalFiles = new Map();
  backend.pendingConflict = null;
  backend.pendingPrimarySelection = new Set();
  backend.secondarySyncTimestamps = new Map();
  backend.notifications = [];
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.getUniverse = (slug) => backend.universes.get(slug);
  backend.updateUniverse = vi.fn(async () => {});
  backend.updateLocalFileState = vi.fn(async () => {});
  backend.ensureLocalFileHandle = vi.fn(async () => ({}));
  backend.backupBeforeMigrationIfNeeded = vi.fn(async () => {});
  backend.loadFromGit = vi.fn(async () => gitState);
  backend.loadFromGitDirect = vi.fn(async () => null);
  backend._hasSavedContent = () => true;
  return backend;
};

const universeWith = (sourceOfTruth) => ({
  slug: SLUG,
  name: 'Field Notes',
  sourceOfTruth,
  localFile: { enabled: true, hadFileHandle: true },
  gitRepo: { enabled: true, linkedRepo: 'someone/field-notes' },
  browserStorage: { enabled: false },
  metadata: {},
});

describe('a linked local file that cannot be read', () => {
  let gitState;
  beforeEach(() => {
    disk.bytes = new TextEncoder().encode('{"@context": "https://redstring.net/contexts/v1.jsonld", "prototypeSp');
    disk.writes.length = 0;
    gitState = buildState(['older', 'copy']);
  });

  it('says why it failed', async () => {
    const backend = makeBackend(universeWith('local'), gitState);
    await expect(backend.loadFromLocalFile(backend.getUniverse(SLUG)))
      .rejects.toMatchObject({ code: 'LOCAL_FILE_UNREADABLE' });
  });

  it('local primary: opens the repository copy and never writes it over the file', async () => {
    const backend = makeBackend(universeWith('local'), gitState);

    const loaded = await backend._loadUniverseDataInner(backend.getUniverse(SLUG), { allowPermissionPrompt: true });

    expect(loaded).toBe(gitState);
    expect(disk.writes).toHaveLength(0);
    expect(backend.notifications.some((n) => /couldn't read the local file/i.test(n.message))).toBe(true);

    // Nor does any save after it.
    const outcome = await backend.saveToLinkedLocalFile(SLUG, gitState, { suppressNotification: true });
    expect(outcome).toMatchObject({ blocked: true });
    await expect(backend.saveToLocalFile(backend.getUniverse(SLUG), exportToRedstring(gitState))).rejects.toThrow(/could not be read/);
    expect(disk.writes).toHaveLength(0);
  });

  it('Git primary: the repository copy is not mirrored over the file', async () => {
    const backend = makeBackend(universeWith('git'), gitState);

    const loaded = await backend._loadUniverseDataInner(backend.getUniverse(SLUG), { allowPermissionPrompt: true });

    expect(loaded).toBe(gitState);
    expect(disk.writes).toHaveLength(0);
  });

  it('writes again once the file reads', async () => {
    const backend = makeBackend(universeWith('local'), gitState);
    await backend._loadUniverseDataInner(backend.getUniverse(SLUG), { allowPermissionPrompt: true });
    expect(backend.unreadableLocalFiles.has(SLUG)).toBe(true);

    disk.bytes = bytesOf(buildState(['whole', 'again']));
    const reread = await backend.loadFromLocalFile(backend.getUniverse(SLUG));
    expect(reread.nodePrototypes.has('whole')).toBe(true);
    expect(backend.unreadableLocalFiles.has(SLUG)).toBe(false);

    await backend.saveToLinkedLocalFile(SLUG, reread, { suppressNotification: true });
    expect(disk.writes).toHaveLength(1);
  });

  it('writes again once the person picks a file', async () => {
    const backend = makeBackend(universeWith('local'), gitState);
    await backend._loadUniverseDataInner(backend.getUniverse(SLUG), { allowPermissionPrompt: true });
    expect(backend.unreadableLocalFiles.has(SLUG)).toBe(true);

    // setFileHandle's first act; the rest of it records metadata.
    await backend.setFileHandle(SLUG, { name: 'field-notes-2.redstring' }).catch(() => {});
    expect(backend.unreadableLocalFiles.has(SLUG)).toBe(false);
  });
});
