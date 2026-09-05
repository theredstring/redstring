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
import { bestNameMatch } from './utils/nameMatch.js';
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
 * on the canvas you happen to be looking at.
 *
 * The matching rule itself is in utils/nameMatch.js because the applier has to
 * use the identical one — the two disagreeing is what silently drops a link.
 */
function resolvePrototype(name, nodePrototypes) {
  return bestNameMatch(name, nodePrototypes, proto => proto.name);
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
        // The Thing's OWN name when we found it, so the store resolves the same
        // subject this tool did rather than re-guessing from the model's wording.
        nodeName: entry.proto?.name || entry.nodeName,
        prototypeId: entry.proto?.id || null,
        url: entry.url,
        href,
        authority,
        identifier: id,
        kind,
        // Whether a Thing by this name actually exists. A link that names
        // nothing still goes through — the node may have been created this turn
        // and be invisible from here — but saying so is what lets the model
        // check instead of reporting a success it cannot see.
        resolved: !!entry.proto,
        // What the authority itself says this is. Carried through so the model
        // reports the paper rather than the number, and so a wrong match shows
        // in the transcript without anyone following the link.
        label: entry.described?.label || null,
        description: entry.described?.description || null
      });
    }
  }

  const unresolved = linked.filter(link => !link.resolved).map(link => link.nodeName);

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
    linked: linked.length > 0,
    ...(unresolved.length > 0 ? {
      unresolved,
      // Named as work still to do rather than buried in a flag. This is the
      // exact spot where a framework ends up nine-tenths grounded and reported
      // as fully grounded.
      note: `No Thing found named: ${unresolved.join(', ')}. These links may not have landed. `
        + 'Check the real names with readGraph, then re-link with the exact name — and if a study still has no DOI, say so instead of reporting it as grounded.'
    } : {}),
    ...(failures.length > 0 ? {
      warning: `${failures.length} identifier(s) did not attach. Tell the user which studies are ungrounded.`
    } : {})
  };
}
