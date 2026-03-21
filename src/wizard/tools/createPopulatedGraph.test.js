/**
 * Tests for createPopulatedGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPopulatedGraph } from './createPopulatedGraph.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

vi.mock('../../ai/palettes.js', () => ({
  resolvePaletteColor: vi.fn((palette, color) => color || '#8B0000'),
  getRandomPalette: vi.fn(() => 'test-palette')
}));

describe('createPopulatedGraph', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns direct action payload with correct args', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        description: 'A test graph',
        nodes: [
          { name: 'Node One', color: '#FF0000', description: 'First node' },
          { name: 'Node Two', color: '#00FF00' }
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

    expect(result).toMatchObject({
      action: 'createPopulatedGraph',
      graphName: 'Test Graph',
      description: 'A test graph',
      nodeCount: 2,
      edgeCount: 1
    });
    expect(result.spec.nodes).toHaveLength(2);
    expect(result.spec.nodes[0].name).toBe('Node One');
    expect(result.spec.nodes[0].color).toBe('#FF0000');
    expect(result.spec.edges).toHaveLength(1);
    expect(result.spec.edges[0].source).toBe('Node One');
  });

  it('uses default color for nodes when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.spec.nodes[0].color).toBe('#8B0000');
  });

  it('uses empty description for nodes when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.spec.nodes[0].description).toBe('');
  });

  it('throws error when edge is missing definitionNode', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createPopulatedGraph(
        {
          name: 'Test Graph',
          nodes: [
            { name: 'Node One' },
            { name: 'Node Two' }
          ],
          edges: [
            { source: 'Node One', target: 'Node Two' }
          ]
        },
        graphState,
        mockCid,
        mockEnsureSchedulerStarted
      )
    ).rejects.toThrow('Edge 1 (Node One → Node Two) is missing required field \'definitionNode\'');
  });

  it('uses empty description for graph when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.description).toBe('');
  });

  it('throws error when name and targetGraphId are missing', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createPopulatedGraph(
        { nodes: [{ name: 'Node One' }] },
        graphState,
        mockCid,
        mockEnsureSchedulerStarted
      )
    ).rejects.toThrow('Graph name is required when creating a new graph');
  });

  it('allows missing name if targetGraphId is provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        targetGraphId: 'existing-graph-id',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.graphId).toBe('existing-graph-id');
    expect(result.graphName).toBe('existing graph');
  });

  it('throws error when nodes array is empty', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createPopulatedGraph(
        { name: 'Test Graph', nodes: [] },
        graphState,
        mockCid,
        mockEnsureSchedulerStarted
      )
    ).rejects.toThrow('At least one node is required');
  });

  it('throws error when nodes is missing', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createPopulatedGraph(
        { name: 'Test Graph' },
        graphState,
        mockCid,
        mockEnsureSchedulerStarted
      )
    ).rejects.toThrow('At least one node is required');
  });

  // Removed ensureSchedulerStarted test as direct UI tools no longer call it

  it('handles missing edges array', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.edgeCount).toBe(0);
    expect(result.edgesAdded).toHaveLength(0);
  });

  it('handles new definitionNode format with directionality', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [
          { name: 'Romeo', description: 'Male protagonist' },
          { name: 'Juliet', description: 'Female protagonist' }
        ],
        edges: [
          {
            source: 'Romeo',
            target: 'Juliet',
            directionality: 'bidirectional',
            definitionNode: {
              name: 'Loves',
              color: '#E74C3C',
              description: 'Romantic love'
            }
          }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const edge = result.spec.edges[0];

    expect(edge.directionality).toBe('bidirectional');
    expect(edge.type).toBe('Loves');
    expect(edge.definitionNode.name).toBe('Loves');
    expect(edge.definitionNode.color).toBe('#E74C3C');
    expect(edge.definitionNode.description).toBe('Romantic love');

    expect(result.edgesAdded[0].type).toBe('Loves');
    expect(result.edgesAdded[0].directionality).toBe('bidirectional');
  });

  it('resolves and returns the color property for the graph', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };
    const result = await createPopulatedGraph(
      {
        name: 'Colorful Graph',
        color: 'sky-blue',
        palette: 'ocean',
        nodes: [{ name: 'A' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    // The mock for resolvePaletteColor returns the color string if provided
    expect(result.color).toBe('sky-blue');
  });

  it('drops edges referencing non-existent nodes and reports them', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };
    const result = await createPopulatedGraph(
      {
        name: 'Grocery Store',
        nodes: [
          { name: 'Apples', description: 'Fruit' },
          { name: 'Bread', description: 'Bakery item' }
        ],
        edges: [
          { source: 'Apples', target: 'Bread', definitionNode: { name: 'Near' } },
          { source: 'Apples', target: 'Produce Section', definitionNode: { name: 'Stocked In' } },
          { source: 'Bread', target: 'Bakery Aisle', definitionNode: { name: 'Stocked In' } }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    // Only the valid edge should remain
    expect(result.edgeCount).toBe(1);
    expect(result.spec.edges).toHaveLength(1);
    expect(result.spec.edges[0].source).toBe('Apples');
    expect(result.spec.edges[0].target).toBe('Bread');

    // Dropped edges should be reported
    expect(result.droppedEdges).toHaveLength(2);
    expect(result.droppedEdges[0].target).toBe('Produce Section');
    expect(result.droppedEdges[1].target).toBe('Bakery Aisle');
    expect(result.edgeWarning).toContain('2 edge(s) were dropped');
  });

  it('returns empty droppedEdges when all edges are valid', async () => {
    const graphState = { graphs: [], nodePrototypes: [] };
    const result = await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [
          { name: 'Node One' },
          { name: 'Node Two' }
        ],
        edges: [
          { source: 'Node One', target: 'Node Two', definitionNode: { name: 'Connects' } }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.droppedEdges).toHaveLength(0);
    expect(result.edgeWarning).toBeNull();
    expect(result.edgeCount).toBe(1);
  });
});

