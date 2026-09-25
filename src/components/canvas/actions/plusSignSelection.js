/**
 * Choosing an existing Thing for the plus sign (moved verbatim from
 * NodeCanvas's handleNodeSelection).
 */
import { queueThumbnailFetch } from '../../../services/imageCache.js';

export function choosePlusSignNode(nodePrototype, ctx) {
  const {
    activeGraphId, decodeThumbnail, getPlusSignMorphNode, nodePrototypesMap, plusSign, setNodeNamePrompt,
    setPlusSign, waitForCachedImage,
  } = ctx;
  if (!plusSign || !activeGraphId) return;

  const proto = nodePrototypesMap.get(nodePrototype.id) || nodePrototype;
  const { thumbnailSrc } = getPlusSignMorphNode({ selectedPrototype: nodePrototype });
  // A Wikipedia image lives in imageCache, which is only filled for prototypes
  // already placed in the active web. Picked from anywhere else, the cache is
  // empty here — so the morph sized itself as a text node and the image arrived
  // as a second stage after the add. Start that fetch now instead.
  const wikiThumb = !thumbnailSrc && !proto.thumbnailSrc
    ? proto.semanticMetadata?.wikipediaThumbnail
    : null;
  // Only 'appear' / 'preparing' may morph — a plus sign dismissed while its image
  // decoded must stay dismissed.
  const startMorph = (imageReady) => setPlusSign(ps => (ps && (ps.mode === 'appear' || ps.mode === 'preparing')) ? {
    ...ps,
    mode: 'morph',
    tempName: nodePrototype.name,
    selectedPrototype: nodePrototype, // Store the selected prototype for morphDone
    selectedColor: nodePrototype.color, // Use the prototype's color for the animation
    imageReady,
  } : ps);

  if (thumbnailSrc || wikiThumb) {
    // Fetch (if needed) and decode the image BEFORE the morph starts, so the
    // morph targets the node's real image size and carries the image from its
    // first frame. Mounting an undecoded <image> mid-animation stalls the frames
    // it decodes on. One budget covers both steps; past it the morph goes ahead
    // and targets whatever the real node will render at that moment.
    setPlusSign(ps => ps && { ...ps, mode: 'preparing' });
    const PREPARE_BUDGET_MS = 1200;
    const deadline = performance.now() + PREPARE_BUDGET_MS;
    (async () => {
      let src = thumbnailSrc;
      if (!src) {
        queueThumbnailFetch(proto.id, wikiThumb, proto.semanticMetadata?.imageAspectRatio || 1, proto.name || '');
        src = (await waitForCachedImage(proto.id, PREPARE_BUDGET_MS))?.thumbnailSrc ?? null;
      }
      const remaining = deadline - performance.now();
      const ok = src && remaining > 0 ? await decodeThumbnail(src, remaining) : false;
      startMorph(ok);
    })();
  } else {
    startMorph(false);
  }

  // Clean up UI state
  setNodeNamePrompt({ visible: false, name: '' });
}
