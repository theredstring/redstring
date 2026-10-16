// @vitest-environment node
//
// Two people, one universe: two real GitSyncEngines syncing through one fake
// host that refuses stale writes, with the same merge glue the app uses
// (src/services/remoteMerge.js). Node environment: each engine persists its
// merge base in localStorage under the universe's slug, and two devices never
// share a localStorage — in jsdom these two would.
import { describe, it, expect, beforeEach } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { planMerge, mergeOntoCanvas, bringInRemote } from '../../src/services/remoteMerge.js';
import { importFromRedstring, exportToRedstring } from '../../src/formats/redstringFormat.js';
import { deepEqual } from '../../src/formats/syncMerge.js';

// ---------------------------------------------------------------------------
// A host: one repository, compare-and-swap writes, every version kept.

let shaCounter = 0;
function makeHost() {
  const files = new Map(); // path → { content, sha }
  const blobs = new Map(); // sha → content
  const commits = []; // { path, sha, author }
  const notFound = (path) => Object.assign(new Error(`File not found: ${path}`), { code: 'FILE_NOT_FOUND', status: 404 });

  const providerFor = (author) => ({
    name: `fake:${author}`,
    online: true,
    async writeFileRaw(path, content, options = {}) {
      if (!this.online) throw new Error('fetch failed: network down');
      const current = files.get(path);
      if ('expectedSha' in options) {
        const expected = options.expectedSha;
        const ok = expected == null ? !current : current && current.sha === expected;
        if (!ok) throw Object.assign(new Error('Remote file changed since last sync'), { code: 'REMOTE_DIVERGED', status: 409 });
      }
      const sha = `sha${++shaCounter}`;
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      files.set(path, { content: text, sha });
      blobs.set(sha, text);
      commits.push({ path, sha, author });
      return { content: { sha } };
    },
    async readFileRawWithMeta(path) {
      if (!this.online) throw new Error('fetch failed: network down');
      const file = files.get(path);
      if (!file) throw notFound(path);
      return { content: file.content, sha: file.sha, size: file.content.length };
    },
    async readFileAtSha(path, sha) {
      if (!this.online) throw new Error('fetch failed: network down');
      if (!blobs.has(sha)) throw notFound(`${path}@${sha}`);
      return blobs.get(sha);
    },
    async getRemoteFileSha(path) {
      if (!this.online) throw Object.assign(new Error('network down'), { code: 'FILE_INFO_UNKNOWN', status: 0 });
      return files.get(path)?.sha || null;
    },
    async listFileHistory(path) {
      return commits.filter((c) => c.path === path).reverse().map((c) => ({ sha: c.sha, author: c.author }));
    },
    async readBinaryFile(path) { throw notFound(path); }
  });

  return { files, commits, providerFor };
}

// ---------------------------------------------------------------------------
// A device: a store, an engine, and the glue universeBackend wires up.

const SLUG = 'forest';
const PATH = `universes/${SLUG}/${SLUG}.redstring`;

function makeDevice(host, author, { initialState = null } = {}) {
  const device = { author, state: initialState, notices: [], conflicts: 0 };
  const provider = host.providerFor(author);
  const engine = new GitSyncEngine(provider, 'git', SLUG, `${SLUG}.redstring`, SLUG);
  device.provider = provider;
  device.engine = engine;

  const applyDocument = (doc) => {
    device.state = { ...device.state, ...doc };
    return device.state;
  };

  engine.onMergeRemote = async (input) => {
    const plan = await planMerge(input);
    if (!plan.ok) {
      device.notices.push(plan.reason);
      return null;
    }
    return {
      content: plan.content,
      apply: async () => {
        const before = device.state;
        applyDocument(mergeOntoCanvas(plan.applyBase, before, plan.merged));
        device.notices.push(`merged ${plan.report.theirs.added.length + plan.report.theirs.changed.length + plan.report.theirs.deleted.length} of theirs`);
        return { state: device.state, before };
      }
    };
  };
  engine.onRemoteUpdate = async (input) => {
    const result = bringInRemote(input, device.state);
    if (!result.ok) {
      device.notices.push(result.reason);
      return null;
    }
    const before = device.state;
    applyDocument(result.merged);
    return { state: device.state, before };
  };
  engine.onRemoteDivergence = async () => {
    device.conflicts++;
    return 'conflict';
  };

  /** Save now (what autosave does once the debounce settles). */
  device.save = async () => {
    engine.lastCommitTime = 0; // skip the 2s spacing between commits
    return engine.forceCommit(device.state);
  };
  /** Open the universe from the repository. */
  device.open = async () => {
    const remote = await provider.readFileRawWithMeta(PATH);
    device.state = importFromRedstring(JSON.parse(remote.content)).storeState;
    engine.markRemoteObserved({ sha: remote.sha, nodeCount: device.state.nodePrototypes.size, contentHash: engine.generateStateHash(device.state) });
  };
  device.edit = (fn) => {
    device.state = structuredClone(device.state);
    fn(device.state);
  };
  return device;
}

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------

