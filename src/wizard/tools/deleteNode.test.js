/**
 * Tests for deleteNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deleteNode } from './deleteNode.js';

describe('deleteNode', () => {
  const mockCid = 'test-cid-123';

  const graphStateWithNode = {
    activeGraphId: 'graph-1',
    graphs: [{
      id: 'graph-1',
      name: 'Test Graph',
      instances: [
        { id: 'inst-1', prototypeId: 'proto-1', name: 'Temp Node' }
      ]
    }],
    nodePrototypes: [
      { id: 'proto-1', name: 'Temp Node' }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves node by name and returns delete spec', async () => {
    const result = await deleteNode(
      { nodeName: 'Temp Node' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.action).toBe('deleteNode');
    expect(result.graphId).toBe('graph-1');
    expect(result.instanceId).toBe('inst-1');
    expect(result.name).toBe('Temp Node');
    expect(result.deleted).toBe(true);
  });

  it('supports fuzzy name matching', async () => {
    const result = await deleteNode(
      { nodeName: 'temp node' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.instanceId).toBe('inst-1');
  });

  it('throws error when nodeName is missing', async () => {
    await expect(
      deleteNode({}, graphStateWithNode, mockCid, null)
    ).rejects.toThrow('nodeName is required');
  });

  it('returns soft result when node not found (delegates to client)', async () => {
    const result = await deleteNode(
      { nodeName: 'Nonexistent' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.action).toBe('deleteNode');
    expect(result.instanceId).toBeNull();
    expect(result.prototypeId).toBeNull();
    expect(result.name).toBe('Nonexistent');
    expect(result.deleted).toBe(false);
    expect(result.notFound).toBe(true);
  });

  it('throws error when no active graph', async () => {
    await expect(
      deleteNode({ nodeName: 'Temp' }, { graphs: [], nodePrototypes: [] }, mockCid, null)
    ).rejects.toThrow('No target graph specified and no active graph available');
  });

  it('falls back to nodeId param for backward compat', async () => {
    const result = await deleteNode(
      { nodeId: 'Temp Node' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.instanceId).toBe('inst-1');
  });

  describe('exact instances only', () => {
    const state = () => ({
      activeGraphId: 'graph-1',
      graphs: [
        {
          id: 'graph-1',
          name: 'Signals',
          instances: [
            { id: 'inst-a', prototypeId: 'proto-rate', x: 10, y: 20 },
            { id: 'inst-b', prototypeId: 'proto-rate', x: 300, y: 40 },
            { id: 'inst-s', prototypeId: 'proto-sampling', x: 50, y: 60 }
          ],
          edgeIds: ['e1', 'e2']
        },
        { id: 'graph-2', name: 'Elsewhere', instances: [{ id: 'inst-far', prototypeId: 'proto-far' }] }
      ],
      nodePrototypes: [
        { id: 'proto-rate', name: 'Bit Rate' },
        { id: 'proto-sampling', name: 'Sampling Rate' },
        { id: 'proto-far', name: 'Far Thing' }
      ],
      edges: [
        { id: 'e1', sourceId: 'inst-a', destinationId: 'inst-s' },
        { id: 'e2', sourceId: 'inst-s', destinationId: 'inst-a' }
      ]
    });

    it('deletes exactly the instance named by instanceId', async () => {
      const result = await deleteNode({ instanceId: 'inst-b' }, state(), mockCid, null);
      expect(result.action).toBe('deleteNode');
      expect(result.instanceId).toBe('inst-b');
      expect(result.name).toBe('Bit Rate');
      expect(result.graphId).toBe('graph-1');
    });

    it('finds an instanceId in its own web when no targetGraphId is given', async () => {
      const result = await deleteNode({ instanceId: 'inst-far' }, state(), mockCid, null);
      expect(result.action).toBe('deleteNode');
      expect(result.graphId).toBe('graph-2');
    });

    it('returns candidates and no action when an exact name is several instances', async () => {
      const result = await deleteNode({ nodeName: 'Bit Rate' }, state(), mockCid, null);
      expect(result.action).toBeUndefined();
      expect(result.ambiguous).toBe(true);
      expect(result.candidates).toEqual([
        { instanceId: 'inst-a', name: 'Bit Rate', x: 10, y: 20, edgeCount: 2 },
        { instanceId: 'inst-b', name: 'Bit Rate', x: 300, y: 40, edgeCount: 0 }
      ]);
      expect(result.message).toContain('instanceId');
    });

    it('never deletes on a substring match', async () => {
      const result = await deleteNode({ nodeName: 'Sampling' }, state(), mockCid, null);
      expect(result.action).toBeUndefined();
      expect(result.deleted).toBe(false);
      expect(result.candidates.map(c => c.name)).toEqual(['Sampling Rate']);
      expect(result.message).toContain('exact name or instanceId');
    });

    it('does not delete "Sampling Rate" when asked for "Rate"', async () => {
      const s = state();
      s.graphs[0].instances = s.graphs[0].instances.filter(i => i.prototypeId !== 'proto-rate');
      const result = await deleteNode({ nodeName: 'Rate' }, s, mockCid, null);
      expect(result.action).toBeUndefined();
      expect(result.deleted).toBe(false);
    });

    it('says so when targetGraphId names no web', async () => {
      await expect(
        deleteNode({ nodeName: 'Bit Rate', targetGraphId: 'Nowhere' }, state(), mockCid, null)
      ).rejects.toThrow('No web named or with id "Nowhere"');
    });
  });
});
