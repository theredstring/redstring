import { describe, it, expect, beforeEach, vi } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import useHistoryStore from '../../src/store/historyStore.js';
import { projectGraphView } from '../../src/core/openDefinitions.js';

// Collapsing a node-group saves it into its definition first. The flow this pins:
// expand a node into an empty definition, build it in place among the rest of the
// graph, collapse it — and the definition holds what was built.

const FLUSH_MS = 60;
const flush = () => vi.advanceTimersByTimeAsync(FLUSH_MS);

const st = () => useGraphStore.getState();
const history = () => useHistoryStore.getState().history;
const undo = () => useHistoryStore.getState().undo(st().applyPatches);

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
    nodePrototypes: new Map([
      ['p-box', makePrototype('p-box', 'Box')],
      ['p-a', makePrototype('p-a', 'A')],
      ['p-b', makePrototype('p-b', 'B')],
      ['p-out', makePrototype('p-out', 'Outside')],
    ]),
    edges: new Map(),
    openGraphIds: ['main'],
    activeGraphId: 'main',
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(),
    savedNodeIds: new Set(),
    savedGraphIds: new Set(),
  });
};

/** Expands Box into an empty definition and builds A → B inside it, A → Outside across it. */
const buildInPlace = () => {
  st().addNodeInstance('main', 'p-box', { x: 0, y: 0 }, 'box');
  st().addNodeInstance('main', 'p-out', { x: 800, y: 0 }, 'out');
  const groupId = st().decomposeEmptyNodeToGroup('main', 'p-box', 0, 'box');
  expect(groupId).toBeTruthy();

  st().addNodeInstance('main', 'p-a', { x: 100, y: 100 }, 'a');
  st().addNodeInstance('main', 'p-b', { x: 300, y: 100 }, 'b');
  st().addInstancesToGroup('main', groupId, ['a', 'b']);
  st().addEdge('main', { id: 'e-inside', sourceId: 'a', destinationId: 'b' });
  st().addEdge('main', { id: 'e-across', sourceId: 'a', destinationId: 'out' });
  return groupId;
};

const defGraph = () => st().graphs.get(st().nodePrototypes.get('p-box').definitionGraphIds[0]);
const protoIdsIn = (graph) => Array.from(graph.instances.values()).map(i => i.prototypeId).sort();

describe('collapseNodeGroupIntoDefinition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  it('saves what was built in place into the empty definition, then collapses', () => {
    const groupId = buildInPlace();
    expect(defGraph().instances.size).toBe(0);

    const survivorId = st().collapseNodeGroupIntoDefinition('main', groupId);
    expect(survivorId).toBe('box');

    const def = defGraph();
    expect(protoIdsIn(def)).toEqual(['p-a', 'p-b']);
    expect(def.edgeIds).toHaveLength(1);
    const insideCopy = st().edges.get(def.edgeIds[0]);
    expect(def.instances.get(insideCopy.sourceId).prototypeId).toBe('p-a');
    expect(def.instances.get(insideCopy.destinationId).prototypeId).toBe('p-b');

    // The outside connection stays in the parent graph, still from A — now the A in
    // the definition, reached through the box — rather than collapsing onto the box.
    const main = st().graphs.get('main');
    expect(main.groups.size).toBe(0);
    expect(Array.from(main.instances.keys()).sort()).toEqual(['box', 'out']);
    expect(main.edgeIds).toContain('e-across');
    const across = st().edges.get('e-across');
    expect(def.instances.get(across.sourceId).prototypeId).toBe('p-a');
    expect(across.sourceVia).toEqual(['box']);
    expect(across.destinationId).toBe('out');

    // Closed, it is drawn to the box; opened in place, to A again.
    expect(projectGraphView(st(), 'main').openView.edges.get('e-across').sourceId).toBe('box');
    st().openDefinitionInPlace('main', 'box');
    const open = projectGraphView(st(), 'main');
    expect(open.openView.edges.has('e-across')).toBe(false);
    expect(open.instances.get(across.sourceId).prototypeId).toBe('p-a');
  });

  it('saves nothing when the box matches its definition', () => {
    const groupId = buildInPlace();
    st().updateDefinitionFromNodeGroup('main', groupId);
    const before = defGraph().instances;
    st().collapseNodeGroupIntoDefinition('main', groupId);
    expect(defGraph().instances).toBe(before);
  });

  it('keeps both when the definition changed elsewhere while the copy was open', () => {
    const groupId = buildInPlace();
    st().updateDefinitionFromNodeGroup('main', groupId);
    // Someone edits the definition in its own tab…
    const defA = Array.from(defGraph().instances.values()).find(i => i.prototypeId === 'p-a');
    st().removeNodeInstance(defGraph().id, defA.id);
    // …while the copy here is edited too.
    st().removeInstancesFromGroup('main', groupId, ['b']);

    st().collapseNodeGroupIntoDefinition('main', groupId);

    const ids = st().nodePrototypes.get('p-box').definitionGraphIds;
    expect(ids).toHaveLength(2);
    expect(protoIdsIn(st().graphs.get(ids[0]))).toEqual(['p-b']); // the edit made elsewhere
    expect(protoIdsIn(st().graphs.get(ids[1]))).toEqual(['p-a']); // the edit made here
  });

  it('overwrites a definition that was edited in the group since expanding', () => {
    const groupId = buildInPlace();
    st().updateDefinitionFromNodeGroup('main', groupId);
    expect(protoIdsIn(defGraph())).toEqual(['p-a', 'p-b']);

    // Take B back out of the box before collapsing.
    st().removeInstancesFromGroup('main', groupId, ['b']);
    st().collapseNodeGroupIntoDefinition('main', groupId);

    expect(protoIdsIn(defGraph())).toEqual(['p-a']);
    expect(defGraph().edgeIds).toHaveLength(0);
    // B was outside the group when it collapsed, so it stays in the parent graph.
    expect(st().graphs.get('main').instances.has('b')).toBe(true);
  });

  it('is one undo step that restores both the open group and the old definition', async () => {
    const groupId = buildInPlace();
    await flush();
    useHistoryStore.setState({ history: [], currentIndex: -1 });

    st().collapseNodeGroupIntoDefinition('main', groupId);
    await flush();

    expect(history()).toHaveLength(1);
    expect(history()[0].description).toBe('Collapsed into definition');

    undo();
    const main = st().graphs.get('main');
    expect(main.groups.has(groupId)).toBe(true);
    expect(main.instances.has('a')).toBe(true);
    expect(main.instances.has('b')).toBe(true);
    expect(defGraph().instances.size).toBe(0);
  });
});
