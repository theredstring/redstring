/**
 * Reading an external identifier out of a URL, for display.
 *
 * Nothing here is stored. The authority ("Wikidata"), the identifier ("Q144")
 * and the link-through are all derived from the URL at render time, so the file
 * keeps holding a plain list of URLs — the most interpretable thing it can hold,
 * and the shape a generic RDF consumer can read. Storing a
 * {authority, id, page} record instead would be Redstring-specific structure
 * that needs migrating every time this derivation improves.
 */
import { canonicalizeLink } from '../formats/linkState.js';
import { safeExternalHref, hostMatches } from './safeUrl.js';

/** A bare DOI, e.g. 10.1038/nature12373 */
export const DOI_REGEX = /^10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+$/;

/**
 * True for a URL that may be stored and shown as a link: an absolute http(s)
 * or mailto URL. Anything else (javascript:, data:, file:, custom schemes,
 * relative paths) is not a link, whatever the URL parser thinks of it.
 */
export const isValidURL = (string) => safeExternalHref(string) !== null;

/** Pull a DOI (or a pubmed: id) out of a bare id, a doi.org URL, or a PubMed URL. */
export const extractDOI = (input) => {
  if (DOI_REGEX.test(input)) return input;

  const doiUrlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/(10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+)/);
  if (doiUrlMatch) return doiUrlMatch[1];

  const pubmedMatch = input.match(/pubmed\.ncbi\.nlm.nih.gov\/(\d+)/);
  if (pubmedMatch) return `pubmed:${pubmedMatch[1]}`;

  return null;
};

/**
 * Which authority a URL belongs to, and what it identifies there.
 *
 * `authority` is the label ("Wikidata"); `identifier` is the term within it
 * ("Q144"). `isEntity` marks the ones that genuinely denote the *subject* —
 * a Wikidata item or a DBpedia resource — as opposed to a document *about* it,
 * which is what a Wikipedia article or a DOI is. That distinction is why a
 * Wikipedia article can sit under a Wikidata row as its human-readable face
 * rather than claiming to be the thing itself.
 *
 * Deliberately returns no colour. Each source used to carry its own brand
 * colour (DOI orange, arXiv red, black for Wikipedia); a stack of them read as
 * a swatch chart, and the black ones vanished on the dark canvas.
 *
 * @param {string} uri
 * @returns {{authority: string, identifier: string, href: string|null, isEntity: boolean, kind: string}}
 *   `href` is null when the input is not a safe http(s)/mailto link; show the
 *   identifier as text then.
 */
export const identifierFromUrl = (uri) => {
  const raw = String(uri ?? '');

  if (raw.startsWith('doi:')) {
    const id = raw.replace('doi:', '');
    return { authority: 'DOI', identifier: id, href: `https://doi.org/${id}`, isEntity: false, kind: 'doi' };
  }
  if (raw.startsWith('pubmed:')) {
    const id = raw.replace('pubmed:', '');
    return { authority: 'PubMed', identifier: id, href: `https://pubmed.ncbi.nlm.nih.gov/${id}`, isEntity: false, kind: 'pubmed' };
  }
  if (raw.startsWith('wd:')) {
    const id = raw.replace('wd:', '');
    return { authority: 'Wikidata', identifier: id, href: `https://www.wikidata.org/wiki/${id}`, isEntity: true, kind: 'wikidata' };
  }
  // Everything else has to be a real http(s)/mailto URL to be a link at all.
  // An unsafe or unparseable string still shows, as text, with no href:
  // `javascript:alert(1)//wikidata.org` is not a Wikidata row.
  if (!safeExternalHref(raw)) {
    return { authority: 'Link', identifier: raw, href: null, isEntity: false, kind: 'url' };
  }
  // The href handed out is the string as written (trimmed) rather than the
  // parser's re-serialisation. It passed the same parse the browser will do
  // when it follows it, and callers that read an IRI back out of it (DBpedia,
  // Wikipedia titles) need the characters the file holds, not their
  // percent-encoding.
  const href = raw.trim();
  const u = new URL(href);
  // Authority is decided on the parsed hostname, on a dot boundary. Substring
  // matching let `https://evil.example/?wikidata.org` wear Wikidata's label.
  const on = (domain) => hostMatches(u.hostname, domain);
  const tailOf = (value) => value.split('/').filter(Boolean).pop();

  if (on('wikidata.org')) {
    return { authority: 'Wikidata', identifier: tailOf(href) || 'Entity', href, isEntity: true, kind: 'wikidata' };
  }
  if (on('wikipedia.org')) {
    const last = tailOf(href);
    return {
      authority: 'Wikipedia',
      identifier: last ? safeDecode(last).replace(/_/g, ' ') : 'Article',
      href,
      isEntity: false,
      kind: 'wikipedia'
    };
  }
  if (on('dbpedia.org')) {
    const resource = tailOf(href);
    return {
      authority: 'DBpedia',
      identifier: resource ? safeDecode(resource).replace(/_/g, ' ') : 'Resource',
      href,
      isEntity: true,
      kind: 'dbpedia'
    };
  }
  if (on('arxiv.org')) {
    return { authority: 'arXiv', identifier: tailOf(href) || href, href, isEntity: false, kind: 'arxiv' };
  }
  if (on('doi.org')) {
    const id = extractDOI(href);
    return { authority: 'DOI', identifier: id || href, href, isEntity: false, kind: 'doi' };
  }
  if (on('orcid.org')) {
    return { authority: 'ORCID', identifier: tailOf(href) || href, href, isEntity: true, kind: 'orcid' };
  }
  if (on('schema.org')) {
    return { authority: 'Schema.org', identifier: tailOf(href) || 'Type', href, isEntity: true, kind: 'schema' };
  }

  // Anything else: show the host as the authority and the path as the id.
  const tail = tailOf(u.pathname);
  return {
    authority: (u.hostname || 'Link').replace(/^www\./, ''),
    identifier: tail ? safeDecode(tail).replace(/_/g, ' ') : (u.hostname || href),
    href,
    isEntity: false,
    kind: 'url'
  };
};

