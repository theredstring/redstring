// @vitest-environment node
// Universe backups kept by main (electron/backupStore.cjs): made from the file
// just saved, named by universe and id only, never by a path the renderer
// chose.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBackupStore, folderNameForSlug, isValidBackupId, idFromTime, timeFromId } = require('../../../electron/backupStore.cjs');

let dir;
let root;
let clock;
let store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-backups-'));
  root = path.join(dir, 'RedstringBackups');
  clock = Date.UTC(2026, 9, 9, 14, 30, 0, 0);
  store = createBackupStore({ root, now: () => clock });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const universeFile = (text) => {
  const file = path.join(dir, 'Ideas.redstring');
  fs.writeFileSync(file, text);
  return file;
};

describe('backupStore', () => {
  it('copies the saved file and lists it, newest first', async () => {
    const file = universeFile('{"v":1}');
    const first = await store.snapshotFile('ideas', file);
    clock += 10 * 60 * 1000;
    fs.writeFileSync(file, '{"v":2}');
    const second = await store.snapshotFile('ideas', file);

    const listed = await store.list('ideas');
    expect(listed.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(listed[0]).toMatchObject({ at: clock, size: 7 });
    expect(new TextDecoder().decode(await store.read('ideas', first.id))).toBe('{"v":1}');
    expect(new TextDecoder().decode(await store.read('ideas', second.id))).toBe('{"v":2}');
  });

  it('never writes beside the universe file', async () => {
    const file = universeFile('{}');
    await store.snapshotFile('ideas', file);
    expect(fs.readdirSync(dir).sort()).toEqual(['Ideas.redstring', 'RedstringBackups']);
  });

  it('keeps bytes it is handed, and gives two backups in one millisecond different ids', async () => {
    const a = await store.writeBytes('ideas', new TextEncoder().encode('a'));
    const b = await store.writeBytes('ideas', new TextEncoder().encode('b'));
    expect(a.id).not.toBe(b.id);
    expect((await store.list('ideas')).length).toBe(2);
    await expect(store.writeBytes('ideas', 'text')).rejects.toThrow(/bytes/);
  });

  it('keeps each universe apart and counts them all', async () => {
    await store.writeBytes('ideas', new Uint8Array(10));
    await store.writeBytes('other', new Uint8Array(5));
    expect((await store.list('ideas')).length).toBe(1);
    expect(await store.usage()).toEqual({ bytes: 15, count: 2 });
  });

  it('removes one, and clears all', async () => {
    const a = await store.writeBytes('ideas', new Uint8Array(1));
    await store.remove('ideas', a.id);
    expect(await store.list('ideas')).toEqual([]);
    await store.writeBytes('ideas', new Uint8Array(1));
    await store.clearAll();
    expect(await store.usage()).toEqual({ bytes: 0, count: 0 });
  });

  it('refuses ids that are not backup ids', async () => {
    await expect(store.read('ideas', '../../etc/passwd')).rejects.toThrow(/Invalid backup/);
    await expect(store.remove('ideas', '../Ideas')).rejects.toThrow(/Invalid backup/);
    expect(isValidBackupId('20261009T143000000Z')).toBe(true);
    expect(isValidBackupId('20261009T143000000Z.redstring')).toBe(false);
  });

  it('keeps a slug that is not a plain name inside the root', () => {
    for (const slug of ['../escape', 'a/b', '..', 'with space']) {
      const folder = store.folderFor(slug);
      expect(path.dirname(folder)).toBe(root);
    }
    expect(folderNameForSlug('../escape')).not.toBe(folderNameForSlug('__escape'));
    expect(() => folderNameForSlug('')).toThrow();
  });

  it('ignores stray files in a universe folder', async () => {
    await store.writeBytes('ideas', new Uint8Array(1));
    fs.writeFileSync(path.join(store.folderFor('ideas'), 'notes.txt'), 'x');
    fs.writeFileSync(path.join(store.folderFor('ideas'), '20261009T143000000Z.redstring.123.tmp'), 'x');
    expect((await store.list('ideas')).length).toBe(1);
  });

  it('reads the time back out of an id', () => {
    expect(timeFromId(idFromTime(clock))).toBe(clock);
  });
});
