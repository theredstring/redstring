/**
 * Edge routing utilities for Manhattan and Clean routing styles
 */

import { getPortPosition } from './portPositioning.js';

/**
 * Compute clean polyline routing from start to end ports with orthogonal stems
 * @param {Object} start - Start point with x, y coordinates
 * @param {Object} end - End point with x, y coordinates
 * @param {Array} obstacleRects - Array of obstacle rectangles (currently unused)
 * @param {number} laneSpacing - Spacing between parallel lanes
 * @param {string|null} startSide - Side of start node ('top', 'bottom', 'left', 'right')
 * @param {string|null} endSide - Side of end node
 * @returns {Array} Array of {x, y} points forming the routing path
 */
export function computeCleanPolylineFromPorts(start, end, obstacleRects, laneSpacing = 24, startSide = null, endSide = null) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // For short connections or when start/end are well-aligned, use minimal stems
  const isShortConnection = distance < 200;
  const isWellAligned = (startSide === 'right' && endSide === 'left' && Math.abs(dy) < 50) ||
                       (startSide === 'left' && endSide === 'right' && Math.abs(dy) < 50) ||
                       (startSide === 'bottom' && endSide === 'top' && Math.abs(dx) < 50) ||
                       (startSide === 'top' && endSide === 'bottom' && Math.abs(dx) < 50);

  let startStemLength, endStemLength;

  if (isShortConnection || isWellAligned) {
    // Use minimal stems for short or well-aligned connections
    startStemLength = 24;
    endStemLength = 24;
  } else {
    // Use staggered stems for longer connections to prevent overlap
    const stableEdgeHash = Math.abs((start.x * 31 + start.y * 17 + end.x * 13 + end.y * 7) % 97);
    const baseStemLength = Math.max(60, laneSpacing * 0.3);
    const stemVariation = (stableEdgeHash % 3) * 16; // 0, 16, 32px variations (reduced)
    startStemLength = baseStemLength + stemVariation;
    endStemLength = baseStemLength + ((stableEdgeHash + 1) % 3) * 16;
  }

  // Create stem points that exit orthogonally from the node edges at staggered distances
  let stemStart, stemEnd;

  if (startSide) {
    // Create orthogonal stem from start port with staggered length
    switch (startSide) {
      case 'top':
        stemStart = { x: start.x, y: start.y - startStemLength };
        break;
      case 'bottom':
        stemStart = { x: start.x, y: start.y + startStemLength };
        break;
      case 'left':
        stemStart = { x: start.x - startStemLength, y: start.y };
        break;
      case 'right':
        stemStart = { x: start.x + startStemLength, y: start.y };
        break;
      default:
        stemStart = start;
    }
  } else {
    stemStart = start;
  }

  if (endSide) {
    // Create orthogonal stem to end port with staggered length
    switch (endSide) {
      case 'top':
        stemEnd = { x: end.x, y: end.y - endStemLength };
        break;
      case 'bottom':
        stemEnd = { x: end.x, y: end.y + endStemLength };
        break;
      case 'left':
        stemEnd = { x: end.x - endStemLength, y: end.y };
        break;
      case 'right':
        stemEnd = { x: end.x + endStemLength, y: end.y };
        break;
      default:
        stemEnd = end;
    }
  } else {
    stemEnd = end;
  }

  // Route between stem points using simple L/Z logic
  const stemDx = stemEnd.x - stemStart.x;
  const stemDy = stemEnd.y - stemStart.y;
  const preferHorizontal = Math.abs(stemDx) >= Math.abs(stemDy);

  let midPath;
  if (Math.abs(stemDx) < 1 && Math.abs(stemDy) < 1) {
    // Stems are very close - direct connection
    midPath = [stemStart, stemEnd];
  } else if (preferHorizontal) {
    // Horizontal-first L path between stems
    midPath = [stemStart, { x: stemEnd.x, y: stemStart.y }, stemEnd];
  } else {
    // Vertical-first L path between stems
    midPath = [stemStart, { x: stemStart.x, y: stemEnd.y }, stemEnd];
  }

  // Assemble full path: start -> stem -> route -> stem -> end
  const fullPath = [];

  // Add start segment if we have a stem
  if (startSide && stemStart && (stemStart.x !== start.x || stemStart.y !== start.y)) {
    fullPath.push(start, stemStart);
  } else {
    fullPath.push(start);
  }

  // Add middle routing (skip first point if it's the same as last added point)
  for (let i = 0; i < midPath.length; i++) {
    const point = midPath[i];
    const lastPoint = fullPath[fullPath.length - 1];
    // Only add if it's different from the last point
    if (!lastPoint || point.x !== lastPoint.x || point.y !== lastPoint.y) {
      fullPath.push(point);
    }
  }

  // Add end segment if we have a stem and it's different from the last point
  if (endSide && stemEnd && (stemEnd.x !== end.x || stemEnd.y !== end.y)) {
    const lastPoint = fullPath[fullPath.length - 1];
    if (!lastPoint || lastPoint.x !== end.x || lastPoint.y !== end.y) {
      fullPath.push(end);
    }
  }

  return fullPath;
}

