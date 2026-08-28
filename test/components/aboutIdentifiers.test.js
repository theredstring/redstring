import { describe, it, expect } from 'vitest';
import {
  identifierFromUrl,
  collectIdentifiers,
  partitionIdentifiers,
  extractDOI
} from '../../src/utils/externalIdentifiers.js';
import { resolveOrigin, LOCAL_ORIGIN_LABEL } from '../../src/utils/nodeOrigin.js';
import {
  LINK_STATES,
  canonicalizeLink,
  resolveLinkState,
  setLinkState,
  clearLinkState,
  partitionLinksByState
} from '../../src/formats/linkState.js';

const WD = 'https://www.wikidata.org/wiki/Q144';
const WP = 'https://en.wikipedia.org/wiki/Dog';
const DB = 'https://dbpedia.org/page/Dog';

describe('identifierFromUrl', () => {
  it('reads authority and identifier out of the URL', () => {
    expect(identifierFromUrl(WD)).toMatchObject({ authority: 'Wikidata', identifier: 'Q144', isEntity: true });
    expect(identifierFromUrl(DB)).toMatchObject({ authority: 'DBpedia', identifier: 'Dog', isEntity: true });
    expect(identifierFromUrl(WP)).toMatchObject({ authority: 'Wikipedia', identifier: 'Dog' });
  });

  it('marks documents as non-entities', () => {
    // A Wikipedia article and a DOI denote documents ABOUT the subject, not the
    // subject — which is why they can't carry an identity claim on their own.
    expect(identifierFromUrl(WP).isEntity).toBe(false);
    expect(identifierFromUrl('doi:10.1038/nature12373').isEntity).toBe(false);
  });

  it('expands bare prefixes into working links', () => {
    expect(identifierFromUrl('doi:10.1038/nature12373').href).toBe('https://doi.org/10.1038/nature12373');
    expect(identifierFromUrl('wd:Q144').href).toBe('https://www.wikidata.org/wiki/Q144');
  });

  it('falls back to the host for anything unrecognised', () => {
    expect(identifierFromUrl('https://example.com/things/dog'))
      .toMatchObject({ authority: 'example.com', identifier: 'dog' });
  });
});

describe('extractDOI', () => {
  it('accepts a bare DOI, a doi.org URL, and a PubMed URL', () => {
    expect(extractDOI('10.1038/nature12373')).toBe('10.1038/nature12373');
    expect(extractDOI('https://doi.org/10.1038/nature12373')).toBe('10.1038/nature12373');
    expect(extractDOI('https://pubmed.ncbi.nlm.nih.gov/12345')).toBe('pubmed:12345');
    expect(extractDOI('https://example.com')).toBeNull();
  });
});

describe('collectIdentifiers', () => {
  it('unions every place the app has stored links', () => {
    // Semantic Discovery writes semanticMetadata.externalLinks rather than the
    // top-level array, which is why those links were invisible before.
    const proto = {
      externalLinks: [WD],
      semanticMetadata: {
        externalLinks: [DB],
        wikipediaUrl: WP,
        originMetadata: { originalUri: 'https://example.com/source' }
      }
    };
    expect(collectIdentifiers(proto)).toEqual([WD, DB, WP, 'https://example.com/source']);
  });

  it('dedupes across locations by canonical URL, keeping first-seen order', () => {
    const proto = {
      externalLinks: [WD, `${WP}?utm_source=x`],
      semanticMetadata: { externalLinks: [WD], wikipediaUrl: WP }
    };
    expect(collectIdentifiers(proto)).toEqual([WD, `${WP}?utm_source=x`]);
  });

  it('survives a prototype with nothing on it', () => {
    expect(collectIdentifiers({})).toEqual([]);
    expect(collectIdentifiers(null)).toEqual([]);
  });
});

describe('partitionIdentifiers', () => {
  it('always returns all three standard slots, in order, empty or not', () => {
    const { slots, extras } = partitionIdentifiers({ externalLinks: [WP] });
    expect(slots.map(s => s.kind)).toEqual(['wikidata', 'wikipedia', 'dbpedia']);
    expect(slots.map(s => s.url)).toEqual([null, WP, null]);
    expect(extras).toEqual([]);
  });

  it('files each link under its own authority rather than folding any together', () => {
    // Wikidata and Wikipedia can disagree about what a word means — Wikidata's
    // "Symptoms" is an artwork — so each needs its own row and its own swap.
    const proto = { externalLinks: [WD, WP, DB], semanticMetadata: { wikidataUrl: WD, wikipediaUrl: WP } };
    const { slots, extras } = partitionIdentifiers(proto);
    expect(slots.map(s => s.url)).toEqual([WD, WP, DB]);
    expect(extras).toEqual([]);
  });

  it('puts everything non-standard in extras, in order', () => {
    const proto = { externalLinks: ['doi:10.1038/nature12373', WD, 'https://example.com/x'] };
    const { slots, extras } = partitionIdentifiers(proto);
    expect(slots[0].url).toBe(WD);
    expect(extras).toEqual(['doi:10.1038/nature12373', 'https://example.com/x']);
  });

  it('keeps a second link to the same authority instead of dropping it', () => {
    const other = 'https://www.wikidata.org/wiki/Q999';
    const { slots, extras } = partitionIdentifiers({ externalLinks: [WD, other] });
    expect(slots[0].url).toBe(WD);
    expect(extras).toEqual([other]);
  });
});

