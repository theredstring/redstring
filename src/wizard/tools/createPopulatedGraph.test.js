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

  it('enqueues create_populated_graph task with correct args', async () => {
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

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      type: 'goal',
      goal: 'create_populated_graph',
      threadId: mockCid,
      partitionKey: mockCid,
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'create_populated_graph',
          threadId: mockCid,
          args: expect.objectContaining({
            name: 'Test Graph',
            description: 'A test graph',
            graph_spec: expect.objectContaining({
              nodes: [
                { name: 'Node One', color: '#FF0000', description: 'First node' },
                { name: 'Node Two', color: '#00FF00', description: '' }
              ],
              edges: [
                expect.objectContaining({
                  source: 'Node One',
                  target: 'Node Two',
                  type: 'Connects',
                  directionality: 'unidirectional',
                  definitionNode: expect.objectContaining({
                    name: 'Connects',
                    description: ''
                  })
                })
              ]
            }),
            layout_algorithm: 'force',
            layout_mode: 'full'
          })
        })]
      })
    }));

    expect(result).toMatchObject({
      graphId: expect.stringMatching(/^graph-\d+-[\w]+$/),
      graphName: 'Test Graph',
      nodeCount: 2,
      edgeCount: 1,
      goalId: 'mock-goal-id'
    });
    expect(result.nodesAdded).toHaveLength(2);
    expect(result.edgesAdded).toHaveLength(1);
  });

  it('uses default color for nodes when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args.graph_spec.nodes[0].color).toBe('#5B6CFF');
  });

  it('uses empty description for nodes when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args.graph_spec.nodes[0].description).toBe('');
  });

  it('handles edges without type - defaults to Connection', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createPopulatedGraph(
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

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    // When no type is provided, defaults to "Connection"
    expect(callArgs.dag.tasks[0].args.graph_spec.edges[0].type).toBe('Connection');
    expect(callArgs.dag.tasks[0].args.graph_spec.edges[0].definitionNode).toBeNull();
  });

  it('uses empty description for graph when not provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    expect(callArgs.dag.tasks[0].args.description).toBe('');
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

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await createPopulatedGraph(
      {
        name: 'Test Graph',
        nodes: [{ name: 'Node One' }]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });

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

    const callArgs = queueManager.enqueue.mock.calls[0][1];
    const edge = callArgs.dag.tasks[0].args.graph_spec.edges[0];
    
    expect(edge.directionality).toBe('bidirectional');
    expect(edge.type).toBe('Loves');
    expect(edge.definitionNode.name).toBe('Loves');
    expect(edge.definitionNode.color).toBe('#E74C3C');
    expect(edge.definitionNode.description).toBe('Romantic love');
    
    expect(result.edgesAdded[0].type).toBe('Loves');
    expect(result.edgesAdded[0].directionality).toBe('bidirectional');
  });
});

