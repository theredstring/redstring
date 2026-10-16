// @vitest-environment node
//
// Shared universes against a REAL Gitea (or Forgejo) instance, two accounts.
// Skipped unless pointed at one:
//
//   REDSTRING_GITEA_URL=http://127.0.0.1:4520 \
//   REDSTRING_GITEA_REPO=ana/forest \
//   REDSTRING_GITEA_TOKENS=<ana token>,<ben token> \
//   npx vitest run test/services/sharedUniverseRealGitea.test.js
//
// The repository must exist, and the second account must be a collaborator
// with write access. Each run writes to fresh folders, so it can be rerun.
import { describe, it, expect } from 'vitest';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { GiteaSemanticProvider } from '../../src/services/gitNativeProvider.js';
import { planMerge, mergeOntoCanvas, bringInRemote } from '../../src/services/remoteMerge.js';
import { importFromRedstring, exportToRedstring } from '../../src/formats/redstringFormat.js';
import { deepEqual } from '../../src/formats/syncMerge.js';

const ENDPOINT = process.env.REDSTRING_GITEA_URL;
const [OWNER, REPO] = (process.env.REDSTRING_GITEA_REPO || '/').split('/');
const TOKENS = (process.env.REDSTRING_GITEA_TOKENS || '').split(',').filter(Boolean);
const enabled = !!(ENDPOINT && OWNER && REPO && TOKENS.length >= 2);
const RUN = Date.now().toString(36);
let folderCounter = 0;

function makeDevice(folder, token, initialState = null) {
  const device = { state: initialState, conflicts: 0 };
  const provider = new GiteaSemanticProvider({ endpoint: ENDPOINT, user: OWNER, repo: REPO, token });
  const engine = new GitSyncEngine(provider, 'git', folder, `${folder}.redstring`, folder);
  Object.assign(device, { provider, engine });
  const apply = (doc) => { device.state = { ...device.state, ...doc }; };
  engine.onMergeRemote = async (input) => {
    const plan = planMerge(input);
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



describe.skipIf(!enabled)('shared universe on a real Gitea, two accounts', () => {
  const folder = () => `rs-${RUN}-${++folderCounter}`;

  it('merges two people\'s edits and pulls them in, with no echo commits', async () => {
    const f = folder();
    const ana = makeDevice(f, TOKENS[0], forest());
    await ana.save();
    const ben = makeDevice(f, TOKENS[1]);
    await ben.open();

    ana.edit((s) => addThing(s, 'fungus', 'Fungus'));
    ben.edit((s) => { addThing(s, 'squirrel', 'Squirrel'); s.nodePrototypes.get('tree').name = 'Oak'; });
    await ana.save();
    await ben.save();
    expect(ben.conflicts).toBe(0);
    expect(names(ben.state)).toEqual(['Bird', 'Fungus', 'Oak', 'Squirrel', 'Soil'].sort());
    expect(await ana.engine.checkRemote()).toMatchObject({ applied: true });
    expect(sameDocument(ana.state, ben.state)).toBe(true);

    const history = await ana.provider.listFileHistory(ana.engine.getLatestPath(), { withSize: false });
    expect(await ana.save()).toBe(false);
    expect(await ben.engine.checkRemote()).toEqual({ changed: false });
    const after = await ana.provider.listFileHistory(ana.engine.getLatestPath(), { withSize: false });
    expect(after.length).toBe(history.length);
    expect(after.map((r) => r.author)).toEqual([after[0].author, after[1].author, after[2].author]);
  }, 60000);

  it('the host refuses stale and duplicate writes', async () => {
    const f = folder();
    const ana = makeDevice(f, TOKENS[0], forest());
    await ana.save();
    const first = ana.engine.lastKnownRemoteSha;
    ana.edit((s) => addThing(s, 'x', 'X'));
    await ana.save();
    const path = ana.engine.getLatestPath();
    await expect(ana.provider.writeFileRaw(path, '{}', { expectedSha: first })).rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
    await expect(ana.provider.writeFileRaw(path, '{}', { expectedSha: null })).rejects.toMatchObject({ code: 'REMOTE_DIVERGED' });
    const old = importFromRedstring(JSON.parse(await ana.provider.readFileAtSha(path, first))).storeState;
    expect(names(old)).toEqual(['Bird', 'Soil', 'Tree']);
    expect(await ana.provider.getRemoteFileSha(path)).toBe(ana.engine.lastKnownRemoteSha);
  }, 60000);

  it('same field from both: the repository\'s value wins, the other is kept aside', async () => {
    const f = folder();
    const ana = makeDevice(f, TOKENS[0], forest());
    await ana.save();
    const ben = makeDevice(f, TOKENS[1]);
    await ben.open();
    ben.edit((s) => { s.nodePrototypes.get('bird').name = 'Robin'; });
    ana.edit((s) => { s.nodePrototypes.get('bird').name = 'Sparrow'; });
    await ben.save();
    await ana.save();
    expect(ana.state.nodePrototypes.get('bird').name).toBe('Robin');
    expect(ana.state.nodePrototypes.get('bird')._preserved.merge.name).toBe('Sparrow');
  }, 60000);
});