describe('resolveOrigin', () => {
  it('says Redstring for a Thing with no outside source', () => {
    expect(resolveOrigin({}).label).toBe(LOCAL_ORIGIN_LABEL);
    expect(resolveOrigin({}).isLocal).toBe(true);
  });

  it('does not read an enrichment link as an origin', () => {
    // Auto-enrichment adds Wikidata links to Things made here, long after they
    // were made. Having one says nothing about where the Thing came from.
    const proto = { externalLinks: [WD], semanticMetadata: { wikidataUrl: WD, autoEnriched: true } };
    expect(resolveOrigin(proto).label).toBe(LOCAL_ORIGIN_LABEL);
  });

  it('names the service that handed the Thing over, and links back to it', () => {
    const proto = { semanticMetadata: { originMetadata: { source: 'wikidata', originalUri: WD } } };
    expect(resolveOrigin(proto)).toEqual({ label: 'Wikidata', href: WD, isLocal: false });
  });

  it('reads the authority off the URI when the source is just "external"', () => {
    const proto = { semanticMetadata: { originMetadata: { source: 'external', originalUri: DB } } };
    expect(resolveOrigin(proto).label).toBe('DBpedia');
  });

  it('lets a recorded origin win, for when Things can name their universe', () => {
    const proto = { semanticMetadata: { origin: { label: 'Redstring (Field Notes)' }, originMetadata: { source: 'wikidata' } } };
    expect(resolveOrigin(proto).label).toBe('Redstring (Field Notes)');
  });
});

describe('link state', () => {
  it('canonicalizes away tracking params, trailing slash, hash and case', () => {
    expect(canonicalizeLink('HTTPS://EN.Wikipedia.org/wiki/Dog/?utm_source=x#intro'))
      .toBe('https://en.wikipedia.org/wiki/Dog');
  });

  it('falls back to the old whole-array signal when nothing is recorded', () => {
    expect(resolveLinkState(WD, undefined)).toBe(LINK_STATES.CONFIRMED);
    expect(resolveLinkState(WD, { autoEnriched: true })).toBe(LINK_STATES.MATCHED);
  });

  it('folds a stored "same" record down to confirmed', () => {
    // The rung above confirmed is retired. A record still carrying it resolves
    // to the strongest rung that survives rather than to nothing.
    const sm = { linkConfirmations: { [canonicalizeLink(WD)]: { state: 'same', by: 'user' } } };
    expect(resolveLinkState(WD, sm)).toBe(LINK_STATES.CONFIRMED);
    expect(LINK_STATES.SAME).toBeUndefined();
  });

  it('lets a per-link record win over the image flag', () => {
    const sm = setLinkState({ autoEnriched: true }, WD, LINK_STATES.CONFIRMED);
    expect(resolveLinkState(WD, sm)).toBe(LINK_STATES.CONFIRMED);
    // An unrecorded link still falls back.
    expect(resolveLinkState(WP, sm)).toBe(LINK_STATES.MATCHED);
  });

  it('matches a record written with a differently-spelled URL', () => {
    const sm = setLinkState({}, `${WD}/?utm_campaign=x`, LINK_STATES.CONFIRMED);
    expect(resolveLinkState(WD, sm)).toBe(LINK_STATES.CONFIRMED);
  });

  it('clears a record without disturbing the others', () => {
    let sm = setLinkState({}, WD, LINK_STATES.CONFIRMED);
    sm = setLinkState(sm, DB, LINK_STATES.MATCHED);
    sm = clearLinkState(sm, WD);
    expect(sm.linkConfirmations[canonicalizeLink(WD)]).toBeUndefined();
    expect(sm.linkConfirmations[canonicalizeLink(DB)]).toBeDefined();
  });

  it('partitions a mixed set into the two rungs', () => {
    let sm = setLinkState({}, WD, LINK_STATES.CONFIRMED);
    sm = setLinkState(sm, WP, LINK_STATES.MATCHED);
    sm = setLinkState(sm, DB, LINK_STATES.CONFIRMED);
    expect(partitionLinksByState([WD, WP, DB], sm)).toEqual({
      matched: [WP], confirmed: [WD, DB]
    });
  });
});
