import { describe, it, expect } from 'vitest';
import { diffCreatedEntities, mergeCreatedEntities, hasCreatedEntities } from './wizardCreatedEntities.js';

const graph = (id, instances, extra = {}) => ({ id, instances: new Map(instances.map(i => [i.id, i])), ...extra });

describe('diffCreatedEntities', () => {
  const existingThing = { id: 'p-old', name: 'Old' };
  const oldGraph = graph('g-old', [{ id: 'i-1', prototypeId: 'p-old' }]);
  const before = {
    graphs: new Map([['g-old', oldGraph]]),
    nodePrototypes: new Map([['p-old', existingThing]]),
    edges: new Map()
  };

  it('finds nothing when nothing changed', () => {
    expect(hasCreatedEntities(diffCreatedEntities(before, before))).toBe(false);
  });

  it('records new webs, placed Things (reused ones too), and new connections', () => {
    const after = {
      graphs: new Map([
        ['g-old', graph('g-old', [{ id: 'i-1', prototypeId: 'p-old' }, { id: 'i-2', prototypeId: 'p-old' }, { id: 'i-3', prototypeId: 'p-new' }], { edgeIds: ['e-1'] })],
        ['g-new', graph('g-new', [], { definingNodeIds: ['p-definer'] })]
      ]),
      nodePrototypes: new Map([
        ['p-old', existingThing],
        ['p-new', { id: 'p-new' }],
        ['p-definer', { id: 'p-definer' }],
        ['p-type', { id: 'p-type' }],
        ['p-rel', { id: 'p-rel' }]
      ]),
      edges: new Map([['e-1', { id: 'e-1', sourceId: 'i-2', destinationId: 'i-3', definitionNodeIds: ['p-rel'] }]])
    };
    const created = diffCreatedEntities(before, after);
    expect(created.webs).toEqual(['g-new']);
    expect(created.connections).toEqual([{ id: 'e-1', graphId: 'g-old' }]);
    // The web's definer and the connection's type are shown by those rows.
    expect(created.things).toEqual(['p-old', 'p-new', 'p-type']);
  });

  it('merges two passes of the same call', () => {
    const merged = mergeCreatedEntities(
      { webs: ['a'], things: ['t'], connections: [{ id: 'c', graphId: 'g' }] },
      { webs: ['a', 'b'], things: [], connections: [{ id: 'c', graphId: 'g' }, { id: 'd', graphId: 'g' }] }
    );
    expect(merged).toEqual({ webs: ['a', 'b'], things: ['t'], connections: [{ id: 'c', graphId: 'g' }, { id: 'd', graphId: 'g' }] });
  });
});
