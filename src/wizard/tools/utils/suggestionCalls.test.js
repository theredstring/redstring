/**
 * Tests for the Part C suggestion-call helpers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../services/oneShot.js', () => ({
  oneShotChoice: vi.fn(),
  oneShotBoolean: vi.fn(),
  oneShotLabel: vi.fn()
}));

import { oneShotChoice, oneShotBoolean, oneShotLabel } from '../../../services/oneShot.js';
import {
  suggestRelationKind,
  suggestArrowDirection,
  suggestGroupName,
  suggestAbstractionName,
  conformNamingStyle,
  proposeMissingNode
} from './suggestionCalls.js';

beforeEach(() => vi.clearAllMocks());

describe('suggestRelationKind', () => {
  it('maps index to kind', async () => {
    oneShotChoice.mockResolvedValue({ index: 0, none: false, callId: 'c' });
    expect(await suggestRelationKind({ sourceName: 'Poodle', targetName: 'Dog' })).toEqual({ kind: 'kind-of', callId: 'c' });
    oneShotChoice.mockResolvedValue({ index: 1, none: false, callId: 'c' });
    expect((await suggestRelationKind({ sourceName: 'Wheel', targetName: 'Car' })).kind).toBe('part-of');
    oneShotChoice.mockResolvedValue({ index: 2, none: false, callId: 'c' });
    expect((await suggestRelationKind({ sourceName: 'A', targetName: 'B' })).kind).toBe('related');
  });
  it('returns null without both names / on no answer', async () => {
    expect(await suggestRelationKind({ sourceName: 'A' })).toBeNull();
    expect(oneShotChoice).not.toHaveBeenCalled();
    oneShotChoice.mockResolvedValue(null);
    expect(await suggestRelationKind({ sourceName: 'A', targetName: 'B' })).toBeNull();
  });
});

describe('suggestArrowDirection', () => {
  it('maps index 0 to target, 1 to source', async () => {
    oneShotChoice.mockResolvedValue({ index: 0, none: false, callId: 'c' });
    expect((await suggestArrowDirection({ sourceName: 'Kubrick', targetName: '2001', label: 'directed' })).arrowsToward).toBe('target');
    oneShotChoice.mockResolvedValue({ index: 1, none: false, callId: 'c' });
    expect((await suggestArrowDirection({ sourceName: 'A', targetName: 'B', label: 'made by' })).arrowsToward).toBe('source');
  });
  it('returns null without a label', async () => {
    expect(await suggestArrowDirection({ sourceName: 'A', targetName: 'B' })).toBeNull();
  });
});

describe('suggestGroupName', () => {
  it('returns the label for >=2 members', async () => {
    oneShotLabel.mockResolvedValue({ value: 'Inner Planets', callId: 'c' });
    expect(await suggestGroupName({ memberNames: ['Mercury', 'Venus', 'Earth'] })).toEqual({ name: 'Inner Planets', callId: 'c' });
  });
  it('returns null for <2 members without calling', async () => {
    expect(await suggestGroupName({ memberNames: ['Solo'] })).toBeNull();
    expect(oneShotLabel).not.toHaveBeenCalled();
  });
});

describe('suggestAbstractionName', () => {
  it('suggests a more-general name when moreGeneral is true', async () => {
    oneShotLabel.mockResolvedValue({ value: 'Mammal', callId: 'c' });
    expect(await suggestAbstractionName({ nodeName: 'Dog', moreGeneral: true })).toEqual({ name: 'Mammal', callId: 'c' });
  });
  it('requires an explicit moreGeneral boolean', async () => {
    expect(await suggestAbstractionName({ nodeName: 'Dog' })).toBeNull();
    expect(oneShotLabel).not.toHaveBeenCalled();
  });
});

describe('conformNamingStyle', () => {
  it('returns null when the model says keep', async () => {
    oneShotLabel.mockResolvedValue({ value: 'keep', callId: 'c' });
    expect(await conformNamingStyle({ name: 'photosynthesis', exampleNames: ['Glycolysis', 'Krebs Cycle'] })).toBeNull();
  });
  it('returns the restyled name when changed', async () => {
    oneShotLabel.mockResolvedValue({ value: 'Photosynthesis', callId: 'c' });
    expect(await conformNamingStyle({ name: 'photosynthesis', exampleNames: ['Glycolysis', 'Krebs Cycle'] }))
      .toEqual({ name: 'Photosynthesis', changed: true, callId: 'c' });
  });
  it('returns null without enough examples', async () => {
    expect(await conformNamingStyle({ name: 'x', exampleNames: ['only one'] })).toBeNull();
    expect(oneShotLabel).not.toHaveBeenCalled();
  });
});

describe('proposeMissingNode', () => {
  it('returns plausibility verdict', async () => {
    oneShotBoolean.mockResolvedValue({ value: true, callId: 'c' });
    expect(await proposeMissingNode({ name: 'Mitochondria', graphName: 'Cell' })).toEqual({ plausible: true, callId: 'c' });
  });
  it('returns null without a name', async () => {
    expect(await proposeMissingNode({})).toBeNull();
  });
});