/** decodeURIComponent that hands back its input on a malformed escape. */
const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Every external identifier a prototype carries, from all the places the app
 * has historically put them, deduped by canonical URL with first-seen order
 * preserved.
 *
 * READ-ONLY on purpose. Do not write the union back to `externalLinks` — that
 * would rewrite a legacy node's storage merely because someone looked at it,
 * and land the rewrite in undo history.
 *
 * @param {object} prototype
 * @returns {string[]} raw (un-canonicalized) URLs, in display order
 */
export const collectIdentifiers = (prototype) => {
  const sm = prototype?.semanticMetadata;
  const candidates = [
    ...(Array.isArray(prototype?.externalLinks) ? prototype.externalLinks : []),
    // Written by LeftSemanticDiscoveryView.materializeConcept — nested rather
    // than top-level, which is why these were invisible in the old editor.
    ...(Array.isArray(sm?.externalLinks) ? sm.externalLinks : []),
    sm?.wikipediaUrl,
    sm?.wikidataUrl,
    sm?.originMetadata?.originalUri
  ];

  const seen = new Set();
  const out = [];
  for (const url of candidates) {
    if (typeof url !== 'string' || !url.trim()) continue;
    const key = canonicalizeLink(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
};

/**
 * The three authorities that hold a permanent slot in About, in display order.
 *
 * Mirrors STANDARD_AUTHORITIES in services/identifierSearch.js, which carries
 * the search implementation for each. Kept as bare kinds here so this module
 * stays free of network code.
 */
export const STANDARD_KINDS = ['wikidata', 'wikipedia', 'dbpedia'];

const AUTHORITY_FOR_KIND = {
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  dbpedia: 'DBpedia'
};

/**
 * Sort a prototype's identifiers into the three standing slots and whatever
 * else it carries.
 *
 * Every standard slot comes back present, `url: null` when nothing fills it, so
 * the section can show what a Thing *could* be identified by rather than only
 * what it happens to have. An empty Wikidata row is information: it says nobody
 * has grounded this yet.
 *
 * Replaces the earlier grouping that folded a Wikipedia article underneath its
 * Wikidata row. That made sense when rows only appeared for links that existed;
 * with a standing Wikipedia slot it would hide the article from its own row.
 * The two are also separately wrong-able — Wikidata matching an artwork while
 * Wikipedia matches the concept is the ordinary case, not an anomaly — so they
 * need separate swap controls.
 *
 * @param {object} prototype
 * @returns {{slots: Array<{kind: string, authority: string, url: string|null}>, extras: string[]}}
 */
export const partitionIdentifiers = (prototype) => {
  const urls = collectIdentifiers(prototype);
  const taken = new Set();

  const slots = STANDARD_KINDS.map(kind => {
    // First match wins: a node with two Wikidata links shows the first in the
    // slot and the rest below, rather than silently dropping one.
    const hit = urls.find(url => !taken.has(url) && identifierFromUrl(url).kind === kind);
    if (hit) taken.add(hit);
    return { kind, authority: AUTHORITY_FOR_KIND[kind], url: hit || null };
  });

  return { slots, extras: urls.filter(url => !taken.has(url)) };
};