let host, ana, ben;
beforeEach(async () => {
  host = makeHost();
  ana = makeDevice(host, 'ana', { initialState: forest() });
  await ana.save(); // creates the repository file
  ben = makeDevice(host, 'ben');
  await ben.open();
});

describe('two people, one universe', () => {
  it('both people adding things: the second save merges, the first pulls it in', async () => {
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));

    await ana.save();
    await ben.save(); // remote moved: merges instead of asking
    expect(ben.conflicts).toBe(0);
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);

    const pulled = await ana.engine.checkRemote();
    expect(pulled).toMatchObject({ changed: true, applied: true });
    expect(names(ana.state)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
    expect(sameDocument(ana.state, ben.state)).toBe(true);
  });

  it('does not echo: pulling someone else\'s save never pushes it back', async () => {
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ben.save();
    const before = host.commits.length;

    await ana.engine.checkRemote();
    expect(await ana.save()).toBe(false); // nothing new to commit
    await ben.engine.checkRemote();
    expect(await ben.save()).toBe(false);
    expect(host.commits.length).toBe(before);
  });

  it('does not echo after a merge either', async () => {
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ana.save();
    await ben.save();
    const afterMerge = host.commits.length;
    expect(await ben.save()).toBe(false);
    await ana.engine.checkRemote();
    expect(await ana.save()).toBe(false);
    expect(host.commits.length).toBe(afterMerge);
  });

  it('different fields of one Thing both land', async () => {
    ana.edit((s) => { s.nodePrototypes.get('tree').name = 'Oak'; });
    ben.edit((s) => { s.nodePrototypes.get('tree').color = '#228B22'; });
    await ana.save();
    await ben.save();
    expect(ben.state.nodePrototypes.get('tree')).toMatchObject({ name: 'Oak', color: '#228B22' });
  });

  it('same field: the version already in the repository wins and the other is kept aside', async () => {
    ana.edit((s) => { s.nodePrototypes.get('bird').name = 'Sparrow'; });
    ben.edit((s) => { s.nodePrototypes.get('bird').name = 'Robin'; });
    await ben.save(); // Robin reaches the repository first
    await ana.save(); // Ana merges
    const bird = ana.state.nodePrototypes.get('bird');
    expect(bird.name).toBe('Robin');
    expect(bird._preserved.merge.name).toBe('Sparrow');
    await ben.engine.checkRemote();
    expect(ben.state.nodePrototypes.get('bird')._preserved.merge.name).toBe('Sparrow');
  });

  it('a delete on one side and an edit on the other keeps the Thing', async () => {
    ana.edit((s) => deleteThing(s, 'soil'));
    ben.edit((s) => {
      s.nodePrototypes.get('soil').description = 'Rich loam';
      addThing(s, 'squirrel', 'Squirrel');
      connect(s, 'eBuries', 'i-squirrel', 'iSoil');
    });
    await ana.save();
    await ben.save();
    expect(ben.state.nodePrototypes.get('soil').description).toBe('Rich loam');
    expect(ben.state.edges.has('eBuries')).toBe(true);
    await ana.engine.checkRemote();
    expect(ana.state.graphs.get('web').instances.has('iSoil')).toBe(true);
  });

  it('keeps edits made on the canvas while the merge was running', async () => {
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();

    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    // Ben keeps editing after his commit is built but before the merge lands.
    const realRead = ben.provider.readFileRawWithMeta.bind(ben.provider);
    ben.provider.readFileRawWithMeta = async (path) => {
      ben.edit((s) => addThing(s, 'acorn', 'Acorn'));
      ben.provider.readFileRawWithMeta = realRead;
      return realRead(path);
    };
    await ben.save();
    expect(names(ben.state)).toEqual(['Acorn', 'Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
    // Acorn is not in the repository yet; the next save sends it.
    expect(await ben.save()).toBe(true);
    await ana.engine.checkRemote();
    expect(names(ana.state)).toContain('Acorn');
  });

  it('merges again when someone saves in the middle of the merge', async () => {
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));

    // Between Ben reading the repository and writing his merge, Ana saves again.
    const realWrite = ben.provider.writeFileRaw.bind(ben.provider);
    let raced = false;
    ben.provider.writeFileRaw = async (path, content, options) => {
      if (!raced && options?.expectedSha) {
        raced = true;
        ana.edit((s) => addThing(s, 'moss', 'Moss'));
        await ana.save();
      }
      return realWrite(path, content, options);
    };
    await ben.save();
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Moss', 'Soil', 'Squirrel', 'Tree']);
    await ana.engine.checkRemote();
    expect(sameDocument(ana.state, ben.state)).toBe(true);
  });

  it('offline: edits made without a connection merge once it is back', async () => {
    ben.provider.online = false;
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await expect(ben.save()).rejects.toThrow(/network/);

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();
    ana.edit((s) => { s.nodePrototypes.get('tree').name = 'Oak'; });
    await ana.save();

    ben.provider.online = true;
    await ben.save();
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Oak', 'Soil', 'Squirrel']);
  });

  it('offline across a restart: the merge base survives in the device\'s storage', async () => {
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    const baseBeforeRestart = ben.engine.syncBaseSha;
    const stateOnDisk = ben.state; // what the local copy held when the app closed

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();

    // Ben restarts: a new engine, the base restored from storage, the store
    // from the local copy, and no remote read this session yet.
    const restarted = makeDevice(host, 'ben', { initialState: stateOnDisk });
    restarted.engine.syncBaseSha = baseBeforeRestart;
    expect(restarted.engine.lastKnownRemoteSha).toBeUndefined();
    await restarted.save();
    expect(restarted.conflicts).toBe(0);
    expect(names(restarted.state)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
  });

  it('a store a failed load left nearly empty is never merged in, even with a known base', async () => {
    ana.edit((s) => { for (let i = 0; i < 12; i++) addThing(s, `t${i}`, `Thing ${i}`); });
    await ana.save();
    const base = ana.engine.syncBaseSha;
    // Ana restarts; the load goes wrong and leaves one Thing. Autosave fires.
    const collapsed = structuredClone(ana.state);
    for (let i = 0; i < 12; i++) deleteThing(collapsed, `t${i}`);
    deleteThing(collapsed, 'tree');
    deleteThing(collapsed, 'bird');
    const restarted = makeDevice(host, 'ana', { initialState: collapsed });
    restarted.engine.syncBaseSha = base;
    await expect(restarted.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    const inRepo = importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState;
    expect(inRepo.nodePrototypes.size).toBeGreaterThanOrEqual(15);
  });

  it('a new session whose store did not come from this device\'s copy asks instead of merging', async () => {
    // Review finding: a base restored from storage used to be trusted at first
    // contact, so a store holding something else (a fresh universe, a fallback
    // copy) merged as if it had deleted everything it lacks.
    ana.edit((s) => { for (let i = 0; i < 12; i++) addThing(s, `t${i}`, `Thing ${i}`); });
    await ana.save();
    const elsewhere = forest();
    deleteThing(elsewhere, 'soil');
    addThing(elsewhere, 'x', 'X');
    const restarted = makeDevice(host, 'ana', { initialState: elsewhere }); // no adoptBase: lineage unknown
    expect(restarted.engine.syncBaseSha).toBeNull();
    await expect(restarted.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    const inRepo = importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState;
    expect(inRepo.nodePrototypes.size).toBe(15);
  });

  it('a state captured before others\' changes arrived is never committed over them', async () => {
    // Review finding: a save in flight when a remote apply landed pushed its
    // older snapshot, reverting the apply in the repository.
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    const captured = ana.state;
    ana.engine.stampState(captured); // SaveCoordinator saw it, a save began
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ben.save();
    // The watch brings Ben's change in while Ana's save is still running.
    ana.engine.hasChanges = false;
    expect(await ana.engine.checkRemote()).toMatchObject({ applied: true });
    // The old snapshot reaches the engine afterwards: dropped.
    ana.engine.lastCommitTime = 0;
    expect(await ana.engine.forceCommit(captured)).toBe(false);
    const inRepo = names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState);
    expect(inRepo).toContain('Squirrel');
    // The canvas kept Fungus, and its next save sends both.
    expect(names(ana.state)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
    expect(await ana.save()).toBe(true);
    expect(names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
  });

  it('a version read but never applied is merged, not overwritten', async () => {
    // Review finding: reads set the compare-and-swap token even when discarded,
    // so the next commit asserted it and overwrote that version's changes.
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ben.save();
    const remote = await ana.provider.readFileRawWithMeta(PATH);
    ana.engine.lastKnownRemoteSha = remote.sha; // read, then thrown away
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();
    expect(names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState)).toEqual(['Bird', 'Fungus', 'Soil', 'Squirrel', 'Tree']);
  });

  it('a recorded base for a state follows what the state grew from', () => {
    const before = ana.state;
    ana.engine.stampState(before);
    expect(ana.engine.baseForState(before)).toBe(ana.engine.syncBaseSha);
    expect(ana.engine.baseForState({ graphs: new Map() })).toBeNull();
  });

  it('without a known base it still asks rather than overwriting', async () => {
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();
    const stranger = makeDevice(host, 'stranger', { initialState: forest() });
    stranger.edit((s) => addThing(s, 'x', 'X'));
    await expect(stranger.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    expect(stranger.conflicts).toBe(1);
    expect(names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState)).toContain('Fungus');
  });

  it('a mass deletion is never merged in: it asks', async () => {
    ana.edit((s) => { for (let i = 0; i < 30; i++) addThing(s, `t${i}`, `Thing ${i}`); });
    await ana.save();
    await ben.engine.checkRemote();
    ben.edit((s) => { for (let i = 0; i < 30; i++) deleteThing(s, `t${i}`); });
    ana.edit((s) => { s.nodePrototypes.get('tree').name = 'Oak'; });
    await ana.save();

    await expect(ben.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    expect(ben.notices.join(' ')).toMatch(/removed 30/);
    const inRepo = importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState;
    expect(inRepo.nodePrototypes.size).toBeGreaterThan(30);
  });

  it('dismissing the conflict does not let the next autosave overwrite the repository', async () => {
    const stranger = makeDevice(host, 'stranger', { initialState: forest() });
    stranger.edit((s) => addThing(s, 'x', 'X'));
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();

    await expect(stranger.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    // The user closes the dialog (cancelPendingConflict clears this flag).
    stranger.engine.remoteConflictPending = false;
    stranger.edit((s) => addThing(s, 'y', 'Y'));
    await expect(stranger.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });
    expect(names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState)).toContain('Fungus');
  });

  it('a resolution save is the user\'s answer: it writes their choice', async () => {
    const stranger = makeDevice(host, 'stranger', { initialState: forest() });
    stranger.edit((s) => addThing(s, 'x', 'X'));
    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    await ana.save();
    await expect(stranger.save()).rejects.toMatchObject({ code: 'REMOTE_CONFLICT' });

    stranger.engine.lastCommitTime = 0;
    expect(await stranger.engine.forceCommit(stranger.state, { isConflictResolution: true })).toBe(true);
    expect(names(importFromRedstring(JSON.parse(host.files.get(PATH).content)).storeState)).toContain('X');
  });

  it('a check with nothing new costs one request and changes nothing', async () => {
    let reads = 0;
    const realRead = ana.provider.readFileRawWithMeta.bind(ana.provider);
    ana.provider.readFileRawWithMeta = async (p) => { reads++; return realRead(p); };
    expect(await ana.engine.checkRemote()).toEqual({ changed: false });
    expect(reads).toBe(0);
  });

  it('a check waits while this device has changes on their way out', async () => {
    ben.edit((s) => addThing(s, 'squirrel', 'Squirrel'));
    await ben.save();
    ana.engine.hasChanges = true;
    expect(await ana.engine.checkRemote()).toEqual({ skipped: 'local-changes' });
  });

  it('three people, everyone ends up with the same universe', async () => {
    const cy = makeDevice(host, 'cy');
    await cy.open();
    ana.edit((s) => addThing(s, 'a1', 'Ana 1'));
    ben.edit((s) => addThing(s, 'b1', 'Ben 1'));
    cy.edit((s) => { addThing(s, 'c1', 'Cy 1'); s.nodePrototypes.get('soil').name = 'Earth'; });
    await ana.save();
    await ben.save();
    await cy.save();
    await ana.engine.checkRemote();
    await ben.engine.checkRemote();
    for (const d of [ana, ben]) expect(sameDocument(d.state, cy.state)).toBe(true);
    expect(names(cy.state)).toEqual(['Ana 1', 'Ben 1', 'Bird', 'Cy 1', 'Earth', 'Tree']);
  });
});
