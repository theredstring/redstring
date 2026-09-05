/**
 * Tests for abstractionSpec — the shared is-a ladder vocabulary.
 */
import { describe, it, expect } from 'vitest';
import {
  singular,
  findByLooseName,
  readIsAList,
  parseLadderShorthand,
  findChainOwner,
  buildLadderLevels,
  applyLadderCap,
  summarizeLadders
} from './abstractionSpec.js';

describe('singular', () => {
  it('sees through ordinary plurals', () => {
    expect(singular('Merchants')).toBe('merchant');
    expect(singular('Companies')).toBe('company');
    expect(singular('Boxes')).toBe('box');
  });

  it('leaves words that merely end in s alone', () => {
    // "Physics" → "physic" and "Series" → "sery" were both real: a mangled key
    // silently fails to match the node it was meant to find.
    for (const w of ['Business', 'Physics', 'Analysis', 'Class', 'Campus', 'Series', 'Species', 'Economics']) {
      expect(singular(w)).toBe(w.toLowerCase());
    }
  });

  it('turns on the last word, since category names are head-final', () => {
    expect(singular('Manufacturing Companies')).toBe('manufacturing company');
    expect(singular('Trading Desks')).toBe('trading desk');
  });
});

describe('findByLooseName', () => {
  const protos = [
    { id: 'p1', name: 'Company Town' },
    { id: 'p2', name: 'Merchants' },
    { id: 'p3', name: 'Grain' }
  ];

  it('matches across a plural difference', () => {
    expect(findByLooseName('Merchant', protos)?.id).toBe('p2');
  });

  it('refuses a node that merely shares a word', () => {
    expect(findByLooseName('Company', protos)).toBeNull();
  });

  it('takes the LAST match, since stale prototypes accumulate', () => {
    const dupes = [{ id: 'old', name: 'Company' }, { id: 'new', name: 'Company' }];
    expect(findByLooseName('Company', dupes)?.id).toBe('new');
  });

  it('works on a Map values() iterator, not just an array', () => {
    // The store holds prototypes in a Map. Iterating the Map itself yields
    // [id, proto] pairs whose .name is undefined, so nothing would ever match and
    // every rung would be silently recreated — callers must pass .values().
    const map = new Map(protos.map((p) => [p.id, p]));
    expect(findByLooseName('Merchant', map.values())?.id).toBe('p2');
    expect(findByLooseName('Merchant', map)).toBeNull();
  });
});

describe('readIsAList', () => {
  it('reads the advertised flat string array', () => {
    expect(readIsAList(['Automaker', 'Company'])).toEqual([
      { name: 'Automaker', description: '' },
      { name: 'Company', description: '' }
    ]);
  });

  it('tolerates {name, description} objects', () => {
    expect(readIsAList([{ name: 'Automaker', description: 'Builds cars.' }])).toEqual([
      { name: 'Automaker', description: 'Builds cars.' }
    ]);
  });

  it('tolerates a single delimited string', () => {
    expect(readIsAList('Automaker → Company > Organization').map((e) => e.name))
      .toEqual(['Automaker', 'Company', 'Organization']);
  });

  it('drops empties and handles null', () => {
    expect(readIsAList(null)).toEqual([]);
    expect(readIsAList(['', '  '])).toEqual([]);
  });
});

describe('parseLadderShorthand', () => {
  it('pulls caret rungs off and returns the bare text', () => {
    expect(parseLadderShorthand('Ford ^Automaker ^Company'))
      .toEqual({ text: 'Ford', isA: ['Automaker', 'Company'] });
  });

  it('leaves an unmarked string untouched', () => {
    expect(parseLadderShorthand('Pistons')).toEqual({ text: 'Pistons', isA: [] });
  });
});

describe('findChainOwner', () => {
  it('returns the node that already owns a chain containing the anchor', () => {
    const protos = [
      { id: 'anchor', name: 'Bunge' },
      { id: 'owner', name: 'Grain Trader', abstractionChains: { 'Generalization Axis': ['anchor', 'owner'] } }
    ];
    // Writing to the anchor instead would found a second, competing chain.
    expect(findChainOwner('anchor', 'Generalization Axis', protos)?.id).toBe('owner');
  });

  it('returns null when nothing owns a chain over the anchor', () => {
    expect(findChainOwner('anchor', 'Generalization Axis', [{ id: 'anchor', name: 'Bunge' }])).toBeNull();
  });
});

describe('buildLadderLevels', () => {
  const protos = [{ id: 'p2', name: 'Merchants' }];

  it('reuses an existing rung and creates the rest', () => {
    const levels = buildLadderLevels(
      readIsAList(['Merchant', 'Organization']),
      'below',
      { baseColor: '#8B0000', protos }
    );
    expect(levels[0].existingId).toBe('p2');
    expect(levels[0].create).toBeNull();
    expect(levels[1].existingId).toBeNull();
    expect(levels[1].create.name).toBe('Organization');
  });

  it('shades created rungs progressively, darker as they generalize', () => {
    const levels = buildLadderLevels(readIsAList(['A', 'B']), 'below', { baseColor: '#8B0000' });
    expect(levels[0].create.color).toBeTruthy();
    expect(levels[1].create.color).not.toBe(levels[0].create.color);
  });

  it('carries a description even for a reused rung', () => {
    const levels = buildLadderLevels(
      readIsAList([{ name: 'Merchant', description: 'A trader.' }]),
      'below',
      { protos }
    );
    expect(levels[0].existingId).toBe('p2');
    expect(levels[0].description).toBe('A trader.');
  });
});

describe('applyLadderCap', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: `N${i}`, isA: [{ name: 'X' }] }));

  it('leaves a modest number alone', () => {
    const { nodeSpecs, warning } = applyLadderCap(mk(3));
    expect(nodeSpecs.every((n) => n.isA)).toBe(true);
    expect(warning).toBeNull();
  });

  it('strips isA past the cap and says which it dropped', () => {
    const { nodeSpecs, warning } = applyLadderCap(mk(8), 5);
    expect(nodeSpecs.filter((n) => n.isA).length).toBe(5);
    expect(warning).toMatch(/dropped/);
    expect(warning).toContain('N7');
  });
});

describe('summarizeLadders', () => {
  it('is null when nothing was laddered', () => {
    expect(summarizeLadders([{ name: 'A' }]).abstractionChains).toBeNull();
  });

  it('renders each ladder, since result.spec never reaches the model', () => {
    const s = summarizeLadders([{ name: 'Ford', isA: [{ name: 'Automaker' }, { name: 'Company' }] }]);
    expect(s.abstractionChains).toEqual(['Ford → Automaker → Company']);
    expect(s.abstractionNote).toMatch(/Do not call/);
  });
});
