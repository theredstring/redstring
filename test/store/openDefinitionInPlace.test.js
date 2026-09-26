import { describe, it, expect, beforeEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { projectGraphView, openGroupId } from '../../src/core/openDefinitions.js';

// A node opened in place shows its definition's own nodes; editing them edits the
// definition. The flow: open a node with no definition yet, drop nodes into it,
// connect them to things outside, close it, reopen it — and nothing is lost or
// copied along the way.

const FLUSH_MS = 60;
const flush = () => vi.advanceTimersByTimeAsync(FLUSH_MS);

const st = () => useGraphStore.getState();
const undo = () => useHistoryStore.getState().undo(st().applyPatches);
const view = () => projectGraphView(st(), 'main');
const defGraph = () => st().graphs.get(st().nodePrototypes.get('p-box').definitionGraphIds[0]);
const mainGraph = () => st().graphs.get('main');

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
    nodePrototypes: new Map(['p-box', 'p-a', 'p-b', 'p-out'].map(id => [id, makePrototype(id)])),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

/** Box at 1000,1000 opened empty; a and b dropped into it; a connected to out. */
const buildInPlace = () => {
  st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
  st().addNodeInstance('main', 'p-out', { x: 0, y: 0 }, 'out');
  st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
  st().addNodeInstance('main', 'p-b', { x: 1300, y: 1100 }, 'b');
  const groupId = st().openDefinitionInPlace('main', 'box');
  st().addInstancesToGroup('main', groupId, ['a', 'b']);
  st().addEdge('main', { id: 'e-in', sourceId: 'a', destinationId: 'b' });
  st().addEdge('main', { id: 'e-across', sourceId: 'a', destinationId: 'out' });
  return groupId;
};

describe('openDefinitionInPlace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  it('opens a node with no definition into a new, empty one', () => {
    st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
    const groupId = st().openDefinitionInPlace('main', 'box');
    expect(groupId).toBe(openGroupId('box'));
    expect(defGraph().instances.size).toBe(0);
    expect(mainGraph().instances.get('box').openDefinition).toEqual({ index: 0, offset: { x: 1000, y: 1000 } });
    const box = view().groups.get(groupId);
    expect(box.emptyPlaceholderOrigin).toEqual({ x: 1000, y: 1000 });
  });

  it('moves dropped nodes into the definition, keeping ids, places and connections', () => {
    buildInPlace();
    expect(mainGraph().instances.has('a')).toBe(false);
    expect(defGraph().instances.get('a')).toMatchObject({ x: 100, y: 100 });
    expect(view().instances.get('a')).toMatchObject({ x: 1100, y: 1100 });

    // Inside the box: the connection is part of the definition.
    expect(defGraph().edgeIds).toContain('e-in');
    expect(mainGraph().edgeIds).not.toContain('e-in');
    // Across the box: it stays outside, reaching a through the box.
    expect(mainGraph().edgeIds).toContain('e-across');
    expect(st().edges.get('e-across')).toMatchObject({ sourceId: 'a', destinationId: 'out', sourceVia: ['box'] });
  });

  it('carries a connection made before the drop into the right graph', () => {
    st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
    st().addNodeInstance('main', 'p-out', { x: 0, y: 0 }, 'out');
    st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
    st().addNodeInstance('main', 'p-b', { x: 1300, y: 1100 }, 'b');
    st().addEdge('main', { id: 'e-in', sourceId: 'a', destinationId: 'b' });
    st().addEdge('main', { id: 'e-across', sourceId: 'out', destinationId: 'a' });
    const groupId = st().openDefinitionInPlace('main', 'box');
    st().addInstancesToGroup('main', groupId, ['a']);
    // b is still outside: both connections cross the box's edge.
    expect(st().edges.get('e-in').sourceVia).toEqual(['box']);
    expect(mainGraph().edgeIds).toEqual(expect.arrayContaining(['e-in', 'e-across']));
    st().addInstancesToGroup('main', groupId, ['b']);
    // Now e-in is wholly inside and moves into the definition.
    expect(defGraph().edgeIds).toContain('e-in');
    expect(st().edges.get('e-in').sourceVia).toBeUndefined();
    expect(st().edges.get('e-across').destinationVia).toEqual(['box']);
  });

  it('closes without losing anything, and reopens with its top-left on the node', () => {
    const groupId = buildInPlace();
    st().closeDefinitionInPlace('main', 'box');
    expect(mainGraph().instances.get('box').openDefinition).toBeUndefined();
    expect(defGraph().instances.size).toBe(2);

    const closed = view();
    expect(closed.instances.has('a')).toBe(false);
    expect(closed.openView.edges.get('e-across')).toMatchObject({ sourceId: 'box', destinationId: 'out' });
    expect(closed.edgeIds).not.toContain('e-in');

    expect(st().openDefinitionInPlace('main', 'box')).toBe(groupId);
    const reopened = view();
    expect(reopened.openView.edges.has('e-across')).toBe(false);
    // a is the definition's top-left, so it lands on the node, as expanding always has.
    expect(reopened.instances.get('a')).toMatchObject({ x: 1000, y: 1000 });
    expect(reopened.instances.get('b')).toMatchObject({ x: 1200, y: 1000 });
  });

  it('collapsing an open box just closes it', () => {
    const groupId = buildInPlace();
    expect(st().collapseNodeGroupIntoDefinition('main', groupId)).toBe('box');
    expect(mainGraph().instances.get('box').openDefinition).toBeUndefined();
    expect(defGraph().instances.size).toBe(2);
  });

  it('moving a node inside the box moves it in the definition', () => {
    buildInPlace();
    st().updateMultipleNodeInstancePositions('main', [{ instanceId: 'a', x: 1150, y: 1120 }]);
    expect(defGraph().instances.get('a')).toMatchObject({ x: 150, y: 120 });
    expect(mainGraph().instances.get('box').openDefinition.offset).toEqual({ x: 1000, y: 1000 });
  });

  it('moving the whole box moves only its placement', () => {
    buildInPlace();
    st().updateMultipleNodeInstancePositions('main', [
      { instanceId: 'a', x: 1600, y: 1100 },
      { instanceId: 'b', x: 1800, y: 1100 },
    ]);
    expect(defGraph().instances.get('a')).toMatchObject({ x: 100, y: 100 });
    expect(mainGraph().instances.get('box').openDefinition.offset).toEqual({ x: 1500, y: 1000 });
    expect(view().instances.get('b')).toMatchObject({ x: 1800, y: 1100 });
  });

  it('edits in view coordinates without disturbing stored positions', () => {
    buildInPlace();
    st().updateNodeInstance('main', 'a', (draft) => { draft.scale = 1.2; });
    expect(defGraph().instances.get('a')).toMatchObject({ x: 100, y: 100, scale: 1.2 });
    st().updateNodeInstance('main', 'a', (draft) => { draft.x += 10; });
    expect(defGraph().instances.get('a').x).toBe(110);
  });

  it('shows edits everywhere the definition appears', () => {
    buildInPlace();
    st().updateMultipleNodeInstancePositions('main', [{ instanceId: 'a', x: 1150, y: 1100 }]);
    const own = projectGraphView(st(), defGraph().id);
    expect(own.instances.get('a')).toMatchObject({ x: 150, y: 100 });
  });

  it('deleting inside the box deletes from the definition, and its outside connections', () => {
    buildInPlace();
    st().removeNodeInstance('main', 'a');
    expect(defGraph().instances.has('a')).toBe(false);
    expect(st().edges.has('e-across')).toBe(false);
    expect(mainGraph().edgeIds).not.toContain('e-across');
    expect(defGraph().edgeIds).not.toContain('e-in');
  });

  it('deleting the box node removes the connections that reached inside it', () => {
    buildInPlace();
    st().removeMultipleNodeInstances('main', ['box']);
    expect(st().edges.has('e-across')).toBe(false);
    expect(mainGraph().edgeIds).not.toContain('e-across');
    // The definition itself is untouched.
    expect(defGraph().instances.size).toBe(2);
  });

  it('opens a definition once per view', () => {
    const groupId = buildInPlace();
    st().addNodeInstance('main', 'p-box', { x: 3000, y: 0 }, 'box-2');
    expect(st().openDefinitionInPlace('main', 'box-2')).toBe(groupId);
    expect(mainGraph().instances.get('box-2').openDefinition).toBeUndefined();
  });

  it('renaming the open box renames the Thing', () => {
    const groupId = buildInPlace();
    st().updateGroup('main', groupId, (group) => { group.name = 'Engine'; });
    expect(st().nodePrototypes.get('p-box').name).toBe('Engine');
  });

  it('undoes opening and building in place', async () => {
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });
    st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
    st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
    await flush();
    const groupId = st().openDefinitionInPlace('main', 'box');
    await flush();
    st().addInstancesToGroup('main', groupId, ['a']);
    await flush();

    undo();
    expect(mainGraph().instances.has('a')).toBe(true);
    expect(defGraph().instances.has('a')).toBe(false);
    undo();
    expect(mainGraph().instances.get('box').openDefinition).toBeUndefined();
  });
});
