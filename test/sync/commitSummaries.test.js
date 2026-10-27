// Who did what in a shared universe is read in History's Git list: each save
// names its account (the host records it) and its commit says what that save
// changed. The save status in the corner says only "Syncing...".
//
// What a commit says must be this person's edits only: not the other person's
// changes that arrived in between, not what a merge brought in.
import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { makeHost, makeDevice } from './storeDevices.js';
import { describeChanges, rebaseSummary } from '../../src/formats/changeSummary.js';

const store = () => useGraphStore.getState();
const thing = (id, name, web = 'web', x = 0) => {
  store().addNodePrototype({ id, name, color: '#8B0000', description: '', definitionGraphIds: [] });
  store().addNodeInstance(web, id, { x, y: 0 }, `i-${id}`);
};
const lastCommit = (host) => host.commits[host.commits.length - 1];

async function twoPeople() {
  const host = makeHost();
  const ana = makeDevice(host, 'ana');
  ana.start();
  ana.act(() => thing('tree', 'Tree'));
  await ana.save();
  const ben = makeDevice(host, 'ben');
  await ben.open();
  // Ana knows what the repository holds from here on, as after any load.
  await ana.open();
  return { host, ana, ben };
}

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

describe('what each save says it did', () => {
  it('names the Things added, and the account that saved', async () => {
    const { host, ana, ben } = await twoPeople();
    ana.act(() => thing('pressure', 'Pressure', 'web', 200));
    await ana.save();
    expect(lastCommit(host)).toMatchObject({ author: 'ana', message: 'Added "Pressure"' });

    await ben.check();
    ben.act(() => store().addEdge('web', { id: 'e1', sourceId: 'i-tree', destinationId: 'i-pressure', typeNodeId: 'base-connection-prototype', directionality: { arrowsToward: new Set() } }));
    await ben.save();
    expect(lastCommit(host)).toMatchObject({ author: 'ben', message: 'Connected "Tree" to "Pressure"' });
  });

  it('a save after their changes arrived says only what this person did', async () => {
    const { host, ana, ben } = await twoPeople();
    ben.act(() => thing('bird', 'Bird', 'web', 300));
    await ben.save();

    ana.act(() => thing('oak', 'Oak', 'web', -300)); // not yet saved when Ben's arrives
    await ana.check();
    expect(ana.state.nodePrototypes.has('bird')).toBe(true);
    await ana.save();
    expect(lastCommit(host)).toMatchObject({ author: 'ana', message: 'Added "Oak"' });
  });

  it('a save that merged with theirs says only what this person did', async () => {
    const { host, ana, ben } = await twoPeople();
    ben.act(() => thing('bird', 'Bird', 'web', 300));
    ana.act(() => thing('oak', 'Oak', 'web', -300));
    await ben.save();
    await ana.save(); // the host refuses it; Ana merges with Ben's and saves that
    expect(ana.state.nodePrototypes.has('bird')).toBe(true);
    expect(lastCommit(host)).toMatchObject({ author: 'ana', message: 'Added "Oak"' });

    // And the save after that measures from the merge.
    ana.act(() => store().updateNodePrototype('oak', (p) => { p.name = 'Old oak'; }));
    await ana.save();
    expect(lastCommit(host).message).toBe('Edited "Old oak"');
  });

  it('an edit made while a save was merging is said by the next save, and only it', async () => {
    const { host, ana, ben } = await twoPeople();
    ben.act(() => thing('bird', 'Bird', 'web', 300));
    await ben.save();
    ana.act(() => thing('oak', 'Oak', 'web', -300));
    // Ana adds Fir while her save is merging with Ben's.
    const merge = ana.engine.onMergeRemote;
    ana.engine.onMergeRemote = async (input) => {
      const plan = await merge(input);
      ana.act(() => thing('fir', 'Fir', 'web', 600));
      return plan;
    };
    await ana.save();
    ana.engine.onMergeRemote = merge;
    expect(lastCommit(host).message).toBe('Added "Oak"');
    expect(ana.state.nodePrototypes.has('fir')).toBe(true);

    await ana.save();
    expect(lastCommit(host)).toMatchObject({ author: 'ana', message: 'Added "Fir"' });
  });

  it('their delete of a Thing this person moved is not said to be this person\'s', async () => {
    const { host, ana, ben } = await twoPeople();
    ana.act(() => thing('oak', 'Oak', 'web', -300));
    await ana.save();
    await ben.check();
    ben.act(() => store().removeNodeInstance('web', 'i-oak'));
    await ben.save();
    ana.act(() => {
      store().updateNodeInstance('web', 'i-oak', (inst) => { inst.x = 999; });
      store().updateNodeInstance('web', 'i-tree', (inst) => { inst.x = 999; });
    });
    await ana.check(); // Ben's delete lands while Ana's moves are on their way
    // Her move of it beats his delete (as any edit does), so it stays: she moved things.
    expect(ana.state.graphs.get('web').instances.has('i-oak')).toBe(true);
    await ana.save();
    expect(lastCommit(host)).toMatchObject({ author: 'ana', message: 'Arranged the web "Forest"' });
  });

  it('a save with nothing to measure from keeps the host\'s plain message', async () => {
    const host = makeHost();
    const ana = makeDevice(host, 'ana');
    ana.start();
    ana.act(() => thing('tree', 'Tree'));
    await ana.save();
    expect(lastCommit(host).message).toBe(`Update ${lastCommit(host).path}`);
  });

  it('a restore says it is one', async () => {
    const { host, ana } = await twoPeople();
    ana.engine.nextCommitMessage = 'Restored the version from 10/26/2026, 3:00:00 PM';
    ana.act(() => thing('oak', 'Oak'));
    await ana.save();
    expect(lastCommit(host).message).toBe('Restored the version from 10/26/2026, 3:00:00 PM');
    ana.act(() => thing('fir', 'Fir'));
    await ana.save();
    expect(lastCommit(host).message).toBe('Added "Fir"');
  });
});

