import { describe, it, expect } from 'vitest';
import {
  identifierFromUrl,
  collectIdentifiers,
  groupIdentifiers,
  extractDOI
} from '../../src/utils/externalIdentifiers.js';
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

describe('groupIdentifiers', () => {
  it('folds the Wikipedia article into the Wikidata row when one lookup found both', () => {
    const proto = { externalLinks: [WD, WP], semanticMetadata: { wikidataUrl: WD, wikipediaUrl: WP } };
    const rows = groupIdentifiers(collectIdentifiers(proto), proto);
    expect(rows).toEqual([{ url: WD, page: WP }]);
  });

  it('leaves the article standing alone when nothing pairs them', () => {
    // No wikidataUrl recorded → the two were not captured together, and
    // inferring the pairing would fabricate a claim the user never made.
    const proto = { externalLinks: [WD, WP], semanticMetadata: {} };
    const rows = groupIdentifiers(collectIdentifiers(proto), proto);
    expect(rows).toEqual([{ url: WD, page: null }, { url: WP, page: null }]);
  });
});

describe('link state', () => {
  it('canonicalizes away tracking params, trailing slash, hash and case', () => {
    expect(canonicalizeLink('HTTPS://EN.Wikipedia.org/wiki/Dog/?utm_source=x#intro'))
      .toBe('https://en.wikipedia.org/wiki/Dog');
  });

  it('reproduces the old whole-array behavior when nothing is recorded', () => {
    expect(resolveLinkState(WD, undefined)).toBe(LINK_STATES.SAME);
    expect(resolveLinkState(WD, { autoEnriched: true })).toBe(LINK_STATES.MATCHED);
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
    sm = setLinkState(sm, DB, LINK_STATES.SAME);
    sm = clearLinkState(sm, WD);
    expect(sm.linkConfirmations[canonicalizeLink(WD)]).toBeUndefined();
    expect(sm.linkConfirmations[canonicalizeLink(DB)]).toBeDefined();
  });

  it('partitions a mixed set into the three rungs', () => {
    let sm = setLinkState({}, WD, LINK_STATES.SAME);
    sm = setLinkState(sm, WP, LINK_STATES.MATCHED);
    sm = setLinkState(sm, DB, LINK_STATES.CONFIRMED);
    expect(partitionLinksByState([WD, WP, DB], sm)).toEqual({
      same: [WD], matched: [WP], confirmed: [DB]
    });
  });
});
