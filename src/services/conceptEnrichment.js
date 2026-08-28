/**
 * Turning a Wikipedia match into prototype updates, and getting one for a
 * concept that already knows which article it is.
 *
 * `buildEnrichmentUpdates` lived inside LeftAIView, which meant the only way to
 * enrich anything was to go through the wizard's name-search path. A concept
 * dragged in from Semantic Discovery already carries the exact URL the user
 * chose off a described list, so it needs the second half without the first.
 */
import useGraphStore from '../store/graphStore.js';
import { setLinkState, LINK_STATES } from '../formats/linkState.js';
import { queueThumbnailFetch } from './imageCache.js';
import { fetchWikipediaPage } from '../wizard/services/wikipediaEnrichment.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

/**
 * Build the update object for a node from a server enrichment match.
 * Shared between single and batch enrichment.
 */
export function buildEnrichmentUpdates(nodeProto, searchResult, confidence, { overwriteDescription = false } = {}) {
  const hasExistingDescription = !overwriteDescription && nodeProto.description && nodeProto.description.trim().length > 10;

  // Compute aspect ratio from API-provided thumbnail dimensions (survives save/load)
  const tw = searchResult.page.thumbnailWidth;
  const th = searchResult.page.thumbnailHeight;
  const imageAspectRatio = (tw && th) ? (th / tw) : undefined;

  // The Wikidata item is the thing this article is ABOUT — an entity IRI,
  // where the article URL is a document. fetchWikipediaSummary already resolves
  // it via pageprops/wikibase_item; it was simply being thrown away. Capturing
  // it is what lets About anchor on Wikidata and show the article as that
  // entity's readable face rather than as an identity claim of its own.
  const wikidataId = searchResult.page.wikidataId;
  const wikidataUrl = wikidataId ? `https://www.wikidata.org/wiki/${wikidataId}` : undefined;

  const updates = {
    ...(hasExistingDescription ? {} : { description: searchResult.page.description }),
    semanticMetadata: {
      ...nodeProto.semanticMetadata,
      wikipediaUrl: searchResult.page.url,
      wikipediaTitle: searchResult.page.title,
      wikipediaThumbnail: searchResult.page.thumbnail,
      wikipediaEnriched: true,
      wikipediaEnrichedAt: new Date().toISOString(),
      autoEnriched: true,
      autoEnrichConfidence: confidence,
      ...(wikidataUrl ? { wikidataUrl } : {}),
      ...(imageAspectRatio ? { imageAspectRatio } : {})
    }
  };

  const currentLinks = nodeProto.externalLinks || [];
  const added = [];
  if (!currentLinks.some(link => String(link).includes('wikipedia.org'))) {
    added.push(searchResult.page.url);
  }
  if (wikidataUrl && !currentLinks.some(link => String(link).includes('wikidata.org'))) {
    added.push(wikidataUrl);
  }
  if (added.length > 0) {
    updates.externalLinks = [...added, ...currentLinks];
    // Redstring found these; nobody has confirmed them. Recording the rung per
    // link keeps the export honest and stops a later image upload from
    // promoting them — the exporter used to read the rung off `autoEnriched`,
    // which is cleared when a user replaces the enriched picture.
    let sm = updates.semanticMetadata;
    for (const link of added) {
      sm = setLinkState(sm, link, LINK_STATES.AUTO, 'auto');
    }
    updates.semanticMetadata = sm;
  }

  return updates;
}

/**
 * The English Wikipedia article a set of links points at, without guessing.
 *
 * Each authority reaches it a different way, and only the Wikidata case costs a
 * request: a DBpedia resource name IS its enwiki title, since that is how
 * DBpedia is generated.
 */
export const wikipediaTitleFromLinks = async (links = [], { signal } = {}) => {
  const titleFromPath = (url) => {
    const tail = String(url).split('/').filter(Boolean).pop() || '';
    try { return decodeURIComponent(tail).replace(/_/g, ' '); } catch { return tail.replace(/_/g, ' '); }
  };

  const wikipedia = links.find(url => String(url).includes('wikipedia.org'));
  if (wikipedia) return titleFromPath(wikipedia);

  const dbpedia = links.find(url => String(url).includes('dbpedia.org'));
  if (dbpedia) return titleFromPath(dbpedia);

  const wikidata = links.find(url => String(url).includes('wikidata.org'));
  if (wikidata) {
    const qid = titleFromPath(wikidata);
    if (!/^Q\d+$/i.test(qid)) return null;
    try {
      const resp = await fetch(
        `${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=sitelinks`
        + '&sitefilter=enwiki&format=json&origin=*',
        { signal }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.entities?.[qid]?.sitelinks?.enwiki?.title || null;
    } catch {
      return null;
    }
  }

  return null;
};

/**
 * Fill in a freshly materialized concept from the article it already names.
 *
 * Fire and forget: materialization stays synchronous and the description and
 * picture land a moment later. Confidence is 1.0 because nothing was guessed —
 * we followed a link the user picked, rather than searching by a name that may
 * mean several things.
 *
 * @param {string} prototypeId
 * @param {string[]} links - the prototype's externalLinks
 */
export const enrichPrototypeFromLinks = async (prototypeId, links = []) => {
  if (!prototypeId || links.length === 0) return null;

  try {
    const title = await wikipediaTitleFromLinks(links);
    if (!title) return null;

    const result = await fetchWikipediaPage(title);
    if (result?.type !== 'direct') return null;

    const store = useGraphStore.getState();
    const proto = store.nodePrototypes.get(prototypeId);
    if (!proto) return null;

    const updates = buildEnrichmentUpdates(proto, result, 1.0);
    if (result.page.originalImage) {
      updates.semanticMetadata = {
        ...updates.semanticMetadata,
        wikipediaOriginalImage: result.page.originalImage
      };
    }

    store.updateNodePrototype(prototypeId, (draft) => { Object.assign(draft, updates); });

    const thumb = result.page.thumbnail;
    if (thumb) {
      const { thumbnailWidth: tw, thumbnailHeight: th } = result.page;
      queueThumbnailFetch(prototypeId, thumb, (tw && th) ? (th / tw) : 1, proto.name);
    }

    console.log(`[ConceptEnrich] Enriched "${proto.name}" from ${title}`);
    return { title, wikipediaUrl: result.page.url };
  } catch (error) {
    console.warn('[ConceptEnrich] Failed:', error?.message || error);
    return null;
  }
};
