/**
 * The JSON-LD document loader every jsonld.* call in the app uses.
 *
 * jsonld.js resolves a remote `@context` by fetching whatever URL the document
 * names. A document is untrusted input (a file someone sent, a page we
 * resolved), so its author would otherwise choose a URL our client requests:
 * an intranet address, a localhost agent server, a tracker that learns who
 * opened the file. Contexts are also code-like — a swapped context changes
 * what every term in the document means.
 *
 * So remote contexts are resolved only from a short list of vocabulary hosts,
 * always over https, with a size cap and an in-memory cache. Anything else is
 * refused with a jsonld-style error, which the callers already treat as a
 * failed parse.
 */

/** Hosts whose published contexts we will fetch. Exact hostnames. */
const ALLOWED_CONTEXT_HOSTS = new Set([
  'schema.org',
  'www.w3.org',
  'w3id.org',
  'purl.org',
]);

/**
 * schema.org serves HTML at its root and advertises the context through a Link
 * header; jsonld's own loaders follow that, ours doesn't need to.
 */
const CONTEXT_ALIASES = {
  'https://schema.org': 'https://schema.org/docs/jsonldcontext.jsonld',
  'https://schema.org/': 'https://schema.org/docs/jsonldcontext.jsonld',
};

const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const cache = new Map();

const loaderError = (url, reason) => {
  const error = new Error(`Remote JSON-LD context refused (${reason}): ${String(url).slice(0, 200)}`);
  error.name = 'jsonld.LoadDocumentError';
  error.details = { code: 'loading document failed', url };
  return error;
};

/**
 * The https URL we would fetch for `url`, or null when it isn't allowed.
 * http:// on an allowed host is upgraded (schema.org contexts are commonly
 * written as http://schema.org/).
 */
export const resolveAllowedContextUrl = (url) => {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (!ALLOWED_CONTEXT_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  parsed.protocol = 'https:';
  parsed.hash = '';
  const href = parsed.href;
  return CONTEXT_ALIASES[href] || CONTEXT_ALIASES[href.replace(/\/$/, '')] || href;
};

const readCapped = async (response) => {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CONTEXT_BYTES) throw new Error('too large');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > MAX_CONTEXT_BYTES) throw new Error('too large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CONTEXT_BYTES) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new Error('too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

/**
 * jsonld.js documentLoader: `(url) => Promise<{ contextUrl, documentUrl, document }>`.
 */
export const safeDocumentLoader = async (url) => {
  const target = resolveAllowedContextUrl(url);
  if (!target) throw loaderError(url, 'host not on the allowlist');
  if (cache.has(target)) return { contextUrl: null, documentUrl: url, document: cache.get(target) };
  if (typeof fetch !== 'function') throw loaderError(url, 'no fetch');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(target, {
      signal: controller?.signal,
      credentials: 'omit',
      headers: { Accept: 'application/ld+json, application/json' },
    });
    // A redirect may only land on another allowed host.
    if (response.url && !resolveAllowedContextUrl(response.url)) throw loaderError(url, 'redirected off the allowlist');
    if (!response.ok) throw loaderError(url, `HTTP ${response.status}`);
    const document = JSON.parse(await readCapped(response));
    cache.set(target, document);
    return { contextUrl: null, documentUrl: url, document };
  } catch (error) {
    if (error?.name === 'jsonld.LoadDocumentError') throw error;
    throw loaderError(url, error?.message || 'fetch failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Options to spread into every jsonld.* call. */
export const JSONLD_SAFE_OPTIONS = Object.freeze({ documentLoader: safeDocumentLoader });

/** Test hook. */
export const _clearContextCache = () => cache.clear();
