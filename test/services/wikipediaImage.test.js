import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/imageCache.js', () => {
  const clearImage = vi.fn();
  const store = Object.assign(() => null, { getState: () => ({ clearImage }) });
  return { default: store, queueThumbnailFetch: vi.fn() };
});

import useGraphStore from '../../src/store/graphStore.js';
import { setWikipediaImage, wikipediaImageChoices } from '../../src/services/wikipediaImage.js';

const MAIN = 'https://upload.wikimedia.org/main.jpg';
const OTHER = 'https://upload.wikimedia.org/other.jpg';
const THIRD = 'https://upload.wikimedia.org/third.jpg';

describe('choosing a Wikipedia picture', () => {
  let sm;
  const update = vi.fn(async (updates) => {
    useGraphStore.getState().updateNodePrototype('p', (draft) => { Object.assign(draft, updates); });
  });

  beforeEach(() => {
    sm = {
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Dog',
      wikipediaOriginalImage: MAIN,
      wikipediaThumbnail: MAIN,
      wikipediaAdditionalImages: [{ url: OTHER, thumbnail: OTHER, width: 200, height: 100 }, { url: THIRD }]
    };
    useGraphStore.setState({
      nodePrototypes: new Map([['p', { id: 'p', name: 'Dog', semanticMetadata: sm }]])
    }, false, 'test_reset');
    update.mockClear();
  });

  const live = () => useGraphStore.getState().nodePrototypes.get('p').semanticMetadata;

  it('lists the picture in use first', () => {
    expect(wikipediaImageChoices(sm).map(i => i.url)).toEqual([MAIN, OTHER, THIRD]);
  });

  // The image section shows the original ahead of the thumbnail, so a choice
  // that only wrote the thumbnail stayed hidden behind the article's main image.
  it('makes the chosen picture the original and keeps the old one choosable', async () => {
    await setWikipediaImage('p', { url: OTHER, width: 200, height: 100 }, update);
    expect(live().wikipediaOriginalImage).toBe(OTHER);
    expect(live().wikipediaThumbnail).toBe(OTHER);
    expect(live().imageAspectRatio).toBe(0.5);
    expect(wikipediaImageChoices(live()).map(i => i.url)).toEqual([OTHER, MAIN, THIRD]);
  });

  it('choosing the picture in use changes nothing about the list', async () => {
    await setWikipediaImage('p', { url: MAIN, width: 100, height: 100 }, update);
    expect(wikipediaImageChoices(live()).map(i => i.url)).toEqual([MAIN, OTHER, THIRD]);
  });
});
