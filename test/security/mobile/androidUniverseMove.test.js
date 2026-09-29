/**
 * S-77: Android universes move from Directory.External to Directory.Data —
 * copy, verify byte-for-byte, only then mark done and remove the originals.
 * Any failure leaves every original in place and External handles resolving
 * to External. Existing persisted handles keep working after the move.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  migrateAndroidUniversesToData,
  resolveHandleDirectory,
  universesFolderHandle,
  __resetAndroidMoveForTests
} from '../../../src/utils/capacitorAdapter.js';

const MARKER = 'redstring_android_universes_moved_to_data_v1';

function installLocalStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  globalThis.localStorage = ls;
  return store;
}

/** In-memory @capacitor/filesystem with two directories. */
function fakeFs(initial = {}) {
  const dirs = { External: new Map(), Data: new Map() };
  for (const [dir, files] of Object.entries(initial)) {
    for (const [path, data] of Object.entries(files)) dirs[dir].set(path, data);
  }
  const ops = [];
  const Filesystem = {
    async readdir({ path, directory }) {
      const prefix = `${path}/`;
      const names = [...dirs[directory].keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
      if (names.length === 0 && !initial[directory]) throw new Error('Directory does not exist');
      return { files: names.map((name) => ({ name, type: 'file' })) };
    },
    async readFile({ path, directory }) {
      if (!dirs[directory].has(path)) throw new Error('File does not exist');
      return { data: dirs[directory].get(path) };
    },
    async writeFile({ path, directory, data }) {
      ops.push(['write', directory, path]);
      if (Filesystem.failWrite) throw new Error('disk full');
      dirs[directory].set(path, Filesystem.corruptWrite ? `${data}X` : data);
    },
    async deleteFile({ path, directory }) {
      ops.push(['delete', directory, path]);
      dirs[directory].delete(path);
    }
  };
  return { fsModule: { Filesystem, Directory: { External: 'External', Data: 'Data' } }, dirs, ops, Filesystem };
}

let ls;
beforeEach(() => {
  ls = installLocalStorage();
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  __resetAndroidMoveForTests();
});
afterEach(() => {
  delete window.Capacitor;
});

describe('migrateAndroidUniversesToData', () => {
  it('moves every file, verified, then marks done and removes the originals', async () => {
    const { fsModule, dirs } = fakeFs({ External: { 'Universes/a.redstring': 'QUFB', 'Universes/a.redstring.bak': 'QkJC' } });
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result).toMatchObject({ status: 'moved', moved: 2 });
    expect(dirs.Data.get('Universes/a.redstring')).toBe('QUFB');
    expect(dirs.Data.get('Universes/a.redstring.bak')).toBe('QkJC');
    expect(dirs.External.size).toBe(0);
    expect(ls.get(MARKER)).toBe('done');
  });

  it('existing External handles resolve to Data after the move; new ones are Data', async () => {
    const { fsModule } = fakeFs({ External: { 'Universes/a.redstring': 'QUFB' } });
    expect(resolveHandleDirectory('External', 'Universes/a.redstring')).toBe('External');
    await migrateAndroidUniversesToData({ fsModule });
    expect(resolveHandleDirectory('External', 'Universes/a.redstring')).toBe('Data');
    expect(resolveHandleDirectory('External', 'Other/x')).toBe('External');
    expect(universesFolderHandle()).toBe('capacitor://Data/Universes/');
  });

  it('a copy that does not verify leaves everything in place and unmarked', async () => {
    const { fsModule, dirs, Filesystem } = fakeFs({ External: { 'Universes/a.redstring': 'QUFB' } });
    Filesystem.corruptWrite = true;
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result.status).toBe('verify-failed');
    expect(dirs.External.get('Universes/a.redstring')).toBe('QUFB');
    expect(ls.has(MARKER)).toBe(false);
    expect(resolveHandleDirectory('External', 'Universes/a.redstring')).toBe('External');
  });

  it('a failed write leaves originals in place and unmarked', async () => {
    const { fsModule, dirs, Filesystem, ops } = fakeFs({ External: { 'Universes/a.redstring': 'QUFB' } });
    Filesystem.failWrite = true;
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result.status).toBe('copy-failed');
    expect(dirs.External.has('Universes/a.redstring')).toBe(true);
    expect(ops.some(([op]) => op === 'delete')).toBe(false);
    expect(ls.has(MARKER)).toBe(false);
  });

  it('never overwrites a DIFFERENT file already in Data', async () => {
    const { fsModule, dirs } = fakeFs({
      External: { 'Universes/a.redstring': 'QUFB' },
      Data: { 'Universes/a.redstring': 'Wlla' }
    });
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result.status).toBe('conflict');
    expect(dirs.Data.get('Universes/a.redstring')).toBe('Wlla');
    expect(dirs.External.get('Universes/a.redstring')).toBe('QUFB');
    expect(ls.has(MARKER)).toBe(false);
  });

  it('is idempotent: an identical copy already in Data counts as verified', async () => {
    const { fsModule, dirs } = fakeFs({
      External: { 'Universes/a.redstring': 'QUFB' },
      Data: { 'Universes/a.redstring': 'QUFB' }
    });
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result.status).toBe('moved');
    expect(dirs.Data.get('Universes/a.redstring')).toBe('QUFB');
    expect(await migrateAndroidUniversesToData({ fsModule })).toMatchObject({ status: 'already-done' });
  });

  it('no External folder: nothing moved, nothing marked (a later-mounted volume still moves)', async () => {
    const { fsModule } = fakeFs({});
    const result = await migrateAndroidUniversesToData({ fsModule });
    expect(result.status).toBe('no-source');
    expect(ls.has(MARKER)).toBe(false);
  });

  it('does nothing on iOS', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const { fsModule, ops } = fakeFs({ External: { 'Universes/a.redstring': 'QUFB' } });
    expect((await migrateAndroidUniversesToData({ fsModule })).status).toBe('not-android');
    expect(ops).toEqual([]);
    expect(universesFolderHandle()).toBe('capacitor://Documents/Universes/');
  });
});
