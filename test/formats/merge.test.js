import { describe, it, expect } from 'vitest';
import { mergeUniverses } from '../../src/formats/mergeUniverses.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const proto = (id, name, extras = {}) => [id, {
  id, name, description: '', color: '#800000',
  externalLinks: [], definitionGraphIds: [],
  ...extras,
}];

const graph = (id, name = `Graph ${id}`) => [id, { id, name, description: '', nodeIds: [], edgeIds: [], definingNodeIds: [], instances: new Map() }];

const edge = (id, src, dst) => [id, { id, sourceId: src, destinationId: dst }];

const state = ({ protos = [], graphs = [], edges = [] } = {}) => ({
  nodePrototypes:       new Map(protos),
  graphs:               new Map(graphs),
  edges:                new Map(edges),
  openGraphIds:         [],
  activeGraphId:        null,
  expandedGraphIds:     new Set(),
  savedNodeIds:         new Set(),
  savedGraphIds:        new Set(),
  rightPanelTabs:       [],
  showConnectionNames:  false,
  activeDefinitionNodeId: null,
});

// ---------------------------------------------------------------------------
// Alignment class 1 — exact ID match
// ---------------------------------------------------------------------------

describe('P5.4 — alignment class 1: exact ID match', () => {
  it('identical prototypes deduplicate silently', () => {
    const base = state({ protos: [proto('dog', 'Dog')] });
    const inc  = state({ protos: [proto('dog', 'Dog')] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(merged.nodePrototypes.size).toBe(1);
    expect(report.dedupedIds).toContain('dog');
    expect(report.mergedIds).toHaveLength(0);
    expect(report.closeMatchCandidates).toHaveLength(0);
  });

  it('base scalar wins on conflict; incoming value goes to _preserved.merge', () => {
    const base = state({ protos: [proto('dog', 'Dog', { color: '#ff0000' })] });
    const inc  = state({ protos: [proto('dog', 'Dog', { color: '#00ff00' })] });
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('dog');
    expect(p.color).toBe('#ff0000');
    expect(p._preserved?.merge?.color).toBe('#00ff00');
  });

  it('non-conflicting scalar from incoming IS merged', () => {
    const base = state({ protos: [proto('dog', 'Dog', { description: '' })] });
    const inc  = state({ protos: [proto('dog', 'Dog', { description: 'A domestic canine' })] });
    const { merged } = mergeUniverses(base, inc);
    // '' vs 'A domestic canine' — incoming wins because base is empty string.
    // ('' is falsy; per mergePrototype: iv !== bv && iv !== null → bank base, set incoming)
    // Actually the rule is: base wins always. '' vs 'A domestic...' is still a conflict.
    const p = merged.nodePrototypes.get('dog');
    expect(p.description).toBe('');
    expect(p._preserved?.merge?.description).toBe('A domestic canine');
  });

  it('externalLinks are unioned across exact-ID match', () => {
    const base = state({ protos: [proto('dog', 'Dog', { externalLinks: ['https://wd.example/Q144'] })] });
    const inc  = state({ protos: [proto('dog', 'Dog', { externalLinks: ['https://dbpedia.example/Dog'] })] });
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('dog');
    expect(p.externalLinks).toContain('https://wd.example/Q144');
    expect(p.externalLinks).toContain('https://dbpedia.example/Dog');
  });
});

// ---------------------------------------------------------------------------
// Alignment class 2 — externalLinks (sameAs) overlap
// ---------------------------------------------------------------------------

describe('P5.4 — alignment class 2: externalLinks overlap', () => {
  it('shared externalLink detected → incoming merged into base prototype', () => {
    const SHARED = 'https://www.wikidata.org/entity/Q144';
    const base = state({ protos: [proto('dog-base', 'Dog', { externalLinks: [SHARED] })] });
    const inc  = state({ protos: [proto('dog-inc',  'Dog', { externalLinks: [SHARED] })] });
    const { merged, report } = mergeUniverses(base, inc);
    // The incoming 'dog-inc' should merge INTO 'dog-base'; no new prototype added.
    expect(merged.nodePrototypes.has('dog-base')).toBe(true);
    expect(merged.nodePrototypes.has('dog-inc')).toBe(false);
    expect(report.mergedIds).toHaveLength(1);
    expect(report.mergedIds[0]).toEqual({ baseId: 'dog-base', incomingId: 'dog-inc' });
  });

  it('merged prototype has union of externalLinks', () => {
    const SHARED = 'https://www.wikidata.org/entity/Q144';
    const EXTRA  = 'https://dbpedia.example/Dog';
    const base = state({ protos: [proto('dog-base', 'Dog', { externalLinks: [SHARED] })] });
    const inc  = state({ protos: [proto('dog-inc',  'Dog', { externalLinks: [SHARED, EXTRA] })] });
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('dog-base');
    expect(p.externalLinks).toContain(SHARED);
    expect(p.externalLinks).toContain(EXTRA);
  });

  it('scalar conflict still preserved in _preserved.merge', () => {
    const SHARED = 'https://wd.example/Q144';
    const base = state({ protos: [proto('a', 'Dog', { color: '#111', externalLinks: [SHARED] })] });
    const inc  = state({ protos: [proto('b', 'Dog', { color: '#222', externalLinks: [SHARED] })] });
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('a');
    expect(p.color).toBe('#111');
    expect(p._preserved?.merge?.color).toBe('#222');
  });
});

// ---------------------------------------------------------------------------
// Alignment class 3 — name equality → closeMatchCandidates
// ---------------------------------------------------------------------------

describe('P5.4 — alignment class 3: case-insensitive name match', () => {
  it('same name (different ID, no shared externalLink) → closeMatchCandidates', () => {
    const base = state({ protos: [proto('dog-1', 'Dog')] });
    const inc  = state({ protos: [proto('dog-2', 'Dog')] });
    const { merged, report } = mergeUniverses(base, inc);
    // Both prototypes survive (user decides).
    expect(merged.nodePrototypes.size).toBe(2);
    expect(report.closeMatchCandidates).toHaveLength(1);
    expect(report.closeMatchCandidates[0]).toMatchObject({
      baseId: 'dog-1',
      incomingId: 'dog-2',
      baseName: 'Dog',
      incomingName: 'Dog',
    });
  });

  it('case-insensitive match detected ("dog" vs "Dog")', () => {
    const base = state({ protos: [proto('a', 'dog')] });
    const inc  = state({ protos: [proto('b', 'Dog')] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(report.closeMatchCandidates).toHaveLength(1);
    expect(merged.nodePrototypes.size).toBe(2);
  });

  it('name match does NOT produce a mergedIds entry', () => {
    const base = state({ protos: [proto('a', 'Cat')] });
    const inc  = state({ protos: [proto('b', 'Cat')] });
    const { report } = mergeUniverses(base, inc);
    expect(report.mergedIds).toHaveLength(0);
    expect(report.dedupedIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No-silent-loss invariant
// ---------------------------------------------------------------------------

describe('P5.4 — no-silent-loss rule', () => {
  it('every scalar conflict ends up in _preserved.merge, none disappear', () => {
    const base = state({ protos: [
      proto('x', 'X', { color: '#aaa', description: 'base-desc' }),
    ]});
    const inc  = state({ protos: [
      proto('x', 'X', { color: '#bbb', description: 'inc-desc'  }),
    ]});
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('x');
    expect(p._preserved.merge.color).toBe('#bbb');
    expect(p._preserved.merge.description).toBe('inc-desc');
  });

  it('second merge accumulates _preserved.merge without overwriting earlier banked values', () => {
    const base = state({ protos: [proto('x', 'X', { color: '#aaa' })] });
    const inc1 = state({ protos: [proto('x', 'X', { color: '#bbb' })] });
    const inc2 = state({ protos: [proto('x', 'X', { color: '#ccc' })] });
    const { merged: m1 } = mergeUniverses(base, inc1);
    const { merged: m2 } = mergeUniverses(m1,   inc2);
    const p = m2.nodePrototypes.get('x');
    expect(p.color).toBe('#aaa');
    expect([p._preserved.merge.color].flat()).toContain('#bbb');
    expect([p._preserved.merge.color].flat()).toContain('#ccc');
  });
});

// ---------------------------------------------------------------------------
// Graphs and edges
// ---------------------------------------------------------------------------

describe('P5.4 — graphs and edges union', () => {
  it('new graphs from incoming are added to merged', () => {
    const base = state({ graphs: [graph('g1')] });
    const inc  = state({ graphs: [graph('g2')] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(merged.graphs.size).toBe(2);
    expect(report.addedGraphIds).toContain('g2');
  });

  it('duplicate graph IDs keep base graph SCALARS and report the union', () => {
    const base = state({ graphs: [['g1', { id: 'g1', name: 'Base Graph' }]] });
    const inc  = state({ graphs: [['g1', { id: 'g1', name: 'Incoming Graph' }]] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(merged.graphs.size).toBe(1);
    expect(merged.graphs.get('g1').name).toBe('Base Graph');
    expect(report.addedGraphIds).toHaveLength(0);
    expect(report.mergedGraphIds).toContain('g1');
  });

  it('new edges from incoming are added to merged', () => {
    const base = state({ edges: [edge('e1', 'a', 'b')] });
    const inc  = state({ edges: [edge('e2', 'b', 'c')] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(merged.edges.size).toBe(2);
    expect(report.addedEdgeIds).toContain('e2');
  });

  it('duplicate edge IDs keep base edge', () => {
    const base = state({ edges: [['e1', { id: 'e1', label: 'base' }]] });
    const inc  = state({ edges: [['e1', { id: 'e1', label: 'incoming' }]] });
    const { merged } = mergeUniverses(base, inc);
    expect(merged.edges.get('e1').label).toBe('base');
  });
});

// ---------------------------------------------------------------------------
// Empty / identity cases
// ---------------------------------------------------------------------------

describe('P5.4 — identity and empty cases', () => {
  it('merging empty states returns empty state', () => {
    const { merged } = mergeUniverses(state(), state());
    expect(merged.nodePrototypes.size).toBe(0);
    expect(merged.graphs.size).toBe(0);
  });

  it('merging non-empty base with empty incoming returns base prototypes', () => {
    const base = state({ protos: [proto('dog', 'Dog'), proto('cat', 'Cat')] });
    const { merged } = mergeUniverses(base, state());
    expect(merged.nodePrototypes.size).toBe(2);
  });

  it('merging empty base with non-empty incoming adds all prototypes', () => {
    const inc = state({ protos: [proto('dog', 'Dog'), proto('cat', 'Cat')] });
    const { merged } = mergeUniverses(state(), inc);
    expect(merged.nodePrototypes.size).toBe(2);
  });

  it('report has zero entries when there are no overlaps or conflicts', () => {
    const base = state({ protos: [proto('dog', 'Dog')], graphs: [graph('g1')], edges: [edge('e1', 'a', 'b')] });
    const inc  = state({ protos: [proto('cat', 'Cat')], graphs: [graph('g2')], edges: [edge('e2', 'b', 'c')] });
    const { report } = mergeUniverses(base, inc);
    expect(report.dedupedIds).toHaveLength(0);
    expect(report.mergedIds).toHaveLength(0);
    expect(report.closeMatchCandidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Referential integrity after a class-2 (sameAs) fold
//
// Class 2 folds an incoming prototype into a base one and never adds the
// incoming id, so anything still naming that id would point at a prototype
// that does not exist.
// ---------------------------------------------------------------------------

const WIKI_DOG = 'https://www.wikidata.org/wiki/Q144';

const graphWith = (id, { instances = [], edgeIds = [], definingNodeIds = [], groups = [], ...rest } = {}) => [id, {
  id, name: `Graph ${id}`, description: '', nodeIds: [], edgeIds, definingNodeIds,
  instances: new Map(instances), groups: new Map(groups), ...rest,
}];

const instance = (instanceId, prototypeId, extras = {}) => [instanceId, { id: instanceId, prototypeId, x: 0, y: 0, ...extras }];

describe('P5.4 — sameAs fold leaves no dangling prototype references', () => {
  const baseSide = () => state({ protos: [proto('base-dog', 'Dog', { externalLinks: [WIKI_DOG] })] });

  it('instance.prototypeId is rewritten to the surviving prototype', () => {
    const inc = state({
      protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] })],
      graphs: [graphWith('g1', { instances: [instance('i1', 'inc-dog')] })],
    });
    const { merged } = mergeUniverses(baseSide(), inc);

    expect(merged.nodePrototypes.has('inc-dog')).toBe(false);
    expect(merged.graphs.get('g1').instances.get('i1').prototypeId).toBe('base-dog');
  });

  it('every instance in the merged result points at a prototype that exists', () => {
    const inc = state({
      protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] }), proto('inc-cat', 'Cat')],
      graphs: [graphWith('g1', { instances: [instance('i1', 'inc-dog'), instance('i2', 'inc-cat')] })],
    });
    const { merged } = mergeUniverses(baseSide(), inc);

    for (const graph of merged.graphs.values()) {
      for (const inst of graph.instances.values()) {
        expect(merged.nodePrototypes.has(inst.prototypeId)).toBe(true);
      }
    }
  });

  it('graph.definingNodeIds is rewritten', () => {
    const inc = state({
      protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] })],
      graphs: [graphWith('g1', { definingNodeIds: ['inc-dog'] })],
    });
    const { merged } = mergeUniverses(baseSide(), inc);
    expect(merged.graphs.get('g1').definingNodeIds).toEqual(['base-dog']);
  });

  it('edge.typeNodeId is rewritten but sourceId/destinationId are NOT', () => {
    const inc = state({
      protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] })],
      edges: [['e1', { id: 'e1', sourceId: 'inc-dog', destinationId: 'i2', typeNodeId: 'inc-dog' }]],
    });
    const { merged } = mergeUniverses(baseSide(), inc);
    const e = merged.edges.get('e1');

    expect(e.typeNodeId).toBe('base-dog');
    // sourceId/destinationId are INSTANCE ids; an instance that happens to share
    // a prototype's id must not be rewritten out from under the edge.
    expect(e.sourceId).toBe('inc-dog');
    expect(e.destinationId).toBe('i2');
  });

  it('prototype.typeNodeId is rewritten, including a forward reference', () => {
    // 'inc-thing' is processed BEFORE the fold that retires 'inc-dog', so this
    // only works because the remap is applied in a pass after the loop.
    const inc = state({
      protos: [
        proto('inc-thing', 'Thing', { typeNodeId: 'inc-dog' }),
        proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] }),
      ],
    });
    const { merged } = mergeUniverses(baseSide(), inc);
    expect(merged.nodePrototypes.get('inc-thing').typeNodeId).toBe('base-dog');
  });

  it('saved sets are unioned and remapped', () => {
    const base = state({ protos: [proto('base-dog', 'Dog', { externalLinks: [WIKI_DOG] })] });
    base.savedNodeIds = new Set(['base-dog']);
    const inc = state({ protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] }), proto('inc-cat', 'Cat')] });
    inc.savedNodeIds = new Set(['inc-dog', 'inc-cat']);

    const { merged } = mergeUniverses(base, inc);
    expect(merged.savedNodeIds).toEqual(new Set(['base-dog', 'inc-cat']));
  });
});

