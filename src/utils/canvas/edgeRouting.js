/**
 * Edge routing utilities for the Manhattan, Clean and Lombardi routing styles
 *
 * SINGLE SOURCE OF TRUTH. Both the settled React render (NodeCanvas) and the
 * DOM-bypass drag updater (useNodeDrag) build routed edges from the functions
 * here. Any geometry that only one of them knows how to compute shows up as an
 * edge that jumps, freezes, or straightens the moment a drag starts.
 *
 * Every compute* function returns the SAME descriptor shape so callers can stay
 * routing-agnostic:
 *
 *   { points, pathD, startX, startY, endX, endY, sourceSide, destSide,
 *     arc?, sourceArrow?, destArrow? }
 *
 * `points` is always a polyline — literally so for the orthogonal styles, a
 * sampling of the curve for Lombardi. Hit-testing, hover trimming and label
 * placement all run against it, which is why an arc costs them nothing new.
 */

import { getPortPosition } from './portPositioning.js';
import { getNodeHitbox } from './nodeHitbox.js';

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

// ===========================================================================
// LOMBARDI ROUTING
// ===========================================================================
//
// After Duncan, Eppstein, Goodrich, Kobourov & Nöllenburg, "Lombardi Drawings
// of Graphs" (arXiv:1009.0579), itself after the artist Mark Lombardi. Two
// rules define the style:
//
//   1. Every edge is a CIRCULAR ARC (or a straight line, the degenerate arc).
//   2. Every vertex has PERFECT ANGULAR RESOLUTION — its incident edges leave
//      evenly spaced around the full 2π, not snapped to four side ports.
//
// Rule 2 is the interesting one, and it is why this can't reuse the port
// machinery: Manhattan and Clean pick one of four sides and stagger within it,
// which is the exact opposite of spreading edges evenly around a circle.
//
// WHERE WE NECESSARILY DEPART FROM THE PAPER
// The paper's algorithms get to CHOOSE vertex positions — that freedom is what
// lets them satisfy both endpoints' tangents at once (their Property 2: the
// locus of valid meeting points for a prescribed pair of tangents is itself a
// circle). Redstring's positions belong to the user; we can't move a node to
// make an arc work. And a circular arc through two fixed points has only one
// degree of freedom left, so it CANNOT honour two independently chosen
// tangents. See solveLombardiArc for how that conflict is settled.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Wrap to (-π, π]. */
const wrapPi = (a) => {
  const r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return r === -Math.PI ? Math.PI : r;
};

/** Wrap to [0, 2π). */
const wrapTau = (a) => ((a % TAU) + TAU) % TAU;

// Cap on the tangent-chord angle (~75°, so an arc spans at most ~151°). Past
// this an arc stops reading as a connection and starts reading as a lasso, and
// it also keeps every arc inside SVG's small-arc case.
export const MAX_TANGENT_CHORD = 1.32;

// Smallest bow, in canvas pixels, worth drawing as an arc rather than a line.
//
// This is a PERFORMANCE floor as much as a visual one. An arc's radius is
// L / (2 sin δ), so as δ approaches zero the radius runs away — a 600px edge
// with a quarter-degree bow wants a radius in the millions. That arc is
// pixel-identical to a straight line, but it is not free: SVG arc rendering
// derives the circle centre from the endpoints and the radius, which is
// numerically ill-conditioned when the radius dwarfs the chord, and anything
// that has to arc-length parameterise the path (a <textPath> label, most
// of all) pays dearly for it.
//
// Below this, emit a line. Whatever survives has a bow you can actually see,
// and a radius bounded by roughly L²/(8·MIN_VISIBLE_BOW).
export const MIN_VISIBLE_BOW = 0.4;

// How far inside the node border an arrowhead's origin sits. Matches the
// `offset` the straight-routing arrow placement uses.
const LOMBARDI_ARROW_INSET = 12;

/**
 * Key an edge for the tangent map.
 *
 * Edges reaching the RENDERER always carry an id. Edges reaching the LAYOUT do
 * not always — several call sites project them down to
 * {sourceId, destinationId, name} on the way in. Without a fallback every such
 * edge would key on `undefined`, collapse into one entry, and the whole fan
 * would come out wrong in exactly the silent way that is hardest to notice.
 */
