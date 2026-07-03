import { describe, it, expect } from 'vitest';
import useGraphStore from '../src/store/graphStore.js';

describe('Abstraction add flow uses prototypeId and reuses existing nodes', () => {
  it('inserts new node relative to existing focused prototype without duplicating it', () => {
    const store = useGraphStore.getState();

    // Create two prototypes A (owner) and B (focused)
    const A = 'proto-owner';
    const B = 'proto-focused';
    store.addNodePrototype({ id: A, name: 'A', color: '#800000', typeNodeId: 'base-thing-prototype', definitionGraphIds: [] });
    store.addNodePrototype({ id: B, name: 'B', color: '#700000', typeNodeId: 'base-thing-prototype', definitionGraphIds: [] });

    // Initialize owner chain with [A, B]
    store.addToAbstractionChain(A, 'Physical', 'below', B, A);

    // Now add C below B using B's prototypeId as the focused id
    const C = 'proto-new';
    store.addNodePrototype({ id: C, name: 'C', color: '#600000', typeNodeId: 'base-thing-prototype', definitionGraphIds: [] });
    store.addToAbstractionChain(A, 'Physical', 'below', C, B);

    const current = useGraphStore.getState();
    const chain = current.nodePrototypes.get(A)?.abstractionChains?.Physical || [];

    expect(chain).toEqual([A, B, C]);
    // Ensure B was not duplicated
    const occurrencesOfB = chain.filter(id => id === B).length;
    expect(occurrencesOfB).toBe(1);
  });
});


