/**
 * linkIdentifier - Attach external identifiers to Things.
 *
 * The wizard's half of the panel's "Known Elsewhere As" field: a DOI, a
 * Wikidata/Wikipedia/DBpedia entry or any URL lands on the prototype's
 * `externalLinks` with a rung recorded for it. Same storage, same reading of
 * what was pasted (`extractDOI` / `isValidURL`), so a link added here is
 * indistinguishable from one the user typed — except for who vouched for it.
 *
 * Three things this deliberately does that the panel does not:
 *
 *  - It CHECKS a DOI before attaching it. A DOI a model produced from memory is
 *    the one identifier in this system that is both easy to fabricate and
 *    impossible to eyeball — `10.1093/qje/112.2.443`, assembled out of a
 *    journal, volume and page, is a 404 — so the registry has to recognise it
 *    or the entry fails. `findWork` is how the model gets a real one.
 *
 *  - It does not pay for that check twice. A DOI `findWork` just returned was
 *    verified by the search itself, so the memo in utils/verifiedWorks.js
 *    answers for it and no request is made. Search-then-link across a whole
 *    reading list costs one wave of searches and no verification calls at all.
 *
 *  - It attaches at the AUTO rung, never EXACT. AUTO means "found, nobody has
 *    checked" — exactly true of a link a model chose. Promoting it is one click
 *    in the panel, and defaulting down is the safe direction: understating is
 *    visible on screen, overstating travels into everyone else's data on export
 *    as skos:exactMatch. See formats/linkState.js.
 */

import { extractDOI, isValidURL, identifierFromUrl } from '../../utils/externalIdentifiers.js';
import { describeIdentifier } from '../../services/identifierSearch.js';
import { rememberVerified, recallVerified } from './utils/verifiedWorks.js';
import { withSafeConsole } from './withSafeConsole.js';

// Registered identifiers are checked in parallel, a few at a time — gentle on
// the registries, and the wall clock for a batch is one lookup's wait.
const CONCURRENCY = 5;

// Degrade fast. A registry that has not answered by now yields "could not
// verify", which the model can act on; hanging past it costs the whole ask.
const VERIFY_TIMEOUT_MS = 8000;

const MAX_LINKS = 30;

/**
 * What was handed in, read as a storable link — the same reading the panel's
 * Add field does. A bare or doi.org DOI becomes `doi:10.…`, a PubMed URL
 * becomes `pubmed:…`, anything else has to already be a URL.
 *
 * @param {string} input
 * @returns {string|null} the URL to store, or null if it isn't one
 */
export function normalizeIdentifier(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;

  // Already stored in one of the prefixed forms identifierFromUrl reads back.
  if (/^(doi|pubmed|wd):/.test(trimmed)) return trimmed;

  const doi = extractDOI(trimmed);
  if (doi) return doi.startsWith('10.') ? `doi:${doi}` : doi;

  return isValidURL(trimmed) ? trimmed : null;
}

/** Run `fn` over `items` a few at a time, preserving order. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Identifiers live on the PROTOTYPE, so resolution is prototype-wide rather
 * than scoped to one graph's instances: a Thing can be grounded without being
 * on the canvas you happen to be looking at. Last match wins — prototypes
 * accumulate and the first is the stale one (see MEMORY.md).
 */
function resolvePrototype(name, nodePrototypes) {
  const queryLower = String(name ?? '').toLowerCase().trim();
  if (!queryLower) return null;

  let resolved = null;
  for (const proto of nodePrototypes) {
    if ((proto.name || '').toLowerCase().trim() === queryLower) resolved = proto;
  }
  if (resolved) return resolved;

  for (const proto of nodePrototypes) {
    const protoName = (proto.name || '').toLowerCase().trim();
    if (protoName && (protoName.includes(queryLower) || queryLower.includes(protoName))) resolved = proto;
  }
  return resolved;
}

/** Every identifier a predictive prototype already carries. */
function existingLinks(proto) {
  return [
    ...(Array.isArray(proto?.externalLinks) ? proto.externalLinks : []),
    ...(Array.isArray(proto?.semanticMetadata?.externalLinks) ? proto.semanticMetadata.externalLinks : [])
  ];
}

/**
 * Attach one or many identifiers.
 *
 * @param {Object} args - { nodeName, identifier } or { links: [{nodeName, identifier}] }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for the applier
 */
