import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node sizes come from real text layout, which needs a browser canvas.
vi.mock('../../src/utils.js', async (orig) => ({
  ...(await orig()),
  getNodeDimensions: () => ({ currentWidth: 120, currentHeight: 100 }),
}));
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { projectGraphView, openGroupId } from '../../src/core/openDefinitions.js';

// Making a group a Thing-group: its members become the Thing's definition,
// themselves (same ids, same connections), and the Thing is opened in place
// where they stood.

const st = () => useGraphStore.getState();
const web = (id) => ({ id, name: id, description: '', instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [] });

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', web('main')]]),
    nodePrototypes: new Map(),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
  for (const [id, name, x] of [['a', 'A', 0], ['b', 'B', 300], ['c', 'C', 600], ['out', 'Outside', 2000]]) {
    st().addNodePrototype({ id: `p-${id}`, name, color: '#8B0000', definitionGraphIds: [] });
    st().addNodeInstance('main', `p-${id}`, { x, y: 0 }, id);
  }
  const edge = (id, sourceId, destinationId) => st().addEdge('main', {
    id, sourceId, destinationId, typeNodeId: 'base-connection-prototype', definitionNodeIds: [],
    directionality: { arrowsToward: new Set([destinationId]) },
  });
  edge('ab', 'a', 'b');
  edge('out-c', 'out', 'c');
  const inner = st().createGroup('main', { name: 'Pair', color: '#8B0000', memberInstanceIds: ['a', 'b'] });
  const groupId = st().createGroup('main', { name: 'Trio', color: '#8B0000', memberInstanceIds: ['a', 'b', 'c'] });
  return { inner, groupId };
};

describe('making a group a Thing-group', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('opens the Thing in place over its members, themselves', () => {
    const { inner, groupId } = reset();
    const boxId = st().convertGroupToThingInPlace('main', groupId, null, true, 'Trio', '#123456');
    const main = st().graphs.get('main');
    expect(main.groups.size).toBe(0);
    const anchorId = boxId.replace('open:', '');
    expect(boxId).toBe(openGroupId(anchorId));
    const anchor = main.instances.get(anchorId);
    expect(anchor.isGroupAnchor).toBeUndefined();
    expect(anchor.openDefinition).toEqual({ index: 0, offset: { x: 0, y: 0 } });

    const proto = st().nodePrototypes.get(anchor.prototypeId);
    expect(proto).toMatchObject({ name: 'Trio', color: '#123456' });
    const def = st().graphs.get(proto.definitionGraphIds[0]);
    // The same Things, where they stood; the web keeps only the Thing and what was outside.
    expect([...def.instances.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(def.instances.get('b')).toMatchObject({ x: 300, y: 0 });
    expect([...main.instances.keys()].sort()).toEqual([anchorId, 'out'].sort());
    // Its own connection moved in; the one from outside stays here, reaching c through it.
    expect(def.edgeIds).toEqual(['ab']);
    expect(main.edgeIds).toEqual(['out-c']);
    expect(st().edges.get('out-c').destinationVia).toEqual([anchorId]);
    // The group inside went in with its members.
    expect(def.groups.get(inner).memberInstanceIds).toEqual(['a', 'b']);

    // Drawn as one Thing-group of those members, nothing to save or refresh.
    const box = projectGraphView(st(), 'main').groups.get(boxId);
    expect(box).toMatchObject({ isOpenDefinition: true, name: 'Trio', linkedNodePrototypeId: proto.id });
    expect([...box.memberInstanceIds].sort()).toEqual(['a', 'b', 'c']);
  });

  it('opens a copy-style Thing-group it holds in place inside it', () => {
    const { inner, groupId } = reset();
    // The inner group a Thing-group the old way (a copy).
    st().convertGroupToNodeGroup('main', inner, null, true, 'Pair');
    const pairAnchor = st().graphs.get('main').groups.get(inner).anchorInstanceId;
    const trio = st().convertGroupToThingInPlace('main', groupId, null, true, 'Trio');
    const view = projectGraphView(st(), 'main');
    const pair = [...view.groups.values()].find(g => g.name === 'Pair');
    expect(pair.isOpenDefinition).toBe(true);
    expect(pair.id).toBe(openGroupId(pairAnchor));
    const inTrio = new Set(view.groups.get(trio).memberInstanceIds);
    for (const id of pair.memberInstanceIds) expect(inTrio.has(id)).toBe(true);
    expect(st().nodePrototypes.get(pair.linkedNodePrototypeId).definitionGraphIds).toHaveLength(1);
  });

  it('is one undo step', () => {
    const { groupId } = reset();
    st().flushHistoryBatch(); // the setup's own writes
    useHistoryStore.setState({ history: [], currentIndex: -1 });
    st().convertGroupToThingInPlace('main', groupId, null, true, 'Trio');
    expect(useHistoryStore.getState().history).toHaveLength(1);
  });

  it('refuses an empty group, as the copy does', () => {
    reset();
    const empty = st().createGroup('main', { name: 'Empty', color: '#8B0000', memberInstanceIds: [] });
    expect(st().convertGroupToThingInPlace('main', empty, null, true, 'Empty')).toBeNull();
  });
});
