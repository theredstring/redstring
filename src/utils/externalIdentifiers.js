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

/** A bare DOI, e.g. 10.1038/nature12373 */
export const DOI_REGEX = /^10\.\d{4,}\/[-._;()\/:a-zA-Z0-9]+$/;

export const isValidURL = (string) => {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
};

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
 * @returns {{authority: string, identifier: string, href: string, isEntity: boolean, kind: string}}
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
  if (raw.includes('wikidata.org')) {
    return {
      authority: 'Wikidata',
      identifier: raw.split('/').filter(Boolean).pop() || 'Entity',
      href: raw,
      isEntity: true,
      kind: 'wikidata'
    };
  }
  if (raw.includes('wikipedia.org')) {
    const last = raw.split('/').filter(Boolean).pop();
    return {
      authority: 'Wikipedia',
      identifier: last ? decodeURIComponent(last).replace(/_/g, ' ') : 'Article',
      href: raw,
      isEntity: false,
      kind: 'wikipedia'
    };
  }
  if (raw.includes('dbpedia.org')) {
    const resource = raw.split('/').filter(Boolean).pop();
    return {
      authority: 'DBpedia',
      identifier: resource ? decodeURIComponent(resource).replace(/_/g, ' ') : 'Resource',
      href: raw,
      isEntity: true,
      kind: 'dbpedia'
    };
  }
  if (raw.includes('arxiv.org')) {
    return { authority: 'arXiv', identifier: raw.split('/').filter(Boolean).pop() || raw, href: raw, isEntity: false, kind: 'arxiv' };
  }
  if (raw.includes('doi.org')) {
    const id = extractDOI(raw);
    return { authority: 'DOI', identifier: id || raw, href: raw, isEntity: false, kind: 'doi' };
  }
  if (raw.includes('orcid.org')) {
    return { authority: 'ORCID', identifier: raw.split('/').filter(Boolean).pop() || raw, href: raw, isEntity: true, kind: 'orcid' };
  }
  if (raw.includes('schema.org')) {
    return { authority: 'Schema.org', identifier: raw.split('/').filter(Boolean).pop() || 'Type', href: raw, isEntity: true, kind: 'schema' };
  }

  // Anything else: show the host as the authority and the path as the id.
  try {
    const u = new URL(raw);
    const tail = u.pathname.split('/').filter(Boolean).pop();
    return {
      authority: u.hostname.replace(/^www\./, ''),
      identifier: tail ? decodeURIComponent(tail).replace(/_/g, ' ') : u.hostname,
      href: raw,
      isEntity: false,
      kind: 'url'
    };
  } catch {
    return { authority: 'Link', identifier: raw, href: raw, isEntity: false, kind: 'url' };
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
 * Group a Wikipedia article under the Wikidata row it was captured with.
 *
 * Only pairs them when the prototype carries BOTH `wikidataUrl` and
 * `wikipediaUrl` — i.e. one lookup produced both. Never infer the pairing from
 * a matching title; that would fabricate an identity claim the user never made.
 *
 * @param {string[]} urls - output of collectIdentifiers
 * @param {object} prototype
 * @returns {Array<{url: string, page: string|null}>}
 */
export const groupIdentifiers = (urls, prototype) => {
  const sm = prototype?.semanticMetadata;
  const pairedPage = (sm?.wikidataUrl && sm?.wikipediaUrl) ? canonicalizeLink(sm.wikipediaUrl) : null;

  const rows = [];
  for (const url of urls) {
    const canonical = canonicalizeLink(url);
    // The paired article is folded into its Wikidata row rather than standing alone.
    if (pairedPage && canonical === pairedPage) continue;
    const isPairedEntity = pairedPage && canonical === canonicalizeLink(sm.wikidataUrl);
    rows.push({ url, page: isPairedEntity ? sm.wikipediaUrl : null });
  }
  return rows;
};
