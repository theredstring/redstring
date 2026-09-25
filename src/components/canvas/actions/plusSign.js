import { choosePlusSignNode } from './plusSignSelection.js';
import useImageCache from '../../../services/imageCache.js';
import { getNodeDimensions } from '../../../utils.js';
import { useLayoutEffect } from 'react';
import { finishPlusSignMorph, finishVideoAnimation } from './plusSignMorph.js';

// Resolves true once `src` is decoded and ready to paint without a stall, false on
// error or if it takes longer than `timeoutMs` (the caller proceeds either way).
const decodeThumbnail = (src, timeoutMs = 600) => {
  const img = new Image();
  img.src = src;
  const decoded = (img.decode
    ? img.decode()
    : new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; })
  ).then(() => true, () => false);
  return Promise.race([decoded, new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))]);
};

// Resolves with a prototype's imageCache entry once its fetch lands, or null if the
// fetch fails or `timeoutMs` passes first.
const waitForCachedImage = (protoId, timeoutMs) => new Promise((resolve) => {
  const existing = useImageCache.getState().images[protoId];
  if (existing) { resolve(existing); return; }
  let timer = null;
  const unsubscribe = useImageCache.subscribe((state) => {
    const entry = state.images[protoId];
    if (!entry && !state.failed[protoId]) return;
    clearTimeout(timer);
    unsubscribe();
    resolve(entry || null);
  });
  timer = setTimeout(() => { unsubscribe(); resolve(null); }, timeoutMs);
});

/** The plus sign's actions: click, choosing a Thing for it, the morph into a node and its landing, and the Y-key video variant (moved verbatim from NodeCanvas, wave 6). */
export function usePlusSignActions({
  activeGraphId, gridMode, keysPressed, nodePrototypesMap, plusSign,
  setNodeNamePrompt, setPlusSign, setVideoAnimation, snapToGridAnimated, storeActions,
  videoAnimation, visibleNodeIds,
}) {
  const handlePlusSignClick = () => {
    if (!plusSign) return;
    if (plusSign.mode === 'morph' || plusSign.mode === 'preparing' || plusSign.mode === 'landed') return;

    // Special Y-key video animation mode (session-only)
    if (keysPressed.current['y']) {
      // Store position and trigger video animation
      setVideoAnimation({ x: plusSign.x, y: plusSign.y, active: true });
      setPlusSign(null); // Immediately remove plus sign
      return;
    }

    setNodeNamePrompt({ visible: true, name: '' });
  };

  const handleNodeSelection = (nodePrototype) => choosePlusSignNode(nodePrototype, {
    activeGraphId, decodeThumbnail, getPlusSignMorphNode, nodePrototypesMap, plusSign, setNodeNamePrompt,
    setPlusSign, waitForCachedImage,
  });

  // The node the morph is turning into, shaped the way the `nodes` memo will hydrate
  // it — including its image. A name-only stand-in sizes the morph (and the final
  // placement) as a text node, so an image node snaps to its real height on landing.
  const getPlusSignMorphNode = (ps) => {
    const proto = ps.selectedPrototype
      ? (nodePrototypesMap.get(ps.selectedPrototype.id) || ps.selectedPrototype)
      : null;
    if (!proto) return { name: ps.tempName };
    // Mirrors the image resolution in the `nodes` memo. Read live, not from the
    // render-time imageCacheMap: the fetch in handleNodeSelection can land after
    // the render whose closures the morph callbacks captured.
    const cached = useImageCache.getState().images[proto.id];
    const thumbnailSrc = (cached && !proto.thumbnailSrc) ? cached.thumbnailSrc : (proto.thumbnailSrc || null);
    const imageAspectRatio = (cached && !proto.thumbnailSrc)
      ? cached.imageAspectRatio
      : (proto.imageAspectRatio ?? proto.semanticMetadata?.imageAspectRatio);
    return { name: proto.name, thumbnailSrc, imageAspectRatio };
  };

  // Where the morph ends: the node's full dims and the canvas point its center
  // lands on. With the grid on that's the snapped vertex, and the PlusSign glides
  // there DURING the morph — placing the node at the snap afterwards made it
  // teleport from the plus position to the grid on landing.
  const getPlusSignMorphTarget = (ps) => {
    const morphNode = getPlusSignMorphNode(ps);
    const dims = getNodeDimensions(morphNode, false, null);
    let center = { x: ps.x, y: ps.y };
    if (gridMode !== 'off') {
      const snapped = snapToGridAnimated(ps.x, ps.y, dims.currentWidth, dims.currentHeight, null);
      center = { x: snapped.x + dims.currentWidth / 2, y: snapped.y + dims.currentHeight / 2 };
    }
    return { morphNode, dims, center };
  };

  // After the morph, the PlusSign holds its last frame ('landed') until the new
  // instance is actually in the visible set. Culling admits it a frame or two after
  // the store commit (effect → rAF → setVisibleNodeIds), and dropping the PlusSign
  // in the same commit as the add left that gap empty — a one-frame flash.
  // Layout effect so the swap lands in a single paint.
  const landedInstanceId = plusSign?.mode === 'landed' ? plusSign.landedInstanceId : null;
  useLayoutEffect(() => {
    if (!landedInstanceId) return;
    if (visibleNodeIds.has(landedInstanceId)) {
      setPlusSign(null);
      return;
    }
    // Safety net: never leave the placeholder stranded if the node doesn't show up.
    const t = setTimeout(() => setPlusSign(ps => (ps?.landedInstanceId === landedInstanceId ? null : ps)), 500);
    return () => clearTimeout(t);
  }, [landedInstanceId, visibleNodeIds]);

  const handleMorphDone = (...args) => finishPlusSignMorph({
    plusSign, activeGraphId, getPlusSignMorphTarget, storeActions, setPlusSign,
  }, ...args);

  const handleVideoAnimationComplete = (...args) => finishVideoAnimation({
    videoAnimation, activeGraphId, gridMode, snapToGridAnimated, storeActions, setVideoAnimation,
  }, ...args);

  return { handlePlusSignClick, handleNodeSelection, getPlusSignMorphTarget, handleMorphDone, handleVideoAnimationComplete };
}
