/**
 * Edge routing utilities for Manhattan and Clean routing styles
 *
 * SINGLE SOURCE OF TRUTH. Both the settled React render (NodeCanvas) and the
 * DOM-bypass drag updater (useNodeDrag) build routed edges from the functions
 * here. Any geometry that only one of them knows how to compute shows up as an
 * edge that jumps, freezes, or straightens the moment a drag starts.
 */

import { getPortPosition } from './portPositioning.js';

const DEFAULT_CORNER_RADIUS = 8;

/**
 * Build a rounded SVG path from an ordered orthogonal polyline.
 *
 * Unlike the generic builder in edgeLabelPlacement.js, the corner radius is
 * clamped to half of the shortest adjacent segment so tight bends can't
 * overshoot into a visible kink.
 *
 * @param {Array<{x:number,y:number}>} pts
 * @param {number} radius
 * @returns {string} SVG path data
 */
export function buildRoundedOrthogonalPath(pts, radius = DEFAULT_CORNER_RADIUS) {
  const points = dedupePoints(pts);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (i === points.length - 1) {
      d += ` L ${curr.x},${curr.y}`;
      continue;
    }
    const next = points[i + 1];
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const inLen = Math.hypot(dx1, dy1);
    const outLen = Math.hypot(dx2, dy2);
    // Clamp so neither the incoming nor outgoing segment is over-consumed.
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2));
    if (r === 0) {
      d += ` L ${curr.x},${curr.y}`;
      continue;
    }
    const backX = curr.x - (dx1 / inLen) * r;
    const backY = curr.y - (dy1 / inLen) * r;
    const fwdX = curr.x + (dx2 / outLen) * r;
    const fwdY = curr.y + (dy2 / outLen) * r;
    d += ` L ${backX},${backY} Q ${curr.x},${curr.y} ${fwdX},${fwdY}`;
  }
  return d;
}

// Drop consecutive duplicate points and collinear midpoints — they produce
// degenerate zero-length corners that render as dots under a round linecap.
function dedupePoints(pts) {
  if (!pts || pts.length === 0) return [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    if (Math.abs(curr.x - prev.x) < 0.01 && Math.abs(curr.y - prev.y) < 0.01) continue;
    out.push(curr);
  }
  // Remove collinear interior points
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < 0.01) out.splice(i, 1);
  }
  return out;
}

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
 * Pull one end of a routed polyline back out of a node and a bit further.
 *
 * This is the orthogonal equivalent of the straight-edge hover preview: the
 * visible line retracts to just past the node border, leaving the gap where an
 * arrowhead would sit, and the caller drops the hover dot on the new endpoint.
 * Works for any polyline, so it covers Manhattan (whose ports already sit on the
 * border) and Clean (whose arrow-less ends start at the node center) alike.
 *
 * @param {Array<{x:number,y:number}>} points - routed polyline
 * @param {{minX:number,minY:number,maxX:number,maxY:number}|null} box - node hitbox to clear
 * @param {boolean} fromStart - trim the start (true) or the end (false)
 * @param {number} extra - additional distance past the border
 * @returns {{points: Array, endpoint: {x:number,y:number}}}
 */