// ---------------------------------------------------------------------------
// Shared graphs union their contents
// ---------------------------------------------------------------------------

describe('P5.4 — foldSameAs: off keeps duplicates for the things-merge step', () => {
  const base = () => state({ protos: [proto('base-dog', 'Dog', { externalLinks: [WIKI_DOG] })] });
  const inc = () => state({
    protos: [proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] })],
    graphs: [graphWith('g1', { instances: [instance('i1', 'inc-dog')] })],
  });

  it('both prototypes survive and the pair is reported', () => {
    const { merged, report } = mergeUniverses(base(), inc(), { foldSameAs: false });

    expect(merged.nodePrototypes.has('base-dog')).toBe(true);
    expect(merged.nodePrototypes.has('inc-dog')).toBe(true);
    expect(report.mergedIds).toHaveLength(0);
    expect(report.sameAsCandidates).toEqual([
      { baseId: 'base-dog', incomingId: 'inc-dog', baseName: 'Dog', incomingName: 'Doggo' },
    ]);
  });

  it('references still resolve — a duplicate is fine, a broken pointer is not', () => {
    const { merged } = mergeUniverses(base(), inc(), { foldSameAs: false });
    const inst = merged.graphs.get('g1').instances.get('i1');

    expect(inst.prototypeId).toBe('inc-dog');
    expect(merged.nodePrototypes.has(inst.prototypeId)).toBe(true);
  });

  it('an exact ID collision still resolves — base wins, loser banked', () => {
    // This one cannot be deferred: a Map has one slot per key.
    const b = state({ protos: [proto('dog', 'Mine')] });
    const i = state({ protos: [proto('dog', 'Theirs')] });
    const { merged } = mergeUniverses(b, i, { foldSameAs: false });

    expect(merged.nodePrototypes.size).toBe(1);
    expect(merged.nodePrototypes.get('dog').name).toBe('Mine');
    expect(merged.nodePrototypes.get('dog')._preserved.merge.name).toBe('Theirs');
  });

  it('defaults to folding when no option is passed', () => {
    const { report } = mergeUniverses(base(), inc());
    expect(report.mergedIds).toHaveLength(1);
    expect(report.sameAsCandidates).toHaveLength(0);
  });
});

