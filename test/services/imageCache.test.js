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
