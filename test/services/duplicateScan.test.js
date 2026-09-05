import { describe, it, expect } from 'vitest';
import { calculateEntityMatchConfidence } from '../../src/services/entityMatching.js';
import {
  prototypeToEntity,
  countInstancesByPrototype,
  computeCarryOver,
  scanForDuplicates
} from '../../src/services/duplicateScan.js';
import { NODE_DEFAULT_COLOR } from '../../src/constants.js';

const WIKI = (q) => `https://www.wikidata.org/wiki/${q}`;

const proto = (id, name, extras = {}) => ({
  id, name, description: '', color: NODE_DEFAULT_COLOR,
  externalLinks: [], definitionGraphIds: [], ...extras,
});

const graphWith = (id, instances) => [id, {
  id, name: id, instances: new Map(instances), edgeIds: [], groups: new Map(),
}];

const inst = (iid, prototypeId) => [iid, { id: iid, prototypeId, x: 0, y: 0 }];

describe('entityMatching — the different-QID early return', () => {
  it('returns the same shape as every other path, not a bare number', () => {
    const r = calculateEntityMatchConfidence(
      { name: 'Mercury', externalLinks: [WIKI('Q308')] },   // the planet
      { name: 'Mercury', externalLinks: [WIKI('Q925')] }    // the element
    );
    expect(typeof r).toBe('object');
    expect(r.confidence).toBe(0);
    expect(r.shouldMerge).toBe(false);
    expect(r.needsReview).toBe(false);
    expect(Array.isArray(r.factors)).toBe(true);
  });

  it('survives being sorted on — the old bare 0.0 produced NaN', () => {
    const mismatch = calculateEntityMatchConfidence(
      { name: 'Mercury', externalLinks: [WIKI('Q308')] },
      { name: 'Mercury', externalLinks: [WIKI('Q925')] }
    );
    const match = calculateEntityMatchConfidence(
      { name: 'Dog', externalLinks: [WIKI('Q144')] },
      { name: 'Doggo', externalLinks: [WIKI('Q144')] }
    );
    const sorted = [mismatch, match].sort((a, b) => b.confidence - a.confidence);
    expect(Number.isNaN(sorted[0].confidence)).toBe(false);
    expect(sorted[0]).toBe(match);
  });

  it('an identical QID still scores as a merge', () => {
    const r = calculateEntityMatchConfidence(
      { name: 'Dog', externalLinks: [WIKI('Q144')] },
      { name: 'Doggo', externalLinks: [WIKI('Q144')] }
    );
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.shouldMerge).toBe(true);
  });
});

describe('prototypeToEntity', () => {
  it('folds both link locations together without duplicates', () => {
    const e = prototypeToEntity(proto('p', 'Dog', {
      externalLinks: [WIKI('Q144')],
      semanticMetadata: { externalLinks: [WIKI('Q144'), 'http://dbpedia.org/Dog'] }
    }));
    expect(e.externalLinks.sort()).toEqual(['http://dbpedia.org/Dog', WIKI('Q144')]);
  });

  it('does not invent a uri or sameAsLinks', () => {
    const e = prototypeToEntity(proto('p', 'Dog', { externalLinks: [WIKI('Q144')] }));
    expect(e.uri).toBeUndefined();
    expect(e.sameAsLinks).toBeUndefined();
  });
});

describe('countInstancesByPrototype', () => {
  it('counts across every web', () => {
    const graphs = new Map([
      graphWith('g1', [inst('i1', 'a'), inst('i2', 'a'), inst('i3', 'b')]),
      graphWith('g2', [inst('i4', 'a')]),
    ]);
    const counts = countInstancesByPrototype(graphs);
    expect(counts.get('a')).toBe(3);
    expect(counts.get('b')).toBe(1);
  });
});

