/**
 * The semantic search engine: what the shared web says about any Thing.
 *
 * One seed in — a prototype, a discovered concept, or just a name — and its
 * statements out, as triplets whose other end is a concept every "add" path
 * already understands. The orbit, the discovery page and the right panel's
 * Semantic Web connections all read from here.
 *
 * Identity first, then statements. Every older pipeline looked a Thing up by
 * its name, which fails in two quiet ways: Wikidata labels common nouns in
 * lower case (an exact "Photosynthesis"@en finds nothing), and a name shared by
 * several subjects mixes their facts together. So the engine settles WHICH
 * subject this is — from the links the Thing already carries, else from the
 * same search the discovery panel's Concepts mode uses — and only then asks
 * for its statements, by QID and by DBpedia resource.
 *
 * Statements come both ways: what this Thing points at ("Photosynthesis → part
 * of → carbon fixation") and what points at it ("chloroplast → has use →
 * photosynthesis"). Wikidata leads; DBpedia fills in what Wikidata doesn't say
 * and adds its URI to the ones both agree on.
 */
import { sparqlClient } from './sparqlClient.js';
import { searchConcepts } from './identifierSearch.js';
import { identifierFromUrl } from '../utils/externalIdentifiers.js';
import { getWikidataIdFromWikipedia } from '../wizard/services/wikipediaEnrichment.js';
import { formatPredicate } from '../utils/predicateFormatter.js';
import titleCaseName from '../utils/titleCaseName.js';
import { generateConceptColor } from '../utils/colorUtils.js';
import { getPredicateInfo } from './candidates.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const QUERY_TIMEOUT_MS = 12000;
const INCOMING_TIMEOUT_MS = 8000;
const cache = new Map();     // key → { timestamp, result }
const inFlight = new Map();  // key → Promise

const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

// Wikidata properties that point at bookkeeping rather than at the subject:
// categories, portals, lists, templates, sources, project maintenance.
const WIKIDATA_NOISE = new Set([
  'P301', 'P360', 'P910', 'P971', 'P1151', 'P1204', 'P1343', 'P1424', 'P1753', 'P1754', 'P2354',
  'P3876', 'P4224', 'P5008', 'P5125', 'P6104', 'P7084', 'P8989', 'P1687', 'P2184', 'P1889', 'P460',
  'P6186', 'P8402', 'P2959', 'P3342'
]);

// DBpedia properties that are page plumbing, not statements.
const DBPEDIA_NOISE = [
  'wikiPageWikiLink', 'wikiPageRedirects', 'wikiPageDisambiguates', 'wikiPageExternalLink',
  'wikiPageID', 'wikiPageRevisionID', 'wikiPageLength', 'thumbnail', 'depiction', 'abstract',
  'wikiPageUsesTemplate', 'wikiPageInterLanguageLink'
].map((p) => `http://dbpedia.org/ontology/${p}`);

// Wikidata properties the orbit's predicate tiers already know by another name,
// so a Wikidata fact ranks as what it is rather than falling to the bottom tier.
const WIKIDATA_PREDICATE_KEYS = {
  P31: 'instanceOf', P279: 'subclassOf', P361: 'partOf', P527: 'hasPart', P463: 'memberOf',
  P170: 'creator', P50: 'author', P175: 'performer', P136: 'genre', P921: 'subject',
  P19: 'placeOfBirth', P20: 'placeOfDeath', P106: 'occupation', P17: 'country', P27: 'nationality',
  P39: 'position', P101: 'field', P800: 'knownFor', P737: 'influencedBy', P166: 'award',
  P135: 'movement', P407: 'language', P112: 'foundedBy', P108: 'employer', P26: 'spouse',
  P40: 'child', P22: 'parent', P25: 'parent', P3373: 'sibling', P131: 'locatedIn', P276: 'location',
  P36: 'capital', P1269: 'relatedTo', P1535: 'relatedTo', P366: 'relatedTo', P2283: 'relatedTo',
  P1552: 'relatedTo', P461: 'relatedTo'
};

/**
 * The identifiers a seed already carries, in every place a Thing keeps them.
 * @returns {string[]}
 */
function seedLinks(seed) {
  if (!seed || typeof seed === 'string') return [];
  const out = new Set();
  const add = (u) => { if (typeof u === 'string' && u) out.add(u); };
  add(seed.uri);
  add(seed.wikidataUrl);
  add(seed.wikipediaUrl);
  add(seed.semanticMetadata?.originalUri);
  add(seed.semanticMetadata?.originMetadata?.originalUri);
  add(seed.semanticMetadata?.wikidataUrl);
  add(seed.semanticMetadata?.wikipediaUrl);
  (seed.externalLinks || []).forEach((l) => add(typeof l === 'string' ? l : l?.url || l?.uri));
  (seed.semanticMetadata?.externalLinks || []).forEach((l) => add(typeof l === 'string' ? l : l?.url || l?.uri));
  return [...out];
}

