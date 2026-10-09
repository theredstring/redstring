import { describe, it, expect, vi, beforeEach } from 'vitest';

// utils.js measures text when it loads; jsdom has no 2D context.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});
// The article fetch is the network; what lands depends on what the Thing lacks.
const page = {
  title: 'Mitochondrion', url: 'https://en.wikipedia.org/wiki/Mitochondrion',
  description: 'An organelle.', thumbnail: 'https://upload.wikimedia.org/thumb/330px-Mito.png',
  thumbnailWidth: 330, thumbnailHeight: 220
};
vi.mock('../../src/services/conceptEnrichment.js', () => ({
  enrichPrototypeFromLinks: vi.fn(),
  wikipediaTitleFromLinks: vi.fn(async () => 'Mitochondrion')
}));
vi.mock('../../src/wizard/services/wikipediaEnrichment.js', () => ({
  fetchWikipediaPage: vi.fn(async () => ({ type: 'direct', page }))
}));
vi.mock('../../src/services/imageCache.js', async (orig) => ({
  ...(await orig()),
  queueThumbnailFetch: vi.fn(),
  cancelThumbnailFetch: vi.fn()
}));

import useGraphStore from '../../src/store/graphStore.js';
import { resolveLinkState, LINK_STATES } from '../../src/formats/linkState.js';
import { findPrototypeForConcept } from '../../src/services/semanticPlacement.js';
import {
  conceptIsPrototype, linkConceptToPrototype, unlinkConceptFromPrototype, describeLinkEffect, identifiedSources
} from '../../src/services/conceptLinking.js';

const st = () => useGraphStore.getState();
const WD = (q) => `https://www.wikidata.org/wiki/${q}`;
const WP = (t) => `https://en.wikipedia.org/wiki/${t}`;
const mito = {
  id: WD('Q39572'), name: 'Mitochondrion', color: '#446688', source: 'wikidata',
  semanticMetadata: { originalUri: WD('Q39572'), externalLinks: [WD('Q39572'), WP('Mitochondrion')] }
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(fields = {}) {
  useGraphStore.setState({
    graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), openGraphIds: [], activeGraphId: null,
    savedNodeIds: new Set(), savedGraphIds: new Set(), isUniverseLoaded: true, hasUniverseFile: true,
  }, false, 'test_reset');
  st().addNodePrototype({
    id: 'p-mito', name: 'Mitochondria', description: '', color: '#111111',
    typeNodeId: null, definitionGraphIds: [], ...fields
  });
}
const proto = () => st().nodePrototypes.get('p-mito');

describe('conceptLinking', () => {
  beforeEach(() => setup());

  it('makes a hand-made Thing the one its result stands for', async () => {
    expect(findPrototypeForConcept(mito)).toBeNull();
    linkConceptToPrototype('p-mito', mito);

    expect(conceptIsPrototype(mito, proto())).toBe(true);
    expect(findPrototypeForConcept(mito)?.id).toBe('p-mito');
    expect(resolveLinkState(WD('Q39572'), proto().semanticMetadata)).toBe(LINK_STATES.EXACT);
    expect(proto().semanticMetadata.wikidataUrl).toBe(WD('Q39572'));

    await flush();
    expect(proto().description).toBe('An organelle.');
    expect(proto().semanticMetadata.wikipediaThumbnail).toBe(page.thumbnail);
  });

  it('replaces the entry per authority and keeps everything else', () => {
    setup({ externalLinks: [WD('Q1'), 'https://doi.org/10.1000/x'] });
    linkConceptToPrototype('p-mito', mito);
    expect(proto().externalLinks).toEqual(['https://doi.org/10.1000/x', WD('Q39572'), WP('Mitochondrion')]);
  });

  it('accumulates results from different sources on one Thing', () => {
    const wdOnly = { id: 'a', name: 'Mitochondrion', semanticMetadata: { originalUri: WD('Q39572'), externalLinks: [WD('Q39572')] } };
    const wpOnly = { id: 'b', name: 'Mitochondrion', semanticMetadata: { originalUri: WP('Mitochondrion'), externalLinks: [WP('Mitochondrion')] } };
    linkConceptToPrototype('p-mito', wdOnly);
    expect(describeLinkEffect(wpOnly, proto())).toBe('adds Wikipedia');
    linkConceptToPrototype('p-mito', wpOnly);
    expect(identifiedSources(proto())).toEqual(['Wikidata', 'Wikipedia']);
    expect(conceptIsPrototype(wdOnly, proto())).toBe(true);
    expect(conceptIsPrototype(wpOnly, proto())).toBe(true);
    expect(describeLinkEffect({ semanticMetadata: { externalLinks: [WD('Q2')] } }, proto())).toBe('replaces its Wikidata entry');
  });

  it('never overwrites a description or a picture the Thing has', async () => {
    setup({ description: 'Mine.', imageSrc: 'data:image/png;base64,AAAA' });
    linkConceptToPrototype('p-mito', mito);
    await flush();
    expect(proto().description).toBe('Mine.');
    expect(proto().semanticMetadata?.wikipediaThumbnail).toBeUndefined();
    expect(proto().semanticMetadata?.autoEnriched).toBeFalsy();
  });

  it('unlinks back to a Thing no result stands for', () => {
    linkConceptToPrototype('p-mito', mito);
    unlinkConceptFromPrototype('p-mito', mito);
    expect(conceptIsPrototype(mito, proto())).toBe(false);
    expect(proto().semanticMetadata.wikidataUrl).toBeUndefined();
    expect(proto().semanticMetadata.linkConfirmations).toEqual({});
  });
});
