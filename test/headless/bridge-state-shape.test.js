// @vitest-environment node
/**
 * Locks the shape of the bridge-state payload — the MCP compatibility contract.
 *
 * `buildBridgeState` produces the object served at GET /api/bridge/state and
 * consumed by redstring-mcp-server.js (getRealRedstringState → toPlainState).
 * If a field the tools read is dropped/renamed, this test fails loudly.
 *
 * Runs against the REAL store in plain Node (no browser, no jsdom) via the
 * headless bootstrap, so it also guards that the serializer stays Node-safe.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadlessStore, __resetHeadlessStoreCache } from '../../src/headless/createHeadlessStore.js';
import { buildBridgeState } from '../../src/services/bridgeStateSerializer.js';

let useGraphStore;

beforeAll(async () => {
  __resetHeadlessStoreCache();
  ({ useGraphStore } = await createHeadlessStore());
});

/**
 * Build a small but representative universe: one graph, two prototypes, two
 * instances, one typed edge. Exercises every branch buildBridgeState reads.
 */
function seedUniverse() {
  const store = useGraphStore.getState();

  const relProtoId = store.addNodePrototype({
    id: 'proto-rel',
    name: 'connects to',
    color: '#8B0000',
    description: 'a relation prototype'
  });

  const personProtoId = store.addNodePrototype({
    id: 'proto-person',
    name: 'Person',
    color: '#4A90D9',
    description: 'a person'
  });

  store.createNewGraph({ id: 'graph-1', name: 'Social' });

  const instA = store.addNodeInstance('graph-1', 'proto-person', { x: 10, y: 20 }, 'inst-a');
  const instB = store.addNodeInstance('graph-1', 'proto-person', { x: 300, y: 40 }, 'inst-b');

  store.addEdge('graph-1', {
    id: 'edge-1',
    sourceId: 'inst-a',
    destinationId: 'inst-b',
    typeNodeId: 'proto-rel',
    definitionNodeIds: [],
    directionality: { arrowsToward: new Set() }
  });

  return { relProtoId, personProtoId, instA, instB };
}

describe('buildBridgeState shape (MCP contract)', () => {
  it('produces the full top-level payload shape', () => {
    seedUniverse();
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    // Top-level keys the MCP server / wizard tools depend on.
    expect(Object.keys(payload).sort()).toEqual([
      'activeGraphId',
      'activeGraphName',
      'autoLayoutSettings',
      'fileStatus',
      'graphEdges',
      'graphLayouts',
      'graphSummaries',
      'graphs',
      'nodePrototypes',
      'openGraphIds',
      'summary'
    ].sort());
  });

  it('serializes graphs with instances, edgeIds, groups, definingNodeIds', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    const graph = payload.graphs.find(g => g.id === 'graph-1');
    expect(graph).toBeTruthy();
    expect(graph).toMatchObject({
      id: 'graph-1',
      name: 'Social',
      instanceCount: 2
    });
    expect(Array.isArray(graph.edgeIds)).toBe(true);
    expect(graph.edgeIds).toContain('edge-1');
    expect(Array.isArray(graph.groups)).toBe(true);
    expect(Array.isArray(graph.definingNodeIds)).toBe(true);

    // Instances keyed by instanceId, carrying prototypeId + position.
    expect(graph.instances['inst-a']).toMatchObject({
      id: 'inst-a',
      prototypeId: 'proto-person',
      x: 10,
      y: 20
    });
  });

  it('serializes prototypes with color, definitionGraphIds, typeNodeId, abstractionChains', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    const proto = payload.nodePrototypes.find(p => p.id === 'proto-person');
    expect(proto).toMatchObject({
      id: 'proto-person',
      name: 'Person',
      color: '#4A90D9'
    });
    expect(Array.isArray(proto.definitionGraphIds)).toBe(true);
    expect(proto).toHaveProperty('typeNodeId');
    expect(proto).toHaveProperty('abstractionChains');
  });

  it('serializes ALL edges into graphEdges with resolved fields', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    const edge = payload.graphEdges.find(e => e.id === 'edge-1');
    expect(edge).toMatchObject({
      id: 'edge-1',
      sourceId: 'inst-a',
      destinationId: 'inst-b',
      typeNodeId: 'proto-rel'
    });
    expect(Array.isArray(edge.definitionNodeIds)).toBe(true);
    expect(Array.isArray(edge.arrowsToward)).toBe(true);
  });

  it('builds graphLayouts with per-instance positions and metadata', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    const layout = payload.graphLayouts['graph-1'];
    expect(layout).toBeTruthy();
    expect(layout.nodes['inst-a']).toMatchObject({ x: 10, y: 20 });
    expect(layout.metadata).toMatchObject({ nodeCount: 2, edgeCount: 1, truncated: false });
    expect(layout.metadata.boundingBox).toMatchObject({ minX: 10, maxX: 300 });
  });

  it('builds graphSummaries with node/edge labels and a text rendering', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    const summary = payload.graphSummaries['graph-1'];
    expect(summary).toBeTruthy();
    expect(summary).toMatchObject({
      id: 'graph-1',
      name: 'Social',
      nodeCount: 2,
      edgeCount: 1
    });
    // Edge label resolves prototype name via safePrototypeName.
    expect(summary.edges[0]).toMatchObject({
      id: 'edge-1',
      from: 'inst-a',
      to: 'inst-b',
      type: 'connects to'
    });
    expect(typeof summary.text).toBe('string');
    expect(summary.text).toContain('Social');
  });

  it('reports summary totals', () => {
    const state = useGraphStore.getState();
    const payload = buildBridgeState(state, { fileStatus: null });

    expect(payload.summary.totalGraphs).toBe(state.graphs.size);
    expect(payload.summary.totalPrototypes).toBe(state.nodePrototypes.size);
    expect(typeof payload.summary.lastUpdate).toBe('number');
  });
});
