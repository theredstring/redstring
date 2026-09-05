/**
 * linkIdentifier - Attach an external identifier to a Thing.
 *
 * The wizard's half of the panel's "Known Elsewhere As" field: paste a DOI, a
 * Wikidata/Wikipedia/DBpedia entry or any URL, and it lands on the prototype's
 * `externalLinks` with a rung recorded for it. Same storage, same reading of
 * what was pasted (`extractDOI` / `isValidURL`), so a link added here is
 * indistinguishable from one the user typed — except for who vouched for it.
 *
 * Two things this deliberately does that the panel does not:
 *
 *  - It CHECKS a DOI before attaching it. A DOI a model produced from memory is
 *    the one identifier in this system that is both easy to fabricate and
 *    impossible to eyeball, so the registry (Crossref, then DataCite) has to
 *    recognise it or the call fails. The registered title comes back in the
 *    result, which is also how the model can report "linked to <paper>" rather
 *    than repeating the number back.
 *
 *  - It attaches at the AUTO rung, never EXACT. AUTO means "found, nobody has
 *    checked" — which is exactly true of a link a model chose. Promoting it is
 *    one click in the panel, and defaulting down is the safe direction:
 *    understating is visible on screen, overstating travels into everyone
 *    else's data on export as skos:exactMatch. See formats/linkState.js.
 */

import { extractDOI, isValidURL, identifierFromUrl } from '../../utils/externalIdentifiers.js';
import { describeIdentifier } from '../../services/identifierSearch.js';
import { withSafeConsole } from './withSafeConsole.js';

/**
 * What was handed in, read as a storable link — the same reading the panel's
 * Add field does. A bare or doi.org DOI becomes `doi:10.…`, a PubMed URL becomes
 * `pubmed:…`, anything else has to already be a URL.
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

/**
 * Attach an identifier to a node.
 *
 * @param {Object} args - { nodeName, identifier, targetGraphId? }
 * @param {Object} graphState - Current graph state
 * @returns {Promise<Object>} Action spec for the applier
 */
export async function linkIdentifier(args, graphState) {
  const { nodeName, identifier, targetGraphId } = args;

  if (!nodeName) throw new Error('nodeName is required');
  if (!identifier) throw new Error('identifier is required');

  const url = normalizeIdentifier(identifier);
  if (!url) {
    throw new Error(
      `"${identifier}" is not a link or a DOI. Pass a DOI (10.xxxx/yyyy), a doi.org URL, or a full https:// URL.`
    );
  }

  const { nodePrototypes = [], activeGraphId } = graphState;
  const graphId = targetGraphId || activeGraphId;

  // Identifiers live on the PROTOTYPE, so resolution is prototype-wide rather
  // than scoped to one graph's instances: a Thing can be grounded without being
  // on the canvas you happen to be looking at. Last match wins — prototypes
  // accumulate and the first is the stale one (see MEMORY.md).
  const queryLower = String(nodeName).toLowerCase().trim();
  let resolvedProto = null;
  for (const proto of nodePrototypes) {
    if ((proto.name || '').toLowerCase().trim() === queryLower) resolvedProto = proto;
  }
  if (!resolvedProto) {
    for (const proto of nodePrototypes) {
      const name = (proto.name || '').toLowerCase().trim();
      if (name && (name.includes(queryLower) || queryLower.includes(name))) resolvedProto = proto;
    }
  }

  const { authority, identifier: id, kind, href } = identifierFromUrl(url);

  // Already there? Say so rather than writing a duplicate the applier would
  // drop anyway — the model needs to know the second call was a no-op.
  const existing = [
    ...(Array.isArray(resolvedProto?.externalLinks) ? resolvedProto.externalLinks : []),
    ...(Array.isArray(resolvedProto?.semanticMetadata?.externalLinks) ? resolvedProto.semanticMetadata.externalLinks : [])
  ];
  if (existing.some(link => normalizeIdentifier(link) === url)) {
    return {
      nodeName: resolvedProto?.name || nodeName,
      url,
      authority,
      identifier: id,
      alreadyLinked: true,
      message: `${resolvedProto?.name || nodeName} already carries ${authority} ${id}.`
    };
  }

  // A registered identifier can be checked; an arbitrary URL cannot, and a
  // missing description there is silence rather than a denial. So the check is
  // enforced only where a null answer actually means "no such registration".
  let described = null;
  if (kind === 'doi' || kind === 'pubmed') {
    described = await withSafeConsole(() => describeIdentifier(url));
    if (!described) {
      throw new Error(
        `${authority} ${id} could not be verified — no registration found (Crossref/DataCite/PubMed), or the lookup failed. `
        + 'Do not attach an identifier you cannot check; find the real one first.'
      );
    }
  } else {
    // Best effort. Its absence proves nothing here, so it never blocks.
    described = await withSafeConsole(() => describeIdentifier(url).catch(() => null));
  }

  console.error('[linkIdentifier]', nodeName, '→', url, described?.label ? `(${described.label})` : '');

  return {
    action: 'linkIdentifier',
    nodeName: resolvedProto?.name || nodeName,
    prototypeId: resolvedProto?.id || null,
    graphId,
    url,
    href,
    authority,
    identifier: id,
    kind,
    // What the authority itself says this is. Carried through so the model can
    // report the paper rather than the number, and so a wrong match is visible
    // in the transcript without following the link.
    label: described?.label || null,
    description: described?.description || null,
    linked: true
  };
}
