/**
 * Connection drawing (moved verbatim from NodeCanvas): the endpoint writer and
 * the edge-pan loop that scrolls the view while a draw is held near the edge.
 * P4.03 turns these into the useConnectionDraw controller.
 */
import useGraphStore from '../../../store/graphStore.js';
import { getNodeDimensions } from '../../../utils.js';

/** While a draw is held near the viewport edge, pan the view and keep the endpoint under the pointer. */
export function runConnectionEdgePan(ctx) {
  const {
    drawingConnectionFrom, isAnimatingZoomRef, drawingConnectionFromRef, mousePositionRef, viewportBoundsRef,
    panOffsetRef, zoomLevelRef, canvasSizeRef, viewportSizeRef, setPanOffset, reprojectDrawingConnectionEnd,
  } = ctx;
  if (!drawingConnectionFrom) return;
  let animationFrameId;
  const panLoop = () => {
    if (isAnimatingZoomRef.current || !drawingConnectionFromRef.current) {
      animationFrameId = requestAnimationFrame(panLoop);
      return;
    }
    if (useGraphStore.getState().mouseSettings?.connectionDrawEdgePanEnabled === false) {
      animationFrameId = requestAnimationFrame(panLoop);
      return;
    }

    const { x: mouseX, y: mouseY } = mousePositionRef.current;
    const bounds = viewportBoundsRef.current;
    const margin = 75;
    const maxSpeed = 15;

    let dx = 0;
    let dy = 0;

    if (mouseX < bounds.x + margin) {
      const dist = (bounds.x + margin) - mouseX;
      const ratio = Math.min(1, dist / margin);
      dx = -maxSpeed * Math.pow(ratio, 1.5);
    } else if (mouseX > bounds.x + bounds.width - margin) {
      const dist = mouseX - (bounds.x + bounds.width - margin);
      const ratio = Math.min(1, dist / margin);
      dx = maxSpeed * Math.pow(ratio, 1.5);
    }

    if (mouseY < bounds.y + margin) {
      const dist = (bounds.y + margin) - mouseY;
      const ratio = Math.min(1, dist / margin);
      dy = -maxSpeed * Math.pow(ratio, 1.5);
    } else if (mouseY > bounds.y + bounds.height - margin) {
      const dist = mouseY - (bounds.y + bounds.height - margin);
      const ratio = Math.min(1, dist / margin);
      dy = maxSpeed * Math.pow(ratio, 1.5);
    }

    if (dx !== 0 || dy !== 0) {
      const currentPan = panOffsetRef.current;
      const currentZoom = zoomLevelRef.current;
      const currentCanvasWidth = canvasSizeRef.current.width * currentZoom;
      const currentCanvasHeight = canvasSizeRef.current.height * currentZoom;
      const minX = viewportSizeRef.current.width - currentCanvasWidth;
      const minY = viewportSizeRef.current.height - currentCanvasHeight;
      const newX = Math.min(Math.max(currentPan.x - dx, minX), 0);
      const newY = Math.min(Math.max(currentPan.y - dy, minY), 0);

      if (newX !== currentPan.x || newY !== currentPan.y) {
        const newPan = { x: newX, y: newY };
        panOffsetRef.current = newPan;
        setPanOffset(newPan);

        // Keep the line endpoint anchored to the pointer on screen by
        // recomputing canvas-space coords against the new pan. Without
        // this, the endpoint visibly drifts while the pointer is held
        // still at the edge.
        reprojectDrawingConnectionEnd(mouseX, mouseY, newPan, currentZoom);
      }
    }

    animationFrameId = requestAnimationFrame(panLoop);
  };

  animationFrameId = requestAnimationFrame(panLoop);
  return () => cancelAnimationFrame(animationFrameId);
  // Boolean dep keeps the loop stable across per-move setDrawingConnectionFrom
  // updates (which create a new object each tick); we only want to mount/unmount
  // the RAF when a draw starts/ends.
}

/** Move the in-progress connection's endpoint (a DOM write, not React state). */
export function writeDrawingConnectionEnd(ctx, canvasX, canvasY) {
  const {
    drawingConnectionEndRef, applyDrawingConnection, drawingConnectionFromRef, nodesRef,
    anchorPositionUpdatesRef, connectionExitedSourceRef, zoomLevelRef, setSelfLoopPreviewActive,
  } = ctx;
  drawingConnectionEndRef.current = { x: canvasX, y: canvasY };
  applyDrawingConnection();

  const draw = drawingConnectionFromRef.current;
  const srcNode = draw ? nodesRef.current?.find(n => n.id === draw.sourceInstanceId) : null;
  if (!srcNode) return;

  const anchorInfo = srcNode.isGroupAnchor ? anchorPositionUpdatesRef.current.get(srcNode.id) : null;
  const dims = anchorInfo
    ? { currentWidth: anchorInfo.width, currentHeight: anchorInfo.height }
    : getNodeDimensions(srcNode, false, null);
  const sx = anchorInfo ? anchorInfo.x : srcNode.x;
  const sy = anchorInfo ? anchorInfo.y : srcNode.y;

  if (!connectionExitedSourceRef.current) {
    // Self-loop gesture: flip once the endpoint has traveled >=10px (screen
    // space) outside the source's bounds. Threshold scaled to canvas units.
    const closestX = Math.max(sx, Math.min(canvasX, sx + dims.currentWidth));
    const closestY = Math.max(sy, Math.min(canvasY, sy + dims.currentHeight));
    const distSq = (canvasX - closestX) ** 2 + (canvasY - closestY) ** 2;
    const threshold = 10 / Math.max(zoomLevelRef.current, 0.0001);
    if (distSq >= threshold * threshold) connectionExitedSourceRef.current = true;
    return; // can't be back inside on the same frame it first left
  }

  const overSource = canvasX >= sx && canvasX <= sx + dims.currentWidth
    && canvasY >= sy && canvasY <= sy + dims.currentHeight;
  setSelfLoopPreviewActive(prev => (prev === overSource ? prev : overSource));
}
