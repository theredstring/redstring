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

/**
 * Crossref's "polite pool" ticket.
 *
 * The anonymous pool 429s hard — measured here at three sequential requests,
 * never mind parallel ones — and a rejected search used to fall through to a
 * different registry and answer with something plausible and wrong. Identifying
 * the client is what buys the headroom; Crossref asks for an address it can
 * reach a misbehaving client at, and answers normally once it has one.
 *
 * Point this at a real inbox someone reads. Never at the end user's own address
 * — this is the application identifying itself, not the person using it.
 */
const CROSSREF_MAILTO = 'redstring@users.noreply.github.com';

/**
 * A Crossref request, in the polite pool, retried once if it is still throttled.
 *
 * One retry, because the failure this guards against is a burst hitting the
 * limiter, not an outage. Anything past that is the caller's to report.
 */
const crossrefFetch = async (url, { signal } = {}) => {
  const polite = `${url}${url.includes('?') ? '&' : '?'}mailto=${encodeURIComponent(CROSSREF_MAILTO)}`;

  const resp = await fetch(polite, { signal });
  if (resp.status !== 429) return resp;

  const retryAfter = Number(resp.headers.get('retry-after'));
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 1000;
  await new Promise(resolve => setTimeout(resolve, waitMs));

  return fetch(polite, { signal });
};
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
/**
 * One Crossref record, read as the line a row shows.
 *
 * Shared by the single-DOI lookup and the bibliographic search so the two can
 * never describe the same paper differently — and so `journal` and `year` come
 * back as fields, not only folded into the prose. Picking between "Golden Eggs
 * and Hyperbolic Discounting" the 1997 QJE article and the 2011 book chapter of
 * the same name is exactly what those two fields are for.
 */
const readCrossrefWork = (work) => {
  const title = Array.isArray(work?.title) ? work.title[0] : work?.title;
  if (!title) return null;

  const authorList = work.author || [];
  const authors = authorList.slice(0, 2).map(a => a.family || a.name).filter(Boolean);
  const year = work.issued?.['date-parts']?.[0]?.[0] || null;
  const journal = (Array.isArray(work['container-title']) ? work['container-title'][0] : null) || null;
  const parts = [
    authors.length ? `${authors.join(', ')}${authorList.length > 2 ? ' et al.' : ''}` : null,
    journal,
    year
  ].filter(Boolean);

  return { label: stripHtml(title), description: parts.join(' · '), journal, year, type: work.type || null };
};

