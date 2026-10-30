/**
 * A linked file saved by something else (another device through a synced
 * folder, another app) is never written over without the person choosing.
 *
 * Before: nothing compared the file with what this device last read or
 * wrote, so the next autosave replaced the other save without a word. Now a
 * save is refused when the file changed, the person picks a version, and the
 * other one goes to History as a backup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const disk = { bytes: null, mtime: 1000, writes: 0, statable: true };
const elsewhere = (bytes) => { disk.bytes = bytes; disk.mtime += 7; };

vi.mock('../../src/utils/fileAccessAdapter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readFileBytes: vi.fn(async () => disk.bytes),
  fileExists: vi.fn(async () => true),
  statFile: vi.fn(async () => (disk.statable && disk.bytes ? { size: disk.bytes.length, mtimeMs: disk.mtime } : null)),
  writeFile: vi.fn(async (_handle, content) => {
    disk.bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    disk.mtime += 1;
    disk.writes += 1;
  }),
}));
vi.mock('../../src/services/fileHandlePersistence.js', async (importOriginal) => ({
  ...(await importOriginal()),
  touchFileHandle: vi.fn(async () => {}),
  storeFileHandleMetadata: vi.fn(async () => {}),
  checkFileHandlePermission: vi.fn(async () => 'granted'),
}));
const backups = [];
vi.mock('../../src/services/universeBackups.js', async (importOriginal) => ({
  ...(await importOriginal()),
  noteUniverseSaved: vi.fn(),
  backUpNow: vi.fn(async (slug, source) => { backups.push({ slug, source }); return { id: 'b' + backups.length }; }),
}));
const dialog = { answer: undefined, asked: 0, host: true };
vi.mock('../../src/components/shared/appDialogs.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasAppDialogHost: () => dialog.host,
  askConfirm: vi.fn(async () => { dialog.asked += 1; return dialog.answer; }),
}));

const { universeBackend } = await import('../../src/services/universeBackend.js');
const { saveCoordinator } = await import('../../src/backend/sync/index.js');
const { exportToRedstring, importFromRedstring } = await import('../../src/formats/redstringFormat.js');
const { serializeRedstring } = await import('../../src/formats/universeBytes.js');

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;
const SLUG = 'field-notes';

const buildState = (names) => {
  const nodePrototypes = new Map(names.map((n) => [n, { id: n, name: n, description: '', definitionGraphIds: [], abstractionChains: {} }]));
  const graphs = new Map([['g1', { id: 'g1', name: 'Main', description: '', instances: new Map([['i1', { id: 'i1', prototypeId: names[0], x: 0, y: 0, scale: 1 }]]), edgeIds: [], definingNodeIds: [] }]]);
  const state = {
    graphs, nodePrototypes, edges: new Map(),
    openGraphIds: ['g1'], activeGraphId: 'g1', activeDefinitionNodeId: null,
    expandedGraphIds: new Set(), rightPanelTabs: [],
    savedNodeIds: new Set(), savedGraphIds: new Set(), showConnectionNames: false,
    universeCreatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...importFromRedstring(exportToRedstring(state), {}).storeState, _universeSlug: SLUG };
};
const bytesOf = (state) => {
  const out = serializeRedstring(exportToRedstring(state));
  return typeof out === 'string' ? new TextEncoder().encode(out) : out;
};

const universe = {
  slug: SLUG,
  name: 'Field Notes',
  sourceOfTruth: 'local',
  localFile: { enabled: true, hadFileHandle: true },
  gitRepo: { enabled: false },
  browserStorage: { enabled: false },
  metadata: { lastSaved: '2026-10-01T00:00:00.000Z' },
};

let open;
const makeBackend = () => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.universes = new Map([[SLUG, universe]]);
  backend.activeUniverseSlug = SLUG;
  backend.fileHandles = new Map([[SLUG, { name: 'field-notes.redstring' }]]);
  backend.unreadableLocalFiles = new Map();
  backend.localFileStamps = new Map();
  backend.changedLocalFiles = new Set();
  backend._askingAboutLocalFile = new Set();
  backend._localFileQueues = new Map();
  backend.pendingConflict = null;
  backend.gitSyncEngines = new Map();
  backend.loadsInFlight = 0;
  backend.notifications = [];
  backend.notifyStatus = (level, message) => backend.notifications.push({ level, message });
  backend.getUniverse = (slug) => backend.universes.get(slug);
  backend.updateUniverse = vi.fn(async () => {});
  backend.updateLocalFileState = vi.fn(async () => {});
  backend.ensureLocalFileHandle = vi.fn(async () => ({}));
  backend.backupBeforeMigrationIfNeeded = vi.fn(async () => {});
  backend._hasSavedContent = () => true;
  backend.storeOperations = { getState: () => open, loadUniverseFromFile: vi.fn((s) => { open = s; }) };
  backend.loadUniverseData = vi.fn(async (u) => backend.loadFromLocalFile(u));
  return backend;
};

const save = (backend, state) => backend.saveToLinkedLocalFile(SLUG, state, { suppressNotification: true });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a linked file saved elsewhere', () => {
  let backend;
  beforeEach(async () => {
    disk.bytes = bytesOf(buildState(['cat', 'dog']));
    disk.mtime = 1000;
    disk.writes = 0;
    disk.statable = true;
    backups.length = 0;
    dialog.answer = undefined;
    dialog.asked = 0;
    dialog.host = true;
    vi.spyOn(saveCoordinator, 'hasUnsavedChanges').mockReturnValue(false);
    vi.spyOn(saveCoordinator, 'flush').mockResolvedValue(true);
    vi.spyOn(saveCoordinator, 'cancelPendingSaves').mockImplementation(() => {});
    backend = makeBackend();
    open = await backend.loadFromLocalFile(universe);
  });
  afterEach(() => vi.restoreAllMocks());

  it('saves as before while the file is as this device left it', async () => {
    await save(backend, buildState(['cat', 'dog', 'fox']));
    await save(backend, buildState(['cat', 'dog', 'fox', 'owl']));
    expect(disk.writes).toBe(2);
    expect(dialog.asked).toBe(0);
  });

  it('refuses to write over a save from elsewhere, and asks once', async () => {
    const theirs = bytesOf(buildState(['cat', 'dog', 'emu']));
    elsewhere(theirs);
    dialog.answer = null;

    expect(await save(backend, buildState(['cat', 'dog', 'fox']))).toMatchObject({ blocked: true });
    await settle();
    expect(await save(backend, buildState(['cat', 'dog', 'fox', 'owl']))).toMatchObject({ blocked: true });
    await settle();

    expect(disk.writes).toBe(0);
    expect(disk.bytes).toBe(theirs);
    expect(dialog.asked).toBe(1);
  });

  it('a touch that left the content alone is not a change', async () => {
    disk.mtime += 50; // iCloud re-downloading the same file, a backup tool
    await save(backend, buildState(['cat', 'dog', 'fox']));
    expect(disk.writes).toBe(1);
    expect(dialog.asked).toBe(0);
  });

  it('Keep Mine: the version on disk goes to History, then this one is saved', async () => {
    const theirs = bytesOf(buildState(['cat', 'dog', 'emu']));
    elsewhere(theirs);
    dialog.answer = false;

    await save(backend, buildState(['cat', 'dog', 'fox']));
    await vi.waitFor(() => expect(saveCoordinator.flush).toHaveBeenCalled());

    expect(backups).toHaveLength(1);
    expect(backups[0].source.content).toBe(theirs);
    expect(backend.changedLocalFiles.has(SLUG)).toBe(false);
    await save(backend, buildState(['cat', 'dog', 'fox']));
    expect(disk.writes).toBe(1);
  });

  it('Open That Version: what was open goes to History, then the file is opened', async () => {
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    dialog.answer = true;

    await save(backend, buildState(['cat', 'dog', 'fox']));
    await vi.waitFor(() => expect(backend.storeOperations.loadUniverseFromFile).toHaveBeenCalled());

    expect(backups).toHaveLength(1);
    expect(saveCoordinator.cancelPendingSaves).toHaveBeenCalled();
    expect(open.nodePrototypes.has('emu')).toBe(true);
    expect(disk.writes).toBe(0);
    expect(backend.changedLocalFiles.has(SLUG)).toBe(false);
  });

  it('closing the question without choosing changes nothing, and it is asked again on focus', async () => {
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    dialog.answer = null;
    await save(backend, buildState(['cat', 'dog', 'fox']));
    await settle();
    expect(backups).toHaveLength(0);

    await backend.checkLocalFileForChanges();
    expect(dialog.asked).toBe(2);
    expect(disk.writes).toBe(0);
  });

  it('on focus, with nothing unsaved, the file is simply opened again', async () => {
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));

    const result = await backend.checkLocalFileForChanges();

    expect(result).toMatchObject({ changed: true, reopened: true });
    expect(dialog.asked).toBe(0);
    expect(open.nodePrototypes.has('emu')).toBe(true);
  });

  it('on focus, with unsaved changes here, it asks instead', async () => {
    saveCoordinator.hasUnsavedChanges.mockReturnValue(true);
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    dialog.answer = null;

    await backend.checkLocalFileForChanges();
    await settle();

    expect(dialog.asked).toBe(1);
    expect(backend.storeOperations.loadUniverseFromFile).not.toHaveBeenCalled();
  });

  it('with no one to ask (tests, headless), it stays refused and says so', async () => {
    dialog.host = false;
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    expect(await save(backend, buildState(['cat', 'dog', 'fox']))).toMatchObject({ blocked: true });
    await settle();
    expect(dialog.asked).toBe(0);
    expect(backend.notifications.some((n) => /saved elsewhere/.test(n.message))).toBe(true);
  });

  it('where the platform can\'t tell, it saves as it always did', async () => {
    disk.statable = false;
    backend = makeBackend();
    open = await backend.loadFromLocalFile(universe);
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    await save(backend, buildState(['cat', 'dog', 'fox']));
    expect(disk.writes).toBe(1);
  });

  it('choosing a file for the universe starts afresh', async () => {
    elsewhere(bytesOf(buildState(['cat', 'dog', 'emu'])));
    dialog.answer = null;
    await save(backend, buildState(['cat', 'dog', 'fox']));
    await settle();
    await backend.setFileHandle(SLUG, { name: 'field-notes-2.redstring' }).catch(() => {});
    expect(backend.changedLocalFiles.has(SLUG)).toBe(false);
    expect(backend.localFileStamps.has(SLUG)).toBe(false);
  });
});
