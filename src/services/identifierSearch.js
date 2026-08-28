/**
 * Looking an identifier UP, as opposed to reading one you already have.
 *
 * `utils/externalIdentifiers.js` derives an authority and an id from a URL that
 * is already on the node. This is the other direction: given a name, what does
 * each authority offer, and given a URL, what does that authority say it is.
 *
 * Both halves exist for the same reason. A name is not an identifier: Wikidata
 * has an item called "Symptoms" that is a work of art, and one called
 * "symptom" that is the medical concept. Nothing about the URL tells them
 * apart — only the label and the one-line description do. So the picker shows
 * descriptions before you choose, and a linked row shows the description of
 * what it is actually pointing at, so a wrong match is visible without
 * following the link.
 *
 * Every request here is a plain browser fetch against a CORS-open read API. No
 * key, no proxy, no server hop.
 */
import { identifierFromUrl } from '../utils/externalIdentifiers.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_REST = 'https://en.wikipedia.org/w/rest.php/v1';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const DBPEDIA_LOOKUP = 'https://lookup.dbpedia.org/api/search';
const DBPEDIA_SPARQL = 'https://dbpedia.org/sparql';

/**
 * The authorities that get a permanent slot in About.
 *
 * Three, and only these three, because they are the ones with a stable notion
 * of "the entry for this subject" that other tools also resolve. Anything else
 * a user adds lands below them as a plain identifier.
 */
export const STANDARD_AUTHORITIES = [
  {
    kind: 'wikidata',
    authority: 'Wikidata',
    // The one the RDF world resolves against, and the one most likely to be
    // wrong for an ordinary English word.
    note: 'The identifier other tools resolve against.'
  },
  {
    kind: 'wikipedia',
    authority: 'Wikipedia',
    note: 'The readable article. Usually the most accurate match of the three.'
  },
  {
    kind: 'dbpedia',
    authority: 'DBpedia',
    note: 'Wikipedia restated as structured data.'
  }
];

const stripHtml = (value) => String(value ?? '').replace(/<[^>]*>/g, '').trim();

/** Collapse an extract to the one line a row can show. */
const firstSentence = (text) => {
  const clean = stripHtml(text);
  if (!clean) return '';
  const stop = clean.search(/\.\s/);
  return stop > 0 ? clean.slice(0, stop + 1) : clean;
};

/**
 * DBpedia serves a subject under two URLs: /page/X is the HTML for people and
 * /resource/X is the IRI that identifies the thing. We store and query the
 * resource IRI, because this list is exported as owl:sameAs and friends, where
 * naming the HTML document instead of the subject is exactly the httpRange-14
 * mistake the sameness ladder exists to avoid. Browsers follow /resource/ to
 * /page/ on their own, so the link still opens somewhere readable.
 */
const dbpediaResourceIri = (url) => String(url ?? '')
  .replace(/^https:/, 'http:')
  .replace('/page/', '/resource/');

const searchWikidata = async (term, { limit, signal }) => {
  const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(term)}`
    + `&language=en&uselang=en&type=item&format=json&origin=*&limit=${limit}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Wikidata HTTP ${resp.status}`);
  const data = await resp.json();
  return (data?.search || []).map(hit => ({
    url: `https://www.wikidata.org/wiki/${hit.id}`,
    identifier: hit.id,
    label: hit.label || hit.id,
    description: hit.description || ''
  }));
};

const searchWikipedia = async (term, { limit, signal }) => {
  const url = `${WIKIPEDIA_REST}/search/page?q=${encodeURIComponent(term)}&limit=${limit}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
  const data = await resp.json();
  return (data?.pages || []).map(page => ({
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key || page.title)}`,
    identifier: page.title,
    label: page.title,
    // `description` is the short gloss; the excerpt is the search snippet with
    // <span class="searchmatch"> wrappers, so it needs stripping.
    description: page.description || stripHtml(page.excerpt)
  }));
};

const searchDBpedia = async (term, { limit, signal }) => {
  const url = `${DBPEDIA_LOOKUP}?query=${encodeURIComponent(term)}&format=json&maxResults=${limit}`;
  const resp = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`DBpedia HTTP ${resp.status}`);
  const data = await resp.json();
  // The lookup service has shipped both shapes; older deployments return
  // `results`, current ones `docs`, and every field arrives as a one-item array.
  const docs = data?.docs || data?.results || [];
  const first = (value) => Array.isArray(value) ? value[0] : value;
  return docs.map(doc => {
    const resource = dbpediaResourceIri(first(doc.resource) || '');
    return {
      url: resource,
      identifier: decodeURIComponent(resource.split('/').filter(Boolean).pop() || '').replace(/_/g, ' '),
      label: stripHtml(first(doc.label)) || resource,
      description: firstSentence(first(doc.comment))
    };
  }).filter(row => row.url);
};

/**
 * Candidate entries for `term` at one authority.
 *
 * @param {'wikidata'|'wikipedia'|'dbpedia'} kind
 * @param {string} term
 * @param {{limit?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<{url: string, identifier: string, label: string, description: string}>>}
 */
export const searchIdentifiers = async (kind, term, { limit = 6, signal } = {}) => {
  const query = String(term ?? '').trim();
  if (!query) return [];
  if (kind === 'wikidata') return searchWikidata(query, { limit, signal });
  if (kind === 'wikipedia') return searchWikipedia(query, { limit, signal });
  if (kind === 'dbpedia') return searchDBpedia(query, { limit, signal });
  return [];
};

/**
 * What the authority says the thing at `url` is.
 *
 * This is the "tell it's wrong without travelling to it" half. Returns null for
 * anything not one of the three searchable authorities, and for any failure —
 * a missing description is cosmetic, and the identifier still reads fine
 * without it.
 *
 * @returns {Promise<{label: string, description: string}|null>}
 */
export const describeIdentifier = async (url, { signal } = {}) => {
  const { kind, identifier, href } = identifierFromUrl(url);

  try {
    if (kind === 'wikidata') {
      const qid = identifier;
      if (!/^Q\d+$/i.test(qid)) return null;
      const resp = await fetch(
        `${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=labels|descriptions`
        + '&languages=en&format=json&origin=*',
        { signal }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const entity = data?.entities?.[qid];
      if (!entity) return null;
      const pick = (bag) => bag?.en?.value || Object.values(bag || {})[0]?.value || '';
      return { label: pick(entity.labels), description: pick(entity.descriptions) };
    }

    if (kind === 'wikipedia') {
      const title = href.split('/').filter(Boolean).pop();
      const resp = await fetch(`${WIKIPEDIA_SUMMARY}/${title}`, { signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        label: data?.title || identifier,
        description: data?.description || firstSentence(data?.extract)
      };
    }

    if (kind === 'dbpedia') {
      const iri = dbpediaResourceIri(href);
      const query = `SELECT ?c WHERE { <${iri}> rdfs:comment ?c . FILTER(langMatches(lang(?c), "en")) } LIMIT 1`;
      const endpoint = `${DBPEDIA_SPARQL}?query=${encodeURIComponent(query)}&format=json`;
      const resp = await fetch(endpoint, { signal, headers: { Accept: 'application/sparql-results+json' } });
      if (!resp.ok) return null;
      const data = await resp.json();
      const comment = data?.results?.bindings?.[0]?.c?.value;
      return comment ? { label: identifier, description: firstSentence(comment) } : null;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('[identifierSearch] describe failed:', error?.message || error);
    }
  }

  return null;
};
