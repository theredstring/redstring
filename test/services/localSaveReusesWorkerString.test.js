/**
 * The local file write takes the save worker's file instead of exporting and
 * stringifying the universe again on the main thread, which for a 32,000-Thing
 * universe was nearly 3 s of a frozen app on every save. The worker sends
 * bytes; until 2026-10-09 the write only recognised text, so every autosave
 * threw the worker's bytes away and serialized again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const writes = [];
vi.mock('../../src/utils/fileAccessAdapter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  writeFile: vi.fn(async (handle, text) => { writes.push(text); }),
  readFile: vi.fn(async () => ''),
}));
vi.mock('../../src/services/fileHandlePersistence.js', async (importOriginal) => ({
  ...(await importOriginal()),
  touchFileHandle: vi.fn(async () => {}),
}));

const { universeBackend } = await import('../../src/services/universeBackend.js');
const { saveCoordinator } = await import('../../src/backend/sync/index.js');
const { exportToRedstring } = await import('../../src/formats/redstringFormat.js');
const { serializeRedstring } = await import('../../src/formats/universeBytes.js');
const asText = (written) => (typeof written === 'string' ? written : new TextDecoder().decode(written));

const UniverseBackend = Object.getPrototypeOf(universeBackend).constructor;
const SLUG = 'big-one';
const universe = { slug: SLUG, name: 'Big One', localFile: { enabled: true, hadFileHandle: true }, metadata: {} };

const state = () => ({
  _universeSlug: SLUG,
  graphs: new Map(),
  nodePrototypes: new Map([['a', { id: 'a', name: 'Alpha', definitionGraphIds: [] }]]),
  edges: new Map(),
  hasUniverseFile: true,
});

const makeBackend = () => {
  const backend = Object.create(UniverseBackend.prototype);
  backend.activeUniverseSlug = SLUG;
  backend.fileHandles = new Map([[SLUG, { name: 'big-one.redstring' }]]);
  backend.pendingConflict = null;
  backend.notifyStatus = vi.fn();
  backend.getUniverse = () => universe;
  backend.updateUniverse = vi.fn(async () => {});
  backend._hasSavedContent = () => false;
  return backend;
};

describe('the local file write', () => {
  beforeEach(() => { writes.length = 0; });

  it('hands the worker\'s string from autosave through to the write', async () => {
    const backend = makeBackend();
    backend.saveToLinkedLocalFile = vi.fn(async () => ({ success: true }));
    await backend.ensureSaveCoordinator();
    await saveCoordinator.fileStorage.saveToFile(state(), false, { preSerialized: true, serializedData: '{"from":"worker"}' });
    expect(backend.saveToLinkedLocalFile.mock.calls[0][2].serializedData).toBe('{"from":"worker"}');

    await saveCoordinator.fileStorage.saveToFile(state(), false, {});
    expect(backend.saveToLinkedLocalFile.mock.calls[1][2].serializedData).toBe(null);
  });

  it('writes the worker\'s bytes as they are, without exporting again', async () => {
    const backend = makeBackend();
    const bytes = new TextEncoder().encode('{"from":"worker","bytes":true}');
    await backend.saveToLinkedLocalFile(SLUG, state(), { serializedData: bytes, suppressNotification: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(bytes);
  });

  it('hands the worker\'s bytes from autosave through to the write', async () => {
    const backend = makeBackend();
    backend.saveToLinkedLocalFile = vi.fn(async () => ({ success: true }));
    await backend.ensureSaveCoordinator();
    const bytes = new TextEncoder().encode('{"from":"worker"}');
    await saveCoordinator.fileStorage.saveToFile(state(), false, { preSerialized: true, serializedData: bytes });
    expect(backend.saveToLinkedLocalFile.mock.calls[0][2].serializedData).toBe(bytes);
  });

  it('writes that string as it is, without exporting again', async () => {
    const backend = makeBackend();
    await backend.saveToLinkedLocalFile(SLUG, state(), { serializedData: '{"from":"worker"}', suppressNotification: true });
    expect(writes).toEqual(['{"from":"worker"}']);
  });

  it('serializes on its own, as bytes, when no file comes with the state', async () => {
    const backend = makeBackend();
    const s = state();
    await backend.saveToLinkedLocalFile(SLUG, s, { suppressNotification: true });
    expect(writes).toHaveLength(1);
    const written = JSON.parse(asText(writes[0]));
    const expected = exportToRedstring(s);
    expect(Object.keys(written.prototypeSpace.prototypes)).toEqual(Object.keys(expected.prototypeSpace.prototypes));
    // The same bytes the worker would have written: pretty, for a small universe.
    expect(asText(writes[0])).toBe(new TextDecoder().decode(serializeRedstring(JSON.parse(asText(writes[0])))));
  });
});
