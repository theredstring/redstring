/**
 * Separate Zustand store for auto-enrichment image data (thumbnails).
 *
 * WHY THIS EXISTS:
 * The main graphStore gets JSON.stringify'd for save hashing + file writes.
 * Storing image data in nodePrototypes means every save cycle copies/hashes/writes
 * megabytes of strings, causing V8 OOM crashes in Electron when 10+ nodes are enriched.
 *
 * This store:
 * - Holds { protoId → { thumbnailSrc: blob URL, imageAspectRatio } } for auto-enriched nodes
 * - Is NEVER serialized, hashed, or saved to disk
 * - Components subscribe to it per-node, so only the affected node re-renders when an image loads
 * - On reload, images re-fetch from Wikipedia URLs stored in semanticMetadata
 *
 * thumbnailSrc is a blob: URL (not a data URL or remote URL) because:
 * - Blob URLs are same-origin, so SVG <image> elements render them without CORS issues
 * - Blob data lives in the browser's native cache, NOT in the JS heap (no OOM)
 * - They're never serialized (blob URLs are opaque strings, ~40 chars)
 *
 * User-uploaded images (via drag-drop or file picker) still go in the main store
 * since those are intentional single-node operations that don't cause batch OOM.
 */
import { create } from 'zustand';

const useImageCache = create((set, get) => ({
  images: {}, // { [protoId]: { thumbnailSrc: string, imageAspectRatio: number } }
  loading: {}, // { [protoId]: true } — a user upload is being read/decoded (drives the shimmer placeholder)
  // { [protoId]: true } — every fetch attempt for an EXPECTED image failed.
  // Distinct from "no image": the graph says this node has one and we could not
  // get it, which the canvas must render differently from a node that never had
  // an image at all. Without this the two are indistinguishable and a failed
  // fetch silently looks like an imageless node.
  failed: {},

  /** Store a thumbnail for a node prototype */
  setImage: (protoId, data) => set(state => {
    // Success clears any prior failure so the node stops rendering its
    // missing-image state.
    if (!state.failed[protoId]) {
      return { images: { ...state.images, [protoId]: data } };
    }
    const failed = { ...state.failed };
    delete failed[protoId];
    return { images: { ...state.images, [protoId]: data }, failed };
  }),

  /** Get cached image data for a node prototype */
  getImage: (protoId) => get().images[protoId] || null,

  /** Mark an expected image as unobtainable (drives the missing-image state) */
  setFailed: (protoId) => set(state => (
    state.failed[protoId] ? state : { failed: { ...state.failed, [protoId]: true } }
  )),

  /** Clear the failed flag (a retry is starting, or the image was removed) */
  clearFailed: (protoId) => set(state => {
    if (!state.failed[protoId]) return state;
    const failed = { ...state.failed };
    delete failed[protoId];
    return { failed };
  }),

  /** Remove cached image for a node prototype */
  clearImage: (protoId) => set(state => {
    const next = { ...state.images };
    const dropped = next[protoId];
    delete next[protoId];
    // Release the blob so repeated delete/undo cycles don't accumulate one
    // detached blob per cycle — the whole point of this store is to keep image
    // bytes out of the heap. Deferred a tick because subscribers still hold the
    // URL in the frame being torn down; revoking synchronously renders a broken
    // <image> for that frame.
    if (dropped?.thumbnailSrc?.startsWith('blob:')) {
      setTimeout(() => URL.revokeObjectURL(dropped.thumbnailSrc), 0);
    }
    return { images: next };
  }),

  /** Mark a prototype's image as loading (upload in progress) — shows a shimmer placeholder */
  startImageLoading: (protoId) => set(state => (
    state.loading[protoId] ? state : { loading: { ...state.loading, [protoId]: true } }
  )),

  /** Clear the loading flag for a prototype */
  stopImageLoading: (protoId) => set(state => {
    if (!state.loading[protoId]) return state;
    const next = { ...state.loading };
    delete next[protoId];
    return { loading: next };
  }),

  /** Clear all cached images */
  clearAll: () => set({ images: {}, loading: {}, failed: {} })
}));

/**
 * Resize a Wikipedia thumbnail URL to a specific width.
 * Wikipedia thumb URLs follow: .../thumb/.../Filename.ext/NNNpx-Filename.ext
 */
function resizeWikipediaThumbUrl(thumbUrl, targetWidth) {
  if (!thumbUrl) return thumbUrl;
  return thumbUrl.replace(/\/(\d+)px-/, `/${targetWidth}px-`);
}

// ── Background fetch queue ──────────────────────────────────────────────
// Fetches Wikipedia thumbnail images and creates blob URLs for SVG rendering.
// Processes one at a time with a brief yield between images.

let _queue = [];
let _activeCount = 0;
const MAX_CONCURRENT = 6; // Parallel fetches

/**
 * Per-prototype generation counter, bumped on every queue and every cancel.
 *
 * A fetch takes long enough that the store can move underneath it. Undo an
 * image deletion and redo it quickly and the sequence is: undo restores the
 * Wikipedia URL → a fetch is queued → redo removes the URL and cancels → the
 * in-flight fetch resolves and writes the image back. The node then shows an
 * image the graph no longer references, and nothing clears it until reload.
 * Comparing the epoch captured at queue time against the current one lets a
 * superseded fetch drop its result instead of publishing it.
 */