export function lombardiEdgeKey(edge) {
  return edge?.id ?? `${edge?.sourceId}\u0000${edge?.destinationId}`;
}

/**
 * Assign every edge END a tangent direction, evenly spaced around its node.
 *
 * This is the "perfect angular resolution" half of a Lombardi drawing, and it
 * is a per-NODE solve: a node of degree k gets k slots at 2π/k spacing, and the
 * only remaining freedom is how that whole fan is rotated.
 *
 * Choosing the rotation: sort the incident edges by the natural bearing to
 * their neighbour, which fixes the cyclic order (and keeps the drawing free of
 * self-inflicted crossings around the node). Then the best rotation is simply
 * the circular mean of each edge's residual — its natural bearing minus its
 * slot's nominal angle. There is nothing to enumerate: rotating the ASSIGNMENT
 * by one slot shifts every residual by exactly -2π/k, which shifts the mean by
 * -2π/k and reproduces the identical set of directions.
 *
 * @param {Array} nodes - hydrated node instances
 * @param {Array} edges - ALL edges (not just visible ones — see caller)
 * @param {Map} dimsById - instanceId → dimensions
 * @returns {Map<string, {sourceAngle:number, destAngle:number}>}
 */
export function computeLombardiTangents(nodes, edges, dimsById) {
  const assignments = new Map();
  if (!nodes?.length || !edges?.length) return assignments;

  const centers = new Map();
  for (const node of nodes) {
    const d = dimsById?.get?.(node.id);
    centers.set(node.id, {
      x: node.x + (d?.currentWidth ?? 0) / 2,
      y: node.y + (d?.currentHeight ?? 0) / 2,
    });
  }

  // Bucket every edge END by the node it attaches to. Self-loops are drawn by
  // the dedicated self-loop path and never consume a slot.
  const ends = new Map();
  const addEnd = (nodeId, entry) => {
    const list = ends.get(nodeId);
    if (list) list.push(entry); else ends.set(nodeId, [entry]);
  };

  for (const edge of edges) {
    if (!edge || edge.sourceId === edge.destinationId) continue;
    const s = centers.get(edge.sourceId);
    const d = centers.get(edge.destinationId);
    if (!s || !d) continue;
    const bearing = Math.atan2(d.y - s.y, d.x - s.x);
    const key = lombardiEdgeKey(edge);
    addEnd(edge.sourceId, { edgeId: key, role: 'source', bearing: wrapTau(bearing) });
    addEnd(edge.destinationId, { edgeId: key, role: 'dest', bearing: wrapTau(bearing + Math.PI) });
  }

  ends.forEach((list) => {
    // Ties (parallel edges — identical bearings) break by edge id so each one
    // lands in a stable slot instead of swapping lanes between renders. This is
    // also what fans a multi-connection apart, which is exactly what Lombardi's
    // own drawings do with repeated relations.
    list.sort((a, b) => (a.bearing - b.bearing) || (a.edgeId < b.edgeId ? -1 : 1));

    const k = list.length;
    const step = TAU / k;

    let sx = 0;
    let sy = 0;
    for (let i = 0; i < k; i++) {
      const residual = list[i].bearing - i * step;
      sx += Math.cos(residual);
      sy += Math.sin(residual);
    }
    // Degenerate: residuals that cancel exactly (two edges to the very same
    // place, say) leave no rotation better than another. Anchor on the first
    // edge's own bearing so the result is at least deterministic.
    const phi = Math.hypot(sx, sy) < 1e-6 ? list[0].bearing : Math.atan2(sy, sx);

    for (let i = 0; i < k; i++) {
      const { edgeId, role } = list[i];
      const angle = phi + i * step;
      const slot = assignments.get(edgeId) || {};
      if (role === 'source') slot.sourceAngle = angle;
      else slot.destAngle = angle;
      assignments.set(edgeId, slot);
    }
  });

  return assignments;
}

