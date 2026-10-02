// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildMemoryIndex, recall, wander, tokenize } from '../../src/druid/recall.js';

/**
 * A small universe in the store's own shape (Maps, instances keyed by id,
 * edges between instance ids).
 *
 *   web "Water":   River —carves→ Valley,  River —feeds→ Delta
 *   web "River" (defines River): Current, Bank
 *   web "Elsewhere": Lighthouse
 */
function universe() {
  const proto = (id, name, description = '') => [id, { id, name, description, definitionGraphIds: [] }];
  const nodePrototypes = new Map([
    proto('base-thing-prototype', 'Thing'),
    proto('p-river', 'River', 'Moving water in a channel.'),
    proto('p-valley', 'Valley', 'Low land between hills.'),
    proto('p-delta', 'Delta', 'Sediment fan at a mouth.'),
    proto('p-current', 'Current', 'The flow inside the channel.'),
    proto('p-bank', 'Bank', 'The edge of the channel.'),
    proto('p-light', 'Lighthouse', 'A tower that warns ships.'),
    proto('p-carves', 'carves')
  ]);
  const inst = (id, prototypeId) => [id, { id, prototypeId }];
  const graphs = new Map([
    ['g-water', { id: 'g-water', name: 'Water', instances: new Map([inst('i1', 'p-river'), inst('i2', 'p-valley'), inst('i3', 'p-delta'), inst('i0', 'base-thing-prototype')]), edgeIds: ['e1', 'e2'], definingNodeIds: [] }],
    ['g-river', { id: 'g-river', name: 'River', instances: new Map([inst('i4', 'p-current'), inst('i5', 'p-bank')]), edgeIds: [], definingNodeIds: ['p-river'] }],
    ['g-else', { id: 'g-else', name: 'Elsewhere', instances: new Map([inst('i6', 'p-light')]), edgeIds: [], definingNodeIds: [] }]
  ]);
  const edges = new Map([
    ['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2', definitionNodeIds: ['p-carves'] }],
    ['e2', { id: 'e2', sourceId: 'i1', destinationId: 'i3', name: 'feeds' }]
  ]);
  return { graphs, nodePrototypes, edges };
}

describe('tokenize', () => {
  it('keeps content words and drops filler', () => {
    expect(tokenize('I think the River is about moving water')).toEqual(['river', 'moving', 'water']);
  });
});

describe('buildMemoryIndex', () => {
  it('links connections and part–whole, and leaves out the base types', () => {
    const idx = buildMemoryIndex(universe());
    expect(idx.nodes.has('base-thing-prototype')).toBe(false);
    expect(idx.links.get('p-river').get('p-valley')).toBe('carves');
    expect(idx.links.get('p-river').get('p-delta')).toBe('feeds');
    expect(idx.links.get('p-river').get('p-current')).toBe('inside River');
    expect(idx.links.get('p-bank').get('p-river')).toBe('inside River');
  });
});

describe('recall', () => {
  it('hands back what is adjacent to what is in mind, not what is already in mind', () => {
    const idx = buildMemoryIndex(universe());
    const got = recall(idx, 'I keep coming back to the River.');
    const names = got.map(m => m.name);
    expect(names).not.toContain('River');
    expect(names).toEqual(expect.arrayContaining(['Valley', 'Delta', 'Current', 'Bank']));
    expect(names).not.toContain('Lighthouse');
    expect(got.find(m => m.name === 'Valley').via).toBe('carves — via River');
  });

  it('surfaces a Thing whose description matches even when its name is not mentioned', () => {
    const idx = buildMemoryIndex(universe());
    const got = recall(idx, 'something about ships at night');
    expect(got[0].name).toBe('Lighthouse');
  });

  it('damps what surfaced recently so the same few do not come back every cycle', () => {
    const idx = buildMemoryIndex(universe());
    const fresh = recall(idx, 'River', { k: 1 });
    const damped = recall(idx, 'River', { k: 1, habituated: new Set([fresh[0].id]) });
    expect(damped[0].id).not.toBe(fresh[0].id);
  });

  it('returns nothing for an empty cue or an empty graph', () => {
    expect(recall(buildMemoryIndex(universe()), '')).toEqual([]);
    expect(recall(buildMemoryIndex({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map() }), 'River')).toEqual([]);
  });
});

describe('wander', () => {
  it('picks a memory not surfaced lately, and says where it came from', () => {
    const idx = buildMemoryIndex(universe());
    const all = [...idx.nodes.keys()];
    const habituated = new Set(all.filter(id => id !== 'p-light'));
    const w = wander(idx, () => 0.99, habituated);
    expect(w.name).toBe('Lighthouse');
    expect(w.via).toBe('drifted up from Elsewhere');
  });

  it('returns null for an empty graph', () => {
    expect(wander(buildMemoryIndex({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map() }))).toBeNull();
  });
});
