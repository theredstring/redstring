/**
 * Import-time hygiene for values that end up in a URL, an image source or CSS.
 *
 * A universe file is written by whoever wrote it. The render sinks already
 * check every link, image and colour they draw (utils/safeUrl.js,
 * utils/safeColor.js); this is the second layer, so a hostile value doesn't sit
 * in the store waiting for the one sink that forgot to check.
 *
 * Rules:
 * - Unsafe values are DROPPED, never rewritten. A rewritten link is a link
 *   nobody wrote. (A dropped Thing or group colour reads as "no colour given"
 *   and gets the default maroon, exactly as a file without one does.)
 * - Only the fields that feed those sinks are touched; everything else in the
 *   file passes through exactly as it was (.redstring is a format other people
 *   write, and data loss is worse than a delayed fix).
 * - Identifier strings that aren't web links (doi:10…, wd:Q42, urn:isbn:…,
 *   bare ids) are kept: they are identifiers, and the About section shows them
 *   as text. Only schemes that do something when followed are refused.
 */
import { safeImageSrc } from '../utils/safeUrl.js';
import { sanitizeColor } from '../utils/safeColor.js';

/**
 * Schemes an identifier may carry and still be stored. Anything with a scheme
 * outside this list (javascript:, data:, file:, blob:, vbscript:, smb:,
 * ms-*:, intent:, …) is dropped.
 */
const STORABLE_LINK_SCHEMES = new Set([
  'http', 'https', 'mailto',
  'doi', 'wd', 'pubmed', 'urn', 'info', 'tag', 'ark', 'did', 'isbn', 'issn', 'arxiv', 'hdl', 'geo',
]);

// What the browser strips before reading a scheme: leading C0/space, and every
// tab/CR/LF anywhere in the string.
// eslint-disable-next-line no-control-regex
const LEADING_C0_OR_SPACE = /^[\u0000- ]+/;
const TAB_OR_NEWLINE = /[\t\n\r]/g;

const effectiveScheme = (value) => {
  const head = value.slice(0, 256).replace(LEADING_C0_OR_SPACE, '').replace(TAB_OR_NEWLINE, '');
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(head);
  return match ? match[1].toLowerCase() : null;
};

/** True when a link/identifier string may be kept in the store. */
export const isStorableLink = (value) => {
  if (typeof value !== 'string') return false;
  if (value.length > 8192) return false;
  const scheme = effectiveScheme(value);
  return scheme === null || STORABLE_LINK_SCHEMES.has(scheme);
};

/**
 * True when an image string may be kept. The render-time allowlist
 * (safeImageSrc) plus SVG data URLs: a user can upload an SVG, and dropping it
 * at load would lose their picture. It is inert as an image; the render sinks
 * still refuse it and fall back to the raster thumbnail.
 */
export const isStorableImage = (value) =>
  typeof value === 'string' && (safeImageSrc(value) !== null || /^data:image\/svg\+xml[;,]/i.test(value.trimStart()));

/**
 * Keys whose values are credentials and must never be stored or exported:
 * apiKey, apiKeyOverride, api_key, accessToken, token, clientSecret, password…
 * `token$` rather than `token` so settings like `maxTokens` survive.
 */
const SECRET_KEY = /api[-_]?key|secret|passw(?:or)?d|authorization|credential|token$/i;

/**
 * A copy of an agent config with every credential-like key removed, at any
 * depth. Returns the input untouched when it isn't an object.
 */
export const stripSecretFields = (value, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => stripSecretFields(item, depth + 1));
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = stripSecretFields(inner, depth + 1);
  }
  return out;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** The colour a Thing or group gets when its file gives none (NODE_DEFAULT_COLOR). */
const DEFAULT_COLOR = '#8B0000';

/**
 * Drop `obj[key]` when it is a non-empty string that isn't a safe colour. With
 * a `fallback`, the key is set to it instead: prototypes and groups are drawn
 * with a colour everywhere, so an unsafe one becomes the colour the importer
 * gives an entity whose file has none.
 */
const cleanColor = (obj, key = 'color', fallback = undefined) => {
  if (!obj || !hasOwn(obj, key)) return;
  const value = obj[key];
  if (value == null) return;
  if (typeof value === 'string' && value.trim() === '') return; // "no colour", harmless
  if (sanitizeColor(value) !== null) return;
  if (fallback === undefined) delete obj[key];
  else obj[key] = fallback;
};