/**
 * Generate consistent Manhattan routing path for an edge
 * @param {Object} edge - Edge object
 * @param {Object} sourceNode - Source node with x, y coordinates
 * @param {Object} destNode - Destination node with x, y coordinates
 * @param {Object} sDims - Source node dimensions
 * @param {Object} dDims - Destination node dimensions
 * @param {string} manhattanBends - Bend style ('one', 'two', or 'auto')
 * @returns {Array} Array of {x, y} points forming the Manhattan path
 */
export function generateManhattanRoutingPath(edge, sourceNode, destNode, sDims, dDims, manhattanBends = 'auto') {
  const sCenterX = sourceNode.x + sDims.currentWidth / 2;
  const sCenterY = sourceNode.y + sDims.currentHeight / 2;
  const dCenterX = destNode.x + dDims.currentWidth / 2;
  const dCenterY = destNode.y + dDims.currentHeight / 2;

  const sPorts = {
    top: { x: sCenterX, y: sourceNode.y },
    bottom: { x: sCenterX, y: sourceNode.y + sDims.currentHeight },
    left: { x: sourceNode.x, y: sCenterY },
    right: { x: sourceNode.x + sDims.currentWidth, y: sCenterY },
  };
  const dPorts = {
    top: { x: dCenterX, y: destNode.y },
    bottom: { x: dCenterX, y: destNode.y + dDims.currentHeight },
    left: { x: destNode.x, y: dCenterY },
    right: { x: destNode.x + dDims.currentWidth, y: dCenterY },
  };

  const relDx = dCenterX - sCenterX;
  const relDy = dCenterY - sCenterY;
  let sPort, dPort;
  if (Math.abs(relDx) >= Math.abs(relDy)) {
    sPort = relDx >= 0 ? sPorts.right : sPorts.left;
    dPort = relDx >= 0 ? dPorts.left : dPorts.right;
  } else {
    sPort = relDy >= 0 ? sPorts.bottom : sPorts.top;
    dPort = relDy >= 0 ? dPorts.top : dPorts.bottom;
  }

  const startX = sPort.x;
  const startY = sPort.y;
  const endX = dPort.x;
  const endY = dPort.y;

  // Determine sides for perpendicular entry/exit (same logic as rendering)
  const sSide = (Math.abs(startY - sourceNode.y) < 0.5) ? 'top'
                  : (Math.abs(startY - (sourceNode.y + sDims.currentHeight)) < 0.5) ? 'bottom'
                  : (Math.abs(startX - sourceNode.x) < 0.5) ? 'left' : 'right';
  const dSide = (Math.abs(endY - destNode.y) < 0.5) ? 'top'
                  : (Math.abs(endY - (destNode.y + dDims.currentHeight)) < 0.5) ? 'bottom'
                  : (Math.abs(endX - destNode.x) < 0.5) ? 'left' : 'right';
  const initOrient = (sSide === 'left' || sSide === 'right') ? 'H' : 'V';
  const finalOrient = (dSide === 'left' || dSide === 'right') ? 'H' : 'V';

  // Use the same bend logic as rendering
  const effectiveBends = (manhattanBends === 'auto')
    ? (initOrient === finalOrient ? 'two' : 'one')
    : manhattanBends;

  // Generate path points based on bend type
  let pathPoints;
  if (effectiveBends === 'two' && initOrient === finalOrient) {
    if (initOrient === 'H') {
      // HVH pattern
      const midX = (startX + endX) / 2;
      pathPoints = [
        { x: startX, y: startY },
        { x: midX, y: startY },
        { x: midX, y: endY },
        { x: endX, y: endY }
      ];
    } else {
      // VHV pattern
      const midY = (startY + endY) / 2;
      pathPoints = [
        { x: startX, y: startY },
        { x: startX, y: midY },
        { x: endX, y: midY },
        { x: endX, y: endY }
      ];
    }
  } else {
    // Simple L-path
    if (initOrient === 'H') {
      pathPoints = [
        { x: startX, y: startY },
        { x: endX, y: startY },
        { x: endX, y: endY }
      ];
    } else {
      pathPoints = [
        { x: startX, y: startY },
        { x: startX, y: endY },
        { x: endX, y: endY }
      ];
    }
  }

  return pathPoints;
}

