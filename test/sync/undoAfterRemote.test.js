// Cmd+Z after someone else's changes arrived. Undo replays the inverse of
// this person's own recorded changes; others' changes come in through
// applyRemoteDocument, which history ignores. So undo must take back only
// this person's edit, leave the other person's alone, and what it leaves
// must sync like any edit.
//
// Ana works in the real store (with its real history). Ben edits plain copies
// of the file and saves them, so the store stays Ana's throughout.
import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { performUndo } from '../../src/store/historyActions.js';
import { makeHost, makeDevice, snapshot, fromFile, sameDocument, describeDifference, brokenReferences, PATH } from './storeDevices.js';

const settleHistory = () => new Promise((r) => setTimeout(r, 120)); // the history middleware batches

async function setup() {
  useHistoryStore.getState().clearHistory?.();
  const host = makeHost();
  const ana = makeDevice(host, 'ana');
  ana.start();
  ana.act(() => {
    const s = useGraphStore.getState();
    s.addNodePrototype({ id: 'tree', name: 'Tree', color: '#8B0000' });
    s.addNodePrototype({ id: 'bird', name: 'Bird', color: '#8B0000' });
    useGraphStore.getState().addNodeInstance('web', 'tree', { x: 0, y: 0 }, 'iTree');
    useGraphStore.getState().addNodeInstance('web', 'bird', { x: 200, y: 0 }, 'iBird');
  });
  await ana.save();
  await settleHistory();
  useHistoryStore.getState().clearHistory?.();

  // Ben: a second engine on the same repository, editing file copies.
  const ben = makeDevice(host, 'ben');
  const remote = await ben.provider.readFileRawWithMeta(PATH);
  ben.state = fromFile(remote.content);
  ben.engine.markRemoteObserved({ sha: remote.sha, nodeCount: ben.state.nodePrototypes.size, contentHash: ben.engine.generateStateHash(ben.state) });
  // Ben always edits the repository's latest version, so his saves never
  // need a merge (whose glue would swap Ana's store out).
  ben.edit = async (fn) => {
    const latest = await ben.provider.readFileRawWithMeta(PATH);
    ben.state = fromFile(latest.content);
    ben.engine._setSyncBase(latest.sha);
    ben.engine.lastKnownRemoteSha = latest.sha;
    fn(ben.state);
    await ben.save();
  };

  /** Ana's own edit, through the store, recorded in her history. */
  ana.edit = async (fn) => {
    fn(useGraphStore.getState());
    await settleHistory();
    ana.state = snapshot();
  };
  ana.undo = async () => {
    performUndo();
    await settleHistory();
    ana.state = snapshot();
  };
  return { host, ana, ben };
}

beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) window.localStorage.clear();
});

describe('undo after someone else\'s changes arrived', () => {
  it('a rename is undone; their recolour of the same Thing stays', async () => {
    const { ana, ben } = await setup();
    await ana.edit((s) => s.updateNodePrototype('tree', (p) => { p.name = 'Oak'; }));
    await ana.save();
    await ben.edit((s) => { s.nodePrototypes.get('tree').color = '#2F4F2F'; });

    await ana.check();
    expect(ana.state.nodePrototypes.get('tree').color).toBe('#2F4F2F');
    await ana.undo();
    const tree = ana.state.nodePrototypes.get('tree');
    expect(tree.name).toBe('Tree');
    expect(tree.color).toBe('#2F4F2F');
  });

  it('a Thing added is undone; the Thing they added stays', async () => {
    const { ana, ben } = await setup();
    await ana.edit((s) => {
      s.addNodePrototype({ id: 'fungus', name: 'Fungus', color: '#8B0000' });
      useGraphStore.getState().addNodeInstance('web', 'fungus', { x: 400, y: 0 }, 'iFungus');
    });
    await ben.edit((s) => {
      s.nodePrototypes.set('squirrel', { id: 'squirrel', name: 'Squirrel', color: '#8B0000', description: '', definitionGraphIds: [] });
      s.graphs.get('web').instances.set('iSquirrel', { id: 'iSquirrel', prototypeId: 'squirrel', x: 600, y: 0, scale: 1 });
    });
    await ana.check(); // Ana has unsaved edits: in the app her next save merges; here, a pull
    expect(ana.state.nodePrototypes.has('squirrel')).toBe(true);
    // Adding a Thing is two recorded steps here (make it, place it): undo both.
    await ana.undo();
    await ana.undo();
    expect(ana.state.nodePrototypes.has('fungus')).toBe(false);
    expect(ana.state.nodePrototypes.has('squirrel')).toBe(true);
    expect(brokenReferences(ana.state)).toEqual([]);
  });

  it('undoing a move of a Thing they deleted leaves it deleted and nothing broken', async () => {
    const { ana, ben } = await setup();
    await ana.edit((s) => s.updateNodeInstance('web', 'iBird', (i) => { i.x = 900; }, { finalize: true }));
    await ana.save();
    await ben.edit((s) => {
      s.graphs.get('web').instances.delete('iBird');
      s.nodePrototypes.delete('bird');
    });
    await ana.check();
    expect(ana.state.nodePrototypes.has('bird')).toBe(false);
    await ana.undo();
    expect(brokenReferences(ana.state)).toEqual([]);
  });

  it('what undo leaves syncs: the repository and the other person end up with it', async () => {
    const { host, ana, ben } = await setup();
    await ana.edit((s) => s.updateNodePrototype('bird', (p) => { p.name = 'Owl'; }));
    await ana.save();
    await ana.undo();
    expect(ana.state.nodePrototypes.get('bird').name).toBe('Bird');
    expect(await ana.save()).not.toBe(false);
    const repo = fromFile(host.current().content);
    expect(sameDocument(repo, ana.state), describeDifference(repo, ana.state)).toBe(true);
  });
});
