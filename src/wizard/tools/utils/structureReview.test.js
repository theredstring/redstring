/**
 * Tests for the structure review pass.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({
  oneShotBoolean: vi.fn(),
  oneShotChoice: vi.fn(),
  oneShotLabel: vi.fn()
}));

import { oneShotBoolean, oneShotChoice, oneShotLabel } from '../../../services/oneShot.js';
import { detectCandidateClusters, reviewGraphStructure, runStructureReview } from './structureReview.js';

beforeEach(() => vi.clearAllMocks());

// A graph with one tight triangle {a,b,c} plus a lone chain d-e-f-g barely
// connected to the triangle via a single c-d edge.
const tightClusterGraph = () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, name: id.toUpperCase() }));
  const edges = [
    { sourceId: 'a', destinationId: 'b' },
    { sourceId: 'b', destinationId: 'c' },
    { sourceId: 'a', destinationId: 'c' }, // triangle a-b-c (dense)
    { sourceId: 'c', destinationId: 'd' }, // single bridge out
    { sourceId: 'd', destinationId: 'e' },
    { sourceId: 'e', destinationId: 'f' },
    { sourceId: 'f', destinationId: 'g' }
  ];
  return { nodes, edges };
};

describe('detectCandidateClusters (pure)', () => {
  it('finds the dense triangle as a candidate', () => {
    const { nodes, edges } = tightClusterGraph();
    const candidates = detectCandidateClusters(nodes, edges);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const abc = candidates.find((c) => c.nodeIds.includes('a') && c.nodeIds.includes('b') && c.nodeIds.includes('c'));
    expect(abc).toBeTruthy();
    expect(abc.nodeNames).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('returns [] for a small or empty graph (no candidates → no review)', () => {
    expect(detectCandidateClusters([], [])).toEqual([]);
    expect(detectCandidateClusters([{ id: 'x', name: 'X' }], [])).toEqual([]);
  });

  it('returns [] for a flat edgeless set', () => {
    const nodes = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, name: `N${i}` }));
    expect(detectCandidateClusters(nodes, [])).toEqual([]);
  });
});

describe('reviewGraphStructure (model)', () => {
  const clusters = [{ nodeIds: ['a', 'b', 'c'], nodeNames: ['A', 'B', 'C'], internalEdges: 3, externalEdges: 1 }];

  it('suggests nothing when the cluster is not coherent (biased to leave)', async () => {
    oneShotBoolean.mockResolvedValue({ value: false, callId: 'c1' });
    const s = await reviewGraphStructure({ clusters, buildId: 'b' });
    expect(s).toEqual([]);
    expect(oneShotChoice).not.toHaveBeenCalled();
  });

  it('suggests nothing when coherent but structure choice is "leave as is"', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'c1' });
    oneShotChoice.mockResolvedValue({ index: 0, none: false, callId: 'c2' }); // leave
    const s = await reviewGraphStructure({ clusters, buildId: 'b' });
    expect(s).toEqual([]);
    expect(oneShotLabel).not.toHaveBeenCalled();
  });

  it('produces a group suggestion with a name and callIds', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'coh' });
    oneShotChoice.mockResolvedValue({ index: 1, none: false, callId: 'struct' }); // group
    oneShotLabel.mockResolvedValue({ value: 'Inner Planets', callId: 'name' });
    const s = await reviewGraphStructure({ clusters, buildId: 'b' });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      action: 'group',
      name: 'Inner Planets',
      coherenceCallId: 'coh',
      structureCallId: 'struct',
      nameCallId: 'name'
    });
  });

  it('produces a fold suggestion for index 2', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'coh' });
    oneShotChoice.mockResolvedValue({ index: 2, none: false, callId: 'struct' });
    oneShotLabel.mockResolvedValue({ value: 'Solar Core', callId: 'name' });
    const s = await reviewGraphStructure({ clusters, buildId: 'b' });
    expect(s[0].action).toBe('fold');
  });
});

describe('runStructureReview', () => {
  it('makes zero model calls on a clean graph with no candidates', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, name: `N${i}` }));
    const { candidates, suggestions } = await runStructureReview(nodes, []);
    expect(candidates).toEqual([]);
    expect(suggestions).toEqual([]);
    expect(oneShotBoolean).not.toHaveBeenCalled();
  });
});
