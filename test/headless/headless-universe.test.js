// @vitest-environment node
/**
 * HeadlessUniverse: the daemon's file-owning persistence layer.
 * Verifies load → mutate → debounced save → reload persistence, the exclusive
 * lock, and the shrink guard — all against the REAL store + real fs in Node.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

let useGraphStore;
let HeadlessUniverse;
let exportToRedstring;
let tmpDir;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ HeadlessUniverse } = await import('../../src/headless/HeadlessUniverse.js'));
  ({ exportToRedstring } = await import('../../src/formats/redstringFormat.js'));
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-headless-'));
});

afterAll(async () => {
  try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const silent = () => {};

describe('HeadlessUniverse', () => {
  it('creates and saves a universe file from store mutations', async () => {
    const filePath = path.join(tmpDir, 'save.redstring');
    const u = new HeadlessUniverse({ filePath, useGraphStore, debounceMs: 20, log: silent });
    await u.load();
    u.watch();

    const store = useGraphStore.getState();
    store.createNewGraph({ id: 'g-persist', name: 'Persisted Graph' });
    store.addNodePrototype({ id: 'p-persist', name: 'Persisted Node', color: '#abcdef' });

    await u.flush();

    expect(fs.existsSync(filePath)).toBe(true);
    const json = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('Persisted Graph');
    expect(serialized).toContain('Persisted Node');

    await u.close();
  });

  it('loads an existing file into a fresh store state', async () => {
    // Build a known universe, export it, write it as a fixture file.
    const fixturePath = path.join(tmpDir, 'fixture.redstring');
    const store = useGraphStore.getState();
    store.createNewGraph({ id: 'g-fixture', name: 'Fixture Graph' });
    store.addNodePrototype({ id: 'p-fixture', name: 'Fixture Node', color: '#123456' });
    await fsp.writeFile(fixturePath, JSON.stringify(exportToRedstring(useGraphStore.getState())), 'utf8');

    // load() replaces the store state with the file's contents.
    const u = new HeadlessUniverse({ filePath: fixturePath, useGraphStore, debounceMs: 20, log: silent });
    await u.load();

    const reloaded = useGraphStore.getState();
    expect(reloaded.graphs.has('g-fixture')).toBe(true);
    expect(reloaded.graphs.get('g-fixture').name).toBe('Fixture Graph');
    expect(reloaded.nodePrototypes.has('p-fixture')).toBe(true);
    expect(u.stateVersion).toBeGreaterThanOrEqual(0);

    await u.close();
  });

  it('holds an exclusive lock: a second daemon on the same file is rejected', async () => {
    const filePath = path.join(tmpDir, 'locked.redstring');
    const u1 = new HeadlessUniverse({ filePath, useGraphStore, debounceMs: 20, log: silent });
    await u1.load();

    const u2 = new HeadlessUniverse({ filePath, useGraphStore, debounceMs: 20, log: silent });
    await expect(u2.load()).rejects.toThrow(/locked by a live daemon/);

    await u1.close();

    // After close, the lock is released and a new daemon can take over.
    const u3 = new HeadlessUniverse({ filePath, useGraphStore, debounceMs: 20, log: silent });
    await u3.load();
    await u3.close();
  });

  it('shrink guard refuses to overwrite a non-empty file with an empty universe', async () => {
    const filePath = path.join(tmpDir, 'guard.redstring');
    const u = new HeadlessUniverse({ filePath, useGraphStore, debounceMs: 20, log: silent });
    await u.load();
    u.watch();

    // Mutate AFTER watch so autosave fires, then persist the non-empty universe.
    const store = useGraphStore.getState();
    store.createNewGraph({ id: 'g-guard', name: 'Guard Graph' });
    store.addNodePrototype({ id: 'p-guard', name: 'Guard Node', color: '#0f0f0f' });
    await u.flush();

    const sizeBefore = (await fsp.stat(filePath)).size;
    expect(sizeBefore).toBeGreaterThan(0);

    // Collapse the store to empty user data and force a save.
    useGraphStore.setState({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map() });
    await u.flush();

    // File must NOT have been overwritten to an empty universe.
    const json = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    expect(JSON.stringify(json)).toContain('Guard Node');

    await u.close();
  });
});
