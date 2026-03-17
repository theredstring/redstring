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

  /** Store a thumbnail for a node prototype */
  setImage: (protoId, data) => set(state => ({
    images: { ...state.images, [protoId]: data }
  })),

  /** Get cached image data for a node prototype */
  getImage: (protoId) => get().images[protoId] || null,

  /** Remove cached image for a node prototype */
  clearImage: (protoId) => set(state => {
    const next = { ...state.images };
    delete next[protoId];
    return { images: next };
  }),

  /** Clear all cached images */
  clearAll: () => set({ images: {} })
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

async function _processSingleImage(protoId, thumbUrl, imageAspectRatio, nodeName) {
  // Skip if already cached
  if (useImageCache.getState().getImage(protoId)) return;

  try {
    const url = resizeWikipediaThumbUrl(thumbUrl, 500);
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[ImageCache] "${nodeName}": HTTP ${resp.status} from ${url}`);
      return;
    }

    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    useImageCache.getState().setImage(protoId, { thumbnailSrc: blobUrl, imageAspectRatio });
    console.log(`[ImageCache] Cached "${nodeName}" (blob ${(blob.size / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.warn(`[ImageCache] Failed "${nodeName}":`, err?.message || err);
  }
}

async function _processQueue() {
  while (_queue.length > 0 && _activeCount < MAX_CONCURRENT) {
    const job = _queue.shift();
    if (!job) break;

    _activeCount++;
    _processSingleImage(job.protoId, job.thumbUrl, job.imageAspectRatio, job.nodeName)
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
  _queue.push({ protoId, thumbUrl, imageAspectRatio, nodeName });
  _processQueue();
}

export default useImageCache;