describe('P5.4 — same-ID graphs union their contents', () => {
  it('instances from both sides survive; base wins on a shared instance id', () => {
    const base = state({ graphs: [graphWith('g1', { instances: [instance('i1', 'p1', { x: 10 })] })] });
    const inc  = state({ graphs: [graphWith('g1', { instances: [instance('i1', 'p1', { x: 99 }), instance('i2', 'p2')] })] });
    const { merged } = mergeUniverses(base, inc);
    const g = merged.graphs.get('g1');

    expect([...g.instances.keys()].sort()).toEqual(['i1', 'i2']);
    expect(g.instances.get('i1').x).toBe(10);
  });

  it('edgeIds and groups union without duplicates', () => {
    const base = state({ graphs: [graphWith('g1', { edgeIds: ['e1', 'e2'], groups: [['gr1', { id: 'gr1' }]] })] });
    const inc  = state({ graphs: [graphWith('g1', { edgeIds: ['e2', 'e3'], groups: [['gr2', { id: 'gr2' }]] })] });
    const { merged } = mergeUniverses(base, inc);
    const g = merged.graphs.get('g1');

    expect(g.edgeIds).toEqual(['e1', 'e2', 'e3']);
    expect([...g.groups.keys()].sort()).toEqual(['gr1', 'gr2']);
  });
});