const _epochs = new Map();

function _bumpEpoch(protoId) {
  const next = (_epochs.get(protoId) || 0) + 1;
  _epochs.set(protoId, next);
  return next;
}

// A single fetch used to be the whole story: one failure and the node showed no
// image until a full reload. On mobile — the primary git surface — a transient
// failure is the common case, not the edge case, so a bounded retry is what
// makes the difference between "the image loads a second late" and "this node
// has no picture any more".
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 800; // 800ms, 1.6s

/**
 * Is this failure worth retrying?
 *
 * 4xx means the URL is wrong or the file is gone — retrying re-asks a question
 * already answered, forever. Network errors and 5xx are the transient ones.
 */
const _isRetryable = (status) => status == null || status >= 500 || status === 429;

async function _processSingleImage(protoId, thumbUrl, imageAspectRatio, nodeName, epoch) {
  // Skip if already cached
  if (useImageCache.getState().getImage(protoId)) return;

  const url = resizeWikipediaThumbUrl(thumbUrl, 500);
  let lastStatus = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Superseded between attempts — the node no longer wants this image.
    if (_epochs.get(protoId) !== epoch) return;

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        lastStatus = resp.status;
        if (!_isRetryable(resp.status)) {
          console.warn(`[ImageCache] "${nodeName}": HTTP ${resp.status} from ${url} (permanent)`);
          break;
        }
        throw new Error(`HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      if (_epochs.get(protoId) !== epoch) return;

      const blobUrl = URL.createObjectURL(blob);
      useImageCache.getState().setImage(protoId, { thumbnailSrc: blobUrl, imageAspectRatio });
      console.log(`[ImageCache] Cached "${nodeName}" (blob ${(blob.size / 1024).toFixed(0)}KB)`);
      return;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.warn(`[ImageCache] Failed "${nodeName}" after ${attempt} attempts:`, err?.message || err);
        break;
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[ImageCache] "${nodeName}" attempt ${attempt} failed (${err?.message || err}), retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Out of attempts. Record it so the node can render a missing-image state
  // instead of silently pretending it never had one.
  if (_epochs.get(protoId) === epoch) {
    useImageCache.getState().setFailed(protoId);
  }
}

async function _processQueue() {
  while (_queue.length > 0 && _activeCount < MAX_CONCURRENT) {
    const job = _queue.shift();
    if (!job) break;

    _activeCount++;
    _processSingleImage(job.protoId, job.thumbUrl, job.imageAspectRatio, job.nodeName, job.epoch)
      .finally(() => {
        _activeCount--;
        _processQueue(); // Process next job when one completes
      });
  }
}

/**
 * Queue a Wikipedia thumbnail for background fetch + blob URL caching.
 * Called from both enrichment (LeftAIView) and file-load (NodeCanvas useEffect).
 *
 * @param {string} protoId - Node prototype ID
 * @param {string} thumbUrl - Wikipedia thumbnail URL (any size — will be resized to 500px)
 * @param {number} imageAspectRatio - height/width ratio (default 1)
 * @param {string} nodeName - For logging
 */
export function queueThumbnailFetch(protoId, thumbUrl, imageAspectRatio = 1, nodeName = '') {
  if (!thumbUrl) return;
  if (useImageCache.getState().getImage(protoId)) return;
  // A queued fetch supersedes a previous verdict — otherwise a node that failed
  // once keeps rendering its missing-image state through an explicit retry.
  useImageCache.getState().clearFailed(protoId);
  _queue.push({ protoId, thumbUrl, imageAspectRatio, nodeName, epoch: _bumpEpoch(protoId) });
  _processQueue();
}

/**
 * Re-attempt a previously failed image, discarding the failed verdict.
 *
 * The automatic bounded retry above handles a flaky moment; this is the manual
 * escape hatch for "my connection came back an hour later", which currently
 * needs a reload. No UI calls it yet — placing that affordance on a node means
 * putting a click target inside a shape that already handles select and drag,
 * which is a design call, not a plumbing one.
 */
export function retryThumbnailFetch(protoId, thumbUrl, imageAspectRatio = 1, nodeName = '') {
  if (!thumbUrl) return;
  useImageCache.getState().clearFailed(protoId);
  useImageCache.getState().clearImage(protoId);
  _queue = _queue.filter((job) => job.protoId !== protoId);
  _queue.push({ protoId, thumbUrl, imageAspectRatio, nodeName, epoch: _bumpEpoch(protoId) });
  _processQueue();
}

/**
 * Drop a prototype's cached image and abandon any fetch still in flight for it.
 *
 * Used when the graph stops referencing an image — the user deletes it, or a
 * redo removes it again. Plain `clearImage` is not enough on its own: a queued
 * or in-flight fetch would repopulate the cache moments later.
 *
 * @param {string} protoId - Node prototype ID
 */
export function cancelThumbnailFetch(protoId) {
  _bumpEpoch(protoId);
  _queue = _queue.filter(job => job.protoId !== protoId);
  useImageCache.getState().clearImage(protoId);
  // The graph no longer expects an image here, so there is nothing left to
  // report as missing.
  useImageCache.getState().clearFailed(protoId);
}

export default useImageCache;
