/**
 * Tests for updateNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateNode } from './updateNode.js';

describe('updateNode', () => {
  const mockCid = 'test-cid-123';

  const graphStateWithNode = {
    activeGraphId: 'graph-1',
    graphs: [{
      id: 'graph-1',
      name: 'Test Graph',
      instances: [
        { id: 'inst-1', prototypeId: 'proto-1', name: 'Alpha Node' }
      ]
    }],
    nodePrototypes: [
      { id: 'proto-1', name: 'Alpha Node', color: '#FF0000', description: 'Test' }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves node by name and returns update spec', async () => {
    const result = await updateNode(
      { nodeName: 'Alpha Node', name: 'Updated Name', color: '#00FF00', description: 'Updated desc' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.action).toBe('updateNode');
    expect(result.prototypeId).toBe('proto-1');
    expect(result.instanceId).toBe('inst-1');
    expect(result.updated).toBe(true);
    expect(result.updates).toEqual({
      name: 'Updated Name',
      color: '#00FF00',
      description: 'Updated desc'
    });
  });

  it('supports fuzzy name matching (case-insensitive)', async () => {
    const result = await updateNode(
      { nodeName: 'alpha node', name: 'New Name' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.prototypeId).toBe('proto-1');
  });

  it('only includes provided update fields', async () => {
    const result = await updateNode(
      { nodeName: 'Alpha Node', color: '#00FF00' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.updates).toEqual({ color: '#00FF00' });
    expect(result.updates.name).toBeUndefined();
  });

  it('throws error when nodeName is missing', async () => {
    await expect(
      updateNode({}, graphStateWithNode, mockCid, null)
    ).rejects.toThrow('nodeName is required');
  });

  it('throws error when node not found', async () => {
    await expect(
      updateNode({ nodeName: 'Nonexistent Node' }, graphStateWithNode, mockCid, null)
    ).rejects.toThrow('not found');
  });

  it('throws error when no active graph', async () => {
    await expect(
      updateNode({ nodeName: 'Alpha' }, { graphs: [], nodePrototypes: [] }, mockCid, null)
    ).rejects.toThrow('No active graph');
  });

  it('falls back to nodeId param for backward compat', async () => {
    const result = await updateNode(
      { nodeId: 'Alpha Node', name: 'New Name' },
      graphStateWithNode,
      mockCid,
      null
    );

    expect(result.prototypeId).toBe('proto-1');
  });
});
