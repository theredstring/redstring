// @vitest-environment node
//
// Shared universes end to end over HTTP: the real Gitea and GitHub providers
// and two real GitSyncEngines against scripts/fake-forge.mjs (a separate
// process keeping real Git repositories, speaking both APIs). The same glue
// the app wires up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { GiteaSemanticProvider, GitHubSemanticProvider } from '../../src/services/gitNativeProvider.js';
import { planMerge, mergeOntoCanvas, bringInRemote } from '../../src/services/remoteMerge.js';
import { importFromRedstring, exportToRedstring } from '../../src/formats/redstringFormat.js';
import { deepEqual } from '../../src/formats/syncMerge.js';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-forge-test-'));
const forges = [];

async function startForge(extraArgs = []) {
  const port = 4600 + Math.floor(Math.random() * 300) + forges.length * 300;
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve('scripts/fake-forge.mjs'), '--port', String(port), '--dir', DIR, ...extraArgs], { stdio: 'pipe' });
  forges.push(child);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${endpoint}/api/v1/version`)).ok) return endpoint;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('fake forge did not start');
}

let ENDPOINT;
// GitHub's reads trail its writes for a moment after a save; this host's do too.
let LAGGING;
const READ_LAG_MS = 1500;

beforeAll(async () => {
  ENDPOINT = await startForge();
  LAGGING = await startForge(['--read-lag', String(READ_LAG_MS)]);
}, 20000);

afterAll(() => {
  for (const child of forges) child.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
});

const HOSTS = {
  Gitea: (repo, token, endpoint = ENDPOINT) => new GiteaSemanticProvider({ endpoint, user: 'harness', repo, token }),
  GitHub: (repo, token, endpoint = ENDPOINT) => new GitHubSemanticProvider({ apiBase: `${endpoint}/github`, user: 'harness', repo, token, authMethod: 'oauth' })
};

const setOffline = (user, on) => fetch(`${ENDPOINT}/_control/offline`, { method: 'POST', body: new URLSearchParams({ user, on: on ? '1' : '0' }), redirect: 'manual' });

let repoCounter = 0;
function makeDevice(host, repo, author, initialState = null, endpoint) {
  const device = { author, state: initialState, conflicts: 0 };
  const provider = HOSTS[host](repo, author, endpoint);
  const engine = new GitSyncEngine(provider, 'git', 'forest', 'forest.redstring', 'forest');
  Object.assign(device, { provider, engine });
  const apply = (doc) => { device.state = { ...device.state, ...doc }; };
  engine.onMergeRemote = async (input) => {
    const plan = await planMerge(input);
    if (!plan.ok) return null;
    return { content: plan.content, apply: async () => { const before = device.state; apply(mergeOntoCanvas(plan.applyBase, before, plan.merged)); return { state: device.state, before }; } };
  };
  engine.onRemoteUpdate = async (input) => {
    const result = bringInRemote(input, device.state);
    if (!result.ok) return null;
    const before = device.state;
    apply(result.merged);
    return { state: device.state, before };
  };
  engine.onRemoteDivergence = async () => { device.conflicts++; return 'conflict'; };
  device.save = async () => { engine.lastCommitTime = 0; return engine.forceCommit(device.state); };
  device.open = async () => {
    const remote = await provider.readFileRawWithMeta(engine.getLatestPath());
    device.state = importFromRedstring(JSON.parse(remote.content)).storeState;
    engine.markRemoteObserved({ sha: remote.sha, nodeCount: device.state.nodePrototypes.size, contentHash: engine.generateStateHash(device.state) });
  };
  device.edit = (fn) => { device.state = structuredClone(device.state); fn(device.state); };
  return device;
}

const gitLog = (repo) => execFileSync('git', ['--git-dir', path.join(DIR, 'harness', `${repo}.git`), 'log', '--format=%an'], { encoding: 'utf8' }).trim().split('\n');

// Universe content

function forest() {
  const proto = (id, name) => [id, { id, name, color: '#8B0000', description: '', definitionGraphIds: [], typeNodeId: null }];
  const inst = (id, prototypeId, x) => [id, { id, prototypeId, x, y: 0, scale: 1 }];
  return {
    graphs: new Map([['web', {
      id: 'web',
      name: 'Forest',
      description: '',
      instances: new Map([inst('iTree', 'tree', 0), inst('iBird', 'bird', 200), inst('iSoil', 'soil', 400)]),
      edgeIds: ['eLives']
    }]]),
    nodePrototypes: new Map([proto('tree', 'Tree'), proto('bird', 'Bird'), proto('soil', 'Soil')]),
    edges: new Map([['eLives', { id: 'eLives', sourceId: 'iBird', destinationId: 'iTree', typeNodeId: null, directionality: { arrowsToward: new Set() } }]]),
    edgePrototypes: new Map(),
    openGraphIds: ['web'],
    activeGraphId: 'web',
    activeDefinitionNodeId: null,
    expandedGraphIds: new Set(),
    rightPanelTabs: [{ type: 'home', isActive: true }],
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
    showConnectionNames: false,
    mergeDismissals: {}
  };
}

function addThing(state, id, name, x = 0) {
  state.nodePrototypes.set(id, { id, name, color: '#8B0000', description: '', definitionGraphIds: [], typeNodeId: null });
  state.graphs.get('web').instances.set(`i-${id}`, { id: `i-${id}`, prototypeId: id, x, y: 50, scale: 1 });
}
function connect(state, eid, from, to) {
  state.edges.set(eid, { id: eid, sourceId: from, destinationId: to, typeNodeId: null, directionality: { arrowsToward: new Set() } });
  const web = state.graphs.get('web');
  web.edgeIds = [...(web.edgeIds || []), eid];
}
function deleteThing(state, id) {
  state.nodePrototypes.delete(id);
  const web = state.graphs.get('web');
  for (const [iid, inst] of web.instances) {
    if (inst.prototypeId !== id) continue;
    web.instances.delete(iid);
    for (const [eid, e] of state.edges) {
      if (e.sourceId === iid || e.destinationId === iid) {
        state.edges.delete(eid);
        web.edgeIds = web.edgeIds.filter((x) => x !== eid);
      }
    }
  }
}
const names = (state) => [...state.nodePrototypes.values()].map((p) => p.name).sort();
// The same universe: what each person's copy saves as. In memory a Thing made
// on the canvas has no `x`, and the same Thing read back from the file has
// `x: 0`; the file is what is shared. Cameras are each person's own.
const asSaved = (state) => importFromRedstring(JSON.parse(JSON.stringify(exportToRedstring(state)))).storeState;
const withoutCameras = (graphs) => new Map([...graphs].map(([id, { panOffset, zoomLevel, ...g }]) => [id, g]));
const sameDocument = (a, b) => {
  const [x, y] = [asSaved(a), asSaved(b)];
  return deepEqual(withoutCameras(x.graphs), withoutCameras(y.graphs))
    && deepEqual(x.nodePrototypes, y.nodePrototypes) && deepEqual(x.edges, y.edges);
};


// Every save spawns a few git processes; under a full parallel run that is slow.
describe.each(Object.keys(HOSTS))('shared universe over HTTP (fake forge, %s API)', { timeout: 30000 }, (host) => {
  it('two people edit, the second save merges, the first pulls it in, nobody echoes', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice(host, repo, 'ana', forest());
    await ana.save();
    const ben = makeDevice(host, repo, 'ben');
    await ben.open();

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => { addThing(s, 'squirrel', 'Squirrel'); s.nodePrototypes.get('tree').name = 'Oak'; });
    await ana.save();
    expect(ben.engine.lastSavedAt).toBe(0);
    await ben.save();
    expect(ben.conflicts).toBe(0);
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Oak', 'Soil', 'Squirrel']);
    expect(ben.engine.lastSavedAt).toBeGreaterThan(0); // a merged save is a save

    expect(await ana.engine.checkRemote()).toMatchObject({ applied: true });
    expect(sameDocument(ana.state, ben.state)).toBe(true);

    const commits = gitLog(repo).length;
    expect(await ana.save()).toBe(false);
    expect(await ben.engine.checkRemote()).toEqual({ changed: false });
    expect(gitLog(repo).length).toBe(commits);
    expect(gitLog(repo)).toEqual(['ben', 'ana', 'ana']);
  });

  it('a stale write is refused by the host, never overwritten', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice(host, repo, 'ana', forest());
    await ana.save();
    const path_ = ana.engine.getLatestPath();
    const sha = ana.engine.lastKnownRemoteSha;
    ana.edit((s) => addThing(s, 'x', 'X'));
    await ana.save();
    await expect(ana.provider.writeFileRaw(path_, '{}', { expectedSha: sha })).rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
    await expect(ana.provider.writeFileRaw(path_, '{}', { expectedSha: null })).rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
  });

  it('offline edits merge when the connection comes back', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice(host, repo, 'ana', forest());
    await ana.save();
    const ben = makeDevice(host, repo, 'ben');
    await ben.open();

    await setOffline('ben', true);
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await expect(ben.save()).rejects.toThrow();
    ana.edit((s) => deleteThing(s, 'soil'));
    await ana.save();
    await setOffline('ben', false);

    await ben.save();
    expect(names(ben.state)).toEqual(['Bird', 'Squirrel', 'Tree']);
    await ana.engine.checkRemote();
    expect(names(ana.state)).toEqual(['Bird', 'Squirrel', 'Tree']);
  }, 20000);

  it('reads the merge base by SHA from the host', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice(host, repo, 'ana', forest());
    await ana.save();
    const first = ana.engine.lastKnownRemoteSha;
    ana.edit((s) => addThing(s, 'x', 'X'));
    await ana.save();
    const old = importFromRedstring(JSON.parse(await ana.provider.readFileAtSha(ana.engine.getLatestPath(), first))).storeState;
    expect(names(old)).toEqual(['Bird', 'Soil', 'Tree']);
    expect(await ana.provider.getRemoteFileSha(ana.engine.getLatestPath())).toBe(ana.engine.lastKnownRemoteSha);
  });
});

// GitHub's own behaviour, beyond the API shape.
describe('shared universe over HTTP (fake forge, GitHub quirks)', { timeout: 30000 }, () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  it('a universe over 1 MB, which the contents API sends without content', async () => {
    const repo = `forest${++repoCounter}`;
    const big = forest();
    for (let i = 0; i < 400; i++) {
      addThing(big, `t${i}`, `Thing ${i}`, i);
      big.nodePrototypes.get(`t${i}`).description = 'x'.repeat(3000);
    }
    const ana = makeDevice('GitHub', repo, 'ana', big);
    await ana.save();

    const listing = await (await fetch(`${ENDPOINT}/github/repos/harness/${repo}/contents/${ana.engine.getLatestPath()}`, { headers: { Authorization: 'token ana' } })).json();
    expect(listing.size).toBeGreaterThan(1024 * 1024);
    expect(listing.encoding).toBe('none');

    const ben = makeDevice('GitHub', repo, 'ben');
    await ben.open();
    expect(ben.state.nodePrototypes.size).toBe(403);

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ana.save();
    await ben.save();
    expect(ben.conflicts).toBe(0);
    await ana.engine.checkRemote();
    expect(ana.state.nodePrototypes.has('squirrel')).toBe(true);
    expect(sameDocument(ana.state, ben.state)).toBe(true);
  });

  it('reads that trail writes never undo your own save', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice('GitHub', repo, 'ana', forest(), LAGGING);
    await ana.save();
    await wait(READ_LAG_MS + 200);
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();

    // The host still shows the first version for a moment.
    expect(await ana.provider.getRemoteFileSha(ana.engine.getLatestPath())).not.toBe(ana.engine.lastKnownRemoteSha);
    await ana.engine.checkRemote();
    expect(names(ana.state)).toContain('Fungus');
    await wait(READ_LAG_MS + 200);
    expect(await ana.engine.checkRemote()).toEqual({ changed: false });
    expect(names(ana.state)).toContain('Fungus');
  });

  it('two people saving moments apart still merge, while reads trail', async () => {
    const repo = `forest${++repoCounter}`;
    const ana = makeDevice('GitHub', repo, 'ana', forest(), LAGGING);
    await ana.save();
    await wait(READ_LAG_MS + 200);
    const ben = makeDevice('GitHub', repo, 'ben', null, LAGGING);
    await ben.open();

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => { addThing(s, 'squirrel', 'Squirrel'); s.nodePrototypes.get('tree').name = 'Oak'; });
    await ana.save();
    await ben.save(); // right after Ana: her save is not readable yet
    expect(ben.conflicts).toBe(0);
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Oak', 'Soil', 'Squirrel']);

    // The host still shows Ana's version, the one Ben just merged with.
    await ben.engine.checkRemote();
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Oak', 'Soil', 'Squirrel']);

    await wait(READ_LAG_MS + 200);
    await ana.engine.checkRemote();
    expect(sameDocument(ana.state, ben.state)).toBe(true);
  });
});
