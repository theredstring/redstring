import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useImageCache, { resizeWikipediaThumbUrl, evictImages, touchImages } from '../../src/services/imageCache.js';

describe('resizeWikipediaThumbUrl', () => {
  it('resizes an existing thumbnail link', () => {
    expect(resizeWikipediaThumbUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sun.jpg/800px-Sun.jpg', 500))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sun.jpg/500px-Sun.jpg');
  });

  it('turns a link to the original file into a thumbnail link', () => {
    expect(resizeWikipediaThumbUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Codex_Borgia.jpg', 500))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Codex_Borgia.jpg/500px-Codex_Borgia.jpg');
    expect(resizeWikipediaThumbUrl('https://upload.wikimedia.org/wikipedia/en/3/3f/Poster.png', 500))
      .toBe('https://upload.wikimedia.org/wikipedia/en/thumb/3/3f/Poster.png/500px-Poster.png');
  });

  it('rasterises SVG originals to PNG and leaves documents and video alone', () => {
    expect(resizeWikipediaThumbUrl('https://upload.wikimedia.org/wikipedia/commons/1/1a/Logo.svg', 500))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Logo.svg/500px-Logo.svg.png');
    const pdf = 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Paper.pdf';
    expect(resizeWikipediaThumbUrl(pdf, 500)).toBe(pdf);
  });

  it('leaves other hosts alone', () => {
    const url = 'https://example.com/a/ab/photo.jpg';
    expect(resizeWikipediaThumbUrl(url, 500)).toBe(url);
  });
});

describe('evictImages', () => {
  let realRevoke;
  beforeEach(() => {
    useImageCache.setState({ images: {}, loading: {}, failed: {} });
    realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    URL.revokeObjectURL = realRevoke;
    vi.useRealTimers();
  });

  const put = (ids) => {
    const images = {};
    for (const id of ids) images[id] = { thumbnailSrc: `blob:${id}`, imageAspectRatio: 1 };
    useImageCache.setState({ images });
  };

  it('frees images of Things that no longer exist and revokes their blobs', () => {
    put(['a', 'b', 'gone']);
    evictImages(new Set(['a']), (id) => id !== 'gone');
    vi.runAllTimers();
    expect(Object.keys(useImageCache.getState().images).sort()).toEqual(['a', 'b']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gone');
  });

  it('caps idle images, keeping the active web and the most recently used', () => {
    const ids = Array.from({ length: 130 }, (_, i) => `p${i}`);
    put(ids);
    touchImages(ids.slice(10)); // p0..p9 are the least recently used
    evictImages(new Set(['p0']), () => true);
    const left = useImageCache.getState().images;
    expect(left.p0).toBeTruthy(); // in the active web: kept however old
    for (let i = 1; i < 10; i++) expect(left[`p${i}`]).toBeUndefined();
    expect(Object.keys(left).length).toBe(121);
  });

  it('clearAll revokes every blob', () => {
    put(['a', 'b']);
    useImageCache.getState().clearAll();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(useImageCache.getState().images).toEqual({});
  });
});