const describeDOI = async (doi, { signal }) => {
  try {
    // Polite pool here too: a throttled verification reads as "no such DOI",
    // which would reject an identifier that is perfectly real.
    const resp = await crossrefFetch(`${CROSSREF_API}/${encodeURIComponent(doi)}`, { signal });
    if (resp.ok) {
      const read = readCrossrefWork((await resp.json())?.message);
      if (read) return { label: read.label, description: read.description };
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

/**
 * Papers matching a bibliographic description — the other direction from
 * `describeDOI`.
 *
 * This exists because a DOI is the one identifier in the system that cannot be
 * recalled, only looked up. A model asked for Laibson 1997 will happily
 * assemble `10.1093/qje/112.2.443` out of the journal, volume and page, which
 * has the shape of a DOI and is not one. Searching returns the real
 * `10.1162/003355397555253` — alongside two book-chapter reprints of the same
 * paper, which is why every candidate carries its journal and year and why
 * nothing here picks a winner. Recognising the right edition needs the context
 * the caller has and this function does not.
 *
 * Crossref covers journal articles and books; DataCite is tried only when
 * Crossref comes back empty, since that is where datasets, preprints and
 * software live. One call in the ordinary case.
 *
 * @param {string} query - free text: title, plus author and year if known
 * @param {{rows?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<{url: string, doi: string, identifier: string, label: string, description: string, journal: string|null, year: number|null}>>}
 */
export const searchWorks = async (query, { rows = 4, signal } = {}) => {
  const term = String(query ?? '').trim();
  if (!term) return [];

  const asRow = (doi, read) => ({
    // Stored form, so a caller can hand this straight to whatever attaches it.
    url: `doi:${doi}`,
    doi,
    identifier: doi,
    label: read.label,
    description: read.description,
    journal: read.journal,
    year: read.year
  });

  // A FAILED Crossref call must never fall through to the other registry. That
  // is how "Kahneman & Tversky 1979" came back as an unrelated Zenodo upload:
  // Crossref answered 429, the error was swallowed, and DataCite's full-text
  // search — which always returns something — supplied the top hit. Throwing
  // here makes the caller report "could not search", which is true and useless,
  // instead of something false and convincing.
  const url = `${CROSSREF_API}?query.bibliographic=${encodeURIComponent(term)}&rows=${rows}`
    + '&select=DOI,title,author,issued,container-title,type';
  const resp = await crossrefFetch(url, { signal });
  if (!resp.ok) throw new Error(`Crossref HTTP ${resp.status}`);

  const items = (await resp.json())?.message?.items || [];
  const found = items
    .map(item => {
      const read = readCrossrefWork(item);
      return read && item.DOI ? asRow(item.DOI, read) : null;
    })
    .filter(Boolean);
  if (found.length) return found;

  // Only now: Crossref answered, and genuinely knows nothing. Datasets,
  // preprints and software live at DataCite instead.
  try {
    const dataciteResp = await fetch(
      `${DATACITE_API}?query=${encodeURIComponent(term)}&page[size]=${rows}`,
      { signal }
    );
    if (!dataciteResp.ok) return [];
    const records = (await dataciteResp.json())?.data || [];
    return records.map(record => {
      const attributes = record?.attributes || {};
      const title = attributes.titles?.[0]?.title;
      const doi = attributes.doi || record.id;
      if (!title || !doi) return null;
      const year = attributes.publicationYear || null;
      return asRow(doi, {
        label: stripHtml(title),
        description: [attributes.publisher, year].filter(Boolean).join(' · '),
        journal: attributes.publisher || null,
        year
      });
    }).filter(Boolean);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    console.warn('[identifierSearch] DataCite search failed:', error?.message || error);
    return [];
  }
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
 * The English Wikipedia article each of these Wikidata items is about.
 *
 * This one extra call is what makes consolidating results honest. DBpedia
 * resources are minted from Wikipedia article titles, so those two can be
 * matched on the title alone — but a Wikidata QID says nothing about which
 * article it belongs to, and matching Wikidata on its *label* instead is
 * exactly the mistake worth avoiding: Wikidata's "Symptoms" is a work of art
 * and Wikipedia's "Symptom" is the medical concept. The sitelink is the
 * assertion, made by Wikidata itself, that two entries denote one subject.
 *
 * Batched (the API takes 50 ids per call) and failure-tolerant: an item with no
 * answer simply never merges, which is the safe direction to fail in.
 *
 * @returns {Promise<Map<string, string>>} QID → article title
 */
const enwikiSitelinks = async (qids, { signal } = {}) => {
  const out = new Map();
  const unique = Array.from(new Set(qids.filter(id => /^Q\d+$/i.test(id || ''))));

  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    try {
      const url = `${WIKIDATA_API}?action=wbgetentities&ids=${batch.join('|')}`
        + '&props=sitelinks&sitefilter=enwiki&format=json&origin=*';
      const resp = await fetch(url, { signal });
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const [qid, entity] of Object.entries(data?.entities || {})) {
        const title = entity?.sitelinks?.enwiki?.title;
        if (title) out.set(qid, title);
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.warn('[identifierSearch] sitelink lookup failed:', error?.message || error);
    }
  }

  return out;
};

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
 * Hits describing the SAME SUBJECT collapse into one concept carrying all three
 * links. Searching "dog" otherwise returned the Wikidata item, the Wikipedia
 * article and the DBpedia resource for the same animal as three near-identical
 * cards, and dragging any one of them in linked the new Thing to only that one
 * authority. Merged, the card is a subject rather than a search hit, and it
 * lands with all three identifiers attached at once.
 *
 * The merge is on identity, never on a matching name — the distinction the
 * older comment here was defending. Wikipedia and DBpedia join on the article
 * title, which is what a DBpedia resource IRI is made of; Wikidata joins by its
 * own enwiki sitelink (see `enwikiSitelinks`). So an item whose sitelink is a
 * different article, or that has none, stays its own card no matter how well
 * its label matches — which is what keeps "Symptoms" the artwork apart from
 * "Symptom" the medical concept.
 *
 * Groups order by their best member's rank, so no single source owns the top of
 * the list, and a subject three authorities agree on rises above one only found
 * in a single index.
 *
 * @param {string} term
 * @param {{limit?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<Array<object>>} shaped for normalizeToCandidate, plus
 *   `authorities` — the display names of every source folded into the row
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

  const sitelinks = await enwikiSitelinks(
    found.flatMap(({ kind, rows }) => (kind === 'wikidata' ? rows.map(row => row.identifier) : [])),
    { signal }
  );

  // Bucket every hit under the subject it denotes. `rank` and `authorityRank`
  // track the best position any member reached, which is what the groups sort
  // on afterwards.
  const groups = new Map();
  const seen = new Set();

  found.forEach(({ kind, authority, rows }, authorityRank) => {
    rows.forEach((hit, rank) => {
      if (!hit?.url) return;
      const linkKey = canonicalizeLink(hit.url);
      if (seen.has(linkKey)) return;
      seen.add(linkKey);

      // Wikipedia and DBpedia both carry the article title as their identifier;
      // Wikidata has to be told. No article means no subject key, so the hit
      // gets one nothing else can collide with.
      const article = kind === 'wikidata' ? sitelinks.get(hit.identifier) : hit.identifier;
      const key = article ? `enwiki:${normalizeLabel(article)}` : `${kind}:${linkKey}`;

      const member = { ...hit, kind, authority };
      const group = groups.get(key);
      if (group) {
        group.members.push(member);
        group.rank = Math.min(group.rank, rank);
        group.authorityRank = Math.min(group.authorityRank, authorityRank);
      } else {
        groups.set(key, { members: [member], rank, authorityRank });
      }
    });
  });

  const kindOrder = STANDARD_AUTHORITIES.map(a => a.kind);
  const preferring = (members, kinds, read) => {
    for (const kind of kinds) {
      const value = read(members.find(m => m.kind === kind) || {});
      if (value) return value;
    }
    return read(members[0]) || '';
  };

  const wanted = normalizeLabel(query);

  return Array.from(groups.values())
    .sort((a, b) => a.rank - b.rank || a.authorityRank - b.authorityRank)
    .map(({ members, rank }) => {
      members.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));

      // Wikipedia's article title is the readable canonical name: Wikidata
      // labels common nouns in lowercase and DBpedia hands back whatever the
      // resource is called, underscores and all.
      const name = preferring(members, ['wikipedia', 'wikidata', 'dbpedia'], m => m.label);
      // Wikipedia's short description first, for the same reason as the name,
      // plus one of its own: it is written for readers, where a Wikidata gloss
      // is written for editors and sometimes says how to model the item rather
      // than what it is ("to be used as P31 values for all symptoms"). Taking
      // both from one source also keeps the title and the line under it talking
      // about the same thing. DBpedia's first sentence is the last resort.
      const description = preferring(members, ['wikipedia', 'wikidata', 'dbpedia'], m => m.description);
      // The URI that denotes the subject rather than a document about it, in
      // the order other tools resolve them.
      const primary = ['wikidata', 'dbpedia', 'wikipedia']
        .map(kind => members.find(m => m.kind === kind))
        .find(Boolean);
      const exact = members.some(m => normalizeLabel(m.label) === wanted);

      return {
        id: primary.url,
        name,
        uri: primary.url,
        source: primary.kind,
        authority: primary.authority,
        authorities: members.map(m => m.authority),
        description,
        externalLinks: members.map(m => m.url),
        // The authority's own ranking is the real signal here; an exact label
        // match on top of it is the strongest this layer can honestly claim,
        // and independent authorities landing on one subject is corroboration
        // worth a nudge rather than a leap.
        sourceTrust: Math.min(0.98, (exact ? 0.95 : 0.8) + 0.03 * (members.length - 1)),
        contextFit: Math.max(0.4, 1 - rank * 0.1)
      };
    });
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