describe('computeCarryOver — fills gaps, never overwrites', () => {
  it('carries a description the survivor lacks', () => {
    const gaps = computeCarryOver(proto('s', 'S'), proto('o', 'O', { description: 'theirs' }));
    expect(gaps.map(g => g.field)).toContain('description');
  });

  it('does NOT touch a description the survivor already has, even a shorter one', () => {
    const gaps = computeCarryOver(
      proto('s', 'S', { description: 'terse' }),
      proto('o', 'O', { description: 'a considerably longer description' })
    );
    expect(gaps.map(g => g.field)).not.toContain('description');
  });

  it('treats the default color as a gap but a real one as set', () => {
    expect(computeCarryOver(proto('s', 'S'), proto('o', 'O', { color: '#123456' }))
      .map(g => g.field)).toContain('color');
    expect(computeCarryOver(proto('s', 'S', { color: '#abcdef' }), proto('o', 'O', { color: '#123456' }))
      .map(g => g.field)).not.toContain('color');
  });

  it('moves the image fields as one unit', () => {
    const gaps = computeCarryOver(
      proto('s', 'S'),
      proto('o', 'O', { imageSrc: 'x.png', thumbnailSrc: 't.png', imageAspectRatio: 1.5 })
    );
    const image = gaps.find(g => g.field === 'image');
    expect(image.value).toEqual({ imageSrc: 'x.png', thumbnailSrc: 't.png', imageAspectRatio: 1.5 });
  });

  it('carries only the abstraction dimensions the survivor lacks', () => {
    const gaps = computeCarryOver(
      proto('s', 'S', { abstractionChains: { generalization: ['a', 's'] } }),
      proto('o', 'O', { abstractionChains: { generalization: ['x', 'o'], composition: ['c'] } })
    );
    expect(gaps.find(g => g.field === 'abstractionChains').value)
      .toEqual({ composition: ['c'] });
  });

  it('reports no gaps when the survivor has everything', () => {
    const full = { description: 'd', color: '#111', imageSrc: 'i', typeNodeId: 't' };
    expect(computeCarryOver(proto('s', 'S', full), proto('o', 'O', full))).toEqual([]);
  });
});

describe('scanForDuplicates', () => {
  const graphs = new Map([graphWith('g1', [inst('i1', 'a'), inst('i2', 'a'), inst('i3', 'b')])]);

  it('puts a shared Wikidata link in the certain band', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],
      ['b', proto('b', 'Doggo', { externalLinks: [WIKI('Q144')] })],
    ]);
    const r = scanForDuplicates(protos, graphs);
    expect(r.certain).toHaveLength(1);
    expect(r.certain[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('never pairs things with different Wikidata ids, whatever their names', () => {
    const protos = new Map([
      ['a', proto('a', 'Mercury', { externalLinks: [WIKI('Q308')] })],
      ['b', proto('b', 'Mercury', { externalLinks: [WIKI('Q925')] })],
    ]);
    const r = scanForDuplicates(protos, graphs);
    const all = [...r.certain, ...r.review, ...r.unlikely];
    expect(all).toHaveLength(0);
  });

  it('picks the most-used thing as survivor', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],   // 2 instances
      ['b', proto('b', 'Dog', { externalLinks: [WIKI('Q144')] })],   // 0 instances
    ]);
    const r = scanForDuplicates(protos, graphs);
    expect(r.certain[0].survivorId).toBe('a');
    expect(r.certain[0].survivorInstances).toBe(2);
  });

  it('attaches the gap-fill list to the pair', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],
      ['b', proto('b', 'Dog', { externalLinks: [WIKI('Q144')], description: 'a good dog' })],
    ]);
    const r = scanForDuplicates(protos, graphs);
    expect(r.certain[0].carryOver.map(g => g.field)).toContain('description');
  });

  it('finds a same-name pair without any links, in a weaker band', () => {
    const protos = new Map([
      ['a', proto('a', 'Ecology')],
      ['b', proto('b', 'ecology')],
    ]);
    const r = scanForDuplicates(protos, graphs);
    const all = [...r.certain, ...r.review, ...r.unlikely];
    expect(all).toHaveLength(1);
    expect(r.certain).toHaveLength(0); // a shared name alone is not proof
  });

  it('reports no pairs for unrelated things', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog')],
      ['b', proto('b', 'Photosynthesis')],
    ]);
    const r = scanForDuplicates(protos, graphs);
    expect([...r.certain, ...r.review, ...r.unlikely]).toHaveLength(0);
  });

  it('still finds link and name matches above the fuzzy cap', () => {
    const protos = new Map();
    for (let i = 0; i < 12; i++) protos.set(`n${i}`, proto(`n${i}`, `Thing ${i}`));
    protos.set('a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] }));
    protos.set('b', proto('b', 'Doggo', { externalLinks: [WIKI('Q144')] }));

    const r = scanForDuplicates(protos, graphs, { fuzzyCap: 5 });
    expect(r.fuzzySkipped).toBe(true);
    expect(r.certain).toHaveLength(1);
  });

  it('handles a universe too small to have duplicates', () => {
    expect(scanForDuplicates(new Map(), new Map()).certain).toEqual([]);
    expect(scanForDuplicates(new Map([['a', proto('a', 'Dog')]]), new Map()).review).toEqual([]);
  });
});
