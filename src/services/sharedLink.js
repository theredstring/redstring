/**
 * Shared links: a link to a universe hosted somewhere else.
 *
 *   https://redstring.io/open?gh=owner/repo/main/universes/foo.redstring
 *   https://redstring.io/open?url=https%3A%2F%2Fexample.com%2Ffoo.redstring
 *   redstring://open?gh=...        (the same link, for the installed apps)
 *
 * A link only says where the file is. It grants nothing: the host decides who
 * can read it. Always `/open`, one level deep, because the page's assets load
 * relative to it (`base: './'` in vite.config.js).
 */

import { classifyUrl } from './externalUniverseLoader.js';

const CANONICAL_ORIGIN = 'https://redstring.io';
const LINK_HOSTS = new Set(['redstring.io', 'www.redstring.io', 'staging.redstring.io']);
const OPEN_PATH = /^\/open\/?$/;
const RAW_GITHUB = 'https://raw.githubusercontent.com/';

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** The file a link's `gh` or `url` names, ready to fetch, or null. */
function sourceFromParams(params) {
  const gh = params.get('gh');
  if (gh) {
    const parts = gh.split('/');
    // owner, repo, branch and at least a file name.
    if (parts.length < 4 || parts.some((part) => !part || part === '.' || part === '..')) return null;
    return normalizeSourceUrl(`${RAW_GITHUB}${encodePath(gh)}`);
  }
  return normalizeSourceUrl(params.get('url'));
}

/**
 * The direct URL of a hosted universe file, or null if it doesn't name one.
 * A raw link copied from a private repo carries a temporary `token`, which is
 * never passed along.
 */
export function normalizeSourceUrl(input) {
  const classified = classifyUrl(input);
  if (classified.kind !== 'github-file' && classified.kind !== 'raw-file') return null;
  const url = new URL(classified.rawUrl);
  if (classified.kind === 'github-file') url.search = '';
  return url.href;
}

/**
 * The source file a shared link points at, or null if `href` isn't one.
 * `anyHost` is for the page's own address, wherever it's deployed.
 */
export function parseSharedLink(href, { anyHost = false } = {}) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === 'redstring:') {
    if (url.hostname !== 'open') return null;
  } else {
    if (url.protocol !== 'https:' && !anyHost) return null;
    if (!anyHost && !LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!OPEN_PATH.test(url.pathname)) return null;
  }
  return sourceFromParams(url.searchParams);
}

/** What a universe file's link says after `open?`. */
function linkQuery(sourceUrl) {
  const source = normalizeSourceUrl(sourceUrl);
  if (!source) return null;
  if (source.startsWith(RAW_GITHUB)) {
    const path = new URL(source).pathname.slice(1);
    // Encoded for a query, keeping the slashes so the link stays readable.
    return `gh=${path.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/')}`;
  }
  return `url=${encodeURIComponent(source)}`;
}

/** The address links are shared under: this deployment's, on the web. */
function linkOrigin() {
  try {
    const { protocol, hostname, origin } = window.location;
    if (protocol === 'https:' && LINK_HOSTS.has(hostname)) return origin;
  } catch { /* no window */ }
  return CANONICAL_ORIGIN;
}

/** The https link to share for a universe file, or null. */
export function buildSharedLink(sourceUrl) {
  const query = linkQuery(sourceUrl);
  return query ? `${linkOrigin()}/open?${query}` : null;
}

/** The same link, for handing to an installed app. */
export function buildAppLink(sourceUrl) {
  const query = linkQuery(sourceUrl);
  return query ? `redstring://open?${query}` : null;
}

/** What a pasted link fetches: the file a shared link names, else as given. */
export function unwrapSharedLink(input) {
  if (typeof input !== 'string') return input;
  return parseSharedLink(input.trim()) || input;
}

/** The universe file this page was opened to show, or null. */
export function readSharedLinkFromAddress() {
  try {
    return parseSharedLink(window.location.href, { anyHost: true });
  } catch {
    return null;
  }
}

/** Takes the link out of the address bar, so a reload opens the app itself. */
export function clearSharedLinkFromAddress() {
  try {
    if (OPEN_PATH.test(window.location.pathname)) window.history.replaceState(null, '', './');
  } catch { /* nothing to clear */ }
}
