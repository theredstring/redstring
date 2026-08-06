import { describe, it, expect } from 'vitest';
import { switchToGraph } from './switchToGraph.js';
import { findDuplicates } from './findDuplicates.js';
import { calculateStringSimilarity } from './utils/stringSimilarity.js';

/**
 * Regression pins for the "wizard appears to hang" family.
 *
 * All three symptoms the user hit traced back to state that only resolved on a
 * clean happy path: a navigation that reported nothing when it was a no-op, a
 * read-only tool whose unbounded result poisoned every later iteration, and a
 * similarity scan that rescanned every instance for every prototype.
 */

const state = ({ graphs = [], protos = [], activeGraphId = null } = {}) => ({
  activeGraphId,
  graphs,
  nodePrototypes: protos
});

describe('switchToGraph resolution', () => {
  const graphs = [
    { id: 'g-real', name: 'Solar System', instances: [] },
    { id: 'g-other', name: 'Garage', instances: [] }
  ];

  it('falls back to graphName when graphId is stale instead of throwing', async () => {
    // The model routinely sends all three; a bad id used to poison the call.
    const r = await switchToGraph(
      { graphId: 'graph-hallucinated-123', graphName: 'Solar System', nodeName: 'Solar System' },
      state({ graphs, activeGraphId: 'g-other' })
    );
    expect(r.graphId).toBe('g-real');
  });

  it('falls back to nodeName when graphId and graphName both fail', async () => {
    const protos = [{ id: 'p1', name: 'Engine', definitionGraphIds: ['g-other'] }];
    const r = await switchToGraph(
      { graphId: 'nope', graphName: 'Also Nope', nodeName: 'Engine' },
      state({ graphs, protos, activeGraphId: 'g-real' })
    );
    expect(r.graphId).toBe('g-other');
  });

  it('accepts a graph NAME passed in the graphId slot', async () => {
    const r = await switchToGraph({ graphId: 'Solar System' }, state({ graphs }));
    expect(r.graphId).toBe('g-real');
  });

  it('reports alreadyActive when the target is the current graph', async () => {
    const r = await switchToGraph({ graphName: 'Solar System' }, state({ graphs, activeGraphId: 'g-real' }));
    expect(r.alreadyActive).toBe(true);
    expect(r.alreadyActiveWarning).toMatch(/do NOT call switchToGraph/i);
  });

  it('does not claim alreadyActive when it really navigated', async () => {
    const r = await switchToGraph({ graphName: 'Garage' }, state({ graphs, activeGraphId: 'g-real' }));
    expect(r.alreadyActive).toBe(false);
    expect(r.alreadyActiveWarning).toBeNull();
  });

  it('lists what it tried and what exists when nothing resolves', async () => {
    await expect(
      switchToGraph({ graphId: 'nope', graphName: 'also nope' }, state({ graphs }))
    ).rejects.toThrow(/Available webs.*Solar System/s);
  });
});

describe('findDuplicates cost and payload', () => {
  const makeState = (n, instancesPerProto = 3) => {
    const protos = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, name: `Concept ${i}`, description: '', definitionGraphIds: []
    }));
    const instances = [];
    for (const p of protos) {
      for (let k = 0; k < instancesPerProto; k++) instances.push({ id: `${p.id}-i${k}`, prototypeId: p.id });
    }
    return state({ graphs: [{ id: 'g', name: 'G', instances }], protos });
  };

  it('caps the result so it cannot poison the rest of the conversation', async () => {
    const r = await findDuplicates({ threshold: 0.8 }, makeState(600));
    expect(r.duplicateGroups.length).toBeLessThanOrEqual(25);
    for (const g of r.duplicateGroups) {
      expect(g.nodes.length).toBeLessThanOrEqual(12);
    }
    // Serialized size is what actually gets re-uploaded each iteration.
    expect(JSON.stringify(r).length).toBeLessThan(60000);
  });

  it('tells the model the view is partial rather than implying completeness', async () => {
    const r = await findDuplicates({ threshold: 0.8 }, makeState(600));
    expect(r.truncated).toBe(true);
    expect(r.truncationNote).toMatch(/threshold|targetGraphId/);
    expect(r.prototypesScanned).toBe(600);
  });

  it('still finds real duplicates and recommends the richest node', async () => {
    const protos = [
      { id: 'a', name: 'Mitochondria', description: 'x'.repeat(150), definitionGraphIds: ['g1'], semanticMetadata: {} },
      { id: 'b', name: 'Mitochondrion', description: '', definitionGraphIds: [] },
      { id: 'c', name: 'Totally Unrelated', description: '', definitionGraphIds: [] }
    ];
    const r = await findDuplicates({ threshold: 0.8 }, state({ graphs: [{ id: 'g', name: 'G', instances: [] }], protos }));

    expect(r.duplicateGroups).toHaveLength(1);
    const names = r.duplicateGroups[0].nodes.map(n => n.name);
    expect(names).toContain('Mitochondria');
    expect(names).toContain('Mitochondrion');
    expect(names).not.toContain('Totally Unrelated');
    expect(r.duplicateGroups[0].recommendedPrimary.name).toBe('Mitochondria');
  });

  it('counts instances correctly from the precomputed index', async () => {
    const protos = [
      { id: 'a', name: 'Engine', definitionGraphIds: [] },
      { id: 'b', name: 'Engin', definitionGraphIds: [] }
    ];
    const graphs = [
      { id: 'g1', name: 'One', instances: [{ id: 'i1', prototypeId: 'a' }, { id: 'i2', prototypeId: 'a' }] },
      // Object-shaped instances — the shape that made the old code allocate per call.
      { id: 'g2', name: 'Two', instances: { i3: { id: 'i3', prototypeId: 'a' }, i4: { id: 'i4', prototypeId: 'b' } } }
    ];
    const r = await findDuplicates({ threshold: 0.7 }, state({ graphs, protos }));
    const engine = r.duplicateGroups[0].nodes.find(n => n.name === 'Engine');
    expect(engine.instanceCount).toBe(3);
  });

  it('completes a large scan quickly enough not to block the server', async () => {
    const started = Date.now();
    await findDuplicates({ threshold: 0.8 }, makeState(1500, 10));
    // Was measured in the tens of seconds before the instance index and the
    // length-pruned similarity; generous bound so this is not flaky on CI.
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('calculateStringSimilarity', () => {
  it('is unchanged for real comparisons', () => {
    expect(calculateStringSimilarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 5);
    expect(calculateStringSimilarity('same', 'same')).toBe(1);
    expect(calculateStringSimilarity('', 'x')).toBe(0);
  });

  it('rejects on length difference alone when a floor is given', () => {
    // 'abc' vs 'abcdefghij' really scores 0.3 — above zero, but it can never
    // reach 0.8 on length alone, so the floor short-circuits before the O(L²) work.
    expect(calculateStringSimilarity('abc', 'abcdefghij')).toBeCloseTo(0.3, 5);
    expect(calculateStringSimilarity('abc', 'abcdefghij', 0.8)).toBe(0);
  });

  it('never rejects a pair that would have passed the floor', () => {
    const a = 'Mitochondria', b = 'Mitochondrion';
    expect(calculateStringSimilarity(a, b, 0.8)).toBeCloseTo(calculateStringSimilarity(a, b), 10);
  });
});
