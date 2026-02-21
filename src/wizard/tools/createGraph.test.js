/**
 * Tests for createGraph tool
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGraph } from './createGraph.js';

describe('createGraph', () => {
  const mockCid = 'test-cid-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a graph spec with action, graphId, and graphName', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createGraph(
      { name: 'Test Graph' },
      graphState,
      mockCid,
      null
    );

    expect(result.action).toBe('createGraph');
    expect(result.graphId).toMatch(/^graph-/);
    expect(result.graphName).toBe('Test Graph');
    expect(result.description).toBe('');
    expect(result.goalId).toBeNull();
  });

  it('throws error when name is missing', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    await expect(
      createGraph({}, graphState, mockCid, null)
    ).rejects.toThrow('name is required');
  });

  it('includes description when provided', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result = await createGraph(
      { name: 'Test Graph', description: 'A test description' },
      graphState,
      mockCid,
      null
    );

    expect(result.description).toBe('A test description');
  });

  it('generates unique graph IDs', async () => {
    const graphState = {
      graphs: [],
      nodePrototypes: []
    };

    const result1 = await createGraph({ name: 'Graph 1' }, graphState, mockCid, null);
    const result2 = await createGraph({ name: 'Graph 2' }, graphState, mockCid, null);

    expect(result1.graphId).not.toBe(result2.graphId);
  });
});
