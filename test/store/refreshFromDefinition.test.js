import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';

// Refreshing a node-group from its definition replaces its members with fresh copies.
// Connections from the old members to things outside the box used to be deleted; they
// now move to the most similar fresh member (same Thing, nearest spot in the box), or
// onto the box's own node when the definition no longer has that Thing.

const st = () => useGraphStore.getState();

const makeGraph = (id) => ({
  id, name: id, description: '',
  instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [],
});
const makePrototype = (id, name) => ({
  id, name, description: '', color: '#8B0000',
  typeNodeId: 'base-thing-prototype', definitionGraphIds: [],
});

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', makeGraph('main')]]),
    nodePrototypes: new Map(
      ['box', 'a', 'b', 'wheel', 'out', 'out2'].map(p => [`p-${p}`, makePrototype(`p-${p}`, p)])
    ),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

/** Opens Box empty, fills it with `members` ([id, prototypeId, x, y]), saves it as the definition. */
const openBoxWith = (members) => {
  st().addNodeInstance('main', 'p-box', { x: 0, y: 0 }, 'box');
  const groupId = st().decomposeEmptyNodeToGroup('main', 'p-box', 0, 'box');
  for (const [id, protoId, x, y] of members) st().addNodeInstance('main', protoId, { x, y }, id);
  st().addInstancesToGroup('main', groupId, members.map(m => m[0]));
  return groupId;
};

const members = (groupId) => st().graphs.get('main').groups.get(groupId).memberInstanceIds;
const instance = (id) => st().graphs.get('main').instances.get(id);
const defGraph = () => st().graphs.get(st().nodePrototypes.get('p-box').definitionGraphIds[0]);

describe('refreshNodeGroupFromDefinition keeps outside connections', () => {
  beforeEach(reset);

  it('moves a connection to the fresh copy of the same Thing, arrow and all', () => {
    const groupId = openBoxWith([['a', 'p-a', 100, 100], ['b', 'p-b', 300, 100]]);
    st().addNodeInstance('main', 'p-out', { x: 800, y: 0 }, 'out');
    st().addEdge('main', { id: 'e-in', sourceId: 'a', destinationId: 'b' });
    st().addEdge('main', {
      id: 'e-across', sourceId: 'a', destinationId: 'out',
      directionality: { arrowsToward: new Set(['a']) },
    });
    st().updateDefinitionFromNodeGroup('main', groupId);

    const result = st().refreshNodeGroupFromDefinition('main', groupId);
    expect(result.reattachedCrossEdgeCount).toBe(1);
    expect(result.droppedCrossEdgeCount).toBe(0);

    const across = st().edges.get('e-across');
    expect(across).toBeTruthy();
    expect(members(groupId)).toContain(across.sourceId);
    expect(instance(across.sourceId).prototypeId).toBe('p-a');
    expect(across.destinationId).toBe('out');
    expect(Array.from(across.directionality.arrowsToward)).toEqual([across.sourceId]);

    // The old internal connection is gone; the definition supplied its own copy.
    expect(st().edges.has('e-in')).toBe(false);
    const mainEdges = st().graphs.get('main').edgeIds.map(id => st().edges.get(id));
    expect(mainEdges.filter(e => members(groupId).includes(e.sourceId) && members(groupId).includes(e.destinationId))).toHaveLength(1);
  });

  it('keeps two of the same Thing apart by where they sit in the box', () => {
    const groupId = openBoxWith([['w-left', 'p-wheel', 100, 100], ['w-right', 'p-wheel', 500, 100]]);
    st().addNodeInstance('main', 'p-out', { x: -400, y: 0 }, 'out-left');
    st().addNodeInstance('main', 'p-out2', { x: 1000, y: 0 }, 'out-right');
    st().addEdge('main', { id: 'e-left', sourceId: 'w-left', destinationId: 'out-left' });
    st().addEdge('main', { id: 'e-right', sourceId: 'w-right', destinationId: 'out-right' });
    st().updateDefinitionFromNodeGroup('main', groupId);

    const result = st().refreshNodeGroupFromDefinition('main', groupId);
    expect(result.reattachedCrossEdgeCount).toBe(2);

    const left = instance(st().edges.get('e-left').sourceId);
    const right = instance(st().edges.get('e-right').sourceId);
    expect(left.prototypeId).toBe('p-wheel');
    expect(right.prototypeId).toBe('p-wheel');
    expect(left.x).toBeLessThan(right.x);
  });

  it('moves a connection onto the box when its Thing left the definition', () => {
    const groupId = openBoxWith([['a', 'p-a', 100, 100], ['b', 'p-b', 300, 100]]);
    st().addNodeInstance('main', 'p-out', { x: 800, y: 0 }, 'out');
    st().addEdge('main', { id: 'e-across', sourceId: 'a', destinationId: 'out' });
    st().updateDefinitionFromNodeGroup('main', groupId);

    // Someone takes A out of the definition in its own tab.
    const defA = Array.from(defGraph().instances.values()).find(i => i.prototypeId === 'p-a');
    st().removeNodeInstance(defGraph().id, defA.id);

    const result = st().refreshNodeGroupFromDefinition('main', groupId);
    expect(result.movedToGroupNodeCount).toBe(1);
    const across = st().edges.get('e-across');
    expect(across.sourceId).toBe('box');
    expect(across.destinationId).toBe('out');
  });

  it('drops only a connection that would loop from the box onto itself', () => {
    const groupId = openBoxWith([['a', 'p-a', 100, 100]]);
    st().addEdge('main', { id: 'e-to-box', sourceId: 'a', destinationId: 'box' });
    st().updateDefinitionFromNodeGroup('main', groupId);

    const defA = Array.from(defGraph().instances.values()).find(i => i.prototypeId === 'p-a');
    st().removeNodeInstance(defGraph().id, defA.id);

    const result = st().refreshNodeGroupFromDefinition('main', groupId);
    expect(result.droppedCrossEdgeCount).toBe(1);
    expect(st().edges.has('e-to-box')).toBe(false);
  });
});
