import { describe, it, expect, beforeEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';
import { deleteNodeGroup } from '../../src/components/canvas/groups/deleteNodeGroup.js';

// A Thing-group inside a node opened in place is drawn in the view graph but stored
// in the definition. The canvas addresses it through the view graph, so the group
// actions have to find it there: combine, delete, ungroup, save and refresh.

const st = () => useGraphStore.getState();
const view = () => projectGraphView(st(), 'main');
const defGraphId = () => st().nodePrototypes.get('p-box').definitionGraphIds[0];
const defGraph = () => st().graphs.get(defGraphId());

const makeGraph = (id) => ({
  id, name: id, description: '',
  instances: new Map(), edgeIds: [], groups: new Map(), definingNodeIds: [],
});
const makePrototype = (id) => ({
  id, name: id, description: '', color: '#8B0000',
  typeNodeId: 'base-thing-prototype', definitionGraphIds: [],
});

const reset = () => {
  useHistoryStore.setState({ history: [], currentIndex: -1 });
  useGraphStore.setState({
    graphs: new Map([['main', makeGraph('main')]]),
    nodePrototypes: new Map(['p-box', 'p-a', 'p-b', 'p-c', 'p-inner'].map(id => [id, makePrototype(id)])),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

/** Box opened in main holding a and b, with a Thing-group (p-inner) around them in the definition. */
const buildNestedGroup = () => {
  st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
  st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
  st().addNodeInstance('main', 'p-b', { x: 1300, y: 1100 }, 'b');
  const boxGroupId = st().openDefinitionInPlace('main', 'box');
  st().addInstancesToGroup('main', boxGroupId, ['a', 'b']);
  st().addEdge('main', { id: 'e-in', sourceId: 'a', destinationId: 'b' });
  const groupId = st().createGroup(defGraphId(), { name: 'p-inner', memberInstanceIds: ['a', 'b'] });
  st().updateGroup(defGraphId(), groupId, (g) => { g.linkedNodePrototypeId = 'p-inner'; });
  return groupId;
};

describe('groups inside an open definition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  it('is drawn in the view but stored in the definition', () => {
    const groupId = buildNestedGroup();
    expect(view().groups.has(groupId)).toBe(true);
    expect(st().graphs.get('main').groups.has(groupId)).toBe(false);
    expect(defGraph().groups.has(groupId)).toBe(true);
  });

  it('combines into its node through the view graph', () => {
    const groupId = buildNestedGroup();
    const nodeId = st().combineNodeGroup('main', groupId);
    expect(nodeId).toBeTruthy();
    expect(defGraph().groups.has(groupId)).toBe(false);
    expect(defGraph().instances.get(nodeId)).toMatchObject({ prototypeId: 'p-inner' });
    expect(defGraph().instances.has('a')).toBe(false);
    expect(view().instances.has(nodeId)).toBe(true);
  });

  it('collapses into its definition through the view graph', () => {
    const groupId = buildNestedGroup();
    const nodeId = st().collapseNodeGroupIntoDefinition('main', groupId);
    expect(nodeId).toBeTruthy();
    const innerDef = st().graphs.get(st().nodePrototypes.get('p-inner').definitionGraphIds[0]);
    expect(innerDef.instances.size).toBe(2);
    expect(defGraph().groups.has(groupId)).toBe(false);
  });

  it('deletes with its Things through the view graph', () => {
    const groupId = buildNestedGroup();
    expect(deleteNodeGroup('main', groupId)).toBe(true);
    expect(defGraph().groups.has(groupId)).toBe(false);
    expect(defGraph().instances.has('a')).toBe(false);
    expect(defGraph().instances.has('b')).toBe(false);
  });

  it('ungroups through the view graph, keeping its Things', () => {
    const groupId = buildNestedGroup();
    st().deleteGroup('main', groupId);
    expect(defGraph().groups.has(groupId)).toBe(false);
    expect(defGraph().instances.has('a')).toBe(true);
  });

  it('saves to and refreshes from its definition through the view graph', () => {
    const groupId = buildNestedGroup();
    expect(st().updateDefinitionFromNodeGroup('main', groupId)).toBeTruthy();
    expect(st().refreshNodeGroupFromDefinition('main', groupId)).toBeTruthy();
    expect(defGraph().groups.get(groupId).memberInstanceIds).toHaveLength(2);
  });

  it('takes a Thing dropped from outside the box, moving it into the definition', () => {
    const groupId = buildNestedGroup();
    st().addNodeInstance('main', 'p-c', { x: 3000, y: 3000 }, 'c');
    st().addInstancesToGroup('main', groupId, ['c']);
    expect(st().graphs.get('main').instances.has('c')).toBe(false);
    expect(defGraph().instances.has('c')).toBe(true);
    expect(defGraph().groups.get(groupId).memberInstanceIds).toContain('c');
    expect(view().groups.get(groupId).memberInstanceIds).toContain('c');
  });

  it('takes a Thing already inside the box where it is', () => {
    const groupId = buildNestedGroup();
    st().addNodeInstance('main', 'p-c', { x: 1500, y: 1100 }, 'c');
    st().addInstancesToGroup('main', `open:box`, ['c']);
    st().addInstancesToGroup('main', groupId, ['c']);
    expect(defGraph().groups.get(groupId).memberInstanceIds).toContain('c');
  });

  it('renames through the view graph', () => {
    const groupId = buildNestedGroup();
    st().updateGroup('main', groupId, (g) => { g.name = 'Renamed'; });
    expect(defGraph().groups.get(groupId).name).toBe('Renamed');
  });
});
