/**
 * Saying a discovered concept IS a Thing already in the universe.
 *
 * Discover searches from a node by its name, and a name is never enough to
 * tell which result is that node. findPrototypeForConcept trusts only a shared
 * URI, and a Thing made by hand has none until something links it, so a
 * search from "Mitochondria" found "Mitochondrion" and offered to add it as a
 * second Thing. Guessing harder by name is wrong somewhere for every homonym
 * (Mercury, Java), so the person points at the result instead. That writes the
 * result's URIs onto the node as exact matches, and from then on every URI
 * check (In this web, the bookmark, a connection's other end) finds the node.
 */
import useGraphStore from '../store/graphStore.js';
import useImageCache, { cancelThumbnailFetch, queueThumbnailFetch } from './imageCache.js';
import { conceptToPrototypeFields } from './candidates.js';
import { conceptUris } from './semanticPlacement.js';
import { wikipediaTitleFromLinks } from './conceptEnrichment.js';
import { fetchWikipediaPage } from '../wizard/services/wikipediaEnrichment.js';
import { canonicalizeLink, clearLinkState, setLinkState, LINK_STATES } from '../formats/linkState.js';
import { collectIdentifiers, identifierFromUrl, STANDARD_KINDS } from '../utils/externalIdentifiers.js';

const kindOf = (url) => identifierFromUrl(url).kind;

const titleFromUrl = (url) => {
  const tail = String(url).split('/').filter(Boolean).pop() || '';
  try { return decodeURIComponent(tail).replace(/_/g, ' '); } catch { return tail.replace(/_/g, ' '); }
};

/**
 * Strip a URL out of every place in semanticMetadata a link can live.
 *
 * It has to reach all of them, or a link taken out of one comes back from
 * another on the next render: `originMetadata.originalUri` is read back by
 * collectIdentifiers. A Wikipedia link takes its article's fields with it,
 * since the cached pictures belong to the article that is no longer linked.
 * About's remove and swap use this too.
 */
export function detachLink(semanticMetadata, url) {
  const canonical = canonicalizeLink(url);
  const matches = (candidate) => typeof candidate === 'string' && canonicalizeLink(candidate) === canonical;

  const sm = { ...(semanticMetadata || {}) };

  if (Array.isArray(sm.externalLinks)) {
    sm.externalLinks = sm.externalLinks.filter(link => !matches(link));
  }
  if (matches(sm.wikidataUrl)) sm.wikidataUrl = undefined;
  if (matches(sm.wikipediaUrl)) {
    sm.wikipediaUrl = undefined;
    sm.wikipediaTitle = undefined;
    sm.wikipediaEnriched = undefined;
    sm.wikipediaEnrichedAt = undefined;
    sm.wikipediaThumbnail = undefined;
    sm.wikipediaOriginalImage = undefined;
    sm.wikipediaAdditionalImages = undefined;
  }
  if (matches(sm.originMetadata?.originalUri)) {
    sm.originMetadata = { ...sm.originMetadata, originalUri: undefined };
  }

  return clearLinkState(sm, url);
}

/** The URIs a concept would give the Thing it is linked to. */
const linksOf = (concept) => conceptToPrototypeFields(concept).externalLinks;

/**
 * Whether this concept and this Thing are linked: they share a URI.
 *
 * Canonicalized on both sides and read through collectIdentifiers, so a link
 * that lives only in `wikidataUrl` or in the nested `semanticMetadata`
 * list still counts.
 */
export function conceptIsPrototype(concept, prototype) {
  if (!concept || !prototype) return false;
  const theirs = new Set(collectIdentifiers(prototype).map(canonicalizeLink));
  if (theirs.size === 0) return false;
  for (const url of conceptUris(concept)) {
    if (theirs.has(canonicalizeLink(url))) return true;
  }
  return false;
}

const AUTHORITY = { wikidata: 'Wikidata', wikipedia: 'Wikipedia', dbpedia: 'DBpedia' };

