/**
 * Tests for searchNodes tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { searchNodes } from './searchNodes.js';

describe('searchNodes', () => {
  const mockGraphState = {
    nodePrototypes: [
      { id: 'proto-1', name: 'Person', color: '#FF0000', description: 'A human being' },
      { id: 'proto-2', name: 'Animal', color: '#00FF00', description: 'A living creature' },
      { id: 'proto-3', name: 'Plant', color: '#0000FF', description: 'A living organism' }
    ]
  };

  const mockCid = 'test-cid-123';
  const mockEnsureSchedulerStarted = () => {};

  it('finds nodes by name', async () => {
    const result = await searchNodes(
      { query: 'Person' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('Person');
  });

  it('finds nodes by description', async () => {
    const result = await searchNodes(
      { query: 'living' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(r => r.name === 'Animal')).toBe(true);
    expect(result.results.some(r => r.name === 'Plant')).toBe(true);
  });

  it('is case insensitive', async () => {
    const result = await searchNodes(
      { query: 'PERSON' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('Person');
  });

  it('returns empty array when no matches', async () => {
    const result = await searchNodes(
      { query: 'NonExistent' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results).toEqual([]);
  });

  it('limits results to 20', async () => {
    const largeGraphState = {
      nodePrototypes: Array.from({ length: 30 }, (_, i) => ({
        id: `proto-${i}`,
        name: `Node ${i}`,
        color: '#FF0000',
        description: `Description ${i}`
      }))
    };

    const result = await searchNodes(
      { query: 'Node' },
      largeGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results.length).toBeLessThanOrEqual(20);
  });

  it('throws error when query is missing', async () => {
    await expect(
      searchNodes({}, mockGraphState, mockCid, mockEnsureSchedulerStarted)
    ).rejects.toThrow('query is required');
  });

  it('handles empty nodePrototypes array', async () => {
    const emptyGraphState = {
      nodePrototypes: []
    };

    const result = await searchNodes(
      { query: 'anything' },
      emptyGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results).toEqual([]);
  });

  it('returns correct node structure', async () => {
    const result = await searchNodes(
      { query: 'Person' },
      mockGraphState,
      mockCid,
      mockEnsureSchedulerStarted
    );

    expect(result.results[0]).toEqual({
      id: 'proto-1',
      name: 'Person',
      color: '#FF0000',
      description: 'A human being'
    });
  });
});

