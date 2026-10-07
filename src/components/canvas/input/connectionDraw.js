/**
 * Connection drawing (moved verbatim from NodeCanvas): the endpoint writer. The
 * edge-pan loop that scrolls the view while a draw is held near the edge is in
 * edgePan.js, shared with the marquee. P4.03 turns these into the
 * useConnectionDraw controller.
 */
import { getNodeDimensions } from '../../../utils.js';

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
