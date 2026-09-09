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
  summarizeLadders,
  seededChainFor,
  isSeededChain,
  resolveChain,
  THING_PROTOTYPE_ID
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

  it('puts the bio on a rung it is about to create', () => {
    // A rung is a real node; born with only a name it is a dead end wherever it
    // later turns up. The bio has to ride along to the creation call.
    const levels = buildLadderLevels(
      readIsAList([{ name: 'Organization', description: 'An organized body of people.' }]),
      'below',
      { protos }
    );
    expect(levels[0].existingId).toBeNull();
    expect(levels[0].create.description).toBe('An organized body of people.');
  });

  it('carries a description alongside a reused rung without asserting it gets written', () => {
    // Reused rungs are left alone by the applier — bios go on new nodes only.
    const levels = buildLadderLevels(
      readIsAList([{ name: 'Merchant', description: 'A trader.' }]),
      'below',
      { protos }
    );
    expect(levels[0].existingId).toBe('p2');
    expect(levels[0].create).toBeNull();
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

describe('seededChainFor', () => {
  it('puts the type between the node and the Thing floor', () => {
    expect(seededChainFor('bakery', 'company')).toEqual(['bakery', 'company', THING_PROTOTYPE_ID]);
  });

  it('collapses to two rungs when the type IS Thing', () => {
    expect(seededChainFor('bakery', THING_PROTOTYPE_ID)).toEqual(['bakery', THING_PROTOTYPE_ID]);
  });

  it('treats an absent type as Thing, since half the creation sites pass null', () => {
    expect(seededChainFor('bakery', null)).toEqual(['bakery', THING_PROTOTYPE_ID]);
  });

  it('refuses the roots, which carry no chain of their own', () => {
    expect(seededChainFor(THING_PROTOTYPE_ID, null)).toBeNull();
    expect(seededChainFor('base-connection-prototype', null)).toBeNull();
  });

  it('does not repeat a self-typed node, which a merge can produce', () => {
    expect(seededChainFor('x', 'x')).toEqual(['x', THING_PROTOTYPE_ID]);
  });
});

describe('isSeededChain', () => {
  const bakery = { id: 'bakery', typeNodeId: 'company' };

  it('recognizes its own output', () => {
    expect(isSeededChain(bakery, ['bakery', 'company', THING_PROTOTYPE_ID])).toBe(true);
  });

  it('counts an absent chain as seeded, so legacy files are not read as authored', () => {
    expect(isSeededChain(bakery, undefined)).toBe(true);
    expect(isSeededChain(bakery, [])).toBe(true);
  });

  it('reads an extended ladder as authored', () => {
    expect(isSeededChain(bakery, ['bakery', 'company', 'org', THING_PROTOTYPE_ID])).toBe(false);
  });

  it('reads a hand-built ladder with no Thing floor as authored', () => {
    // The case that makes shape inference safe: a two-rung ladder someone wrote is
    // still distinguishable from a seed, because seeding always lays the floor.
    expect(isSeededChain(bakery, ['bakery', 'company'])).toBe(false);
  });

  it('goes stale against the OLD type once the node is retyped', () => {
    expect(isSeededChain({ id: 'bakery', typeNodeId: 'institution' },
      ['bakery', 'company', THING_PROTOTYPE_ID])).toBe(false);
  });
});

describe('resolveChain', () => {
  const DIM = 'Generalization Axis';

  it('synthesizes a chain for a prototype that has none stored', () => {
    const r = resolveChain('bakery', DIM, [{ id: 'bakery', typeNodeId: 'company' }]);
    expect(r.chain).toEqual(['bakery', 'company', THING_PROTOTYPE_ID]);
    expect(r.virtual).toBe(true);
    expect(r.ownerId).toBe('bakery');
  });

  it('prefers a ladder the node is a rung of over its own seeded chain', () => {
    // The shadowing case. A rung added via Add Above/Below is born typed Thing, so it
    // owns a trivial seeded chain; without this it would hide the ladder it was added to.
    const protos = [
      { id: 'rung', typeNodeId: THING_PROTOTYPE_ID,
        abstractionChains: { [DIM]: ['rung', THING_PROTOTYPE_ID] } },
      { id: 'ford', typeNodeId: 'automaker',
        abstractionChains: { [DIM]: ['ford', 'rung', 'automaker', THING_PROTOTYPE_ID] } }
    ];
    const r = resolveChain('rung', DIM, protos);
    expect(r.ownerId).toBe('ford');
    expect(r.chain).toEqual(['ford', 'rung', 'automaker', THING_PROTOTYPE_ID]);
    expect(r.seeded).toBe(false);
  });

  it('keeps a node on its OWN ladder once it has authored one', () => {
    const protos = [
      { id: 'rung', typeNodeId: THING_PROTOTYPE_ID,
        abstractionChains: { [DIM]: ['rung', 'sub', THING_PROTOTYPE_ID] } },
      { id: 'ford', abstractionChains: { [DIM]: ['ford', 'rung', THING_PROTOTYPE_ID] } }
    ];
    expect(resolveChain('rung', DIM, protos).ownerId).toBe('rung');
  });

  it('leaves Thing on its own, not on some arbitrary node it is the floor of', () => {
    // Thing is a rung of every seeded chain and owner of none. Skipping seeded chains
    // during resolution is what stops it resolving to whichever one iterates first.
    const protos = [
      { id: 'a', typeNodeId: 'company', abstractionChains: { [DIM]: ['a', 'company', THING_PROTOTYPE_ID] } },
      { id: 'b', typeNodeId: 'org', abstractionChains: { [DIM]: ['b', 'org', THING_PROTOTYPE_ID] } }
    ];
    const r = resolveChain(THING_PROTOTYPE_ID, DIM, protos);
    expect(r.ownerId).toBe(THING_PROTOTYPE_ID);
    expect(r.virtual).toBe(true);
  });
});