/**
 * The single circular arc from p to q that best honours a desired departure
 * tangent at p and a desired arrival tangent at q.
 *
 * Property 1 of the paper: a circular arc makes the SAME angle with the chord
 * at both of its endpoints. So the two demands are not independent — an arc
 * that departs p at +δ from the chord necessarily arrives at q at -δ. With the
 * node positions fixed there is no way to satisfy both unless they already
 * agree, so we split the difference. Averaging the two demanded deviations
 * minimises the worst-case angular error, and it is exact whenever the
 * tangent assignment happens to be consistent (which it is for the whole class
 * of graphs the paper's constructions target).
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} q
 * @param {number} thetaP - direction the edge should leave p (radians)
 * @param {number} thetaQ - direction the edge should leave q (radians)
 * @param {number} curvature - user multiplier on the resulting bow
 * @returns {{straight:boolean, cx?:number, cy?:number, radius?:number,
 *            a0?:number, sweep?:number, delta:number} | null}
 */
export function solveLombardiArc(p, q, thetaP, thetaQ, curvature = 1) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < 1e-6) return null;

  const chord = Math.atan2(dy, dx);
  // Departure deviation demanded at p, and arrival deviation demanded at q.
  // The edge ARRIVES at q travelling in direction thetaQ + π (thetaQ points out
  // of the node), and an arc's arrival deviation is the negation of its
  // departure deviation — hence the minus.
  const alpha = wrapPi(thetaP - chord);
  const beta = wrapPi(thetaQ + Math.PI - chord);
  let delta = ((alpha - beta) / 2) * curvature;
  delta = Math.max(-MAX_TANGENT_CHORD, Math.min(MAX_TANGENT_CHORD, delta));

  // Sagitta of a chord L subtending 2δ. See MIN_VISIBLE_BOW for why an
  // invisibly-shallow arc must become an actual line rather than a huge circle.
  const bow = (chordLength / 2) * Math.abs(Math.tan(delta / 2));
  if (bow < MIN_VISIBLE_BOW) return { straight: true, delta: 0 };

  // Signed radius: chord subtending 2δ. The centre lies one radius off the
  // tangent at p, on the side the arc curves away from.
  const signedR = chordLength / (2 * Math.sin(delta));
  const tx = Math.cos(chord + delta);
  const ty = Math.sin(chord + delta);
  const cx = p.x + signedR * ty;
  const cy = p.y - signedR * tx;

  return {
    straight: false,
    cx,
    cy,
    radius: Math.abs(signedR),
    a0: Math.atan2(p.y - cy, p.x - cx),
    // Travelling p→q turns through -2δ (screen coords are y-down).
    sweep: -2 * delta,
    delta,
  };
}

/**
 * Point and tangent at parameter s ∈ [0,1] along an arc.
 * @returns {{x:number, y:number, angle:number}} angle in DEGREES, in the p→q
 *   direction of travel.
 */
export function arcPointAt(arc, s) {
  const a = arc.a0 + arc.sweep * s;
  const dir = arc.sweep >= 0 ? 1 : -1;
  return {
    x: arc.cx + arc.radius * Math.cos(a),
    y: arc.cy + arc.radius * Math.sin(a),
    angle: Math.atan2(dir * Math.cos(a), -dir * Math.sin(a)) * (180 / Math.PI),
  };
}

/** Where a point falls along the arc, clamped into [0,1]. */
export function arcParamOf(arc, pt) {
  if (!arc || arc.sweep === 0) return 0;
  const a = Math.atan2(pt.y - arc.cy, pt.x - arc.cx);
  // MAX_TANGENT_CHORD keeps |sweep| under π, so the shortest signed delta is
  // unambiguously the one inside the arc.
  const s = wrapPi(a - arc.a0) / arc.sweep;
  return Math.max(0, Math.min(1, s));
}

/**
 * Sample an arc into a polyline, ~8° per step.
 *
 * Deliberately does NOT go through arcPointAt: that computes a tangent angle
 * with an atan2 per point, and no consumer of a sampled polyline reads it.
 * Trimming, clearance and hit-testing all want x/y only, and at 500 edges the
 * wasted trig and the wider objects were both showing up.
 */