/**
 * `userUpload` fields (a prototype's own imageSrc/thumbnailSrc) may hold an
 * SVG the person uploaded; every other image field comes from the web and
 * must pass the render-time allowlist as it stands.
 */
const cleanImage = (obj, key, { userUpload = false } = {}) => {
  if (!obj || !hasOwn(obj, key)) return;
  const value = obj[key];
  if (value == null || value === '') return;
  const ok = userUpload ? isStorableImage(value) : safeImageSrc(value) !== null;
  if (!ok) delete obj[key];
};

const cleanLink = (obj, key) => {
  if (!obj || !hasOwn(obj, key)) return;
  const value = obj[key];
  if (value == null || value === '') return;
  if (!isStorableLink(value)) delete obj[key];
};

/** Links may be strings or `{ '@id' | url | uri }` objects; drop unsafe ones. */
const cleanLinkList = (list) => {
  if (!Array.isArray(list)) return list;
  return list.filter((entry) => {
    if (entry == null) return true;
    if (typeof entry === 'string') return isStorableLink(entry);
    if (typeof entry === 'object') {
      const inner = entry['@id'] ?? entry.url ?? entry.uri ?? entry.href;
      return inner == null || isStorableLink(inner);
    }
    return true;
  });
};

const cleanSemanticMetadata = (sm) => {
  if (!sm || typeof sm !== 'object' || Array.isArray(sm)) return sm;
  const out = { ...sm };
  for (const key of ['wikipediaUrl', 'wikidataUrl', 'dbpediaUrl', 'originalUri', 'url', 'uri']) cleanLink(out, key);
  for (const key of ['wikipediaThumbnail', 'wikipediaOriginalImage', 'thumbnail', 'image']) cleanImage(out, key);
  if (Array.isArray(out.externalLinks)) out.externalLinks = cleanLinkList(out.externalLinks);
  if (Array.isArray(out.wikipediaAdditionalImages)) {
    out.wikipediaAdditionalImages = out.wikipediaAdditionalImages
      .filter((img) => img && typeof img === 'object')
      .map((img) => {
        const copy = { ...img };
        cleanImage(copy, 'url');
        cleanImage(copy, 'thumbnail');
        return copy;
      })
      .filter((img) => img.url || img.thumbnail);
  }
  if (out.originMetadata && typeof out.originMetadata === 'object') {
    out.originMetadata = { ...out.originMetadata };
    cleanLink(out.originMetadata, 'originalUri');
  }
  if (out.origin && typeof out.origin === 'object') {
    out.origin = { ...out.origin };
    cleanLink(out.origin, 'href');
  }
  return out;
};

/** Clean one node prototype in place (the importer's own fresh object). */
export const sanitizePrototype = (proto) => {
  if (!proto || typeof proto !== 'object') return proto;
  cleanColor(proto, 'color', DEFAULT_COLOR);
  cleanImage(proto, 'imageSrc', { userUpload: true });
  cleanImage(proto, 'thumbnailSrc', { userUpload: true });
  if (Array.isArray(proto.externalLinks)) proto.externalLinks = cleanLinkList(proto.externalLinks);
  if (hasOwn(proto, 'semanticMetadata')) proto.semanticMetadata = cleanSemanticMetadata(proto.semanticMetadata);
  if (proto.agentConfig && typeof proto.agentConfig === 'object') proto.agentConfig = stripSecretFields(proto.agentConfig);
  return proto;
};

const each = (collection, fn) => {
  if (!collection) return;
  if (collection instanceof Map) {
    collection.forEach((value) => fn(value));
  } else if (typeof collection === 'object') {
    Object.values(collection).forEach((value) => fn(value));
  }
};

/**
 * Clean an imported store state (or an import adapter's `{ graphs, nodes,
 * edges }` result) in place, and return it.
 */
export const sanitizeImportedState = (state) => {
  if (!state || typeof state !== 'object') return state;
  each(state.nodePrototypes, sanitizePrototype);
  each(state.nodes, sanitizePrototype);
  each(state.edgePrototypes, sanitizePrototype);
  each(state.edges, (edge) => {
    if (!edge || typeof edge !== 'object') return;
    cleanColor(edge);
    if (hasOwn(edge, 'semanticMetadata')) edge.semanticMetadata = cleanSemanticMetadata(edge.semanticMetadata);
  });
  each(state.graphs, (graph) => {
    if (!graph || typeof graph !== 'object') return;
    cleanColor(graph);
    each(graph.groups, (group) => cleanColor(group, 'color', DEFAULT_COLOR));
  });
  return state;
};