/** "A", "A and B", "A, B and C". */
export const listWords = (words) => (
  words.length <= 1 ? (words[0] || '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
);

/** The standing authorities a Thing is identified on, in About's order. */
export function identifiedSources(prototype) {
  const kinds = new Set(collectIdentifiers(prototype).map(kindOf));
  return STANDARD_KINDS.filter(kind => kinds.has(kind)).map(kind => AUTHORITY[kind]);
}

/**
 * What linking this concept would do to the Thing. Sources the Thing has no
 * entry on are added, so linking results from different sources accumulates;
 * a source it already has a different entry on is replaced.
 */
export function linkEffect(concept, prototype) {
  const have = collectIdentifiers(prototype);
  const haveCanonical = new Set(have.map(canonicalizeLink));
  const haveKinds = new Set(have.map(kindOf));
  const adds = new Set();
  const replaces = new Set();
  for (const url of linksOf(concept)) {
    const kind = kindOf(url);
    if (!STANDARD_KINDS.includes(kind) || haveCanonical.has(canonicalizeLink(url))) continue;
    (haveKinds.has(kind) ? replaces : adds).add(kind);
  }
  const order = (set) => STANDARD_KINDS.filter(kind => set.has(kind)).map(kind => AUTHORITY[kind]);
  return { adds: order(adds), replaces: order(replaces) };
}

/** Linking's effect in words: "adds Wikipedia, replaces its Wikidata entry". */
export function describeLinkEffect(concept, prototype) {
  const { adds, replaces } = linkEffect(concept, prototype);
  const parts = [];
  if (adds.length) parts.push(`adds ${listWords(adds)}`);
  if (replaces.length) parts.push(`replaces its ${listWords(replaces)} ${replaces.length > 1 ? 'entries' : 'entry'}`);
  return parts.join(', ');
}

/** The link button's label for a concept that isn't linked yet. */
export function linkActionTitle(concept, prototype) {
  const effect = describeLinkEffect(concept, prototype);
  return `This is ${prototype.name}. Link it${effect ? ` (${effect})` : ''}`;
}

/** A picture the person put there: uploaded, or stored in the repo. */
const hasOwnPicture = (proto) => !!(proto?.imageSrc || proto?.imageRef);

const hasPicture = (proto) => !!(
  hasOwnPicture(proto)
  || proto?.thumbnailSrc
  || proto?.semanticMetadata?.wikipediaThumbnail
  || useImageCache.getState().getImage(proto?.id)
);

/**
 * Link a concept to a Thing, so the Thing stands for it.
 *
 * A Thing is one subject, so it holds one entry per authority: the concept's
 * Wikidata item replaces whatever Wikidata item the Thing had, and so on for
 * Wikipedia and DBpedia. Authorities the concept doesn't carry are left alone,
 * so linking a Wikidata-only result and then a Wikipedia-only one accumulates
 * both. Anything else the Thing carries (a DOI, a homepage) stays.
 * Every link lands as an exact match, because picking it out of a described
 * list is exactly the act of checking.
 *
 * The description and the picture are filled from the article only where the
 * Thing has none. A picture that came with a Wikipedia link this replaces was
 * that article's, not the person's, so it goes with the link and the new
 * article's picture takes its place.
 *
 * @returns {boolean} whether anything was linked
 */
export function linkConceptToPrototype(prototypeId, concept) {
  const store = useGraphStore.getState();
  const proto = store.nodePrototypes.get(prototypeId);
  if (!proto) return false;
  const incoming = linksOf(concept);
  if (incoming.length === 0) return false;

  const incomingCanonical = new Set(incoming.map(canonicalizeLink));
  const incomingKinds = new Set(incoming.map(kindOf).filter(kind => STANDARD_KINDS.includes(kind)));
  const replaced = collectIdentifiers(proto).filter(url => (
    !incomingCanonical.has(canonicalizeLink(url)) && incomingKinds.has(kindOf(url))
  ));
  const replacedCanonical = new Set(replaced.map(canonicalizeLink));
  const pictureGoes = !hasOwnPicture(proto)
    && !!proto.semanticMetadata?.autoEnriched
    && replaced.some(url => kindOf(url) === 'wikipedia');

  let sm = { ...(proto.semanticMetadata || {}) };
  for (const url of replaced) sm = detachLink(sm, url);

  const links = (Array.isArray(proto.externalLinks) ? proto.externalLinks : [])
    .filter(url => !replacedCanonical.has(canonicalizeLink(url)));
  for (const url of incoming) {
    if (!links.some(link => canonicalizeLink(link) === canonicalizeLink(url))) links.push(url);
    sm = setLinkState(sm, url, LINK_STATES.EXACT, 'user');
    if (kindOf(url) === 'wikidata') sm.wikidataUrl = url;
    if (kindOf(url) === 'wikipedia') {
      sm.wikipediaUrl = url;
      sm.wikipediaTitle = titleFromUrl(url);
    }
  }
  if (pictureGoes) {
    sm.autoEnriched = false;
    sm.imageAspectRatio = undefined;
  }

  store.updateNodePrototype(prototypeId, (draft) => {
    draft.externalLinks = links;
    draft.semanticMetadata = sm;
  });
  if (pictureGoes) cancelThumbnailFetch(prototypeId);

  fillEmptyFromLinks(prototypeId, incoming);
  return true;
}

/**
 * Take a concept's links back off a Thing. The description and picture they
 * brought stay: they are the Thing's now, and About can remove them.
 */
export function unlinkConceptFromPrototype(prototypeId, concept) {
  const store = useGraphStore.getState();
  const proto = store.nodePrototypes.get(prototypeId);
  if (!proto) return;
  const leaving = new Set([...conceptUris(concept)].map(canonicalizeLink));

  let sm = { ...(proto.semanticMetadata || {}) };
  for (const url of collectIdentifiers(proto)) {
    if (leaving.has(canonicalizeLink(url))) sm = detachLink(sm, url);
  }
  const links = (Array.isArray(proto.externalLinks) ? proto.externalLinks : [])
    .filter(url => !leaving.has(canonicalizeLink(url)));

  store.updateNodePrototype(prototypeId, (draft) => {
    draft.externalLinks = links;
    draft.semanticMetadata = sm;
  });
}

/**
 * Fill a Thing's description and picture from the article its new links name,
 * each only if it is still empty when the article arrives.
 */
async function fillEmptyFromLinks(prototypeId, links) {
  try {
    const title = await wikipediaTitleFromLinks(links);
    if (!title) return;
    const result = await fetchWikipediaPage(title);
    if (result?.type !== 'direct') return;
    const page = result.page;

    const store = useGraphStore.getState();
    const proto = store.nodePrototypes.get(prototypeId);
    // Unlinked again while the article was on its way.
    if (!proto || !conceptIsPrototype({ externalLinks: links }, proto)) return;

    const fillDescription = !proto.description?.trim() && !!page.description;
    const fillPicture = !hasPicture(proto) && !!page.thumbnail;
    if (!fillDescription && !fillPicture) return;

    const { thumbnailWidth: tw, thumbnailHeight: th } = page;
    const ratio = (tw && th) ? (th / tw) : undefined;

    store.updateNodePrototype(prototypeId, (draft) => {
      if (fillDescription) draft.description = page.description;
      if (fillPicture) {
        // autoEnriched marks the picture as the article's, which keeps it out
        // of the saved file (a URL, refetched on load). Safe only because the
        // Thing had no picture of its own.
        draft.semanticMetadata = {
          ...draft.semanticMetadata,
          wikipediaThumbnail: page.thumbnail,
          ...(page.originalImage ? { wikipediaOriginalImage: page.originalImage } : {}),
          ...(ratio ? { imageAspectRatio: ratio } : {}),
          autoEnriched: true,
          autoEnrichConfidence: 1.0
        };
      }
      draft.semanticMetadata = {
        ...draft.semanticMetadata,
        wikipediaEnriched: true,
        wikipediaEnrichedAt: new Date().toISOString()
      };
    });
    if (fillPicture) queueThumbnailFetch(prototypeId, page.thumbnail, ratio || 1, proto.name);
  } catch (error) {
    console.warn('[ConceptLinking] Fill failed:', error?.message || error);
  }
}