export function sampleArc(arc, steps = null) {
  const n = steps ?? Math.max(8, Math.min(32, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 22)) + 1));
  const points = new Array(n);
  const step = arc.sweep / (n - 1);
  for (let i = 0; i < n; i++) {
    const a = arc.a0 + step * i;
    points[i] = { x: arc.cx + arc.radius * Math.cos(a), y: arc.cy + arc.radius * Math.sin(a) };
  }
  return points;
}

/**
 * Exact distance from a point to an arc — no sampling.
 *
 * Hit-testing used to build the whole routing descriptor per edge per pointer
 * move and then walk its sampled polyline. For a circle there is a closed form:
 * if the point's bearing from the centre falls inside the arc's angular span,
 * the distance is just |r − radius|; otherwise it's the nearer endpoint. O(1)
 * instead of O(samples), and more accurate than the polyline it replaced.
 */
export function distanceToArc(px, py, arc) {
  const dx = px - arc.cx;
  const dy = py - arc.cy;
  const r = Math.hypot(dx, dy);
  if (r < 1e-9) return arc.radius;

  // MAX_TANGENT_CHORD keeps |sweep| under π, so the shortest signed delta
  // unambiguously identifies whether the bearing lies within the span.
  const s = wrapPi(Math.atan2(dy, dx) - arc.a0) / arc.sweep;
  if (s >= 0 && s <= 1) return Math.abs(r - arc.radius);

  const a0 = arc.a0;
  const a1 = arc.a0 + arc.sweep;
  const d0 = Math.hypot(px - (arc.cx + arc.radius * Math.cos(a0)), py - (arc.cy + arc.radius * Math.sin(a0)));
  const d1 = Math.hypot(px - (arc.cx + arc.radius * Math.cos(a1)), py - (arc.cy + arc.radius * Math.sin(a1)));
  return Math.min(d0, d1);
}

/**
 * Just the geometry, none of the render trimmings.
 *
 * Hit-testing needs the circle and the two centres; it does not need a sampled
 * polyline, a path string, or arrowhead placements. computeLombardiRouting
 * builds on this rather than duplicating it.
 *
 * @returns {{p:{x,y}, q:{x,y}, arc:object|null, chord:number}}
 */
export function lombardiArcFor(edge, sourceNode, destNode, sDims, dDims, tangents, curvature = 1) {
  const p = { x: sourceNode.x + sDims.currentWidth / 2, y: sourceNode.y + sDims.currentHeight / 2 };
  const q = { x: destNode.x + dDims.currentWidth / 2, y: destNode.y + dDims.currentHeight / 2 };
  const chord = Math.atan2(q.y - p.y, q.x - p.x);
  const assigned = tangents?.get?.(lombardiEdgeKey(edge));
  const solved = solveLombardiArc(
    p, q,
    assigned?.sourceAngle ?? chord,
    assigned?.destAngle ?? (chord + Math.PI),
    curvature
  );
  return { p, q, chord, arc: solved && !solved.straight ? solved : null };
}

/**
 * SVG path for the portion of an arc between two points. Both are snapped onto
 * the circle first, so a `from`/`to` that came off the sampled polyline (and
 * therefore sits a hair inside the true circle) still yields an exact arc.
 */
export function arcPathBetween(arc, from, to) {
  if (!arc || arc.straight) return `M ${from.x},${from.y} L ${to.x},${to.y}`;
  const s0 = arcParamOf(arc, from);
  const s1 = arcParamOf(arc, to);
  const p0 = arcPointAt(arc, s0);
  const p1 = arcPointAt(arc, s1);
  const sweep = arc.sweep * (s1 - s0);
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;
  return `M ${p0.x},${p0.y} A ${arc.radius},${arc.radius} 0 ${largeArc} ${sweepFlag} ${p1.x},${p1.y}`;
}

// Widest total angle a label may bend through.
//
// This is a DEGENERACY guard, not a taste one. Curved labels read well at every
// bend a real connection produces, so there's no aesthetic threshold to enforce
// — but as the sweep approaches a full turn the path's two endpoints converge,
// the arc becomes ambiguous, and the text starts overlapping its own tail. Just
// under 2π is where that begins.
export const MAX_LABEL_SWEEP = Math.PI * 1.8;

