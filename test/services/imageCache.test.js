import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useImageCache from '../../src/services/imageCache.js';

/**
 * P1.09 — writes that change nothing must not notify subscribers.
 *
 * NodeCanvas subscribes to the whole `images` map, so every fresh `images`
 * object is a full canvas render. These pin down both halves of the contract:
 * a no-op leaves the state object untouched (Zustand then notifies nobody),
 * and a real change still behaves exactly as it did before the guard.
 */

const reset = () => useImageCache.setState({ images: {}, loading: {}, failed: {} });

/** Count store notifications for the duration of a test. */
function watch() {
  const calls = { n: 0 };
  const unsubscribe = useImageCache.subscribe(() => { calls.n++; });
  return { calls, unsubscribe };
}

describe('imageCache no-op guards (P1.09)', () => {
  let watcher;
  let realRevoke;

  beforeEach(() => {
    reset();
    watcher = watch();
    realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    watcher.unsubscribe();
    URL.revokeObjectURL = realRevoke;
    vi.useRealTimers();
  });

  describe('clearImage', () => {
    it('does nothing at all when the key is absent', () => {
      useImageCache.setState({ images: { other: { thumbnailSrc: 'blob:x', imageAspectRatio: 1 } } });
      watcher.calls.n = 0;
      const before = useImageCache.getState();

      useImageCache.getState().clearImage('missing');

      expect(useImageCache.getState()).toBe(before);
      expect(useImageCache.getState().images).toBe(before.images);
      expect(watcher.calls.n).toBe(0);
      vi.runAllTimers();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('removes a present entry and revokes its blob URL a tick later', () => {
      useImageCache.setState({ images: { p1: { thumbnailSrc: 'blob:p1', imageAspectRatio: 1 } } });
      watcher.calls.n = 0;
      const beforeImages = useImageCache.getState().images;

      useImageCache.getState().clearImage('p1');

      const { images } = useImageCache.getState();
      expect(images).not.toBe(beforeImages);
      expect('p1' in images).toBe(false);
      expect(watcher.calls.n).toBe(1);
      // Deferred, not synchronous — subscribers still hold the URL this frame.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1');
    });

    it('removes a present non-blob entry without revoking anything', () => {
      useImageCache.setState({ images: { p1: { thumbnailSrc: 'https://example.org/a.png', imageAspectRatio: 1 } } });
      watcher.calls.n = 0;

      useImageCache.getState().clearImage('p1');

      expect('p1' in useImageCache.getState().images).toBe(false);
      expect(watcher.calls.n).toBe(1);
      vi.runAllTimers();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('treats a key that is present with an undefined value as present', () => {
      useImageCache.setState({ images: { p1: undefined } });
      watcher.calls.n = 0;

      useImageCache.getState().clearImage('p1');

      expect('p1' in useImageCache.getState().images).toBe(false);
      expect(watcher.calls.n).toBe(1);
    });
  });

  describe('setImage', () => {
    const entry = { thumbnailSrc: 'blob:p1', imageAspectRatio: 0.75 };

    it('skips the identical reference', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;
      const before = useImageCache.getState();

      useImageCache.getState().setImage('p1', entry);

      expect(useImageCache.getState()).toBe(before);
      expect(watcher.calls.n).toBe(0);
    });

    it('skips a fresh object with the same thumbnailSrc and the same other fields', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;
      const before = useImageCache.getState();

      useImageCache.getState().setImage('p1', { imageAspectRatio: 0.75, thumbnailSrc: 'blob:p1' });

      expect(useImageCache.getState()).toBe(before);
      expect(useImageCache.getState().images.p1).toBe(entry);
      expect(watcher.calls.n).toBe(0);
    });

    it('writes a different thumbnailSrc', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;
      const next = { thumbnailSrc: 'blob:p1-new', imageAspectRatio: 0.75 };

      useImageCache.getState().setImage('p1', next);

      expect(useImageCache.getState().images.p1).toBe(next);
      expect(watcher.calls.n).toBe(1);
    });

    it('writes the same thumbnailSrc with a different aspect ratio', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;
      const next = { thumbnailSrc: 'blob:p1', imageAspectRatio: 1 };

      useImageCache.getState().setImage('p1', next);

      expect(useImageCache.getState().images.p1).toBe(next);
      expect(watcher.calls.n).toBe(1);
    });

    it('writes when a field is added or missing', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;

      const extra = { ...entry, source: 'upload' };
      useImageCache.getState().setImage('p1', extra);
      expect(useImageCache.getState().images.p1).toBe(extra);

      const fewer = { thumbnailSrc: 'blob:p1' };
      useImageCache.getState().setImage('p1', fewer);
      expect(useImageCache.getState().images.p1).toBe(fewer);

      expect(watcher.calls.n).toBe(2);
    });

    it('writes an equal entry when a failed flag is set, and clears the flag', () => {
      useImageCache.setState({ images: { p1: entry }, failed: { p1: true, p2: true } });
      watcher.calls.n = 0;

      useImageCache.getState().setImage('p1', { ...entry });

      const state = useImageCache.getState();
      expect(state.failed).toEqual({ p2: true });
      expect(state.images.p1).toEqual(entry);
      expect(watcher.calls.n).toBe(1);
    });

    it('writes a new key, including an undefined value for a key that was absent', () => {
      useImageCache.getState().setImage('p1', entry);
      expect(useImageCache.getState().images.p1).toBe(entry);

      useImageCache.getState().setImage('p9', undefined);
      expect('p9' in useImageCache.getState().images).toBe(true);

      expect(watcher.calls.n).toBe(2);
    });

    it('writes a non-object value that differs', () => {
      useImageCache.setState({ images: { p1: entry } });
      watcher.calls.n = 0;

      useImageCache.getState().setImage('p1', null);

      expect(useImageCache.getState().images.p1).toBeNull();
      expect(watcher.calls.n).toBe(1);
    });
  });
});

