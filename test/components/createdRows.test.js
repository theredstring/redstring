import { describe, it, expect } from 'vitest';
import { resolveRows } from '../../src/components/wizard/createdRows.js';

const web = (id, definer, placed = []) => [id, {
  id, name: id, definingNodeIds: [definer],
  instances: new Map(placed.map((protoId, i) => [`${id}-i${i}`, { prototypeId: protoId }])),
}];
const thing = (id) => [id, { id, name: id, definitionGraphIds: [] }];

describe('createdRows', () => {
  it('leads with the outermost web a call made, not the first the store gained', () => {
    // A formula: the store gains the inner part's web, then the outer part's,
    // then the equation's, whose web holds the outer part, which holds the inner.
    const state = {
      graphs: new Map([
        web('inner-web', 'inner', ['b', 'c']),
        web('outer-web', 'outer', ['a', 'inner']),
        web('eq-web', 'eq', ['x', 'outer']),
        web('other-web', 'other'),
      ]),
      nodePrototypes: new Map(['inner', 'outer', 'eq', 'other', 'a', 'b', 'c', 'x'].map(thing)),
      edges: new Map(),
      activeGraphId: null,
    };
    const rows = resolveRows({ webs: ['inner-web', 'outer-web', 'other-web', 'eq-web'] }, state);
    expect(rows.map(r => r.id)).toEqual(['other-web', 'eq-web', 'outer-web', 'inner-web']);
  });
});