// The path is made longer than the text so `startOffset="50%"` has room either
// side; a path exactly as long as the estimate would clip if the estimate ran
// a few percent short.
const LABEL_PATH_SLACK = 1.4;

/**
 * A path for a label to ride along its own arc, or null if it shouldn't.
 *
 * The label follows a circle CONCENTRIC with the edge's arc, at whatever radius
 * the placement chose — so a label nudged off the line to dodge something still
 * curves the same way the line does, just at a slightly different radius.
 *
 * Returns null only when there is no arc to ride, no text to place, or the
 * label would have to wrap most of the way round the circle (see
 * MAX_LABEL_SWEEP). The caller's fallback is a straight rotated label.
 *
 * @param {object} arc - from solveLombardiArc
 * @param {{x:number,y:number}} anchor - the chosen label position
 * @param {number} textWidth - estimated rendered width
 * @param {object} [options] - `span` supplies the path length directly, for
 *   callers that already measured the rendered path (the drag updater does,
 *   once, at drag start) and shouldn't re-estimate it every frame.
 * @returns {{d: string, sweep: number, radius: number}|null}
 */
export function labelArcPath(arc, anchor, textWidth, options = {}) {
  const span = options.span ?? (textWidth > 0 ? textWidth * (options.slack ?? LABEL_PATH_SLACK) : 0);
  if (!arc || !(span > 0)) return null;
  const maxSweep = options.maxSweep ?? MAX_LABEL_SWEEP;

  const dx = anchor.x - arc.cx;
  const dy = anchor.y - arc.cy;
  const radius = Math.hypot(dx, dy);
  if (!(radius > 1)) return null;

  const sweep = span / radius;
  if (!(sweep > 0) || sweep > maxSweep) return null;
  // How far the text's baseline actually departs from a straight one over its
  // own length. Below a pixel the two are the same picture — and this is the
  // case where the radius is enormous, which is precisely when <textPath> is
  // most expensive. Straight label, identical result, a fraction of the cost.
  //
  // `options.minBow` lets the caller raise this floor. The renderer sets it from
  // the zoom level, so the test becomes "is this bend visible ON SCREEN" rather
  // than "is it visible in canvas coordinates" — at low zoom a 3px canvas bow is
  // sub-pixel to the viewer, and <textPath> is far too expensive to spend on a
  // curve nobody can see. See CONNECTION LABEL RENDERING BUDGETS in NodeCanvas.
  if ((span * sweep) / 8 < (options.minBow ?? MIN_VISIBLE_BOW)) return null;

  const mid = Math.atan2(dy, dx);
  const half = sweep / 2;
  const at = (a) => ({ x: arc.cx + radius * Math.cos(a), y: arc.cy + radius * Math.sin(a) });

  // Text runs from a0 to a1, so the direction of travel decides whether it reads
  // upright or upside down. Pick the one heading rightward — and for a
  // near-vertical label, downward — which is the same rule the straight labels
  // use when they flip to stay readable.
  const forward = { a0: mid - half, a1: mid + half };
  const backward = { a0: mid + half, a1: mid - half };
  const readsUpright = (o) => {
    const p0 = at(o.a0);
    const p1 = at(o.a1);
    const runX = p1.x - p0.x;
    return Math.abs(runX) > 1e-6 ? runX > 0 : p1.y - p0.y > 0;
  };
  const chosen = readsUpright(forward) ? forward : backward;

  const p0 = at(chosen.a0);
  const p1 = at(chosen.a1);
  const sweepFlag = chosen.a1 > chosen.a0 ? 1 : 0;
  // Past a half turn the two endpoints stop identifying the arc on their own and
  // SVG needs telling which way round to go. Omitting this drew long labels
  // backwards along the short side of the circle.
  const largeArc = sweep > Math.PI ? 1 : 0;
  return {
    d: `M ${p0.x},${p0.y} A ${radius},${radius} 0 ${largeArc} ${sweepFlag} ${p1.x},${p1.y}`,
    sweep,
    radius,
  };
}

