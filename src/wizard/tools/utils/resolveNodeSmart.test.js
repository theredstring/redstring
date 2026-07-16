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

  it('falls back to LAST substring match when no model is configured', async () => {
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
