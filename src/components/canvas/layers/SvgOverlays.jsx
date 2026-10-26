/**
 * The overlays at the top of the canvas content group (moved verbatim from
 * NodeCanvas): the marquee rect, the plus sign and the video effect.
 */
import { Profiler, useEffect } from 'react';
import useCanvasUIStore from '../../../store/canvasUIStore.js';
import { useGroupPieStore } from '../pie/groupPieButtons.js';
import { useThingGroupPromptStore } from '../thingGroupPrompt/thingGroupPrompt.js';
import { onRenderProbe } from '../../../utils/perf/renderProbe.js';
import PlusSign from '../../../PlusSign.jsx';
import PlusSignBubbles from './PlusSignBubbles.jsx';
import { NODE_WIDTH, NODE_HEIGHT, NODE_CORNER_RADIUS } from '../../../constants';
import VideoNodeAnimation from '../../../VideoNodeAnimation.jsx';

export default function SvgOverlays({ ctx }) {
  const {
    selectionStart, setMarqueeRectEl, plusSign, handlePlusSignClick, handleMorphDone, setPlusSign,
    gestureBlockRef, isPanningOrZooming, getPlusSignMorphTarget, textSettings, videoAnimation,
    handleVideoAnimationComplete, clipboardRef, handleNodeSelection, edgePieMenuVisible,
  } = ctx;

  // Any pie (node, carousel, connection, group) opening sends the plus sign
  // back in. Its own bubbles aren't a pie; a plus that is being named, waiting
  // on its Add Web selector, or already becoming a Thing is committed and stays.
  const nodePieTarget = useCanvasUIStore(s => s.selectedNodeIdForPieMenu);
  const groupPieShown = useGroupPieStore(s => Boolean(s.groupId && s.buttons.length));
  const pieShown = Boolean(nodePieTarget || edgePieMenuVisible || groupPieShown);
  useEffect(() => {
    if (!pieShown || plusSign?.mode !== 'appear' || plusSign.prompting) return;
    if (useThingGroupPromptStore.getState().prompt) return;
    setPlusSign(ps => ps && { ...ps, mode: 'disappear' });
  }, [pieShown, nodePieTarget]);

  return (
    <Profiler id="SvgOverlays" onRender={onRenderProbe}>
      {/* Marquee: geometry is written by setMarqueeRectEl, never by React. */}
      {selectionStart && (
        <rect
          ref={setMarqueeRectEl}
          fill="rgba(255, 0, 0, 0.1)"
          stroke="red"
          strokeWidth={1}
        />
      )}

      {/* Under the plus sign, so the bubbles come out from beneath it. */}
      {plusSign && (
        <PlusSignBubbles
          plusSign={plusSign}
          setPlusSign={setPlusSign}
          clipboardRef={clipboardRef}
          handleNodeSelection={handleNodeSelection}
          gestureBlockRef={gestureBlockRef}
          isPanningOrZoomingRef={isPanningOrZooming}
        />
      )}

      {plusSign && (
        <PlusSign
          plusSign={plusSign}
          onClick={handlePlusSignClick}
          onMorphDone={handleMorphDone}
          onDisappearDone={() => setPlusSign(null)}
          gestureBlockRef={gestureBlockRef}
          isPanningOrZoomingRef={isPanningOrZooming}
          {...(plusSign.tempName ? (() => {
            const { morphNode, dims, center } = getPlusSignMorphTarget(plusSign);
            const W = dims.currentWidth;
            const H = dims.currentHeight;
            // Only draw the image once it's decoded (see handleNodeSelection);
            // otherwise the slot is still reserved and the node fills it in.
            const hasImage = plusSign.imageReady && Boolean(morphNode.thumbnailSrc) && dims.calculatedImageHeight > 0;
            return {
              targetCenter: center,
              // Make the PlusSign slightly smaller so the final node feels like an expansion
              targetWidth: W * 0.9,
              targetHeight: H * 0.9,
              targetCornerRadius: dims.scaledCornerRadius,
              // Image slot as fractions of the node box, so it tracks the morphing rect.
              targetImage: hasImage ? {
                src: morphNode.thumbnailSrc,
                fx: (W - dims.imageWidth) / 2 / W,
                fy: dims.textAreaHeight / H,
                fw: dims.imageWidth / W,
                fh: dims.calculatedImageHeight / H,
              } : null,
            };
          })() : {
            targetWidth: NODE_WIDTH,
            targetHeight: NODE_HEIGHT,
            targetCornerRadius: NODE_CORNER_RADIUS * 1.4 * (textSettings?.nodeScale ?? 1.0),
          })}
        />
      )}

      {/* Y-key video animation (session-only special effect) */}
      {videoAnimation && videoAnimation.active && (
        <VideoNodeAnimation
          x={videoAnimation.x}
          y={videoAnimation.y}
          onComplete={handleVideoAnimationComplete}
        />
      )}
    </Profiler>
  );
}
