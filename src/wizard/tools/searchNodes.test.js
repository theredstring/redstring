/**
 * Tests for searchNodes tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { searchNodes } from './searchNodes.js';
import { search } from './search.js';

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

  it('returns all nodes when query is omitted', async () => {
    const result = await searchNodes({}, mockGraphState, mockCid, mockEnsureSchedulerStarted);

    expect(result.results).toBeDefined();
    expect(result.total).toBe(3);
    expect(result.returned).toBe(3);
    expect(result.message).toContain('Showing all');
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

describe('search scope', () => {
  // Two webs. "Zoo" holds two Persons and the Animal; "Garden" holds the Plant,
  // and a box in "Zoo" opens Garden's definition with an edge into it.
  const state = () => ({
    activeGraphId: 'zoo',
    graphs: [
      {
        id: 'zoo',
        name: 'Zoo',
        instances: [
          { id: 'i-p1', prototypeId: 'proto-1' },
          { id: 'i-p2', prototypeId: 'proto-1' },
          { id: 'i-a', prototypeId: 'proto-2' }
        ],
        edgeIds: ['e-into']
      },
      { id: 'garden', name: 'Garden', instances: [{ id: 'i-plant', prototypeId: 'proto-3' }], edgeIds: [] }
    ],
    nodePrototypes: [
      { id: 'proto-1', name: 'Person', description: 'A human being' },
      { id: 'proto-2', name: 'Animal', description: 'A living creature' },
      { id: 'proto-3', name: 'Plant', description: 'A living organism' }
    ],
    edges: [{ id: 'e-into', sourceId: 'i-a', destinationId: 'i-plant', name: 'Eats' }]
  });

  it('searches only the active web, by instance', async () => {
    const result = await searchNodes({}, state());
    expect(result.scope).toBe('web');
    expect(result.total).toBe(3);
    expect(result.results.map(r => r.id)).toEqual(['i-p1', 'i-p2', 'i-a']);
    expect(result.results[0].prototypeId).toBe('proto-1');
    expect(result.message).toContain('web "Zoo"');
  });

  it('keeps other webs out of a web search', async () => {
    const result = await searchNodes({ query: 'living' }, state());
    expect(result.results.map(r => r.name)).toEqual(['Animal']);
  });

  it('searches a named web', async () => {
    const result = await searchNodes({ targetGraphId: 'Garden' }, state());
    expect(result.results.map(r => r.id)).toEqual(['i-plant']);
  });

  it("searches every Thing with scope: 'universe'", async () => {
    const result = await searchNodes({ query: 'living', scope: 'universe' }, state());
    expect(result.scope).toBe('universe');
    expect(result.results.map(r => r.id).sort()).toEqual(['proto-2', 'proto-3']);
    expect(result.message).toContain('universe');
  });

  it('says so when targetGraphId names no web, instead of searching the active one', async () => {
    const result = await searchNodes({ query: 'Person', targetGraphId: 'Aquarium' }, state());
    expect(result.results).toEqual([]);
    expect(result.message).toContain('No web named or with id "Aquarium"');
  });

  it('names the far end of a connection into another web by its real name', async () => {
    const result = await search({ searchType: 'connections' }, state());
    expect(result.results[0]).toEqual(expect.objectContaining({ id: 'e-into', sourceName: 'Animal', targetName: 'Plant' }));
  });

  it('connection search says so when targetGraphId names no web', async () => {
    const result = await search({ searchType: 'connections', targetGraphId: 'Aquarium' }, state());
    expect(result.results).toEqual([]);
    expect(result.message).toContain('No web named or with id "Aquarium"');
  });
});











describe('search of a web with a definition opened in place', () => {
  // "Law" is shown open in "Sail": its Things stay in its own web and are seen in Sail.
  const state = () => ({
    activeGraphId: 'sail',
    graphs: [
      { id: 'sail', name: 'Sail', instances: [{ id: 'i-sail', prototypeId: 'p-sail' }, { id: 'i-law', prototypeId: 'p-law', openDefinition: { index: 0 } }] },
      { id: 'law', name: 'Law', instances: [{ id: 'i-r', prototypeId: 'p-r' }] }
    ],
    nodePrototypes: [
      { id: 'p-sail', name: 'Sail' },
      { id: 'p-law', name: 'Equilibrium Law', definitionGraphIds: ['law'] },
      { id: 'p-r', name: 'Reflectivity' }
    ],
    edges: []
  });

  it('finds the opened definition\'s Things, marked with what they are opened in', async () => {
    const result = await searchNodes({ query: 'Reflectivity' }, state());
    expect(result.results).toEqual([expect.objectContaining({ id: 'i-r', prototypeId: 'p-r', openedIn: 'Equilibrium Law' })]);
  });
});
