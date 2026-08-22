/**
 * Tests for the shared resolveNodeSmart resolver.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({
  isOneShotAvailable: vi.fn().mockResolvedValue(false),
  oneShotChoice: vi.fn()
}));
vi.mock('./suggestionCalls.js', () => ({ proposeMissingNode: vi.fn() }));

import { isOneShotAvailable, oneShotChoice } from '../../../services/oneShot.js';
import { proposeMissingNode } from './suggestionCalls.js';
import { resolveNodeSmart } from './resolveNodeSmart.js';

const candidates = [
  { instanceId: 'i1', prototypeId: 'p-old', name: 'Membrane', description: 'old dupe' },
  { instanceId: 'i2', prototypeId: 'p1', name: 'Outer Membrane' },
  { instanceId: 'i3', prototypeId: 'p2', name: 'Membrane Potential' },
  { instanceId: 'i4', prototypeId: 'p-new', name: 'Membrane', description: 'current' }
];

beforeEach(() => {
  vi.clearAllMocks();
  isOneShotAvailable.mockResolvedValue(false);
});

describe('resolveNodeSmart — deterministic paths', () => {
  it('exact match short-circuits without a model call, taking the LAST duplicate', async () => {
    const r = await resolveNodeSmart('membrane', candidates);
    expect(r.method).toBe('exact');
    expect(r.exact).toBe(true);
    expect(r.match.prototypeId).toBe('p-new'); // last, not p-old
    expect(isOneShotAvailable).not.toHaveBeenCalled();
    expect(oneShotChoice).not.toHaveBeenCalled();
  });

  it('returns empty for a blank query', async () => {
    const r = await resolveNodeSmart('', candidates);
    expect(r.method).toBe('empty');
    expect(r.match).toBeNull();
  });

  it('returns empty when there are no candidates', async () => {
    const r = await resolveNodeSmart('anything', []);
    expect(r.method).toBe('empty');
  });

  it('falls back to the best-scoring substring match when no model is configured', async () => {
    const r = await resolveNodeSmart('potential', candidates);
    expect(r.method).toBe('substring');
    expect(r.match.prototypeId).toBe('p2');
  });

  it('returns not-found when nothing matches and no model', async () => {
    const r = await resolveNodeSmart('mitochondria', candidates);
    expect(r.method).toBe('not-found');
    expect(r.match).toBeNull();
  });
});

describe('resolveNodeSmart — heuristic ranking (no model)', () => {
  // The wizard runs its tools in Node, where oneShot has no localStorage and so
  // no model is ever configured. The heuristic below IS the production path.
  const cells = [
    { id: 'n1', name: 'Cell Wall' },
    { id: 'n2', name: 'Cell Membrane' },
    { id: 'n3', name: 'Stem Cell' }
  ];

  it('picks the most similar candidate, not the last one scanned', async () => {
    const list = [
      { id: 'far', name: 'Membrane Potential Gradient' },
      { id: 'near', name: 'Membrane Potential' },
      { id: 'last', name: 'Transmembrane Potential Sensor' }
    ];
    // Typo'd query so nothing matches exactly and all three stay eligible.
    const r = await resolveNodeSmart('membrane potentia', list);
    expect(r.method).toBe('substring');
    expect(r.match.id).toBe('near'); // best score, despite not being last
  });

  it('refuses to guess when several candidates are equally plausible', async () => {
    const r = await resolveNodeSmart('Cell', cells);
    expect(r.method).toBe('ambiguous');
    expect(r.match).toBeNull();
    const names = r.candidates.map((c) => c.name).sort();
    expect(names).toEqual(['Cell Wall', 'Stem Cell']);
  });

  it('still resolves when one candidate is clearly the best', async () => {
    const r = await resolveNodeSmart('Cell Wal', cells);
    expect(r.method).toBe('substring');
    expect(r.match.name).toBe('Cell Wall');
  });

  it('prefers an exact match over any ambiguity', async () => {
    const r = await resolveNodeSmart('stem cell', cells);
    expect(r.method).toBe('exact');
    expect(r.match.name).toBe('Stem Cell');
  });

  it('breaks exact-score ties toward the LAST candidate (stale prototypes are older)', async () => {
    const dupes = [
      { id: 'old', name: 'Membrane X' },
      { id: 'new', name: 'Membrane X' }
    ];
    const r = await resolveNodeSmart('membrane x', dupes);
    expect(r.match.id).toBe('new');
  });

  it('honors substringMode none — exact only, never a fuzzy bind', async () => {
    const r = await resolveNodeSmart('Cell', cells, { substringMode: 'none' });
    expect(r.method).toBe('not-found');
    expect(r.match).toBeNull();
  });
});

describe('resolveNodeSmart — model paths', () => {
  beforeEach(() => { isOneShotAvailable.mockResolvedValue(true); });

  it('uses the model when there is no exact match and returns its pick', async () => {
    // Query intentionally has no exact match; model resolves the synonym.
    oneShotChoice.mockResolvedValue({ index: 1, value: {}, none: false, callId: 'c1' });
    const r = await resolveNodeSmart('outer cell wall', candidates);
    expect(oneShotChoice).toHaveBeenCalledTimes(1);
    expect(r.method).toBe('model');
    expect(r.exact).toBe(false);
    expect(r.match.prototypeId).toBe('p1'); // index 1 = Outer Membrane
    expect(r.callId).toBe('c1');
  });

  it('reports model-none when the model rejects all candidates', async () => {
    oneShotChoice.mockResolvedValue({ index: null, value: null, none: true, callId: 'c2' });
    const r = await resolveNodeSmart('nucleus', candidates);
    expect(r.method).toBe('model-none');
    expect(r.match).toBeNull();
    expect(r.callId).toBe('c2');
  });

  it('falls back to substring when the model call returns null', async () => {
    oneShotChoice.mockResolvedValue(null);
    const r = await resolveNodeSmart('potential', candidates);
    expect(r.method).toBe('substring');
    expect(r.match.prototypeId).toBe('p2');
  });

  it('honors useModel:false (never calls the model)', async () => {
    const r = await resolveNodeSmart('membrane potent', candidates, { useModel: false });
    expect(isOneShotAvailable).not.toHaveBeenCalled();
    expect(r.method).toBe('substring');
  });
});

describe('resolveNodeSmart — missing-node proposal (C2)', () => {
  it('attaches proposedNode when unresolvable and proposeMissing is on', async () => {
    isOneShotAvailable.mockResolvedValue(false); // no model → not-found heuristic path
    proposeMissingNode.mockResolvedValue({ plausible: true, callId: 'p1' });
    const r = await resolveNodeSmart('mitochondria', candidates, { proposeMissing: true, graphName: 'Cell' });
    expect(r.method).toBe('not-found');
    expect(r.proposedNode).toMatchObject({ name: 'mitochondria', proposalCallId: 'p1' });
  });

  it('does not attach a proposal when the model deems it implausible', async () => {
    proposeMissingNode.mockResolvedValue({ plausible: false, callId: 'p2' });
    const r = await resolveNodeSmart('asdfqwer', candidates, { proposeMissing: true });
    expect(r.proposedNode).toBeUndefined();
  });

  it('never proposes when proposeMissing is off (default)', async () => {
    const r = await resolveNodeSmart('mitochondria', candidates);
    expect(proposeMissingNode).not.toHaveBeenCalled();
    expect(r.proposedNode).toBeUndefined();
  });
});