/**
 * Generate consistent clean routing path for an edge
 * @param {Object} edge - Edge object
 * @param {Object} sourceNode - Source node
 * @param {Object} destNode - Destination node
 * @param {Object} sDims - Source node dimensions
 * @param {Object} dDims - Destination node dimensions
 * @param {Map} cleanLaneOffsets - Port assignment map
 * @param {number} cleanLaneSpacing - Spacing between lanes
 * @returns {Array} Array of {x, y} points forming the clean routing path
 */
export function generateCleanRoutingPath(edge, sourceNode, destNode, sDims, dDims, cleanLaneOffsets, cleanLaneSpacing = 24) {
  const x1 = sourceNode.x + sDims.currentWidth / 2;
  const y1 = sourceNode.y + sDims.currentHeight / 2;
  const x2 = destNode.x + dDims.currentWidth / 2;
  const y2 = destNode.y + dDims.currentHeight / 2;

  const portAssignment = cleanLaneOffsets.get(edge.id);
  if (portAssignment) {
    const { sourcePort, destPort, sourceSide, destSide } = portAssignment;

    // Check if this edge has directional arrows
    const arrowsToward = edge.directionality?.arrowsToward instanceof Set
      ? edge.directionality.arrowsToward
      : new Set(Array.isArray(edge.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);
    const hasSourceArrow = arrowsToward.has(sourceNode.id);
    const hasDestArrow = arrowsToward.has(destNode.id);

    // For non-directional connections, route to node centers
    const effectiveStart = hasSourceArrow ? sourcePort : { x: x1, y: y1 };
    const effectiveEnd = hasDestArrow ? destPort : { x: x2, y: y2 };
    const effectiveStartSide = hasSourceArrow ? sourceSide : null;
    const effectiveEndSide = hasDestArrow ? destSide : null;

    return computeCleanPolylineFromPorts(
      effectiveStart,
      effectiveEnd,
      [],
      cleanLaneSpacing,
      effectiveStartSide,
      effectiveEndSide
    );
  } else {
    // Fallback to simple L-path from node centers
    const startPt = { x: x1, y: y1 };
    const endPt = { x: x2, y: y2 };
    return computeCleanPolylineFromPorts(startPt, endPt, [], cleanLaneSpacing);
  }
}
