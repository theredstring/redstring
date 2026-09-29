import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeQuery = vi.fn();
vi.mock('../../src/services/sparqlClient.js', () => ({ sparqlClient: { executeQuery: (...a) => executeQuery(...a) } }));
const searchConcepts = vi.fn();
vi.mock('../../src/services/identifierSearch.js', () => ({ searchConcepts: (...a) => searchConcepts(...a) }));
const getWikidataIdFromWikipedia = vi.fn();
vi.mock('../../src/wizard/services/wikipediaEnrichment.js', () => ({ getWikidataIdFromWikipedia: (...a) => getWikidataIdFromWikipedia(...a) }));

import { resolveSemanticIdentity, getSemanticConnections, clearSemanticCache } from '../../src/services/semanticSearchEngine.js';

// The search engine settles which subject a seed is before asking about it, then
// returns its statements both ways, Wikidata first, DBpedia folded in.
const lit = (value) => ({ value });
const wdOut = (pid, pLabel, q, label) => ({ p: lit(`http://www.wikidata.org/entity/${pid}`), pLabel: lit(pLabel), o: lit(`http://www.wikidata.org/entity/${q}`), oLabel: lit(label) });
const wdIn = (pid, pLabel, q, label) => ({ p: lit(`http://www.wikidata.org/entity/${pid}`), pLabel: lit(pLabel), s: lit(`http://www.wikidata.org/entity/${q}`), sLabel: lit(label) });
const dbp = (prop, res, label) => ({ p: lit(`http://dbpedia.org/ontology/${prop}`), o: lit(`http://dbpedia.org/resource/${res}`), oLabel: lit(label) });

function answer({ out = [], inc = [], db = [] } = {}) {
  executeQuery.mockImplementation(async (endpoint, query) => {
    if (endpoint === 'dbpedia') return db;
    return query.includes('?s ?pd wd:') ? inc : out;
  });
}

describe('semanticSearchEngine', () => {
  beforeEach(() => {
    clearSemanticCache();
    executeQuery.mockReset();
    searchConcepts.mockReset();
    getWikidataIdFromWikipedia.mockReset();
  });

  it("reads identity from the Thing's own links, without searching", async () => {
    const id = await resolveSemanticIdentity({ name: 'Paris', externalLinks: ['https://www.wikidata.org/wiki/Q90', 'https://en.wikipedia.org/wiki/Paris'] });
    expect(id.qid).toBe('Q90');
    expect(id.dbpediaUri).toBe('http://dbpedia.org/resource/Paris');
    expect(id.resolvedBy).toBe('links');
    expect(searchConcepts).not.toHaveBeenCalled();
  });

  it('settles a bare name only on an exact match, never a near miss', async () => {
    searchConcepts.mockResolvedValue([{ name: 'Social democracy', uri: 'http://dbpedia.org/resource/Social_democracy', externalLinks: [] }]);
    getWikidataIdFromWikipedia.mockResolvedValue(null);
    const miss = await resolveSemanticIdentity('Democracy');
    expect(miss.qid).toBeNull();
    expect(miss.dbpediaUri).toBeNull();

    searchConcepts.mockResolvedValue([{ name: 'democracy', uri: 'https://www.wikidata.org/wiki/Q7174', externalLinks: ['https://www.wikidata.org/wiki/Q7174', 'https://en.wikipedia.org/wiki/Democracy'] }]);
    const hit = await resolveSemanticIdentity('Democracy');
    expect(hit.qid).toBe('Q7174');
    expect(hit.resolvedBy).toBe('search');
  });

  it('returns statements both ways and drops bookkeeping', async () => {
    answer({
      out: [wdOut('P31', 'instance of', 'Q515', 'city'), wdOut('P910', "topic's main category", 'Q1', 'Category:Paris')],
      inc: [wdIn('P36', 'capital', 'Q142', 'France'), wdIn('P31', 'instance of', 'Q2', 'Template:Paris')]
    });
    const { connections } = await getSemanticConnections({ name: 'Paris', externalLinks: ['https://www.wikidata.org/wiki/Q90'] });
    const rows = connections.map((c) => `${c.subject} ${c.predicate} ${c.object}`);
    expect(rows).toEqual(expect.arrayContaining(['Paris Instance Of City', 'France Capital Paris']));
    expect(rows.join()).not.toMatch(/Category:|Template:/);
    const capital = connections.find((c) => c.predicate === 'Capital');
    expect(capital.direction).toBe('in');
    expect(capital.other.semanticMetadata.originalUri).toBe('http://www.wikidata.org/entity/Q142');
  });

  it('folds a DBpedia statement into the Wikidata one about the same Thing, keeping both links', async () => {
    answer({
      out: [wdOut('P17', 'country', 'Q142', 'France')],
      db: [dbp('country', 'France', 'France'), dbp('mayor', 'Anne_Hidalgo', 'Anne Hidalgo')]
    });
    const { connections } = await getSemanticConnections({ name: 'Paris', externalLinks: ['https://www.wikidata.org/wiki/Q90', 'http://dbpedia.org/resource/Paris'] });
    const france = connections.filter((c) => c.other.name === 'France');
    expect(france).toHaveLength(1);
    expect(france[0].provider).toBe('wikidata');
    expect(france[0].other.semanticMetadata.externalLinks).toEqual(['http://www.wikidata.org/entity/Q142', 'http://dbpedia.org/resource/France']);
    expect(connections.some((c) => c.other.name === 'Anne Hidalgo' && c.provider === 'dbpedia')).toBe(true);
  });

  it('asks once per subject, however many ask', async () => {
    answer({ out: [wdOut('P31', 'instance of', 'Q515', 'city')] });
    const seed = { name: 'Paris', externalLinks: ['https://www.wikidata.org/wiki/Q90'] };
    await Promise.all([getSemanticConnections(seed), getSemanticConnections(seed)]);
    await getSemanticConnections(seed);
    // Two Wikidata queries (out, in) for one subject; no DBpedia link, no DBpedia query.
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  it('says nothing, rather than guess, for a subject it cannot place', async () => {
    searchConcepts.mockResolvedValue([]);
    getWikidataIdFromWikipedia.mockResolvedValue(null);
    const { identity, connections } = await getSemanticConnections('Zzxq');
    expect(identity.qid).toBeNull();
    expect(connections).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
