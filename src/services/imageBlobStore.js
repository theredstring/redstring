/**
 * Resolves content-addressed image refs (`sha256:…`) to displayable blob URLs.
 *
 * The counterpart to GitSyncEngine._externalizeImages: that writes full-res
 * image bytes out to `universes/<folder>/images/<sha>.<ext>` and leaves a ref
 * on the prototype; this fetches them back on demand.
 *
 * Only the PANEL's large view needs this. The canvas renders `thumbnailSrc`,
 * which stays inline in the `.redstring` file — so nothing here is on the path
 * that draws the graph, and a total failure of this module costs the user the
 * full-size image in one panel section, not their canvas.
 *
 * Blobs are immutable by construction (the address IS the content hash), so a
 * resolved entry can be cached for the life of the session with no
 * invalidation logic. The cache is capped and never serialized — these are the
 * multi-megabyte payloads we just went to the trouble of getting out of the
 * save path, and letting them accumulate unbounded in the heap would reproduce
 * the OOM this whole architecture exists to avoid.
 *
 * @see src/formats/imageRefs.js
 */
import { isImageRef, blobPathCandidates, mimeForExt } from '../formats/imageRefs.js';

// Full-resolution originals — a handful of these is already tens of MB, so the
// ceiling is deliberately low. Eviction revokes the object URL; a re-view
// re-fetches, which is one request against an immutable, cacheable path.
const MAX_CACHED = 24;

/**
 * The active blob source, registered by whichever GitSyncEngine owns the
 * current universe. A plain registration (rather than importing the engine)
 * keeps this module free of a cycle: gitSyncEngine already imports the format
 * layer, which imports imageRefs.
 *
 * @type {{ provider: object, universeFolder: string }|null}
 */
let _source = null;

/** ref → blob URL, insertion-ordered for LRU-ish eviction. */
const _cache = new Map();
/** ref → in-flight promise, so concurrent viewers share one fetch. */
const _inflight = new Map();
/** Refs known to be unreachable, so a missing blob is not re-fetched forever. */
const _permanentFailures = new Set();

/**
 * Point the store at a universe's git repo. Called by GitSyncEngine on start
 * and whenever the active universe changes.
 */
export function registerBlobSource(provider, universeFolder) {
  const changed =
    _source?.provider !== provider || _source?.universeFolder !== universeFolder;
  _source = provider ? { provider, universeFolder } : null;
  // Refs are hashes, so a cached blob stays valid across universes — but a
  // FAILURE is only ever about one repo. Clear those so switching to a universe
  // that does have the blob retries.
  if (changed) _permanentFailures.clear();
}

/** Forget the active source (universe closed / git disconnected). */
export function clearBlobSource() {
  _source = null;
  _permanentFailures.clear();
}

/** True when a ref could be resolved — i.e. a git source is registered. */
export const canResolveRefs = () => !!_source?.provider;

function _remember(ref, blobUrl) {
  _cache.set(ref, blobUrl);
  while (_cache.size > MAX_CACHED) {
    const oldest = _cache.keys().next().value;
    const url = _cache.get(oldest);
    _cache.delete(oldest);
    // Deferred: a component may still hold this URL in the frame being torn
    // down, and revoking synchronously renders a broken <img> for that frame.
    if (typeof url === 'string' && url.startsWith('blob:')) {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}

async function _fetchBlob(ref, knownExt) {
  const { provider, universeFolder } = _source;
  const candidates = blobPathCandidates(ref, universeFolder, knownExt);

  let lastStatus = null;
  for (const path of candidates) {
    try {
      const bytes = await provider.readBinaryFile(path);
      if (!bytes || bytes.length === 0) continue;
      const ext = path.slice(path.lastIndexOf('.') + 1);
      const blob = new Blob([bytes], { type: mimeForExt(ext) });
      return URL.createObjectURL(blob);
    } catch (err) {
      lastStatus = err?.status ?? err?.code ?? null;
      // 404 on this candidate just means "wrong extension" when we're probing;
      // any other error is worth surfacing rather than silently trying more.
      const isMissing = err?.code === 'FILE_NOT_FOUND' || err?.status === 404;
      if (!isMissing) throw err;
    }
  }

  const err = new Error(`No blob found for ${ref}`);
  err.code = 'BLOB_NOT_FOUND';
  err.status = lastStatus;
  throw err;
}

/**
 * Resolve a ref to a blob URL suitable for `<img src>`.
 *
 * @param {string} ref - `sha256:<hex>`
 * @param {string|null} [knownExt] - extension recorded beside the ref, which
 *   turns path discovery into a single request instead of a probe
 * @returns {Promise<string|null>} blob URL, or null when unresolvable (no git
 *   source, malformed ref, or the blob is genuinely absent). Callers render
 *   their missing-image state on null rather than treating it as an error.
 */
export async function resolveImageRef(ref, knownExt = null) {
  if (!isImageRef(ref)) return null;
  if (_cache.has(ref)) {
    // Refresh recency so an actively-viewed image is not the next eviction.
    const url = _cache.get(ref);
    _cache.delete(ref);
    _cache.set(ref, url);
    return url;
  }
  if (_permanentFailures.has(ref)) return null;
  if (!_source?.provider) return null;
  if (_inflight.has(ref)) return _inflight.get(ref);

  const task = (async () => {
    try {
      const blobUrl = await _fetchBlob(ref, knownExt);
      _remember(ref, blobUrl);
      return blobUrl;
    } catch (err) {
      // A missing blob is permanent for this source: the file simply is not in
      // the repo, and retrying on every panel open would be pure noise. A
      // network/auth failure is transient and stays retryable.
      if (err?.code === 'BLOB_NOT_FOUND') {
        console.warn(`[ImageBlobStore] ${ref.slice(0, 15)}… not found in repo`);
        _permanentFailures.add(ref);
      } else {
        console.warn(`[ImageBlobStore] Failed to resolve ${ref.slice(0, 15)}…:`, err?.message || err);
      }
      return null;
    } finally {
      _inflight.delete(ref);
    }
  })();

  _inflight.set(ref, task);
  return task;
}

/**
 * Seed the cache with bytes we already hold, so the image the user JUST
 * uploaded resolves instantly instead of round-tripping through the remote
 * they have not pushed to yet.
 */
export function primeImageRef(ref, dataUrl) {
  if (!isImageRef(ref) || typeof dataUrl !== 'string' || _cache.has(ref)) return;
  _remember(ref, dataUrl);
  _permanentFailures.delete(ref);
}

/** Drop everything (universe switch, sign-out). */
export function clearImageBlobCache() {
  for (const url of _cache.values()) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  _cache.clear();
  _permanentFailures.clear();
}