describe('describeChanges', () => {
  const web = (instances, extra = {}) => ({ id: 'w', name: 'Forest', instances: new Map(instances), edgeIds: [], ...extra });
  const state = ({ things = [], instances = [], edges = [], webExtra = {} } = {}) => ({
    nodePrototypes: new Map(things.map(([id, name]) => [id, { id, name }])),
    graphs: new Map([['w', web(instances.map((i) => [i.id, i]), webExtra)]]),
    edges: new Map(edges.map((e) => [e.id, e])),
    edgePrototypes: new Map()
  });
  const a = { id: 'ia', prototypeId: 'a', x: 0, y: 0 };
  const b = { id: 'ib', prototypeId: 'b', x: 100, y: 0 };

  it('nothing shared changed: null', () => {
    const s = state({ things: [['a', 'A']], instances: [a] });
    expect(describeChanges(s, { ...s })).toBeNull();
  });

  it('moving Things arranges the web', () => {
    const before = state({ things: [['a', 'A']], instances: [a] });
    const after = state({ things: [['a', 'A']], instances: [{ ...a, x: 50 }] });
    expect(describeChanges(before, after)).toBe('Arranged the web "Forest"');
  });

  it('moving a Thing opened in place moves its box: still arranging; the camera is nobody\'s edit', () => {
    const open = { ...a, openDefinition: { graphId: 'd', xOffset: 0, yOffset: 0 } };
    const before = state({ things: [['a', 'A']], instances: [open] });
    const after = state({ things: [['a', 'A']], instances: [{ ...open, x: 40, openDefinition: { graphId: 'd', xOffset: 12, yOffset: 30 } }], webExtra: { panOffset: { x: 5, y: 5 }, zoomLevel: 0.5 } });
    expect(describeChanges(before, after)).toBe('Arranged the web "Forest"');

    const camera = state({ things: [['a', 'A']], instances: [open], webExtra: { zoomLevel: 2 } });
    expect(describeChanges(before, camera)).toBeNull();
  });

  it('opening a Thing in place is an edit', () => {
    const before = state({ things: [['a', 'A']], instances: [a] });
    const after = state({ things: [['a', 'A']], instances: [{ ...a, openDefinition: { graphId: 'd', xOffset: 0, yOffset: 0 } }] });
    expect(describeChanges(before, after)).toBe('Edited the web "Forest"');
  });

  it('rebasing: a placement moved here and deleted there stays deleted', () => {
    const base = state({ things: [['a', 'A'], ['b', 'B']], instances: [a, b] });
    const before = state({ things: [['a', 'A'], ['b', 'B']], instances: [{ ...a, x: 9 }, b] });
    before.nodePrototypes = base.nodePrototypes;
    const after = state({ things: [['a', 'A'], ['b', 'B']], instances: [b] });
    after.nodePrototypes = base.nodePrototypes;
    const rebased = rebaseSummary(base, before, after);
    expect(rebased.graphs.get('w').instances.has('ia')).toBe(false);
    expect(describeChanges(rebased, after)).toBeNull();
  });

  it('places and takes out Things that were already there', () => {
    const before = state({ things: [['a', 'A'], ['b', 'B']], instances: [a] });
    const after = state({ things: [['a', 'A'], ['b', 'B']], instances: [b] });
    expect(describeChanges(before, after)).toBe('Placed "B" in "Forest"; took "A" out of "Forest"');
  });

  it('many Things: two names and a count', () => {
    const before = state();
    const after = state({ things: [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', '']] });
    expect(describeChanges(before, after)).toBe('Added "A", "B" and 2 more Things');
  });

  it('a removed Thing is named from before', () => {
    const before = state({ things: [['a', 'A']], instances: [a] });
    const after = state();
    expect(describeChanges(before, after)).toBe('Removed "A"');
  });
});
