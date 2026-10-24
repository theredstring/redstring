import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';
import { applyToolResultToStore } from '../../src/services/toolResultApplier.js';
import { expandGraph } from '../../src/wizard/tools/expandGraph.js';
import { createPopulatedGraph } from '../../src/wizard/tools/createPopulatedGraph.js';
import { deleteEdge } from '../../src/wizard/tools/deleteEdge.js';

// The tools run against plain state and the applier against the live store.
// These pin the seams between them: an edge the tool reports added lands, an
// edge it drops never does, and deletes act on exactly one thing.

const st = () => useGraphStore.getState();

const resetStore = () => {
  useGraphStore.setState({
    graphs: new Map(), nodePrototypes: new Map(), edges: new Map(),
    openGraphIds: [], activeGraphId: null, activeDefinitionNodeId: null,
    rightPanelTabs: [{ type: 'home', isActive: true }],
    expandedGraphIds: new Set(), savedNodeIds: new Set(), savedGraphIds: new Set(),
    isUniverseLoaded: true, isUniverseLoading: false,
    universeLoadingError: null, hasUniverseFile: true,
  }, false, 'test_reset');
};

const makeGraph = (name) => {
  st().createNewGraph({ name, typeNodeId: null, color: '#333' });
  return st().activeGraphId;
};

// What the MCP bridge hands a tool: plain arrays.
const plainState = () => ({
  activeGraphId: st().activeGraphId,
  openGraphIds: st().openGraphIds,
  graphs: Array.from(st().graphs.values()).map(g => ({
    id: g.id,
    name: g.name,
    definingNodeIds: g.definingNodeIds || [],
    edgeIds: Array.from(g.edgeIds || []),
    instances: Array.from(g.instances.values()).map(i => ({ id: i.id, prototypeId: i.prototypeId, x: i.x, y: i.y }))
  })),
  nodePrototypes: Array.from(st().nodePrototypes.values()),
  edges: Array.from(st().edges.values())
});

const nameOfInstance = (graphId, instId) => {
  const inst = st().graphs.get(graphId)?.instances.get(instId);
  return st().nodePrototypes.get(inst?.prototypeId)?.name;
};

const edgePairs = (graphId) => (st().graphs.get(graphId).edgeIds || [])
  .map(id => st().edges.get(id))
  .filter(Boolean)
  .map(e => `${nameOfInstance(graphId, e.sourceId)} -> ${nameOfInstance(graphId, e.destinationId)}`);

describe('edges to layers made in the same call', () => {
  beforeEach(resetStore);

  it('expandGraph: an edge to a layer lands on the layer once it exists', async () => {
    const mainId = makeGraph('Main');
    const result = await expandGraph({
      nodes: [{ name: 'Driver' }],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Piston' }, { name: 'Crankshaft' }] } }],
      edges: [
        { source: 'Driver', target: 'Engine', type: 'Starts' },
        { source: 'Driver', target: 'Piston', type: 'Hears' }
      ],
      enrich: false
    }, plainState());

    expect(result.edgeCount).toBe(2);
    expect(result.spec.edges.every(e => e.toLayer)).toBe(true);
    applyToolResultToStore('expandGraph', result);

    const pairs = edgePairs(mainId);
    expect(pairs).toContain('Driver -> Engine');
    expect(pairs).toContain('Driver -> Piston');
  });

  it('createPopulatedGraph: same, for a new web', async () => {
    makeGraph('Main');
    const result = await createPopulatedGraph({
      name: 'Car',
      nodes: [{ name: 'Driver' }, { name: 'Road' }],
      layers: [{ name: 'Engine', definition: { nodes: [{ name: 'Piston' }, { name: 'Crankshaft' }] } }],
      edges: [
        { source: 'Driver', target: 'Road', type: 'Drives On' },
        { source: 'Driver', target: 'Engine', type: 'Starts' }
      ],
      enrich: false,
      unfold: false,
      shape: 'network'
    }, plainState());

    applyToolResultToStore('createPopulatedGraph', result);
    const pairs = edgePairs(result.graphId);
    expect(pairs).toContain('Driver -> Road');
    expect(pairs).toContain('Driver -> Engine');
  });
});