// ---------------------------------------------------------------------------
// Fields that used to be dropped on the floor
// ---------------------------------------------------------------------------

describe('P5.4 — edgePrototypes are merged', () => {
  it('incoming edge prototypes are carried over; base wins on a shared id', () => {
    const base = state();
    base.edgePrototypes = new Map([['base-connection-prototype', { id: 'base-connection-prototype', name: 'Connection' }]]);
    const inc = state();
    inc.edgePrototypes = new Map([
      ['base-connection-prototype', { id: 'base-connection-prototype', name: 'Overwritten' }],
      ['custom-rel', { id: 'custom-rel', name: 'Eats' }],
    ]);

    const { merged } = mergeUniverses(base, inc);
    expect(merged.edgePrototypes.get('custom-rel').name).toBe('Eats');
    expect(merged.edgePrototypes.get('base-connection-prototype').name).toBe('Connection');
  });
});

describe('P5.4 — abstractionChains survive a merge', () => {
  it('a dimension base does not have is taken from incoming', () => {
    const base = state({ protos: [proto('dog', 'Dog')] });
    const inc  = state({ protos: [proto('dog', 'Dog', { abstractionChains: { generalization: ['animal', 'dog'] } })] });
    const { merged } = mergeUniverses(base, inc);
    expect(merged.nodePrototypes.get('dog').abstractionChains.generalization).toEqual(['animal', 'dog']);
  });

  it('a conflicting chain keeps base and banks incoming (order is never invented)', () => {
    const base = state({ protos: [proto('dog', 'Dog', { abstractionChains: { generalization: ['animal', 'dog'] } })] });
    const inc  = state({ protos: [proto('dog', 'Dog', { abstractionChains: { generalization: ['mammal', 'dog'] } })] });
    const { merged } = mergeUniverses(base, inc);
    const p = merged.nodePrototypes.get('dog');

    expect(p.abstractionChains.generalization).toEqual(['animal', 'dog']);
    expect(p._preserved.merge.abstractionChains.generalization).toEqual([['mammal', 'dog']]);
  });

  it('prototype ids inside a chain are remapped through a sameAs fold', () => {
    const base = state({ protos: [proto('base-dog', 'Dog', { externalLinks: [WIKI_DOG] })] });
    const inc  = state({ protos: [
      proto('inc-dog', 'Doggo', { externalLinks: [WIKI_DOG] }),
      proto('pet', 'Pet', { abstractionChains: { generalization: ['inc-dog', 'pet'] } }),
    ] });
    const { merged } = mergeUniverses(base, inc);
    expect(merged.nodePrototypes.get('pet').abstractionChains.generalization).toEqual(['base-dog', 'pet']);
  });
});