// Enrichment queues a thumbnail as it writes the metadata, and that write wakes
// the canvas effect that queues it again. The second request used to supersede
// the first, whose image was then discarded — so enrichment, waiting on the
// first, was told nothing landed and never re-laid the graph out.
describe('queueThumbnailFetch — a repeat request joins the fetch in flight', () => {
  let realFetch, realImage, realCreate;

  beforeEach(() => {
    reset();
    realFetch = globalThis.fetch;
    realImage = globalThis.Image;
    realCreate = URL.createObjectURL;
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) }));
    globalThis.Image = class { decode() { return Promise.resolve(); } };
    URL.createObjectURL = vi.fn(() => 'blob:joined');
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.Image = realImage;
    URL.createObjectURL = realCreate;
  });

  it('fetches once and tells both callers the image landed', async () => {
    const { queueThumbnailFetch } = await import('../../src/services/imageCache.js');
    const url = 'https://upload.wikimedia.org/thumb/a/ab/X.jpg/320px-X.jpg';
    const first = queueThumbnailFetch('p-join', url, 0.5, 'X');
    const second = queueThumbnailFetch('p-join', url, 0.5, 'X');

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(useImageCache.getState().getImage('p-join')).toEqual({ thumbnailSrc: 'blob:joined', imageAspectRatio: 0.5 });
  });

  it('resolves false once the image is already cached', async () => {
    const { queueThumbnailFetch } = await import('../../src/services/imageCache.js');
    useImageCache.setState({ images: { 'p-have': { thumbnailSrc: 'blob:have', imageAspectRatio: 1 } } });
    await expect(queueThumbnailFetch('p-have', 'https://x/1px-a.jpg')).resolves.toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// The canvas re-checks images whenever the active web's instances change, and
// dropping a node is such a change. For a Thing whose image had already failed,
// that re-check queued the same URL again, which cleared the failed flag: the
// node lost its image slot (shrank and shifted) until the fetch failed again a
// frame or two later and it snapped back. A verdict on a URL stands until the
// URL changes or someone asks for a retry.
describe('queueThumbnailFetch — a failed image stays failed', () => {
  let realFetch;
  const url = 'https://upload.wikimedia.org/thumb/a/ab/Gone.jpg/320px-Gone.jpg';

  beforeEach(() => {
    reset();
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('does not clear the flag or fetch again for the same URL', async () => {
    const { queueThumbnailFetch } = await import('../../src/services/imageCache.js');
    await queueThumbnailFetch('p-gone', url, 1, 'Gone');
    expect(useImageCache.getState().failed['p-gone']).toBe(true);
    const calls = globalThis.fetch.mock.calls.length;

    const seen = [];
    const unsubscribe = useImageCache.subscribe((s) => seen.push(Boolean(s.failed['p-gone'])));
    await expect(queueThumbnailFetch('p-gone', url, 1, 'Gone')).resolves.toBe(false);
    unsubscribe();

    expect(seen).not.toContain(false);
    expect(useImageCache.getState().failed['p-gone']).toBe(true);
    expect(globalThis.fetch.mock.calls.length).toBe(calls);
  });

  it('tries again when the URL changes', async () => {
    const { queueThumbnailFetch } = await import('../../src/services/imageCache.js');
    await queueThumbnailFetch('p-swap', url, 1, 'Swap');
    const calls = globalThis.fetch.mock.calls.length;
    await queueThumbnailFetch('p-swap', url.replace('Gone', 'Other'), 1, 'Swap');
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(calls);
  });

  it('tries again on an explicit retry', async () => {
    const { queueThumbnailFetch, retryThumbnailFetch } = await import('../../src/services/imageCache.js');
    await queueThumbnailFetch('p-retry', url, 1, 'Retry');
    const calls = globalThis.fetch.mock.calls.length;
    retryThumbnailFetch('p-retry', url, 1, 'Retry');
    await vi.waitFor(() => expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(calls));
  });
});