export async function linkIdentifier(args, graphState) {
  const { nodeName, identifier, links, targetGraphId } = args;

  // One pair is a batch of one. Keeping a single code path means the batch form
  // cannot drift from the form every existing caller and test uses.
  const requested = Array.isArray(links) && links.length > 0
    ? links.map(link => ({ nodeName: link?.nodeName, identifier: link?.identifier }))
    : [{ nodeName, identifier }];

  if (requested.length > MAX_LINKS) {
    throw new Error(`Too many links (${requested.length}). Attach at most ${MAX_LINKS} identifiers per call.`);
  }

  const { nodePrototypes = [], activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  const resolved = requested.map(entry => {
    if (!entry.nodeName) return { ...entry, failure: 'nodeName is required' };
    if (!entry.identifier) return { ...entry, failure: 'identifier is required' };

    const url = normalizeIdentifier(entry.identifier);
    if (!url) {
      return {
        ...entry,
        failure: `"${entry.identifier}" is not a link or a DOI. Pass a DOI (10.xxxx/yyyy), a doi.org URL, or a full https:// URL.`
      };
    }

    const proto = resolvePrototype(entry.nodeName, nodePrototypes);
    if (existingLinks(proto).some(link => normalizeIdentifier(link) === url)) {
      return { ...entry, url, proto, alreadyLinked: true };
    }
    return { ...entry, url, proto };
  });

  const checked = await withSafeConsole(() => mapWithConcurrency(resolved, CONCURRENCY, async (entry) => {
    if (entry.failure || entry.alreadyLinked) return entry;

    const { kind } = identifierFromUrl(entry.url);

    // A DOI or PubMed id can be checked, and a null answer there means no such
    // registration. An arbitrary URL cannot be, and a null answer is silence
    // rather than a denial — so the check only ever blocks where it means
    // something.
    const registered = kind === 'doi' || kind === 'pubmed';

    // Already answered for, this run — by an earlier link or by the findWork
    // search that produced this DOI in the first place.
    const known = recallVerified(entry.url);
    if (known) return { ...entry, described: known };

    let described = null;
    try {
      described = await describeIdentifier(entry.url, { signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
    } catch (error) {
      console.error('[linkIdentifier] verification failed:', entry.url, error?.message || error);
    }

    if (described) rememberVerified(entry.url, described);
    else if (registered) {
      const { authority, identifier: id } = identifierFromUrl(entry.url);
      return {
        ...entry,
        failure: `${authority} ${id} could not be verified — no registration found (Crossref/DataCite/PubMed), or the lookup failed. `
          + 'Do not attach an identifier you cannot check; use findWork to get the real one.'
      };
    }

    return { ...entry, described };
  }));

  const linked = [];
  const failures = [];
  const skipped = [];

  for (const entry of checked) {
    const { authority, identifier: id, href, kind } = entry.url
      ? identifierFromUrl(entry.url)
      : { authority: null, identifier: null, href: null, kind: null };

    if (entry.failure) {
      failures.push({ nodeName: entry.nodeName || null, identifier: entry.identifier || null, reason: entry.failure });
    } else if (entry.alreadyLinked) {
      skipped.push({ nodeName: entry.proto?.name || entry.nodeName, url: entry.url, authority, identifier: id });
    } else {
      linked.push({
        nodeName: entry.proto?.name || entry.nodeName,
        prototypeId: entry.proto?.id || null,
        url: entry.url,
        href,
        authority,
        identifier: id,
        kind,
        // What the authority itself says this is. Carried through so the model
        // reports the paper rather than the number, and so a wrong match shows
        // in the transcript without anyone following the link.
        label: entry.described?.label || null,
        description: entry.described?.description || null
      });
    }
  }

  console.error(`[linkIdentifier] ${linked.length} linked, ${skipped.length} already present, ${failures.length} failed`);

  // Nothing landed and nothing was already there: the call failed, and it has
  // to read as a failure rather than as a result with an empty list.
  if (linked.length === 0 && skipped.length === 0) {
    throw new Error(failures.map(f => `${f.nodeName || '?'}: ${f.reason}`).join(' | '));
  }

  return {
    action: 'linkIdentifier',
    graphId,
    links: linked,
    skipped,
    failures,
    linkedCount: linked.length,
    // Only the successes are the mutation; the rest is for the model to read.
    linked: linked.length > 0
  };
}
