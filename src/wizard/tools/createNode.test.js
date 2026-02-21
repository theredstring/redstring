/**
 * Tests for createNode tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNode } from './createNode.js';

describe('createNode', () => {
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns action spec with correct fields', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [{ id: 'graph-1', name: 'Test Graph' }],
      nodePrototypes: []
    };

    const result = await createNode(
      { name: 'Test Node', color: '#FF0000', description: 'A test node' },
      graphState,
      mockCid,
      null
    );

    expect(result.action).toBe('createNode');
    expect(result.graphId).toBe('graph-1');
    expect(result.name).toBe('Test Node');
    expect(result.color).toBe('#FF0000');
    expect(result.description).toBe('A test node');
  });

  it('uses default color when not provided', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      null
    );

    expect(result.color).toBe('#5B6CFF');
  });

  it('uses empty description when not provided', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    const result = await createNode(
      { name: 'Test Node' },
      graphState,
      mockCid,
      null
    );

    expect(result.description).toBe('');
  });

  it('throws error when name is missing', async () => {
    const graphState = {
      activeGraphId: 'graph-1',
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createNode({}, graphState, mockCid, null)
    ).rejects.toThrow('name is required');
  });

  it('throws error when no active graph', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createNode({ name: 'Test Node' }, graphState, mockCid, null)
    ).rejects.toThrow('No active graph');
  });
});
