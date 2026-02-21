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
    expect(result.deleted).toBe(true);
  });

  it('throws error when no active graph', async () => {
    await expect(
      deleteNode({ nodeName: 'Temp' }, { graphs: [], nodePrototypes: [] }, mockCid, null)
    ).rejects.toThrow('No active graph');
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
});
