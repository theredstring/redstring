// @vitest-environment node
/**
 * GitHub-backed universes: pull/push against a fake, in-memory sync client.
 * The network client (GitHubUniverseSync) is exercised only for parseRepoSpec
 * here; pull/push wiring is verified through the workspace with a stub so the
 * tests stay offline and deterministic.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { parseRepoSpec } from '../../src/headless/githubSync.js';

let useGraphStore, HeadlessWorkspace;
const workspaces = [];

async function freshWorkspace() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-gh-'));
  const ws = new HeadlessWorkspace({ dir, useGraphStore, debounceMs: 10, log: () => {} });
  workspaces.push(ws);
  return { dir, ws };
}

/** In-memory stand-in for GitHubUniverseSync. */
function makeFakeSync(files = {}) {
  const writes = [];
  return {
    user: 'me',
    repo: 'graphs',
    branch: 'main',
    writes,
    async discoverUniverses() {
      return Object.keys(files).filter((p) => /\.redstring$/i.test(p));
    },
    async readFile(p) {
      return Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null;
    },
    async writeFile(p, content, message) {
      writes.push({ path: p, content, message });
      files[p] = content;
      return { content: { sha: 'cafef00d' } };
    }
  };
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

describe('parseRepoSpec', () => {
  it('parses user/repo, sub-paths, and github URLs', () => {
    expect(parseRepoSpec('me/graphs')).toEqual({ user: 'me', repo: 'graphs', path: null });
    expect(parseRepoSpec('me/graphs/universes/a/a.redstring')).toEqual({ user: 'me', repo: 'graphs', path: 'universes/a/a.redstring' });
    expect(parseRepoSpec('https://github.com/me/graphs.git')).toEqual({ user: 'me', repo: 'graphs', path: null });
    expect(() => parseRepoSpec('nope')).toThrow(/user\/repo/);
  });
});

describe('HeadlessWorkspace git pull/push', () => {
  it('pulls a universe from a repo, registers a git slot, and loads it into the store', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();

    // Craft repo content = a valid exported universe with a distinctive graph.
    useGraphStore.getState().createNewGraph({ id: 'g-src', name: 'SourceGraph' });
    await ws.universe.flush();
    const content = fs.readFileSync(ws.activeFilePath, 'utf8');

    // Switch active away so the store no longer holds g-src — proving the pull loads it back.
    await ws.createUniverse('Scratch');
    expect(useGraphStore.getState().graphs.has('g-src')).toBe(false);

    const fake = makeFakeSync({ 'Imported.redstring': content });
    const u = await ws.pullUniverse(fake, {});

    expect(u.name).toBe('Imported');
    expect(u.sourceOfTruth).toBe('git');
    expect(u.gitRepo.enabled).toBe(true);
    expect(u.gitRepo.linkedRepo).toMatchObject({ type: 'github', user: 'me', repo: 'graphs', authMethod: 'token' });
    expect(u.gitRepo.repoPath).toBe('Imported.redstring');
    expect(ws.getActive().slug).toBe(u.slug);
    expect(useGraphStore.getState().graphs.has('g-src')).toBe(true); // pull activated + loaded it
  });

  it('discovers a single .redstring when no explicit path is given', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();
    const content = fs.readFileSync(ws.activeFilePath, 'utf8');
    const fake = makeFakeSync({ 'universes/physics/physics.redstring': content, 'README.md': '# not a universe' });
    const u = await ws.pullUniverse(fake, { activate: false });
    expect(u.gitRepo.repoPath).toBe('universes/physics/physics.redstring');
  });

  it('pushes a universe to its repo and records the link', async () => {
    const { ws } = await freshWorkspace();
    await ws.open();
    const phys = await ws.createUniverse('Physics'); // active
    useGraphStore.getState().createNewGraph({ id: 'g-push', name: 'PushGraph' });
    await ws.universe.flush();

    const fake = makeFakeSync({});
    const res = await ws.pushUniverse(fake, phys.slug, { message: 'test push' });

    expect(res.repoPath).toBe('universes/physics/physics.redstring');
    expect(res.commit).toBe('cafef00d');
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].message).toBe('test push');
    expect(fake.writes[0].content).toContain('PushGraph');

    const entry = ws.manifest.universes[phys.slug];
    expect(entry.gitRepo.enabled).toBe(true);
    expect(entry.gitRepo.repoPath).toBe('universes/physics/physics.redstring');
  });

  it('round-trips: pushed content pulls back into a second workspace', async () => {
    const a = await freshWorkspace();
    await a.ws.open();
    await a.ws.createUniverse('Physics');
    useGraphStore.getState().createNewGraph({ id: 'g-rt', name: 'RoundTrip' });
    await a.ws.universe.flush();

    const shared = {};
    const fakeA = makeFakeSync(shared);
    await a.ws.pushUniverse(fakeA, a.ws.getActive().slug, {});

    const b = await freshWorkspace();
    await b.ws.open();
    const fakeB = makeFakeSync(shared);
    await b.ws.pullUniverse(fakeB, {});
    expect(useGraphStore.getState().graphs.has('g-rt')).toBe(true);
  });
});
