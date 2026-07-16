/**
 * Tests for the ladder ordering helper. The applier wires the axis; here we only
 * verify the specific→general ordering decision.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({ oneShotChoice: vi.fn() }));

import { oneShotChoice } from '../../../services/oneShot.js';
import { orderLadder } from './ladderChain.js';

beforeEach(() => vi.clearAllMocks());

describe('orderLadder', () => {
  const ladder = ['Poodle', 'Dog', 'Mammal', 'Animal'];

  it('keeps the produced order when it is specific → general (index 0)', async () => {
    oneShotChoice.mockResolvedValue({ index: 0, none: false, callId: 'c' });
    expect(await orderLadder({ nodeNames: ladder })).toEqual(ladder);
  });

  it('reverses when the model says it is general → specific (index 1)', async () => {
    oneShotChoice.mockResolvedValue({ index: 1, none: false, callId: 'c' });
    expect(await orderLadder({ nodeNames: ladder })).toEqual([...ladder].reverse());
  });

  it('keeps the produced order with no model (null)', async () => {
    oneShotChoice.mockResolvedValue(null);
    expect(await orderLadder({ nodeNames: ladder })).toEqual(ladder);
  });

  it('returns null for fewer than two names without calling', async () => {
    expect(await orderLadder({ nodeNames: ['Solo'] })).toBeNull();
    expect(oneShotChoice).not.toHaveBeenCalled();
  });
});