/**
 * Rebuild path data for a routing descriptor whose polyline has been trimmed
 * (the hover pull-back). Orthogonal routings re-emit a rounded polyline; a
 * Lombardi routing re-emits a shorter arc on the SAME circle rather than a
 * chain of chords, so the curve keeps its exact curvature while retracting.
 */
export function rebuildRoutedPath(routing, points) {
  if (!points || points.length < 2) return routing?.pathD || '';
  if (routing?.arc) return arcPathBetween(routing.arc, points[0], points[points.length - 1]);
  return buildRoundedOrthogonalPath(points);
}

/**
 * Compute the full Lombardi routing descriptor for an edge.
 *
 * Endpoint convention matches the other routings: an arrow-bearing end
 * terminates at the node border (so the arrowhead is visible), an arrow-less
 * end stays at the node centre and is covered by the node body.
 */
export function computeLombardiRouting(edge, sourceNode, destNode, sDims, dDims, tangents, options = {}) {
  const curvature = options.curvature ?? 1;
  const selected = options.selectedInstanceIds;
  const { p, q, chord, arc } = lombardiArcFor(edge, sourceNode, destNode, sDims, dDims, tangents, curvature);

  const arrowsToward = edge?.directionality?.arrowsToward instanceof Set
    ? edge.directionality.arrowsToward
    : new Set(Array.isArray(edge?.directionality?.arrowsToward) ? edge.directionality.arrowsToward : []);
  const hasSourceArrow = arrowsToward.has(sourceNode.id);
  const hasDestArrow = arrowsToward.has(destNode.id);

  let points = null;
  let startPt = p;
  let endPt = q;
  let sourceArrow = null;
  let destArrow = null;

  // Sampling is only needed to find where the arc crosses a node's box, which
  // in turn is only needed for an END THAT HAS AN ARROW. An arrow-less edge —
  // the common case — never pays for it, and neither does anything that only
  // wants the circle (label placement, hit-testing, the pie-menu anchor).
  if (hasSourceArrow || hasDestArrow) {
    const sBox = options.sourceBounds || getNodeHitbox(sourceNode, sDims, !!selected?.has?.(sourceNode.id));
    const dBox = options.destBounds || getNodeHitbox(destNode, dDims, !!selected?.has?.(destNode.id));
    const fullPoints = arc ? sampleArc(arc) : [p, q];

    // Tangent-following arrowheads. The source arrow points back at the source,
    // mirroring every other routing style.
    const headingAt = (pt) => (arc ? arcPointAt(arc, arcParamOf(arc, pt)).angle : chord * (180 / Math.PI));
    const arrowFor = (fromStart, box, reverse) => {
      const { endpoint } = trimRouteEnd(fullPoints, box, fromStart, LOMBARDI_ARROW_INSET);
      const angle = headingAt(endpoint);
      return { x: endpoint.x, y: endpoint.y, angle: reverse ? angle + 180 : angle };
    };

    points = fullPoints;
    if (hasSourceArrow) {
      const trimmed = trimRouteEnd(points, sBox, true, 0);
      points = trimmed.points;
      startPt = trimmed.endpoint;
      sourceArrow = arrowFor(true, sBox, true);
    }
    if (hasDestArrow) {
      const trimmed = trimRouteEnd(points, dBox, false, 0);
      points = trimmed.points;
      endPt = trimmed.endpoint;
      destArrow = arrowFor(false, dBox, false);
    }
  }

  const from = startPt;
  const to = endPt;

  return {
    kind: 'lombardi',
    arc,
    // Lazy: only the hover preview reads this, and only for the one edge under
    // the cursor. Materialising it for all 500 edges of a large graph, every
    // render, was pure waste.
    get points() {
      if (points === null) points = arc ? sampleArc(arc) : [from, to];
      return points;
    },
    pathD: arc ? arcPathBetween(arc, startPt, endPt)
      : `M ${startPt.x},${startPt.y} L ${endPt.x},${endPt.y}`,
    startX: startPt.x,
    startY: startPt.y,
    endX: endPt.x,
    endY: endPt.y,
    // Lombardi has no notion of a node side — direction is continuous. Callers
    // that switch on a side must fall back to the explicit arrow descriptors.
    sourceSide: null,
    destSide: null,
    sourceArrow,
    destArrow,
  };
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
