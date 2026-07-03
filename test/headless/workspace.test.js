// @vitest-environment node
/**
 * HeadlessWorkspace: the local universe registry + active-universe switching.
 * Verifies create/list/switch/rm/unlink, reconcile-with-disk, auto-default, and
 * that switching the active universe re-points persistence to the right file.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';

let useGraphStore, HeadlessWorkspace;
const workspaces = [];

async function freshWorkspace() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-ws-'));
  const ws = new HeadlessWorkspace({ dir, useGraphStore, debounceMs: 10, log: () => {} });
  workspaces.push(ws);
  return { dir, ws };
}

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
  ({ HeadlessWorkspace } = await import('../../src/headless/HeadlessWorkspace.js'));
});

afterEach(async () => {
  while (workspaces.length) {
    const ws = workspaces.pop();
    try { await ws.close(); } catch { /* ignore */ }
    try { await fsp.rm(ws.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('HeadlessWorkspace', () => {
  it('auto-creates a default "Universe" in an empty folder and writes a manifest', async () => {
    const { dir, ws } = await freshWorkspace();
    await ws.open();
    expect(ws.createdDefault).toBe(true);
    const active = ws.getActive();
    expect(active).toBeTruthy();
    expect(active.name).toBe('Universe');
    // manifest + the universe file exist on disk
    expect(fs.existsSync(path.join(dir, '.redstring', 'workspace.json'))).toBe(true);
    expect(fs.existsSync(ws.activeFilePath)).toBe(true);
  });

  it('creates, lists, and switches universes, loading each into the store', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();

    const physics = await ws.createUniverse('Physics'); // becomes active
    // add a graph to Physics via the live store
    useGraphStore.getState().createNewGraph({ id: 'g-phys', name: 'Mechanics' });
    await ws.universe.flush();

    const chem = await ws.createUniverse('Chemistry'); // switches active → empty store
    expect(useGraphStore.getState().graphs.has('g-phys')).toBe(false);

    const names = ws.listUniverses().map((u) => u.name).sort();
    expect(names).toEqual(['Chemistry', 'Physics', 'Universe']);

    // switching back to Physics reloads its graph
    await ws.switchActive(physics.slug);
    expect(useGraphStore.getState().graphs.has('g-phys')).toBe(true);
    expect(ws.getActive().slug).toBe(physics.slug);

    // exactly one active
    expect(ws.listUniverses().filter((u) => u.active).length).toBe(1);
    expect(chem.slug).not.toBe(physics.slug);
  });

  it('persists a switched universe to ITS file, not the previous one', async () => {
    const { dir, ws } = await freshWorkspace();
    await ws.open();
    const a = await ws.createUniverse('Alpha');
    useGraphStore.getState().createNewGraph({ id: 'g-alpha', name: 'AlphaGraph' });
    await ws.universe.flush();
    const b = await ws.createUniverse('Beta');
    useGraphStore.getState().createNewGraph({ id: 'g-beta', name: 'BetaGraph' });
    await ws.universe.flush();

    const aFile = JSON.parse(await fsp.readFile(path.join(dir, ws.manifest.universes[a.slug].localFile.path), 'utf8'));
    const bFile = JSON.parse(await fsp.readFile(path.join(dir, ws.manifest.universes[b.slug].localFile.path), 'utf8'));
    expect(JSON.stringify(aFile)).toContain('AlphaGraph');
    expect(JSON.stringify(aFile)).not.toContain('BetaGraph');
    expect(JSON.stringify(bFile)).toContain('BetaGraph');
  });

  it('reconciles pre-existing .redstring files found in the folder', async () => {
    const { dir, ws } = await freshWorkspace();
    // Drop a raw .redstring file in the folder before opening.
    await ws.open();                                   // creates default + gives us a valid export
    const exported = await fsp.readFile(ws.activeFilePath, 'utf8');
    await fsp.writeFile(path.join(dir, 'Imported.redstring'), exported, 'utf8');
    await ws.close();
    workspaces.pop(); // manually managed below

    const ws2 = new HeadlessWorkspace({ dir, useGraphStore, debounceMs: 10, log: () => {} });
    workspaces.push(ws2);
    await ws2.open();
    const list = ws2.listUniverses();
    expect(list.some((u) => u.name === 'Imported')).toBe(true);
    // the `.redstring` manifest DIR must never be mistaken for a universe file
    expect(list.every((u) => u.name && u.name.trim().length > 0)).toBe(true);
    expect(list.length).toBe(2); // Universe (default) + Imported
  });

  it('deletes a universe and falls back to another (or a fresh default)', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();
    const keep = await ws.createUniverse('Keep');
    const drop = await ws.createUniverse('Drop'); // active
    await ws.deleteUniverse(drop.slug);
    expect(ws.listUniverses().some((u) => u.slug === drop.slug)).toBe(false);
    expect(ws.getActive()).toBeTruthy();

    // delete everything → a fresh default is created
    for (const u of ws.listUniverses()) await ws.deleteUniverse(u.slug);
    expect(ws.listUniverses().length).toBe(1);
    expect(ws.getActive().name).toBe('Universe');
    expect(keep).toBeTruthy();
  });

  it('back-compat: activeFileHint registers + activates a specific file', async () => {
    const { dir, ws } = await freshWorkspace();
    const hint = path.join(dir, 'Legacy.redstring');
    await ws.open({ activeFileHint: hint });
    expect(ws.getActive().name).toBe('Legacy');
    expect(fs.existsSync(hint)).toBe(true);
  });

  it('unlink git detaches the slot; unlinking the only local source is refused', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();
    const u = await ws.createUniverse('Repo');
    ws.setGitLink(u.slug, { type: 'github', user: 'me', repo: 'graphs', authMethod: 'token' });
    expect(ws.manifest.universes[u.slug].gitRepo.enabled).toBe(true);
    ws.unlink(u.slug, 'git');
    expect(ws.manifest.universes[u.slug].gitRepo.enabled).toBe(false);
    expect(() => ws.unlink(u.slug, 'local')).toThrow(/only .*local/i);
  });
});
