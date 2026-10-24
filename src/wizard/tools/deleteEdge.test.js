/**
 * Tests for deleteEdge tool
 */

import { describe, it, expect } from 'vitest';
import { deleteEdge } from './deleteEdge.js';

// A web "Main" with A, B, C and a box D whose definition web "Inside" holds X.
// Edges: A→B, A→C, A→B (second, different type), and A→X stored in Main with
// its far end in the definition's web (a connection into an open definition).
const makeState = () => ({
  activeGraphId: 'main',
  graphs: [
    {
      id: 'main',
      name: 'Main',
      instances: [
        { id: 'i-a', prototypeId: 'p-a' },
        { id: 'i-b', prototypeId: 'p-b' },
        { id: 'i-c', prototypeId: 'p-c' },
        { id: 'i-d', prototypeId: 'p-d' }
      ],
      edgeIds: ['e-ab', 'e-ac', 'e-ax']
    },
    {
      id: 'inside',
      name: 'Inside',
      instances: [{ id: 'i-x', prototypeId: 'p-x' }, { id: 'i-y', prototypeId: 'p-y' }],
      edgeIds: ['e-xy']
    }
  ],
  nodePrototypes: [
    { id: 'p-a', name: 'Alpha' },
    { id: 'p-b', name: 'Beta' },
    { id: 'p-c', name: 'Gamma' },
    { id: 'p-d', name: 'Box', definitionGraphIds: ['inside'] },
    { id: 'p-x', name: 'Xenon' },
    { id: 'p-y', name: 'Yttrium' }
  ],
  edges: [
    { id: 'e-ab', sourceId: 'i-a', destinationId: 'i-b', name: 'Feeds' },
    { id: 'e-ac', sourceId: 'i-a', destinationId: 'i-c', name: 'Feeds' },
    { id: 'e-ax', sourceId: 'i-a', destinationId: 'i-x', name: 'Reaches' },
    { id: 'e-xy', sourceId: 'i-x', destinationId: 'i-y', name: 'Binds' }
  ]
});

describe('deleteEdge', () => {
  it('uses a real edgeId as given, in the web that holds it', async () => {
    const result = await deleteEdge({ edgeId: 'e-xy' }, makeState());
    expect(result).toEqual({
      action: 'deleteEdge',
      graphId: 'inside',
      edgeId: 'e-xy',
      sourceName: 'Xenon',
      targetName: 'Yttrium',
      deleted: true
    });
  });

  it('skips the name checks when the edgeId is real, whatever names come with it', async () => {
    const result = await deleteEdge({ edgeId: 'e-ab', sourceName: 'Nonsense', targetName: 'Beta' }, makeState());
    expect(result.action).toBe('deleteEdge');
    expect(result.edgeId).toBe('e-ab');
    expect(result.graphId).toBe('main');
  });

  it('returns no action for an unknown edgeId with no names', async () => {
    const result = await deleteEdge({ edgeId: 'edge-made-up' }, makeState());
    expect(result.action).toBeUndefined();
    expect(result.deleted).toBe(false);
    expect(result.message).toContain("searchType: 'connections'");
  });

  it('resolves names to the one matching edge and passes its id', async () => {
    const result = await deleteEdge({ sourceName: 'alpha', targetName: 'GAMMA' }, makeState());
    expect(result.action).toBe('deleteEdge');
    expect(result.edgeId).toBe('e-ac');
    expect(result.sourceName).toBe('Alpha');
    expect(result.targetName).toBe('Gamma');
  });

  it('finds a connection into an open definition by the inner node\'s name', async () => {
    const result = await deleteEdge({ sourceName: 'Alpha', targetName: 'Xenon' }, makeState());
    expect(result.action).toBe('deleteEdge');
    expect(result.edgeId).toBe('e-ax');
    expect(result.graphId).toBe('main');
  });

  it('follows definitions opened in place when the state says which are open', async () => {
    const state = makeState();
    state.graphs[0].instances[3].openDefinition = { index: 0 };
    const result = await deleteEdge({ sourceName: 'Xenon', targetName: 'Yttrium' }, state);
    expect(result.action).toBe('deleteEdge');
    expect(result.edgeId).toBe('e-xy');
    expect(result.graphId).toBe('inside');
  });

  it('returns candidates and no action when names match several edges', async () => {
    const state = makeState();
    state.edges.push({ id: 'e-ab2', sourceId: 'i-b', destinationId: 'i-a', name: 'Starves' });
    state.graphs[0].edgeIds.push('e-ab2');
    const result = await deleteEdge({ sourceName: 'Alpha', targetName: 'Beta' }, state);
    expect(result.action).toBeUndefined();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.map(c => c.id).sort()).toEqual(['e-ab', 'e-ab2']);
    expect(result.candidates[0]).toEqual(expect.objectContaining({ sourceName: expect.any(String), targetName: expect.any(String), web: 'Main' }));
    expect(result.message).toContain('edgeId');
  });

  it('names the closest nodes, the node count and the search hint when a name is unknown', async () => {
    const result = await deleteEdge({ sourceName: 'Alpah', targetName: 'Beta' }, makeState());
    expect(result.action).toBeUndefined();
    expect(result.deleted).toBe(false);
    expect(result.message).toContain('"Alpha"');
    expect(result.message).toContain('4 nodes');
    expect(result.message).toContain("Pass edgeId from search (searchType: 'connections')");
    // Not the old "first 8 names" dump.
    expect(result.message).not.toContain('Available nodes');
  });

  it('lists the connections the named nodes do have when there is none between them', async () => {
    const result = await deleteEdge({ sourceName: 'Beta', targetName: 'Gamma' }, makeState());
    expect(result.action).toBeUndefined();
    expect(result.candidates.map(c => c.id).sort()).toEqual(['e-ab', 'e-ac']);
  });

  it('throws when neither edgeId nor names are given', async () => {
    await expect(deleteEdge({}, makeState())).rejects.toThrow('edgeId or sourceName/targetName is required');
  });

  it('throws when no active graph', async () => {
    await expect(
      deleteEdge({ edgeId: 'edge-1' }, { graphs: [], nodePrototypes: [] })
    ).rejects.toThrow('No target graph specified and no active graph available');
  });

  it('says so when targetGraphId names no web', async () => {
    await expect(
      deleteEdge({ sourceName: 'Alpha', targetName: 'Beta', targetGraphId: 'Nowhere' }, makeState())
    ).rejects.toThrow('No web named or with id "Nowhere"');
  });
});
