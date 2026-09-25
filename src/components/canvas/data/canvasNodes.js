/**
 * The canvas's hydrated node list and base dimensions (moved verbatim from
 * NodeCanvas's `nodes` and `baseDimsById` memos). NodeCanvas memoizes each on
 * the same dependencies; the refs it passes keep P1.08's stable identities.
 */
import { getNodeDimensions } from '../../../utils.js';

export function computeCanvasNodes(ctx) {
  const {
    failedImagesMap, imageCacheMap, instances, loadingImagesMap, nodePrototypesMap, prevNodesListRef,
    prevNodesRef,
  } = ctx;
  if (!instances || !nodePrototypesMap) return [];
  const prevMap = prevNodesRef.current;
  const newMap = new Map();
  const result = [];

  for (const [id, instance] of instances) {
    const prototype = nodePrototypesMap.get(instance.prototypeId);
    if (!prototype) continue;

    const cached = imageCacheMap[instance.prototypeId];
    const effectiveThumb = (cached && !prototype.thumbnailSrc)
      ? cached.thumbnailSrc
      : (prototype.thumbnailSrc || null);
    // Mirrors the imageOverrides rule below, so the reuse check compares the same
    // ratio the node will actually be built with.
    // The semanticMetadata fallback matters when the image is EXPECTED but not
    // in hand: an auto-enriched node keeps its ratio there (it survives save,
    // where the image data does not), so a slot reserved for an unfetchable
    // image is still the right shape rather than defaulting to square.
    const effectiveAspect = (cached && !prototype.thumbnailSrc)
      ? cached.imageAspectRatio
      : (prototype.imageAspectRatio ?? prototype.semanticMetadata?.imageAspectRatio);
    // Show the shimmer only while there's no image to show yet.
    const imageLoading = Boolean(loadingImagesMap[instance.prototypeId]) && !effectiveThumb;
    // The graph says this node HAS an image and every attempt to get it
    // failed. Without this the node renders identically to one that never had
    // an image — the layout collapses and the viewer has no way to tell a
    // missing picture from an absent one. `wikipediaThumbnail` (a URL we
    // could not fetch) and `imageRef` (a blob we could not read) are both
    // statements that an image is expected.
    const expectsImage = Boolean(
      prototype.semanticMetadata?.wikipediaThumbnail || prototype.imageRef
    );
    const imageMissing = expectsImage && !effectiveThumb &&
      Boolean(failedImagesMap[instance.prototypeId]);

    const prev = prevMap.get(id);
    // Reuse old reference if nothing meaningful changed
    if (prev &&
      prev.x === instance.x && prev.y === instance.y &&
      prev.scale === instance.scale &&
      prev.sizeMul === instance.sizeMul &&
      prev.prototypeId === instance.prototypeId &&
      // Anchor flags gate rendering outright (flagged anchors are filtered out of
      // the node pass and drawn as their group's title tab instead), so a stale
      // reuse here makes a node invisible. Combining a zero-member node-group —
      // decompose on an empty definition, then recompose — clears these flags
      // without moving the instance, so every other field below still matches
      // and the old flagged object would be reused: the node then renders only
      // while it happens to be the selected/active node and vanishes on deselect.
      prev.isGroupAnchor === instance.isGroupAnchor &&
      prev.anchorForGroupId === instance.anchorForGroupId &&
      prev.name === prototype.name &&
      prev.color === prototype.color &&
      (prev.thumbnailSrc || null) === effectiveThumb && // a node without an image has it undefined
      // The ratio drives node height and can arrive after the thumbnail does
      // (async imageCache fetch), so reusing the old object here would pin the
      // node at its square placeholder height until something else invalidated it.
      prev.imageAspectRatio === effectiveAspect &&
      prev.imageLoading === imageLoading &&
      prev.imageMissing === imageMissing &&
      prev.description === prototype.description &&
      prev.definitionGraphIds === prototype.definitionGraphIds) {
      result.push(prev);
      newMap.set(id, prev);
    } else {
      const imageOverrides = (cached && !prototype.thumbnailSrc)
        ? { thumbnailSrc: cached.thumbnailSrc, imageAspectRatio: cached.imageAspectRatio }
        : {};
      const node = {
        ...prototype,
        ...imageOverrides,
        ...instance,
        name: prototype.name,
        imageAspectRatio: effectiveAspect,
        imageLoading,
        imageMissing,
      };
      result.push(node);
      newMap.set(id, node);
    }
  }

  prevNodesRef.current = newMap;
  // All reused, same order: keep the previous array too, so a write that changed nothing
  // here (a thumbnail for another graph) doesn't invalidate what's keyed on `nodes` (F-20).
  const prevList = prevNodesListRef.current;
  if (prevList.length === result.length && result.every((n, i) => n === prevList[i])) return prevList;
  prevNodesListRef.current = result;
  return result;
}

export function computeBaseDims(ctx) {
  const {
    dimensionCacheRef, nodes, textSettings,
  } = ctx;
  const map = new Map();
  const cache = dimensionCacheRef.current;
  // Include textSettings in cache key so dimensions recalculate when text size changes
  const tsFontSize = textSettings?.fontSize || 1;
  const tsLineSpacing = textSettings?.lineSpacing || 1;
  const tsNodeScale = textSettings?.nodeScale || 1;

  // A stable key over only the properties that affect dimensions (not position
  // x/y or scale, which change during drag). sizeMul IS included: it's the
  // persistent per-instance size, so different sizes get distinct dims. So is
  // imageAspectRatio, which drives node height and can arrive after the thumbnail.
  // One builder because the eviction sweep below has to produce the identical
  // string — two hand-written copies would silently drift.
  const keyFor = (n) => `${n.prototypeId}-${n.name}-${n.thumbnailSrc || 'noimg'}-${n.imageAspectRatio ?? 'noar'}-${n.imageLoading ? 'loading' : 'idle'}-${n.imageMissing ? 'missing' : 'ok'}-${tsFontSize}-${tsLineSpacing}-${tsNodeScale}-${n.sizeMul || 1}`;

  for (const n of nodes) {
    const cacheKey = keyFor(n);

    // Check if we have cached dimensions for this node's dimensional properties
    let dims = cache.get(cacheKey);

    if (!dims) {
      // Only calculate if not in cache
      dims = getNodeDimensions(n, false, null);
      cache.set(cacheKey, dims);
    }

    map.set(n.id, dims);
  }

  // Clean up cache entries for nodes that no longer exist
  const currentCacheKeys = new Set(nodes.map(keyFor));
  for (const key of cache.keys()) {
    if (!currentCacheKeys.has(key)) {
      cache.delete(key);
    }
  }

  return map;
}
