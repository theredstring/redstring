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
import { canonicalizeLink } from '../formats/linkState.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const DBPEDIA_LOOKUP = 'https://lookup.dbpedia.org/api/search';
const DBPEDIA_SPARQL = 'https://dbpedia.org/sparql';
const CROSSREF_API = 'https://api.crossref.org/works';
const DATACITE_API = 'https://api.datacite.org/dois';
const PUBMED_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

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

/**
 * The action API rather than rest.php/v1/search/page.
 *
 * The REST search endpoint answers 429 to clients Wikimedia can't identify,
 * which is most of them, and it does so for the whole endpoint rather than per
 * query. `action=query` with `origin=*` is the CORS-declared path the rest of
 * this codebase already uses, and `generator=search` + `prop=description` gets
 * the ranked titles and their short glosses in the same single call.
 */
const searchWikipedia = async (term, { limit, signal }) => {
  const url = `${WIKIPEDIA_API}?action=query&generator=search`
    + `&gsrsearch=${encodeURIComponent(term)}&gsrlimit=${limit}`
    + '&prop=description&format=json&origin=*';
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
  const data = await resp.json();
  // Keyed by page id, so `index` is the only thing carrying search rank.
  return Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(page => ({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      identifier: page.title,
      label: page.title,
      description: stripHtml(page.description)
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
 * A DOI's registered title, from whichever agency registered it.
 *
 * Crossref covers journal articles and books; DataCite covers datasets,
 * preprints and software. A DOI belongs to exactly one of them, so the fallback
 * is a second lookup rather than a merge. Both are CORS-open and keyless.
 *
 * doi.org's own content negotiation would resolve either in one request, but it
 * answers with a redirect chain that browsers can't always follow with a custom
 * Accept header, so two direct calls are the reliable version.
 */
const describeDOI = async (doi, { signal }) => {
  try {
    const resp = await fetch(`${CROSSREF_API}/${encodeURIComponent(doi)}`, { signal });
    if (resp.ok) {
      const work = (await resp.json())?.message;
      const title = Array.isArray(work?.title) ? work.title[0] : work?.title;
      if (title) {
        const authors = (work.author || [])
          .slice(0, 2)
          .map(a => a.family || a.name)
          .filter(Boolean);
        const year = work.issued?.['date-parts']?.[0]?.[0];
        const journal = Array.isArray(work['container-title']) ? work['container-title'][0] : null;
        const parts = [
          authors.length ? `${authors.join(', ')}${(work.author || []).length > 2 ? ' et al.' : ''}` : null,
          journal,
          year
        ].filter(Boolean);
        return { label: stripHtml(title), description: parts.join(' · ') };
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
  }

  const resp = await fetch(`${DATACITE_API}/${encodeURIComponent(doi)}`, { signal });
  if (!resp.ok) return null;
  const attributes = (await resp.json())?.data?.attributes;
  const title = attributes?.titles?.[0]?.title;
  if (!title) return null;
  const parts = [attributes.publisher, attributes.publicationYear].filter(Boolean);
  return { label: stripHtml(title), description: parts.join(' · ') };
};

const describePubMed = async (pmid, { signal }) => {
  const resp = await fetch(`${PUBMED_API}?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`, { signal });
  if (!resp.ok) return null;
  const record = (await resp.json())?.result?.[pmid];
  if (!record?.title) return null;
  const parts = [record.sortfirstauthor, record.source, record.pubdate].filter(Boolean);
  return { label: stripHtml(record.title), description: parts.join(' · ') };
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

const normalizeLabel = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Every authority at once, as concepts you could drag onto a canvas.
 *
 * The same primitive as the identifier picker, aimed at discovery instead of at
 * one slot. It is fast for a structural reason worth keeping in mind before
 * anyone routes it back through SPARQL: these are search indexes
 * (wbsearchentities, the Wikipedia REST search, the DBpedia Lookup service),
 * answering in one round trip from a prebuilt index. The federation path this
 * sits beside queries live SPARQL endpoints — query.wikidata.org and DBpedia's
 * Virtuoso — with exact-label matches, which is both slower per call and the
 * wrong shape for "what might this word mean".
 *
 * Deliberately does NOT merge hits that share a label. Wikidata's "Symptoms" is
 * a work of art and Wikipedia's is the medical concept; folding them into one
 * card because the words match would hide exactly the distinction a person
 * needs to make. Each hit stays its own concept, carrying its own description,
 * and the description is what tells them apart.
 *
 * Results interleave by rank — every authority's best hit, then every
 * authority's second — so no single source owns the top of the list.
 *
 * @param {string} term
 * @param {{limit?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<object>>} shaped for normalizeToCandidate
 */
export const searchConcepts = async (term, { limit = 8, signal } = {}) => {
  const query = String(term ?? '').trim();
  if (!query) return [];

  const settled = await Promise.allSettled(
    STANDARD_AUTHORITIES.map(authority =>
      searchIdentifiers(authority.kind, query, { limit, signal })
        .then(rows => ({ ...authority, rows }))
    )
  );
  const found = settled.filter(r => r.status === 'fulfilled').map(r => r.value);

  const wanted = normalizeLabel(query);
  const seen = new Set();
  const out = [];

  for (let rank = 0; rank < limit; rank++) {
    for (const { kind, authority, rows } of found) {
      const hit = rows[rank];
      if (!hit) continue;
      const key = canonicalizeLink(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        id: hit.url,
        name: hit.label,
        uri: hit.url,
        source: kind,
        authority,
        description: hit.description,
        externalLinks: [hit.url],
        // The authority's own ranking is the real signal here; an exact label
        // match on top of it is the strongest this layer can honestly claim.
        sourceTrust: normalizeLabel(hit.label) === wanted ? 0.95 : 0.8,
        contextFit: Math.max(0.4, 1 - rank * 0.1)
      });
    }
  }

  return out;
};

/**
 * What the authority says the thing at `url` is.
 *
 * This is the "tell it's wrong without travelling to it" half. Covers more than
 * the searchable three: a DOI can't be searched by name here, but it can
 * certainly say what paper it is, and a row reading "10.1038/nature12373" alone
 * is an identifier nobody can check. Returns null for anything unrecognised,
 * and for any failure — a missing description is cosmetic, and the identifier
 * still reads fine without it.
 *
 * @returns {Promise<{label: string, description: string}|null>}
 */
export const describeIdentifier = async (url, { signal } = {}) => {
  const { kind, identifier, href } = identifierFromUrl(url);

  try {
    if (kind === 'doi') return await describeDOI(identifier, { signal });
    if (kind === 'pubmed') return await describePubMed(identifier, { signal });

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
