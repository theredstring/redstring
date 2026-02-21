/**
 * Tests for expandGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { expandGraph } from './expandGraph.js';

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
          { source: 'Node One', target: 'Node Two', type: 'connects' }
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
      description: 'First node'
    });
    expect(result.spec.nodes[1]).toEqual({
      name: 'Node Two',
      color: '#5B6CFF',
      description: ''
    });

    // Verify edge specs with title case and definitionNode
    expect(result.spec.edges[0].source).toBe('Node One');
    expect(result.spec.edges[0].target).toBe('Node Two');
    expect(result.spec.edges[0].type).toBe('Connects');
    expect(result.spec.edges[0].definitionNode).toBeDefined();
    expect(result.spec.edges[0].definitionNode.name).toBe('Connects');
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
