import { describe, it, expect, beforeEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import useCanvasUIStore from '../../src/store/canvasUIStore.js';
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

  it('parking a nested box under its title never moves the box around it', () => {
    // A box holding only another open box: parking that box's node under its
    // title is a move of everything inside, and read as a drag it carried the box
    // (and the title, and so the next parking) off up-left every frame.
    st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
    st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
    st().addInstancesToGroup('main', st().openDefinitionInPlace('main', 'box'), ['a']);
    st().openDefinitionInPlace('main', 'a');
    st().updateMultipleNodeInstancePositions('main', [{ instanceId: 'a', x: 1150, y: 1040 }], { phase: 'end', parkedAnchors: true });
    expect(mainGraph().instances.get('box').openDefinition.offset).toEqual({ x: 1000, y: 1000 });
    expect(defGraph().instances.get('a')).toMatchObject({ x: 150, y: 40 });
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

  it('opens a definition again in a second box', () => {
    buildInPlace();
    st().addNodeInstance('main', 'p-box', { x: 3000, y: 0 }, 'box-2');
    expect(st().openDefinitionInPlace('main', 'box-2')).toBe(openGroupId('box-2'));
    expect(mainGraph().instances.get('box-2').openDefinition).toBeTruthy();
    expect(view().groups.get(openGroupId('box-2')).memberInstanceIds).toEqual(['box-2/a', 'box-2/b']);
    expect(view().edgeIds).toEqual(expect.arrayContaining(['e-in', 'box-2/e-in']));
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

describe('a definition open in two boxes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
    buildInPlace();
    st().addNodeInstance('main', 'p-box', { x: 3000, y: 0 }, 'box-2');
    st().openDefinitionInPlace('main', 'box-2', 0, {}, { x: 2000, y: -1000 });
  });

  it('edits the definition from either box, under stored ids', () => {
    const before = defGraph().instances.get('a');
    const shown = view().instances.get('box-2/a');
    st().updateMultipleNodeInstancePositions('main', [{ instanceId: 'box-2/a', x: shown.x + 50, y: shown.y }]);
    expect(defGraph().instances.get('a').x).toBe(before.x + 50);
    expect(view().instances.get('a').x).toBe(view().instances.get('box-2/a').x - 2000 + (mainGraph().instances.get('box').openDefinition.offset.x));
    st().updateNodeInstance('main', 'box-2/b', (inst) => { inst.scale = 2; });
    expect(defGraph().instances.get('b').scale).toBe(2);
    expect([...defGraph().instances.keys()].some(id => id.includes('/'))).toBe(false);
  });

  it('moves the second box on its own when all of it is dragged', () => {
    const firstOffset = { ...mainGraph().instances.get('box').openDefinition.offset };
    const updates = ['box-2/a', 'box-2/b'].map(id => ({ instanceId: id, x: view().instances.get(id).x + 10, y: view().instances.get(id).y + 20 }));
    st().updateMultipleNodeInstancePositions('main', updates);
    expect(mainGraph().instances.get('box-2').openDefinition.offset).toEqual({ x: 2010, y: -980 });
    expect(mainGraph().instances.get('box').openDefinition.offset).toEqual(firstOffset);
  });

  it('connects a node in the second box to the outside through that box', () => {
    st().addEdge('main', { id: 'e-2', sourceId: 'box-2/b', destinationId: 'out', directionality: { arrowsToward: new Set(['box-2/b']) } });
    const stored = st().edges.get('e-2');
    expect(stored).toMatchObject({ sourceId: 'b', destinationId: 'out', sourceVia: ['box-2'] });
    expect(Array.from(stored.directionality.arrowsToward)).toEqual(['b']);
    expect(mainGraph().edgeIds).toContain('e-2');
    expect(view().openView.edges.get('e-2')).toMatchObject({ sourceId: 'box-2/b', destinationId: 'out' });
  });

  it('connects the two boxes to each other around both', () => {
    st().addEdge('main', { id: 'e-between', sourceId: 'a', destinationId: 'box-2/b' });
    expect(st().edges.get('e-between')).toMatchObject({ sourceId: 'a', destinationId: 'b', sourceVia: ['box'], destinationVia: ['box-2'] });
    expect(mainGraph().edgeIds).toContain('e-between');
    expect(defGraph().edgeIds).not.toContain('e-between');
  });

  it('connects inside the second box into the definition itself', () => {
    st().addEdge('main', { id: 'e-in-2', sourceId: 'box-2/b', destinationId: 'box-2/a' });
    expect(st().edges.get('e-in-2')).toMatchObject({ sourceId: 'b', destinationId: 'a' });
    expect(st().edges.get('e-in-2').sourceVia).toBeUndefined();
    expect(defGraph().edgeIds).toContain('e-in-2');
    expect(view().edgeIds).toEqual(expect.arrayContaining(['e-in-2', 'box-2/e-in-2']));
  });

  it('updates and deletes a connection picked in the second box', () => {
    st().updateEdge('box-2/e-in', (edge) => { edge.directionality.arrowsToward = new Set(['box-2/b']); });
    expect(Array.from(st().edges.get('e-in').directionality.arrowsToward)).toEqual(['b']);
    st().removeEdge('box-2/e-in');
    expect(st().edges.has('e-in')).toBe(false);
    expect(view().edgeIds).not.toContain('e-in');
  });

  it('deletes a node picked in the second box from the definition', () => {
    st().removeMultipleNodeInstances('main', ['box-2/b']);
    expect(defGraph().instances.has('b')).toBe(false);
    expect(st().edges.has('e-in')).toBe(false);
    expect(view().instances.has('b')).toBe(false);
  });

  it('drops a node into the second box, keeping its connection on that box', () => {
    st().addNodeInstance('main', 'p-a', { x: 0, y: 500 }, 'c');
    st().addEdge('main', { id: 'e-c', sourceId: 'c', destinationId: 'out' });
    st().addEdge('main', { id: 'e-c-a', sourceId: 'c', destinationId: 'a' });
    st().addInstancesToGroup('main', openGroupId('box-2'), ['c']);
    expect(defGraph().instances.has('c')).toBe(true);
    expect(st().edges.get('e-c')).toMatchObject({ sourceId: 'c', sourceVia: ['box-2'] });
    // c (now in box-2) to a in the first box: still between the two boxes.
    expect(st().edges.get('e-c-a')).toMatchObject({ sourceId: 'c', destinationId: 'a', sourceVia: ['box-2'], destinationVia: ['box'] });
    expect(view().instances.has('box-2/c')).toBe(true);
  });

  it('keeps a node dropped into the second box selected, under its id there', () => {
    st().addNodeInstance('main', 'p-a', { x: 0, y: 500 }, 'c');
    useCanvasUIStore.getState().setSelectedInstanceIds(new Set(['c']));
    st().addInstancesToGroup('main', openGroupId('box-2'), ['c']);
    expect([...useCanvasUIStore.getState().selectedInstanceIds]).toEqual(['box-2/c']);
  });

  it('closes the second box alone', () => {
    expect(st().closeDefinitionInPlace('main', 'box-2')).toBe('box-2');
    expect(mainGraph().instances.get('box-2').openDefinition).toBeUndefined();
    expect(mainGraph().instances.get('box').openDefinition).toBeTruthy();
  });
});

describe('dragging a box that holds an empty box', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
    // Box open, holding Inner (open and empty), inside which is nothing.
    st().addNodeInstance('main', 'p-box', { x: 1000, y: 1000 }, 'box');
    st().addNodeInstance('main', 'p-a', { x: 1100, y: 1100 }, 'a');
    st().openDefinitionInPlace('main', 'box', 0, {}, { x: 0, y: 0 });
    st().addInstancesToGroup('main', openGroupId('box'), ['a']);
    st().addNodeInstance('main', 'p-b', { x: 1200, y: 1300 }, 'inner');
    st().addInstancesToGroup('main', openGroupId('box'), ['inner']);
    st().openDefinitionInPlace('main', 'inner', 0, {}, { x: 50, y: 60 });
  });

  it('moves the empty box once, with its box', () => {
    const v = view();
    const innerBox = v.groups.get(openGroupId('inner'));
    const ph = innerBox.emptyPlaceholderOrigin;
    const d = { x: 300, y: 200 };
    // What a drag of the outer box sends: its Things, its inner anchor, the empty box's spot.
    st().updateMultipleNodeInstancePositions('main', [
      { instanceId: 'a', x: v.instances.get('a').x + d.x, y: v.instances.get('a').y + d.y },
      { instanceId: 'inner', x: v.instances.get('inner').x + d.x, y: v.instances.get('inner').y + d.y },
      { instanceId: `__placeholder__${openGroupId('inner')}`, x: ph.x + d.x, y: ph.y + d.y },
    ]);
    expect(view().groups.get(openGroupId('inner')).emptyPlaceholderOrigin).toEqual({ x: ph.x + d.x, y: ph.y + d.y });
    expect(view().instances.get('a').x).toBe(v.instances.get('a').x + d.x);
  });
});

