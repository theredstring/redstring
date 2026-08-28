/**
 * Where a Thing came from.
 *
 * The provenance block used to answer this only when it could, which meant most
 * Things showed a "Where this came from" heading and then nothing that said
 * where they came from. Every Thing has an answer: either an outside service
 * handed it to us, or a person made it here.
 *
 * Derived, not stored, so no existing file changes and nothing needs migrating.
 * The one forward-looking hook is `semanticMetadata.origin`: when a creation
 * path eventually records its own answer (which universe a Thing arrived from,
 * which import, which agent), it wins over everything derived here. Nothing
 * writes it yet, and `semanticMetadata` is persisted verbatim as an opaque
 * blob, so adding it later is additive too.
 */
import { identifierFromUrl } from './externalIdentifiers.js';

/**
 * Sources written by the semantic-discovery and orbit paths at creation time.
 * These are the only honest signal that a Thing originated elsewhere. The
 * presence of a Wikidata link is NOT such a signal: auto-enrichment adds those
 * to Things that were made here, long after the fact.
 */
const SOURCE_LABELS = {
  wikidata: 'Wikidata',
  dbpedia: 'DBpedia',
  wikipedia: 'Wikipedia',
  schema: 'Schema.org',
  'schema.org': 'Schema.org'
};

/**
 * The default answer.
 *
 * Just the name, with nothing in parentheses. Naming a universe here would be a
 * promise the app can't keep yet: Things don't carry which universe they came
 * from, so anything more specific would be a guess dressed as a fact.
 */
export const LOCAL_ORIGIN_LABEL = 'Redstring';

/**
 * @param {object} prototype
 * @returns {{label: string, href: string|null, isLocal: boolean}}
 */
export const resolveOrigin = (prototype) => {
  const sm = prototype?.semanticMetadata;

  const declared = sm?.origin;
  if (declared?.label) {
    return { label: declared.label, href: declared.href || null, isLocal: !!declared.isLocal };
  }

  const om = sm?.originMetadata;
  const source = om?.source ? String(om.source).toLowerCase() : null;
  if (source) {
    let label = SOURCE_LABELS[source];
    // Orbit records 'external' for anything it resolved off a URI rather than
    // from a named service, so read the service back off the URI itself.
    if (!label && om.originalUri) {
      const derived = identifierFromUrl(om.originalUri).authority;
      if (derived && derived !== 'Link') label = derived;
    }
    if (!label) label = source.charAt(0).toUpperCase() + source.slice(1);
    return { label, href: om.originalUri || null, isLocal: false };
  }

  return { label: LOCAL_ORIGIN_LABEL, href: null, isLocal: true };
};
