/**
 * Tests for expandGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandGraph } from './expandGraph.js';
import queueManager from '../../services/queue/Queue.js';

vi.mock('../../services/queue/Queue.js', () => ({
  default: {
    enqueue: vi.fn(() => 'mock-goal-id'),
    dequeue: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], inflight: new Map(), byId: new Map() }))
  }
}));

describe('expandGraph', () => {
  const mockEnsureSchedulerStarted = vi.fn();
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues create_populated_graph task with correct args', async () => {
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
          { source: 'Node One', target: 'Node Two', type: 'connects' }
        ]
      },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(queueManager.enqueue).toHaveBeenCalledWith('goalQueue', expect.objectContaining({
      goal: 'expand_graph',
      dag: expect.objectContaining({
        tasks: [expect.objectContaining({
          toolName: 'create_populated_graph',
          args: expect.objectContaining({
            graph_id: 'graph-1',
            graph_spec: expect.objectContaining({
              nodes: [
                { name: 'Node One', color: '#FF0000', description: 'First node' },
                { name: 'Node Two', color: undefined, description: '' }
              ],
              edges: [
                {
                  source: 'Node One',
                  target: 'Node Two',
                  type: 'connects',
                  definitionNode: {
                    name: 'connects',
                    color: '#708090',
                    description: ''
                  }
                }
              ]
            })
          })
        })]
      })
    }));

    expect(result).toEqual({
      nodesAdded: 2,
      edgesAdded: 1,
      goalId: 'mock-goal-id'
    });
  });

  it('throws error when nodes array is empty', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({ nodes: [] }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('nodes array is required');
  });

  it('throws error when nodes is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({}, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('nodes array is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      expandGraph({ nodes: [{ name: 'Node One' }] }, graphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('No active graph');
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

    expect(result.edgesAdded).toBe(0);
  });

  it('calls ensureSchedulerStarted callback', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expandGraph(
      { nodes: [{ name: 'Node One' }] },
      graphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(mockEnsureSchedulerStarted).toHaveBeenCalledTimes(1);
  });
});

