/**
 * Tests for graphShapes + classifyGraphShape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({
  oneShotChoice: vi.fn(),
  oneShotBoolean: vi.fn()
}));

import { oneShotChoice, oneShotBoolean } from '../../../services/oneShot.js';
import { classifyGraphShape, shouldUnfoldMembers } from './classifyGraphShape.js';
import { GRAPH_SHAPES, GRAPH_SHAPE_KEYS, isEdgelessShape, isAbstractionShape } from './graphShapes.js';

beforeEach(() => vi.clearAllMocks());

describe('graphShapes library', () => {
  it('defines exactly the nine shapes with required fields', () => {
    expect(GRAPH_SHAPE_KEYS).toEqual([
      'set', 'web', 'star', 'sequence', 'cycle', 'tree', 'ladder', 'correspondence', 'dialectic'
    ]);
    for (const s of GRAPH_SHAPES) {
      expect(s.key).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(Array.isArray(s.examples) && s.examples.length >= 2).toBe(true);
      expect(s.buildNotes).toBeTruthy();
    }
  });

  it('routes set to edgeless and ladder to abstraction axis', () => {
    expect(isEdgelessShape('set')).toBe(true);
    expect(isEdgelessShape('web')).toBe(false);
    expect(isAbstractionShape('ladder')).toBe(true);
    expect(isAbstractionShape('tree')).toBe(false);
  });
});

describe('classifyGraphShape', () => {
  it('returns the chosen shape key', async () => {
    // index 0 = set
    oneShotChoice.mockResolvedValue({ index: 0, value: {}, none: false, callId: 'c1' });
    expect(await classifyGraphShape({ request: 'brainstorm 20 ideas' })).toBe('set');
  });

  it('maps a later index correctly', async () => {
    const seqIndex = GRAPH_SHAPE_KEYS.indexOf('sequence');
    oneShotChoice.mockResolvedValue({ index: seqIndex, value: {}, none: false, callId: 'c2' });
    expect(await classifyGraphShape({ request: 'albums in order' })).toBe('sequence');
  });

  it('returns null when the model has no answer (fallback)', async () => {
    oneShotChoice.mockResolvedValue(null);
    expect(await classifyGraphShape({ request: 'whatever' })).toBeNull();
  });

  it('returns null for an empty request without calling the model', async () => {
    expect(await classifyGraphShape({ request: '' })).toBeNull();
    expect(oneShotChoice).not.toHaveBeenCalled();
  });

  it('passes the shared buildId through', async () => {
    oneShotChoice.mockResolvedValue({ index: 1, none: false, callId: 'c3' });
    await classifyGraphShape({ request: 'x', buildId: 'build_123' });
    expect(oneShotChoice.mock.calls[0][0].buildId).toBe('build_123');
  });
});

describe('shouldUnfoldMembers', () => {
  it('returns the boolean verdict', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'c4' });
    expect(await shouldUnfoldMembers({ memberKind: 'album', buildId: 'b' })).toBe(true);
  });
  it('returns null on no answer', async () => {
    oneShotBoolean.mockResolvedValue(null);
    expect(await shouldUnfoldMembers({ memberKind: 'album' })).toBeNull();
  });
  it('returns null for empty memberKind without a call', async () => {
    expect(await shouldUnfoldMembers({ memberKind: '' })).toBeNull();
    expect(oneShotBoolean).not.toHaveBeenCalled();
  });
});