describe('P5.4 — semanticMetadata survives a merge', () => {
  const withMeta = (id, meta) => proto(id, 'Dog', { semanticMetadata: meta });

  it('linkConfirmations are kept (they drive the exactMatch/closeMatch ladder)', () => {
    const base = state({ protos: [withMeta('dog', { linkConfirmations: { [WIKI_DOG]: 'exact' } })] });
    const inc  = state({ protos: [withMeta('dog', { linkConfirmations: { 'http://dbpedia.org/Dog': 'close' } })] });
    const { merged } = mergeUniverses(base, inc);
    expect(merged.nodePrototypes.get('dog').semanticMetadata.linkConfirmations).toEqual({
      [WIKI_DOG]: 'exact',
      'http://dbpedia.org/Dog': 'close',
    });
  });

  it('externalLinks union, relationships concat, confidence takes the max', () => {
    const base = state({ protos: [withMeta('dog', { externalLinks: ['a'], relationships: [{ r: 1 }], confidence: 0.4 })] });
    const inc  = state({ protos: [withMeta('dog', { externalLinks: ['a', 'b'], relationships: [{ r: 2 }], confidence: 0.9 })] });
    const { merged } = mergeUniverses(base, inc);
    const m = merged.nodePrototypes.get('dog').semanticMetadata;

    expect(m.externalLinks).toEqual(['a', 'b']);
    expect(m.relationships).toEqual([{ r: 1 }, { r: 2 }]);
    expect(m.confidence).toBe(0.9);
  });

  it('incoming metadata is adopted when base has none', () => {
    const base = state({ protos: [proto('dog', 'Dog')] });
    const inc  = state({ protos: [withMeta('dog', { confidence: 0.7 })] });
    const { merged } = mergeUniverses(base, inc);
    expect(merged.nodePrototypes.get('dog').semanticMetadata.confidence).toBe(0.7);
  });
});
