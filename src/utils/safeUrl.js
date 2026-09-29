/**
 * The one gate for URLs that come from graph data.
 *
 * A universe file, a pasted link, a Wikidata result or a Wizard turn can all
 * put a string into a place the browser will follow: an `<a href>`, a
 * `window.open`, an `<image href>`. None of those sources is trusted, and a
 * `javascript:` or `data:text/html` URL in any of them runs code in the app's
 * origin, where the GitHub token and the BYOK keys live.
 *
 * So every such sink asks here first. The answer is a normalized URL for the
 * schemes a person could legitimately mean, or null, in which case the caller
 * renders plain text (or nothing). Unsafe values are dropped, never rewritten:
 * a "fixed" URL would be a URL nobody wrote.
 *
 * Parsing goes through the WHATWG URL parser, the same one the browser uses when
 * it follows the link. That is what makes the whitespace and control-character
 * tricks (`java\tscript:`, `\x01javascript:`, `  JaVaScRiPt:`) harmless: the
 * parser strips them exactly as the browser would, and the scheme we check is
 * the scheme the browser would act on.
 */

/** Longest URL accepted for a link. Real links are far shorter. */
const MAX_HREF_LENGTH = 8192;

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const IMAGE_PROTOCOLS = new Set(['https:', 'http:', 'blob:']);

/**
 * Raster image data URLs only. `image/svg+xml` is excluded: an SVG is a
 * document, and one that is ever opened or navigated to runs its scripts.
 */
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|gif|webp|avif);/i;

// C0 controls and space, which the URL parser strips from both ends.
// eslint-disable-next-line no-control-regex
const LEADING_C0_OR_SPACE = /^[\u0000- ]+/;

const parse = (value) => {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_HREF_LENGTH) return null;
  try {
    // No base URL: a relative string is not an external link.
    return new URL(value);
  } catch {
    return null;
  }
};

/**
 * @param {unknown} url
 * @returns {string|null} the normalized URL for https:, http: and mailto:, else null
 */
export const safeExternalHref = (url) => {
  const parsed = parse(url);
  if (!parsed || !EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null;
  // http(s) with no host is not a link anywhere ("https:foo" parses oddly).
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null;
  return parsed.href;
};

/**
 * @param {unknown} url
 * @returns {string|null} a src an <img>/<image> may load, else null
 */
export const safeImageSrc = (url) => {
  if (typeof url !== 'string' || !url) return null;
  // Data URLs can be megabytes, so don't hand them to the URL parser (which
  // would copy them). The browser strips leading C0/space before reading the
  // scheme; do the same so the prefix check sees what the browser sees.
  const head = url.slice(0, 64).replace(LEADING_C0_OR_SPACE, '');
  if (/^data:/i.test(head)) {
    return SAFE_IMAGE_DATA_URL.test(head) ? url : null;
  }
  // blob: URLs are minted by this document (imageBlobStore); their inner
  // origin is ours, so they are safe to load as images.
  const parsed = parse(url);
  if (!parsed || !IMAGE_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.protocol !== 'blob:' && !parsed.hostname) return null;
  return parsed.href;
};

/**
 * A CSS `url(...)` value for an image, or null. The URL goes through
 * safeImageSrc and is quoted with its quotes and backslashes escaped, so it
 * can't close the `url(` and append its own declarations.
 *
 * @param {unknown} url
 * @returns {string|null}
 */
export const cssImageUrl = (url) => {
  const src = safeImageSrc(url);
  if (!src) return null;
  return `url("${src.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
};

/**
 * The only sanctioned `window.open` in src/. Opens a vetted external URL in a
 * new tab with no opener and no referrer. In Electron the request reaches
 * setWindowOpenHandler, which checks the scheme again before handing it to the
 * OS.
 *
 * @param {unknown} url
 * @returns {boolean} true when the URL was safe and an open was requested
 */
export const openExternalUrl = (url) => {
  const href = safeExternalHref(url);
  if (!href) return false;
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
  window.open(href, '_blank', 'noopener,noreferrer');
  return true;
};

/**
 * True when `hostname` is `domain` or a subdomain of it, on a dot boundary:
 * `www.wikidata.org` matches `wikidata.org`; `evilwikidata.org` and
 * `wikidata.org.evil.com` do not.
 */
export const hostMatches = (hostname, domain) => {
  if (typeof hostname !== 'string' || typeof domain !== 'string') return false;
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
};
