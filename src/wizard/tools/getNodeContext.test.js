/**
 * Tests for getNodeContext tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getNodeContext } from './getNodeContext.js';

describe('getNodeContext', () => {
  const mockGraphState = {
    activeGraphId: 'graph-1',
    graphs: [
      {
        id: 'graph-1',
        name: 'Test Graph',
        edgeIds: ['edge-1', 'edge-2']
      }
    ],
    nodePrototypes: [
      { id: 'proto-1', name: 'Node One', color: '#FF0000', description: 'First node' },
      { id: 'proto-2', name: 'Node Two', color: '#00FF00', description: 'Second node' },
      { id: 'proto-3', name: 'Node Three', color: '#0000FF', description: 'Third node' }
    ],
    edges: [
      {
        id: 'edge-1',
        sourceId: 'proto-1',
        destinationId: 'proto-2',
        name: 'connects'
      },
      {
        id: 'edge-2',
        sourceId: 'proto-2',
        destinationId: 'proto-3',
        name: 'relates'
      }
    ]
  };

  const mockCid = 'test-cid-123';
  const mockEnsureSchedulerStarted = () => {};

  it('returns node and its neighbors', async () => {
    const result = await getNodeContext(
      { nodeId: 'proto-1' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.node).toEqual({
      id: 'proto-1',
      name: 'Node One',
      color: '#FF0000',
      description: 'First node'
    });

    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0]).toEqual({
      id: 'proto-2',
      name: 'Node Two',
      relationship: 'connects'
    });
  });

  it('finds neighbors in both directions', async () => {
    const result = await getNodeContext(
      { nodeId: 'proto-2' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.neighbors).toHaveLength(2);
    expect(result.neighbors.some(n => n.id === 'proto-1')).toBe(true);
    expect(result.neighbors.some(n => n.id === 'proto-3')).toBe(true);
  });

  it('throws error when nodeId is missing', async () => {
    await expect(
      getNodeContext({}, mockGraphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('nodeId is required');
  });

  it('throws error when node not found', async () => {
    await expect(
      getNodeContext({ nodeId: 'non-existent' }, mockGraphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('Node non-existent not found');
  });

  it('handles empty neighbors', async () => {
    const isolatedGraphState = {
      activeGraphId: 'graph-1',
      graphs: [
        {
          id: 'graph-1',
          name: 'Test Graph',
          edgeIds: []
        }
      ],
      nodePrototypes: [
        { id: 'proto-1', name: 'Isolated Node', color: '#FF0000', description: 'No connections' }
      ],
      edges: []
    };

    const result = await getNodeContext(
      { nodeId: 'proto-1' },
      isolatedGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.neighbors).toEqual([]);
  });

  it('handles edges array format', async () => {
    const arrayEdgesState = {
      ...mockGraphState,
      edges: [
        {
          id: 'edge-1',
          sourceId: 'proto-1',
          destinationId: 'proto-2',
          name: 'connects'
        }
      ]
    };

    const result = await getNodeContext(
      { nodeId: 'proto-1' },
      arrayEdgesState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.neighbors.length).toBeGreaterThan(0);
  });

  it('handles missing active graph gracefully', async () => {
    const noActiveGraphState = {
      graphs: [],
      nodePrototypes: [
        { id: 'proto-1', name: 'Node One', color: '#FF0000', description: 'First node' }
      ],
      edges: []
    };

    const result = await getNodeContext(
      { nodeId: 'proto-1' },
      noActiveGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.node).toBeDefined();
    expect(result.neighbors).toEqual([]);
  });

  it('only includes neighbors that exist in nodePrototypes', async () => {
    const stateWithMissingNeighbor = {
      activeGraphId: 'graph-1',
      graphs: [
        {
          id: 'graph-1',
          name: 'Test Graph',
          edgeIds: ['edge-1']
        }
      ],
      nodePrototypes: [
        { id: 'proto-1', name: 'Node One', color: '#FF0000', description: 'First node' }
      ],
      edges: [
        {
          id: 'edge-1',
          sourceId: 'proto-1',
          destinationId: 'proto-missing',
          name: 'connects'
        }
      ]
    };

    const result = await getNodeContext(
      { nodeId: 'proto-1' },
      stateWithMissingNeighbor,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.neighbors).toEqual([]);
  });
});

