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
          { source: 'Node One', target: 'Node Two', type: 'connects' }
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

    expect(result.spec.nodes[0].color).toBe('#5B6CFF');
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

  it('handles edges without type - defaults to Connection', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createPopulatedGraph(
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
    );

    expect(result.spec.edges[0].type).toBe('Connection');
    expect(result.spec.edges[0].definitionNode).toBeNull();
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

  it('throws error when name is missing', async () => {
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
    ).rejects.toThrow('Graph name is required');
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
});

