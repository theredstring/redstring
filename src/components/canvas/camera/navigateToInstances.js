/**
 * Framing every instance of a prototype (moved verbatim from NodeCanvas's
 * navigateToPrototypeInstances, the command the component search runs).
 */
import { MAX_ZOOM } from '../../../constants';
import { getNodeDimensions } from '../../../utils.js';

export function frameInstancesOfPrototype(prototypeId, ctx) {
  const {
    activeGraphId, baseDimsById, canvasSize, containerRef, getFramingRegion, nodes,
    transform, viewportSize,
  } = ctx;
  try {
    if (!activeGraphId || !nodes || nodes.length === 0 || !containerRef.current) return;
    const matching = nodes.filter(n => n.prototypeId === prototypeId);
    if (matching.length === 0) return;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    matching.forEach(node => {
      const dims = baseDimsById.get(node.id) || getNodeDimensions(node, false, null);
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + dims.currentWidth);
      maxY = Math.max(maxY, node.y + dims.currentHeight);
    });

    const nodesCenterX = (minX + maxX) / 2;
    const nodesCenterY = (minY + maxY) / 2;
    const nodesWidth = Math.max(1, maxX - minX);
    const nodesHeight = Math.max(1, maxY - minY);

    // Fit and centre against the usable region rather than the raw window, so
    // open panels don't park the instances behind themselves.
    const vb = getFramingRegion();
    const padding = 180; // slightly more padding for less aggressive zoom
    const targetZoomX = vb.width / (nodesWidth + padding * 2);
    const targetZoomY = vb.height / (nodesHeight + padding * 2);
    const rawZoom = Math.min(targetZoomX, targetZoomY);
    const maxSearchZoom = 0.6; // cap zoom-in for search navigation
    const targetZoom = Math.min(MAX_ZOOM, Math.max(0.05, Math.min(rawZoom, maxSearchZoom)));

    const targetPanX = (vb.x + vb.width / 2) - nodesCenterX * targetZoom + canvasSize.offsetX * targetZoom;
    const targetPanY = (vb.y + vb.height / 2) - nodesCenterY * targetZoom + canvasSize.offsetY * targetZoom;

    const maxPanX = 0;
    const maxPanY = 0;
    const minPanX = viewportSize.width - canvasSize.width * targetZoom;
    const minPanY = viewportSize.height - canvasSize.height * targetZoom;
    const finalPanX = Math.min(Math.max(targetPanX, minPanX), maxPanX);
    const finalPanY = Math.min(Math.max(targetPanY, minPanY), maxPanY);

    transform.jumpTo({ x: finalPanX, y: finalPanY }, targetZoom);
  } catch { }
}