export function trimRouteEnd(points, box, fromStart, extra = 0) {
  if (!points || points.length < 2) {
    return { points: points || [], endpoint: points?.[0] || { x: 0, y: 0 } };
  }

  // Work start-first, then flip back at the end.
  const pts = fromStart ? points.slice() : points.slice().reverse();

  const inBox = (p) => box
    && p.x >= box.minX && p.x <= box.maxX
    && p.y >= box.minY && p.y <= box.maxY;

  // 1. Walk to where the polyline leaves the node box.
  let idx = 0;
  let cursor = pts[0];
  if (inBox(pts[0])) {
    let exited = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Standard slab exit: smallest positive t at which the segment leaves.
      let t = Infinity;
      if (dx > 0) t = Math.min(t, (box.maxX - a.x) / dx);
      else if (dx < 0) t = Math.min(t, (box.minX - a.x) / dx);
      if (dy > 0) t = Math.min(t, (box.maxY - a.y) / dy);
      else if (dy < 0) t = Math.min(t, (box.minY - a.y) / dy);

      if (t >= 0 && t <= 1) {
        idx = i;
        cursor = { x: a.x + dx * t, y: a.y + dy * t };
        exited = true;
        break;
      }
    }
    // Fully enclosed (nodes overlapping, say) — nothing sensible to trim.
    if (!exited) return { points, endpoint: pts[0] };
  }

  // 2. Advance `extra` further along the remaining polyline.
  let remaining = extra;
  while (remaining > 0 && idx < pts.length - 1) {
    const next = pts[idx + 1];
    const segLen = Math.hypot(next.x - cursor.x, next.y - cursor.y);
    if (segLen >= remaining) {
      if (segLen > 0) {
        cursor = {
          x: cursor.x + ((next.x - cursor.x) / segLen) * remaining,
          y: cursor.y + ((next.y - cursor.y) / segLen) * remaining,
        };
      }
      remaining = 0;
    } else {
      remaining -= segLen;
      idx += 1;
      cursor = next;
    }
  }

  // 3. Rebuild from the new endpoint. Guard against consuming the whole route.
  const tail = pts.slice(idx + 1);
  const trimmed = tail.length > 0 ? [cursor, ...tail] : [cursor, pts[pts.length - 1]];

  return {
    points: fromStart ? trimmed : trimmed.slice().reverse(),
    endpoint: cursor,
  };
}

/**
 * Compute the full Manhattan routing descriptor for an edge.
 *
 * Returns everything both render paths need — the polyline (for label
 * placement), the rounded path data (for the <path> elements), the chosen
 * ports (for the center→port stubs) and the sides (for arrowhead orientation).
 *
 * @returns {{points: Array, pathD: string, startX: number, startY: number,
 *            endX: number, endY: number, sourceSide: string, destSide: string}}
 */
export function computeManhattanRouting(sourceNode, destNode, sDims, dDims, manhattanBends = 'auto') {
  const points = generateManhattanRoutingPath(null, sourceNode, destNode, sDims, dDims, manhattanBends);
  const start = points[0];
  const end = points[points.length - 1];

  const sourceSide = (Math.abs(start.y - sourceNode.y) < 0.5) ? 'top'
    : (Math.abs(start.y - (sourceNode.y + sDims.currentHeight)) < 0.5) ? 'bottom'
      : (Math.abs(start.x - sourceNode.x) < 0.5) ? 'left' : 'right';
  const destSide = (Math.abs(end.y - destNode.y) < 0.5) ? 'top'
    : (Math.abs(end.y - (destNode.y + dDims.currentHeight)) < 0.5) ? 'bottom'
      : (Math.abs(end.x - destNode.x) < 0.5) ? 'left' : 'right';

  return {
    points,
    pathD: buildRoundedOrthogonalPath(points),
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    sourceSide,
    destSide,
  };
}

/**
 * Compute the full clean routing descriptor for an edge. Mirrors
 * computeManhattanRouting so callers can treat both styles uniformly.
 */
export function computeCleanRouting(edge, sourceNode, destNode, sDims, dDims, cleanLaneOffsets, cleanLaneSpacing = 24) {
  const points = generateCleanRoutingPath(edge, sourceNode, destNode, sDims, dDims, cleanLaneOffsets, cleanLaneSpacing);
  const start = points[0];
  const end = points[points.length - 1];
  const assignment = cleanLaneOffsets?.get?.(edge.id) || null;

  return {
    points,
    pathD: buildRoundedOrthogonalPath(points),
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    sourceSide: assignment?.sourceSide ?? null,
    destSide: assignment?.destSide ?? null,
  };
}

/**
 * Generate consistent Manhattan routing path for an edge
 * @param {Object} edge - Edge object (unused; kept for call-site symmetry)
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
