/**
 * Tests for C7 batch naming conformance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./suggestionCalls.js', () => ({ conformNamingStyle: vi.fn() }));

import { conformNamingStyle } from './suggestionCalls.js';
import { conformNames, MIN_EXAMPLES, MAX_NEW_NAMES } from './conformNames.js';

const examples = ['Glycolysis', 'Krebs Cycle', 'Electron Transport', 'Fermentation', 'Photosynthesis'];

beforeEach(() => vi.clearAllMocks());

describe('conformNames', () => {
  it('returns only the names that changed', async () => {
    conformNamingStyle.mockImplementation(async ({ name }) =>
      name === 'atp synthesis' ? { name: 'ATP Synthesis', changed: true, callId: 'c' } : null
    );
    const changes = await conformNames({ names: ['atp synthesis', 'Calvin Cycle'], exampleNames: examples });
    expect(changes).toEqual({ 'atp synthesis': 'ATP Synthesis' });
  });

  it('skips (no calls) when there are too few examples', async () => {
    const changes = await conformNames({ names: ['x'], exampleNames: ['only', 'four', 'names', 'here'] });
    expect(changes).toEqual({});
    expect(conformNamingStyle).not.toHaveBeenCalled();
  });

  it('skips when there are too many new names (cost guard)', async () => {
    const many = Array.from({ length: MAX_NEW_NAMES + 1 }, (_, i) => `n${i}`);
    const changes = await conformNames({ names: many, exampleNames: examples });
    expect(changes).toEqual({});
    expect(conformNamingStyle).not.toHaveBeenCalled();
  });

  it('returns {} with no model (all null)', async () => {
    conformNamingStyle.mockResolvedValue(null);
    expect(await conformNames({ names: ['a', 'b'], exampleNames: examples })).toEqual({});
  });

  it('needs exactly MIN_EXAMPLES examples to run', async () => {
    conformNamingStyle.mockResolvedValue(null);
    await conformNames({ names: ['a'], exampleNames: examples.slice(0, MIN_EXAMPLES) });
    expect(conformNamingStyle).toHaveBeenCalled();
  });
});
