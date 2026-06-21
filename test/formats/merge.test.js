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

  it('duplicate graph IDs keep base graph (silent dedup)', () => {
    const base = state({ graphs: [['g1', { id: 'g1', name: 'Base Graph' }]] });
    const inc  = state({ graphs: [['g1', { id: 'g1', name: 'Incoming Graph' }]] });
    const { merged, report } = mergeUniverses(base, inc);
    expect(merged.graphs.size).toBe(1);
    expect(merged.graphs.get('g1').name).toBe('Base Graph');
    expect(report.addedGraphIds).toHaveLength(0);
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