function readLinks(links) {
  let qid = null; let dbpediaUri = null; let wikipediaTitle = null;
  for (const link of links) {
    const id = identifierFromUrl(link);
    if (id.kind === 'wikidata' && !qid && /^Q\d+$/.test(id.identifier)) qid = id.identifier;
    else if (id.kind === 'dbpedia' && !dbpediaUri && /\/resource\//.test(link)) {
      dbpediaUri = `http://dbpedia.org/resource/${link.split('/resource/').pop()}`;
    } else if (id.kind === 'wikipedia' && !wikipediaTitle && /en\.(m\.)?wikipedia\.org\/wiki\//.test(link)) {
      wikipediaTitle = id.identifier;
    }
  }
  return { qid, dbpediaUri, wikipediaTitle };
}

/**
 * Which subject a seed is.
 *
 * @param {Object|string} seed - a prototype, a concept, or a name
 * @returns {Promise<{name, qid, dbpediaUri, wikipediaTitle, links: string[], resolvedBy}>}
 *   `resolvedBy` is 'links' (the seed said), 'search' (the Concepts search
 *   settled it) or null (nothing found — no statements will follow).
 */
export async function resolveSemanticIdentity(seed, { signal } = {}) {
  const name = typeof seed === 'string' ? seed.trim() : (seed?.name || '').trim();
  const links = seedLinks(seed);
  let { qid, dbpediaUri, wikipediaTitle } = readLinks(links);
  let resolvedBy = qid || dbpediaUri || wikipediaTitle ? 'links' : null;

  if (!qid && !dbpediaUri && !wikipediaTitle && name) {
    try {
      const hits = await searchConcepts(name, { limit: 3, signal });
      // Only a hit that IS this name. The top hit for "Democracy" can be
      // "Social democracy" when one index is slow, and a near miss would hand
      // this Thing another subject's statements.
      const hit = hits.find((h) => lower(h.name) === lower(name));
      if (hit) {
        const found = readLinks([hit.uri, ...(hit.externalLinks || [])].filter(Boolean));
        qid = found.qid; dbpediaUri = found.dbpediaUri; wikipediaTitle = found.wikipediaTitle;
        (hit.externalLinks || []).forEach((l) => { if (!links.includes(l)) links.push(l); });
        resolvedBy = 'search';
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[SemanticSearchEngine] Concept search failed while resolving', name, err?.message);
    }
  }

  // Last resort for a bare name: the English article of exactly that title.
  if (!qid && !dbpediaUri && !wikipediaTitle && name) {
    const found = await getWikidataIdFromWikipedia(name).catch(() => null);
    if (found) { qid = found; wikipediaTitle = name; resolvedBy = 'search'; }
  } else if (!qid && wikipediaTitle) {
    qid = await getWikidataIdFromWikipedia(wikipediaTitle).catch(() => null);
  }
  // DBpedia names its resources after the English Wikipedia article.
  if (!dbpediaUri && wikipediaTitle) {
    dbpediaUri = `http://dbpedia.org/resource/${encodeURIComponent(wikipediaTitle.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
  }

  return { name, qid, dbpediaUri, wikipediaTitle, links, resolvedBy };
}

function scorePredicate(pid, label, direction) {
  const key = pid && WIKIDATA_PREDICATE_KEYS[pid];
  const info = key ? getPredicateInfo(key) : getPredicateInfo(label);
  // A real statement about the subject never ranks as low as page metadata,
  // whether or not the tier table knows its name.
  let weight = info.tier === 'C' && info.weight <= 0.2 ? 0.55 : info.weight;
  let tier = info.tier === 'C' && info.weight <= 0.2 ? 'B' : info.tier;
  if (direction === 'in') weight *= 0.85;
  return { tier, weight: Math.round(weight * 100) / 100, key: key || null };
}

function otherConcept({ name, uri, description, provider, predicate, extraLinks = [] }) {
  const links = [uri, ...extraLinks].filter(Boolean);
  return {
    id: uri || `concept-${name}`,
    name,
    color: generateConceptColor(name),
    description: description || '',
    source: provider,
    discoveredAt: new Date().toISOString(),
    relationships: [],
    semanticMetadata: {
      originalUri: uri || null,
      externalLinks: links,
      confidence: 0.8,
      connectionInfo: { predicate, source: provider }
    },
    defaultPredicate: predicate
  };
}

// Wikimedia's own page kinds: never a subject worth connecting to.
const META_TITLE = /^(Category|Template|Wikipedia|Portal|Help|Module|Wikimedia|List of)\b/i;

const pidOf = (uri) => String(uri || '').split('/').pop();

function runWikidata(query, signal) {
  // A timeout is an answer too: nothing from this source, the rest still shows.
  return sparqlClient.executeQuery('wikidata', query, { signal }).catch((err) => {
    console.warn('[SemanticSearchEngine] Wikidata query failed:', err?.message);
    return [];
  });
}

function keepRow(pid, name) {
  return name && !WIKIDATA_NOISE.has(pid) && !/^Q\d+$/.test(name) && !META_TITLE.test(name);
}

/** What this subject points at, on Wikidata. */
async function wikidataOutgoing(qid, signal) {
  const query = `
    SELECT ?p ?pLabel ?o ?oLabel ?oDescription WHERE {
      wd:${qid} ?pd ?o .
      ?p wikibase:directClaim ?pd ; wikibase:propertyType wikibase:WikibaseItem .
      ?p rdfs:label ?pLabel . FILTER(LANG(?pLabel) = "en")
      ?o rdfs:label ?oLabel . FILTER(LANG(?oLabel) = "en")
      OPTIONAL { ?o schema:description ?oDescription . FILTER(LANG(?oDescription) = "en") }
    } LIMIT 120`;
  const rows = await runWikidata(query, signal);
  return rows
    .map((b) => ({ direction: 'out', pid: pidOf(b.p?.value), label: b.pLabel?.value, uri: b.o?.value, name: b.oLabel?.value, description: b.oDescription?.value }))
    .filter((r) => keepRow(r.pid, r.name))
    .map((r) => ({ ...r, provider: 'wikidata', predicateUri: `http://www.wikidata.org/prop/direct/${r.pid}` }));
}

/**
 * What points at this subject, on Wikidata.
 *
 * Bounded before it's joined — "human" has millions of things pointing at it —
 * and the planner is told to keep the written order, because left to itself it
 * joins the property table first and times out even on small subjects. Of the
 * bounded set, the best-known are what's worth showing, so they're ordered by
 * how many Wikipedias cover them.
 */
async function wikidataIncoming(qid, signal) {
  const query = `
    SELECT ?p ?pLabel ?s ?sLabel ?sDescription ?links WHERE {
      hint:Query hint:optimizer "None" .
      { SELECT ?s ?pd WHERE {
          ?s ?pd wd:${qid} .
          FILTER(STRSTARTS(STR(?pd), "http://www.wikidata.org/prop/direct/"))
        } LIMIT 500 }
      ?p wikibase:directClaim ?pd .
      ?p wikibase:propertyType wikibase:WikibaseItem .
      ?s wikibase:sitelinks ?links .
      ?p rdfs:label ?pLabel . FILTER(LANG(?pLabel) = "en")
      ?s rdfs:label ?sLabel . FILTER(LANG(?sLabel) = "en")
      OPTIONAL { ?s schema:description ?sDescription . FILTER(LANG(?sDescription) = "en") }
    } ORDER BY DESC(?links) LIMIT 40`;
  const rows = await runWikidata(query, signal);
  return rows
    .map((b) => ({ direction: 'in', pid: pidOf(b.p?.value), label: b.pLabel?.value, uri: b.s?.value, name: b.sLabel?.value, description: b.sDescription?.value }))
    .filter((r) => keepRow(r.pid, r.name))
    .map((r) => ({ ...r, provider: 'wikidata', predicateUri: `http://www.wikidata.org/prop/direct/${r.pid}` }));
}

async function dbpediaStatements(resourceUri, signal) {
  // Only an IRI we built or were given goes into the query, never free text.
  if (!/^http:\/\/dbpedia\.org\/resource\/[^\s<>"{}|\\^`]+$/.test(resourceUri)) return [];
  const query = `
    SELECT DISTINCT ?p ?o ?oLabel ?oComment WHERE {
      <${resourceUri}> ?p ?o .
      FILTER(isIRI(?o))
      FILTER(STRSTARTS(STR(?p), "http://dbpedia.org/ontology/"))
      FILTER(?p NOT IN (${DBPEDIA_NOISE.map((p) => `<${p}>`).join(', ')}))
      ?o <http://www.w3.org/2000/01/rdf-schema#label> ?oLabel . FILTER(LANG(?oLabel) = "en")
      OPTIONAL { ?o <http://www.w3.org/2000/01/rdf-schema#comment> ?oComment . FILTER(LANG(?oComment) = "en") }
    } LIMIT 80`;
  let rows = [];
  try {
    rows = await sparqlClient.executeQuery('dbpedia', query, { signal });
  } catch (err) {
    console.warn('[SemanticSearchEngine] DBpedia query failed:', err?.message);
    return [];
  }
  return rows.map((b) => {
    const local = String(b.p?.value || '').split('/').pop();
    return {
      direction: 'out',
      pid: null,
      key: local,
      label: local,
      uri: b.o?.value,
      name: b.oLabel?.value,
      description: b.oComment?.value ? b.oComment.value.slice(0, 280) : null,
      provider: 'dbpedia',
      predicateUri: b.p?.value
    };
  }).filter((r) => r.name);
}

function toConnection(row, seedName) {
  const { tier, weight, key } = scorePredicate(row.pid, row.key || row.label, row.direction);
  const predicate = formatPredicate(row.label || row.key || 'relatedTo');
  // Named the way Things are named here; the source's own label is kept.
  const name = titleCaseName(row.name);
  const other = otherConcept({
    name, uri: row.uri, description: row.description, provider: row.provider,
    predicate: key || row.key || row.label
  });
  if (name !== row.name) other.semanticMetadata.originalLabel = row.name;
  return {
    id: `${row.direction}|${lower(predicate)}|${row.uri || lower(row.name)}`,
    direction: row.direction,
    predicate,
    predicateKey: key || row.key || row.label,
    predicateUri: row.predicateUri,
    subject: row.direction === 'out' ? seedName : name,
    object: row.direction === 'out' ? name : seedName,
    other,
    provider: row.provider,
    tier,
    confidence: weight
  };
}

/** Fold DBpedia into Wikidata: same other end, same direction → one row, both URIs. */
function merge(connections) {
  const byId = new Map();
  const byName = new Map();
  for (const c of connections) {
    if (byId.has(c.id)) continue;
    const nameKey = `${c.direction}|${lower(c.other.name)}`;
    const twin = byName.get(nameKey);
    if (twin && twin.provider !== c.provider) {
      const links = twin.other.semanticMetadata.externalLinks;
      c.other.semanticMetadata.externalLinks.forEach((l) => { if (!links.includes(l)) links.push(l); });
      if (!twin.other.description && c.other.description) twin.other.description = c.other.description;
      continue;
    }
    byId.set(c.id, c);
    if (!twin) byName.set(nameKey, c);
  }
  return [...byId.values()].sort((a, b) => (b.confidence - a.confidence) || a.predicate.localeCompare(b.predicate));
}

/**
 * What the shared web says about a seed.
 *
 * @param {Object|string} seed - a prototype, a concept, or a name
 * @param {Object} [options]
 * @param {(partial: {identity, connections}) => void} [options.onProgress] - called as each source lands
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.refresh] - skip the cache
 * @returns {Promise<{identity, connections: Array}>}
 */
export async function getSemanticConnections(seed, { onProgress, signal, refresh = false } = {}) {
  const identity = await resolveSemanticIdentity(seed, { signal });
  const key = identity.qid || identity.dbpediaUri || `name:${lower(identity.name)}`;
  const seedName = identity.name;

  if (!identity.qid && !identity.dbpediaUri) return { identity, connections: [] };

  const cached = !refresh && cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // The cached rows were made under whatever name first asked; show this one.
    const connections = cached.result.map((c) => ({
      ...c,
      subject: c.direction === 'out' ? seedName : c.subject,
      object: c.direction === 'out' ? c.object : seedName
    }));
    return { identity, connections };
  }
  if (!refresh && inFlight.has(key)) {
    const result = await inFlight.get(key);
    return { identity, connections: result };
  }

  // The queries stop on their own timeouts, never on the caller's signal: the
  // work is shared with anyone else asking about the same subject, and a
  // finished answer is worth caching even if the one who asked has moved on.
  const withTimeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

  const work = (async () => {
    const found = [];
    const ordered = () => [...found.filter((r) => r.provider === 'wikidata'), ...found.filter((r) => r.provider !== 'wikidata')];
    const emit = () => onProgress?.({ identity, connections: merge(ordered().map((r) => toConnection(r, seedName))) });
    const tasks = [];
    const land = (rows) => { found.push(...rows); emit(); };
    if (identity.qid) {
      tasks.push(wikidataOutgoing(identity.qid, withTimeout(QUERY_TIMEOUT_MS)).then(land));
      // Incoming is the extra; it never holds the rest up for long.
      tasks.push(wikidataIncoming(identity.qid, withTimeout(INCOMING_TIMEOUT_MS)).then(land));
    }
    if (identity.dbpediaUri) tasks.push(dbpediaStatements(identity.dbpediaUri, withTimeout(QUERY_TIMEOUT_MS)).then(land));
    await Promise.allSettled(tasks);
    // Wikidata first, so it wins every merge regardless of which landed first.
    return merge(ordered().map((r) => toConnection(r, seedName)));
  })();

  inFlight.set(key, work);
  try {
    const connections = await work;
    cache.set(key, { timestamp: Date.now(), result: connections });
    return { identity, connections };
  } finally {
    inFlight.delete(key);
  }
}

/** Forget what's cached, for one seed's key or everything. */
export function clearSemanticCache(key = null) {
  if (key) cache.delete(key); else cache.clear();
}
