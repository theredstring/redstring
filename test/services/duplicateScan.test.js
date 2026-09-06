import { describe, it, expect } from 'vitest';
import { calculateEntityMatchConfidence } from '../../src/services/entityMatching.js';
import {
  prototypeToEntity,
  countUsesByPrototype,
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

describe('countUsesByPrototype', () => {
  it('counts instances across every web', () => {
    const graphs = new Map([
      graphWith('g1', [inst('i1', 'a'), inst('i2', 'a'), inst('i3', 'b')]),
      graphWith('g2', [inst('i4', 'a')]),
    ]);
    const counts = countUsesByPrototype(graphs, new Map());
    expect(counts.get('a').instances).toBe(3);
    expect(counts.get('b').instances).toBe(1);
  });

  // A thing used as a connection's type is used, even with nothing on canvas.
  it('counts a thing used as a connection type', () => {
    const edges = new Map([
      ['e1', { id: 'e1', sourceId: 'i1', destinationId: 'i2', typeNodeId: 'eats' }],
      ['e2', { id: 'e2', sourceId: 'i2', destinationId: 'i3', typeNodeId: 'eats' }],
    ]);
    const counts = countUsesByPrototype(new Map(), edges);
    expect(counts.get('eats')).toEqual({ instances: 0, connections: 2, total: 2 });
  });

  it('totals both kinds of use together', () => {
    const graphs = new Map([graphWith('g1', [inst('i1', 'eats')])]);
    const edges = new Map([['e1', { id: 'e1', typeNodeId: 'eats' }]]);
    expect(countUsesByPrototype(graphs, edges).get('eats'))
      .toEqual({ instances: 1, connections: 1, total: 2 });
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
  const edges = new Map();

  it('puts a shared Wikidata link between same-named things in certain', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],
      ['b', proto('b', 'Dog', { externalLinks: [WIKI('Q144')] })],
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    expect(r.certain).toHaveLength(1);
    expect(r.certain[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('never pairs things with different Wikidata ids, whatever their names', () => {
    const protos = new Map([
      ['a', proto('a', 'Mercury', { externalLinks: [WIKI('Q308')] })],
      ['b', proto('b', 'Mercury', { externalLinks: [WIKI('Q925')] })],
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    const all = [...r.certain, ...r.review, ...r.unlikely];
    expect(all).toHaveLength(0);
  });

  it('picks the most-used thing as survivor', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],   // 2 instances
      ['b', proto('b', 'Dog', { externalLinks: [WIKI('Q144')] })],   // 0 instances
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    expect(r.certain[0].survivorId).toBe('a');
    expect(r.certain[0].survivorUses.total).toBe(2);
  });

  it('lets connection use decide the survivor, not just canvas instances', () => {
    // 'b' is on no canvas but types three connections; 'a' is placed once.
    const protos = new Map([
      ['a', proto('a', 'Eats', { externalLinks: [WIKI('Q1')] })],
      ['b', proto('b', 'Eats', { externalLinks: [WIKI('Q1')] })],
    ]);
    const oneInstance = new Map([graphWith('g1', [inst('i1', 'a')])]);
    const typedEdges = new Map([
      ['e1', { id: 'e1', typeNodeId: 'b' }],
      ['e2', { id: 'e2', typeNodeId: 'b' }],
      ['e3', { id: 'e3', typeNodeId: 'b' }],
    ]);

    const r = scanForDuplicates(protos, oneInstance, typedEdges);
    expect(r.certain[0].survivorId).toBe('b');
    expect(r.certain[0].survivorUses).toEqual({ instances: 0, connections: 3, total: 3 });
  });

  it('attaches the gap-fill list to the pair', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],
      ['b', proto('b', 'Dog', { externalLinks: [WIKI('Q144')], description: 'a good dog' })],
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    expect(r.certain[0].carryOver.map(g => g.field)).toContain('description');
  });

  it('finds a same-name pair without any links, in a weaker band', () => {
    const protos = new Map([
      ['a', proto('a', 'Ecology')],
      ['b', proto('b', 'ecology')],
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    const all = [...r.certain, ...r.review, ...r.unlikely];
    expect(all).toHaveLength(1);
    expect(r.certain).toHaveLength(0); // a shared name alone is not proof
  });

  it('reports no pairs for unrelated things', () => {
    const protos = new Map([
      ['a', proto('a', 'Dog')],
      ['b', proto('b', 'Photosynthesis')],
    ]);
    const r = scanForDuplicates(protos, graphs, edges);
    expect([...r.certain, ...r.review, ...r.unlikely]).toHaveLength(0);
  });

  it('still finds link and name matches above the fuzzy cap', () => {
    const protos = new Map();
    for (let i = 0; i < 12; i++) protos.set(`n${i}`, proto(`n${i}`, `Thing ${i}`));
    protos.set('a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] }));
    protos.set('b', proto('b', 'Doggo', { externalLinks: [WIKI('Q144')] }));

    const r = scanForDuplicates(protos, graphs, edges, { fuzzyCap: 5 });
    expect(r.fuzzySkipped).toBe(true);
    // The point is that link bucketing still runs, so the pair is still FOUND.
    // Which band it lands in is the name bar's business, tested separately.
    expect([...r.certain, ...r.review, ...r.unlikely]).toHaveLength(1);
  });

  // Enrichment routinely lands a whole cast on one "List of X characters"
  // page. That link scores 0.90 on its own — enough to auto-merge every
  // character in the list into one thing.
  describe('a shared hub page is not proof of identity', () => {
    const LIST = 'https://en.wikipedia.org/wiki/List_of_Mario_characters';

    it('keeps two different characters on one cast list out of certain', () => {
      const protos = new Map([
        ['a', proto('a', 'Mario', { externalLinks: [LIST] })],
        ['b', proto('b', 'Princess Peach', { externalLinks: [LIST] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
      // Their names are also nothing alike, so this lands in unlikely.
      expect(r.unlikely).toHaveLength(1);
    });

    it('demotes a hub link even when the names DO match', () => {
      // The name bar can't catch this one — only the hub rule can.
      const protos = new Map([
        ['a', proto('a', 'Toad', { externalLinks: [LIST] })],
        ['b', proto('b', 'Toad', { externalLinks: [LIST] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
      expect(r.review[0].demotedBecause).toBe('shared page covers many things');
    });

    it('demotes a disambiguation page the same way', () => {
      const DAB = 'https://en.wikipedia.org/wiki/Mercury_(disambiguation)';
      const protos = new Map([
        ['a', proto('a', 'Mercury', { externalLinks: [DAB] })],
        ['b', proto('b', 'Mercury the planet', { externalLinks: [DAB] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
    });

    it('still trusts a real page shared by two things with the same name', () => {
      const PAGE = 'https://en.wikipedia.org/wiki/Dog';
      const protos = new Map([
        ['a', proto('a', 'Dog', { externalLinks: [PAGE] })],
        ['b', proto('b', 'Dog', { externalLinks: [PAGE] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(1);
      expect(r.certain[0].demotedBecause).toBeNull();
    });
  });

  describe('certain requires the names to be plausible', () => {
    it('allows a typo through — that is what the bar is for', () => {
      const protos = new Map([
        ['a', proto('a', 'Mitochondrion', { externalLinks: [WIKI('Q39572')] })],
        ['b', proto('b', 'Mitochondrian', { externalLinks: [WIKI('Q39572')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(1);
    });

    it('holds back a merely similar name, even on a shared link', () => {
      // 'dog' vs 'doggo' is 60% — under the unlikely bar, so it goes there.
      const protos = new Map([
        ['a', proto('a', 'Dog', { externalLinks: [WIKI('Q144')] })],
        ['b', proto('b', 'Doggo', { externalLinks: [WIKI('Q144')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
      expect(r.unlikely[0].demotedBecause).toBe('names are too different');
    });

    it('drops a badly mismatched name to unlikely, not review', () => {
      // Below 75% similar there is no decision worth surfacing — it should not
      // sit in the queue of pairs asking to be judged.
      const protos = new Map([
        ['a', proto('a', 'Mario', { externalLinks: [WIKI('Q12379')] })],
        ['b', proto('b', 'Princess Peach', { externalLinks: [WIKI('Q12379')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
      expect(r.review).toHaveLength(0);
      expect(r.unlikely).toHaveLength(1);
      expect(r.unlikely[0].demotedBecause).toBe('names are too different');
    });

    it('keeps a near-miss name in review, where a decision belongs', () => {
      // "Doggo" is ~60% — under the certain bar but well over the unlikely one.
      const protos = new Map([
        ['a', proto('a', 'Doggos', { externalLinks: [WIKI('Q144')] })],
        ['b', proto('b', 'Doggo', { externalLinks: [WIKI('Q144')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
      expect(r.review).toHaveLength(1);
    });

    it('holds back one name being the start of another', () => {
      // Containment is not sameness: "Mario Kart" is not Mario.
      const protos = new Map([
        ['a', proto('a', 'Mario', { externalLinks: [WIKI('Q12379')] })],
        ['b', proto('b', 'Mario Kart', { externalLinks: [WIKI('Q12379')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect(r.certain).toHaveLength(0);
    });

    it('a demoted pair is still offered, never dropped', () => {
      const protos = new Map([
        ['a', proto('a', 'Mario', { externalLinks: [WIKI('Q12379')] })],
        ['b', proto('b', 'Princess Peach', { externalLinks: [WIKI('Q12379')] })],
      ]);
      const r = scanForDuplicates(protos, graphs, edges);
      expect([...r.certain, ...r.review, ...r.unlikely]).toHaveLength(1);
    });
  });

  it('handles a universe too small to have duplicates', () => {
    expect(scanForDuplicates(new Map(), new Map(), new Map()).certain).toEqual([]);
    expect(scanForDuplicates(new Map([['a', proto('a', 'Dog')]]), new Map(), new Map()).review).toEqual([]);
  });
});
