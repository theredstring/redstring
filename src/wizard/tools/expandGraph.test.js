/**
 * Tests for expandGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandGraph } from './expandGraph.js';

vi.mock('../../ai/palettes.js', () => ({
  resolvePaletteColor: vi.fn((palette, color) => color || '#8B0000'),
  getRandomPalette: vi.fn(() => 'test-palette')
}));

describe('expandGraph', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns spec with nodes and edges for UI application', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await expandGraph(
      {
        nodes: [
          { name: 'Node One', color: '#FF0000', description: 'First node' },
          { name: 'Node Two' }
        ],
        edges: [
          {
            source: 'Node One',
            target: 'Node Two',
            definitionNode: { name: 'Connects', description: 'Test connection' }
          }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    // Should return a spec-based result for UI-side application
    expect(result.action).toBe('expandGraph');
    expect(result.graphId).toBe('graph-1');
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
    expect(result.nodesAdded).toEqual(['Node One', 'Node Two']);
    expect(result.spec).toBeDefined();
    expect(result.spec.nodes).toHaveLength(2);
    expect(result.spec.edges).toHaveLength(1);

    // Verify node specs
    expect(result.spec.nodes[0]).toEqual({
      name: 'Node One',
      color: '#FF0000',
      description: 'First node',
      type: null,
      typeColor: '#A0A0A0',
      typeDescription: ''
    });
    expect(result.spec.nodes[1]).toEqual({
      name: 'Node Two',
      color: '#8B0000',
      description: '',
      type: null,
      typeColor: '#A0A0A0',
      typeDescription: ''
    });

    // Verify edge specs with title case and definitionNode
    expect(result.spec.edges[0].source).toBe('Node One');
    expect(result.spec.edges[0].target).toBe('Node Two');
    expect(result.spec.edges[0].type).toBe('Connects');
    expect(result.spec.edges[0].definitionNode).toBeDefined();
    expect(result.spec.edges[0].definitionNode.name).toBe('Connects');
  });

  it('throws error when nodes and edges are empty', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({ nodes: [], edges: [] }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('At least one node, edge or layer is required');
  });

  it('throws error when neither nodes nor edges is provided', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('At least one node, edge or layer is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({ nodes: [{ name: 'Node One' }] }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No target graph specified and no active graph available.');
  });

  it('handles missing nodes array', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await expandGraph(
      { edges: [{ source: 'Node A', target: 'Node B', type: 'connects' }] },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.nodeCount).toBe(0);
    expect(result.spec.nodes).toHaveLength(0);
    // Edges referencing non-existent nodes are now correctly dropped
    expect(result.edgeCount).toBe(0);
    expect(result.spec.edges).toHaveLength(0);
    expect(result.droppedEdges).toHaveLength(1);
    expect(result.droppedEdges[0].source).toBe('Node A');
    expect(result.droppedEdges[0].target).toBe('Node B');
  });

  it('handles missing edges array', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await expandGraph(
      { nodes: [{ name: 'Node One' }] },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.edgeCount).toBe(0);
    expect(result.spec.edges).toHaveLength(0);
    expect(result.spec.nodes).toHaveLength(1);
  });

  it('handles definitionNode in edges', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await expandGraph(
      {
        nodes: [
          { name: 'Moon' },
          { name: 'Planet' }
        ],
        edges: [
          {
            source: 'Moon',
            target: 'Planet',
            definitionNode: {
              name: 'orbits',
              color: '#00FF00',
              description: 'Orbital relationship'
            }
          }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.spec.edges[0].type).toBe('Orbits');
    expect(result.spec.edges[0].definitionNode.name).toBe('Orbits');
    expect(result.spec.edges[0].definitionNode.color).toBe('#00FF00');
    expect(result.spec.edges[0].definitionNode.description).toBe('Orbital relationship');
  });
});

describe('expandGraph — composition', () => {
  const mockCid2 = 'cid';
  const noop = () => {};

  const graphState = {
    activeGraphId: 'graph-1',
    graphs: [{ id: 'graph-1', name: 'Cell', instances: [], edgeIds: [], groups: [] }],
    nodePrototypes: []
  };

  // The point of 2.1: expandGraph is what the quality-repair loop runs. While it
  // could only emit flat nodes and edges, every repair pass dismantled whatever
  // nesting a build had produced.
  it('accepts layers and carries them into the spec for the applier', async () => {
    const result = await expandGraph(
      {
        nodes: [{ name: 'Cell Membrane' }],
        layers: [{
          name: 'Cytoplasm',
          description: 'The cell interior',
          definition: { nodes: [{ name: 'Mitochondria' }, { name: 'Ribosome' }] }
        }]
      },
      graphState, mockCid2, noop
    );

    expect(result.layerCount).toBe(1);
    expect(result.layersAdded).toEqual(['Cytoplasm']);
    expect(result.spec.layers).toHaveLength(1);
    expect(result.spec.layers[0].definition.nodes.map(n => n.name))
      .toEqual(['Mitochondria', 'Ribosome']);
  });

  it('builds from layers alone, with no flat nodes at all', async () => {
    const result = await expandGraph(
      {
        layers: [{
          name: 'Cytoplasm',
          definition: { nodes: [{ name: 'Mitochondria' }, { name: 'Ribosome' }] }
        }]
      },
      graphState, mockCid2, noop
    );
    expect(result.layerCount).toBe(1);
    expect(result.nodeCount).toBe(0);
  });

  // The false-orphan bug: an edge to a layer used to be invisible to the quality
  // analyzer, so its other endpoint was reported orphaned and the model "fixed"
  // it by adding flat hub edges.
  it('does not report a node orphaned when its only edge points at a layer', async () => {
    const result = await expandGraph(
      {
        nodes: [{ name: 'Cell Membrane', description: 'Outer boundary' }],
        edges: [{ source: 'Cell Membrane', target: 'Cytoplasm', type: 'Encloses' }],
        layers: [{
          name: 'Cytoplasm',
          description: 'The cell interior',
          definition: { nodes: [{ name: 'Mitochondria' }, { name: 'Ribosome' }] }
        }]
      },
      graphState, mockCid2, noop
    );
    expect(result.qualityReport.orphanedNodes).toHaveLength(0);
  });

  it('surfaces layer warnings rather than swallowing them', async () => {
    const result = await expandGraph(
      { layers: [{ name: 'Empty', definition: { nodes: [] } }] },
      graphState, mockCid2, noop
    );
    expect(result.layerWarnings.some(w => w.includes('empty'))).toBe(true);
  });
});