describe('endpoints resolved from the universe', () => {
  beforeEach(resetStore);

  it('places the existing Thing in the web so its edge has an end', async () => {
    const otherId = makeGraph('Other');
    st().applyBulkGraphUpdates(otherId, { nodes: [{ name: 'Temperature' }] });
    const tempProtoId = Array.from(st().nodePrototypes.values()).find(p => p.name === 'Temperature').id;
    const mainId = makeGraph('Main');

    const result = await expandGraph({
      nodes: [{ name: 'Sampling Temperature' }],
      edges: [{ source: 'Sampling Temperature', target: 'temperature', type: 'Is A Kind Of' }],
      enrich: false
    }, plainState());

    expect(result.placedExisting).toEqual(['Temperature']);
    applyToolResultToStore('expandGraph', result);

    expect(edgePairs(mainId)).toEqual(['Sampling Temperature -> Temperature']);
    const placed = Array.from(st().graphs.get(mainId).instances.values()).find(i => i.prototypeId === tempProtoId);
    expect(placed).toBeTruthy();
  });

  it('never wires "Softmax Function" to a node merely containing "max"', async () => {
    const mainId = makeGraph('Main');
    st().applyBulkGraphUpdates(mainId, { nodes: [{ name: 'max' }, { name: 'Logits' }] });

    const result = await expandGraph({
      edges: [{ source: 'Logits', target: 'Softmax Function', type: 'Feeds' }],
      enrich: false
    }, plainState());

    expect(result.edgeCount).toBe(0);
    expect(result.droppedEdges).toHaveLength(1);
    expect(result.edgeWarning).toContain('Softmax Function');
    applyToolResultToStore('expandGraph', result);
    expect(edgePairs(mainId)).toEqual([]);
  });
});

describe('deletes act on exactly one thing', () => {
  beforeEach(resetStore);

  it('deleteNode applier falls back to the LAST same-named instance', () => {
    const mainId = makeGraph('Main');
    st().applyBulkGraphUpdates(mainId, { nodes: [{ name: 'Rate', instanceId: 'i-first' }] });
    const protoId = st().graphs.get(mainId).instances.get('i-first').prototypeId;
    st().addNodeInstance(mainId, protoId, { x: 0, y: 0 }, 'i-last');

    applyToolResultToStore('deleteNode', { action: 'deleteNode', graphId: mainId, name: 'Rate', instanceId: null });
    const ids = Array.from(st().graphs.get(mainId).instances.keys());
    expect(ids).toEqual(['i-first']);
  });

  it('deleteEdge: the tool passes a verified id and the applier deletes that edge', async () => {
    const mainId = makeGraph('Main');
    st().applyBulkGraphUpdates(mainId, {
      nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      edges: [{ source: 'A', target: 'B', type: 'Feeds' }, { source: 'A', target: 'C', type: 'Feeds' }]
    });
    const result = await deleteEdge({ sourceName: 'a', targetName: 'c' }, plainState());
    expect(result.action).toBe('deleteEdge');
    applyToolResultToStore('deleteEdge', result);
    expect(edgePairs(mainId)).toEqual(['A -> B']);
  });

  it('deleteEdge applier deletes nothing when names match several connections', () => {
    const mainId = makeGraph('Main');
    st().applyBulkGraphUpdates(mainId, {
      nodes: [{ name: 'A' }, { name: 'B' }],
      edges: [{ source: 'A', target: 'B', type: 'Feeds' }, { source: 'B', target: 'A', type: 'Starves' }]
    });
    expect(edgePairs(mainId)).toHaveLength(2);
    applyToolResultToStore('deleteEdge', { action: 'deleteEdge', graphId: mainId, sourceName: 'A', targetName: 'B' });
    expect(edgePairs(mainId)).toHaveLength(2);
  });
});
