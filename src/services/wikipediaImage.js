/**
 * Making one of a linked Wikipedia article's pictures the Thing's picture.
 *
 * Shared by the Bio's "Pull from Wikipedia" (which sets the article's main
 * image) and the About section's Wikipedia row (which picks any of them).
 */
import useGraphStore from '../store/graphStore.js';
import useImageCache, { queueThumbnailFetch } from './imageCache.js';
import { safeImageSrc } from '../utils/safeUrl.js';

/**
 * Every picture the linked article offers, the one in use first.
 *
 * @returns {{ url: string, thumbnail?: string, width?: number, height?: number }[]}
 */
export function wikipediaImageChoices(semanticMetadata) {
  const sm = semanticMetadata || {};
  const main = sm.wikipediaOriginalImage || sm.wikipediaThumbnail;
  const rest = Array.isArray(sm.wikipediaAdditionalImages) ? sm.wikipediaAdditionalImages : [];
  const choices = main ? [{ url: main, thumbnail: sm.wikipediaThumbnail || main }] : [];
  for (const image of rest) {
    if (image?.url && image.url !== main) choices.push(image);
  }
  return choices;
}

const measureAspectRatio = async (url, dims) => {
  if (dims?.width > 0 && dims?.height > 0) return dims.height / dims.width;
  // An <img> reads naturalWidth/Height without needing CORS.
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image load failed'));
      i.src = url;
    });
    const ratio = (img.naturalWidth > 0 && img.naturalHeight > 0) ? img.naturalHeight / img.naturalWidth : 1;
    img.src = '';
    return ratio;
  } catch (err) {
    console.warn('[Wikipedia] Could not compute aspect ratio, using 1:1', err);
    return 1;
  }
};

/**
 * Sets `image` as the Thing's picture.
 *
 * The chosen picture becomes `wikipediaOriginalImage`, and the one it replaces
 * joins `wikipediaAdditionalImages`. The image section shows the original ahead
 * of the thumbnail (it wants full resolution), so writing only the thumbnail
 * left the article's own main image on show and the choice looked ignored.
 * Swapping keeps every picture choosable.
 *
 * @param {string} nodeId
 * @param {{ url: string, width?: number, height?: number }} image
 * @param {(updates: object) => any} onUpdateNode
 */
export async function setWikipediaImage(nodeId, image, onUpdateNode) {
  // Only a web or raster-image URL becomes the node's picture.
  const imageUrl = safeImageSrc(image?.url);
  if (!imageUrl || !nodeId || !onUpdateNode) return;
  try {
    const aspectRatio = await measureAspectRatio(imageUrl, image);

    // Read live from the store, not a render's copy: the pull path writes
    // wikipediaUrl/Title/Enriched just ahead of this call.
    const sm = useGraphStore.getState().nodePrototypes.get(nodeId)?.semanticMetadata || {};
    const previousMain = sm.wikipediaOriginalImage;
    const rest = Array.isArray(sm.wikipediaAdditionalImages) ? sm.wikipediaAdditionalImages : [];
    const additional = previousMain && previousMain !== imageUrl
      ? [{ url: previousMain }, ...rest.filter(i => i?.url !== imageUrl && i?.url !== previousMain)]
      : rest.filter(i => i?.url !== imageUrl);

    // Stored as a Wikipedia URL, never a data URL in the main store. The legacy
    // imageSrc/thumbnailSrc and any imageRef are cleared so the image cache's
    // copy is what the canvas draws.
    await onUpdateNode({
      imageSrc: null,
      thumbnailSrc: null,
      imageRef: null,
      imageRefExt: null,
      imageAspectRatio: aspectRatio,
      semanticMetadata: {
        ...sm,
        wikipediaOriginalImage: imageUrl,
        wikipediaAdditionalImages: additional,
        wikipediaThumbnail: imageUrl,
        imageAspectRatio: aspectRatio
      }
    });

    // Drop the stale copy, then fetch the new one for the canvas.
    useImageCache.getState().clearImage(nodeId);
    const name = useGraphStore.getState().nodePrototypes.get(nodeId)?.name || '';
    queueThumbnailFetch(nodeId, imageUrl, aspectRatio, name);
  } catch (error) {
    console.warn('[Wikipedia] Failed to set image from URL:', error);
  }
}
