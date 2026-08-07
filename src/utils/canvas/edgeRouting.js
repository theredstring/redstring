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

// ===========================================================================
// PARALLEL CONNECTIONS
// ===========================================================================
//
// Two nodes can be joined by any number of connections, and they are DIFFERENT
// connections — each has its own type, name, direction and label. A router that
// derives its geometry purely from the two endpoints hands every one of them
// the identical path, so the bundle draws as a single line with N labels
// stacked on it and nothing to click apart.
//
// The straight styles already solve this: calculateParallelEdgePath bows each
// one by a different amount using {pairIndex, totalInPair}. The helpers below
// give the routed styles the same input, expressed as a signed rank so the fan
// straddles the route a lone connection would have taken instead of drifting
// off to one side of it.
// ---------------------------------------------------------------------------

/** Extra clearance past the rounded corner before a port may sit on a side. */
const PORT_CORNER_BUFFER = 8;

/**
 * What fraction of the straight styles' curve spacing an orthogonal lane gets.
 *
 * The straight styles spend their spacing on a bow that is free to swing wide
 * of both nodes, so the number is large (200px at the slider's default). An
 * orthogonal lane has to fit ON a node's side, and at that magnitude every
 * bundle would clamp to the port band and collapse back into one lane on all
 * but the largest nodes. A quarter of it separates the lanes clearly while
 * still tracking the Multi Connection Curve slider, so one control governs how
 * far apart multiple connections spread in every routing style.
 */
export const ORTHOGONAL_LANE_FRACTION = 0.25;

/**
 * The same, for a Lombardi bundle's arcs.
 *
 * Here the fan is free of the node outline, so the number can be generous — and
 * a half matches the straight styles exactly: their spacing is a Bézier control
 * offset, and a quadratic Bézier's apex lands at half of it. Parallel
 * connections therefore sit the same distance apart whichever of the two styles
 * you are looking at.
 */
export const LOMBARDI_LANE_FRACTION = 0.5;

/**
 * Signed position of an edge within its parallel bundle: 0 when it is alone,
 * otherwise centred — ±0.5 for a pair, {-1, 0, +1} for a triple, and so on.
 *
 * @param {{pairIndex:number,totalInPair:number}|null|undefined} curveInfo
 */
export function parallelLaneRank(curveInfo) {
  const total = curveInfo?.totalInPair ?? 1;
  if (!(total > 1)) return 0;
  return (curveInfo.pairIndex ?? 0) - (total - 1) / 2;
}

/**
 * Sign that puts a bundle's fan into a frame BOTH of its members agree on.
 *
 * A lane rank is an index, so it says nothing about direction — but a router
 * that spends that rank on a CHORD-RELATIVE quantity (a perpendicular offset, a
 * tangent-chord angle) has implicitly expressed it in the edge's own p→q frame.
 * Two connections between the same pair of nodes need not share that frame: the
 * bundle is keyed on the UNORDERED pair, so an A→B connection and a B→A one land
 * in the same bundle with opposite chords. Reversing the chord mirrors the
 * perpendicular, which cancels the rank's opposite sign exactly — and the two
 * connections draw on top of each other, which is the one thing the fan exists
 * to prevent.
 *
 * Multiplying the rank by this restores the cancellation's other half. The frame
 * is geometric (left-to-right, then top-to-bottom) rather than keyed on node ids
 * so that the lane order matches what the reader sees: the upper lane stays the
 * upper lane no matter which end of it the connection was drawn from.
 *
 * Any router whose fan is chord-relative MUST apply this. Routers that spend the
 * rank on a GLOBAL axis instead — Manhattan slides its ports along a node side,
 * which is an absolute direction — are already frame-independent and must not.
 */
export function bundleFrameSign(p, q) {
  return (p.x !== q.x ? p.x <= q.x : p.y <= q.y) ? 1 : -1;
}

/**
 * Half the straight-line distance a port may travel along `side` before it
 * runs into the node's rounded corner.
 */
function portBandHalfWidth(dims, side) {
  const along = (side === 'left' || side === 'right') ? dims.currentHeight : dims.currentWidth;
  const radius = Math.min(
    dims.scaledCornerRadius ?? DEFAULT_CORNER_RADIUS,
    Math.min(dims.currentWidth, dims.currentHeight) / 2
  );
  return Math.max(0, along / 2 - radius - PORT_CORNER_BUFFER);
}

/**
 * Lane offset, in canvas pixels, for one edge of a parallel bundle routed
 * orthogonally between two given sides.
 *
 * The requested spacing is compressed until the whole bundle fits inside BOTH
 * nodes' port bands — a wide fan on a narrow node would otherwise push its
 * outer lanes into the rounded corners, where the connection visibly detaches
 * from the node outline. Both ends share one offset so the lanes stay parallel
 * rather than splaying.
 */
function orthogonalLaneOffset(curveInfo, spacing, sDims, dDims, sSide, dSide) {
  const rank = parallelLaneRank(curveInfo);
  if (rank === 0 || !(spacing > 0)) return 0;
  const maxRank = ((curveInfo.totalInPair ?? 1) - 1) / 2;
  const band = Math.min(portBandHalfWidth(sDims, sSide), portBandHalfWidth(dDims, dSide));
  const fitted = maxRank > 0 ? Math.min(spacing, band / maxRank) : spacing;
  return rank * fitted;
}

/** Slide a port along the side it sits on, leaving it on that side. */
function offsetPortAlongSide(port, side, offset) {
  return (side === 'left' || side === 'right')
    ? { ...port, y: port.y + offset }
    : { ...port, x: port.x + offset };
}

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
export function computeManhattanRouting(sourceNode, destNode, sDims, dDims, manhattanBends = 'auto', options = {}) {
  const points = generateManhattanRoutingPath(null, sourceNode, destNode, sDims, dDims, manhattanBends, options);
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
 * @param {Object} [options] - `curveInfo` ({pairIndex, totalInPair}) and
 *   `laneSpacing` fan a bundle of parallel connections into separate lanes.
 *   See PARALLEL CONNECTIONS above; omit them and a bundle collapses onto one
 *   path, which is what this router used to do unconditionally.
 * @returns {Array} Array of {x, y} points forming the Manhattan path
 */
export function generateManhattanRoutingPath(edge, sourceNode, destNode, sDims, dDims, manhattanBends = 'auto', options = {}) {
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

  // Sides are read off the UNOFFSET ports, before the parallel fan slides them
  // along: the fan moves a port within its side, never onto another one, and
  // deriving the side from a slid port would be a coordinate comparison the
  // offset could tip over.
  const sSide = (Math.abs(sPort.y - sourceNode.y) < 0.5) ? 'top'
                  : (Math.abs(sPort.y - (sourceNode.y + sDims.currentHeight)) < 0.5) ? 'bottom'
                  : (Math.abs(sPort.x - sourceNode.x) < 0.5) ? 'left' : 'right';
  const dSide = (Math.abs(dPort.y - destNode.y) < 0.5) ? 'top'
                  : (Math.abs(dPort.y - (destNode.y + dDims.currentHeight)) < 0.5) ? 'bottom'
                  : (Math.abs(dPort.x - destNode.x) < 0.5) ? 'left' : 'right';

  const initOrient = (sSide === 'left' || sSide === 'right') ? 'H' : 'V';
  const finalOrient = (dSide === 'left' || dSide === 'right') ? 'H' : 'V';

  // Spread parallel connections into their own lanes.
  //
  // An orthogonal route has exactly two coordinates free to move: where the
  // ports sit along their sides, and where the run BETWEEN them sits. Offsetting
  // only the ports leaves every lane sharing that middle run, which is most of
  // the line — so both have to move.
  //
  // They must move in opposite senses whenever the route doubles back, or the
  // lanes cross instead of nesting. Two same-shaped routes offset identically at
  // both ends intersect exactly once; inverting the middle run's offset by
  // sign(Δx)·sign(Δy) is what unpicks that. Zero deltas can't produce a crossing
  // either way, so they take +1 rather than collapsing the offset to nothing.
  const laneOffset = orthogonalLaneOffset(
    options.curveInfo, options.laneSpacing ?? 0, sDims, dDims, sSide, dSide
  );
  const trunkOffset = -laneOffset * (Math.sign(relDx) || 1) * (Math.sign(relDy) || 1);

  // Which offset the DESTINATION port takes depends on what the middle run is.
  // Between two same-orientation sides the run is a separate trunk and the dest
  // port is a lane end like the source's; between perpendicular sides there is
  // no trunk — the route's single corner IS the middle run, and the dest port
  // is the coordinate that positions it.
  const parallelSides = initOrient === finalOrient;
  const sLanePort = offsetPortAlongSide(sPort, sSide, laneOffset);
  const dLanePort = offsetPortAlongSide(dPort, dSide, parallelSides ? laneOffset : trunkOffset);

  const startX = sLanePort.x;
  const startY = sLanePort.y;
  const endX = dLanePort.x;
  const endY = dLanePort.y;

  // Use the same bend logic as rendering
  let effectiveBends = (manhattanBends === 'auto')
    ? (parallelSides ? 'two' : 'one')
    : manhattanBends;

  // A one-bend route between two same-orientation sides turns at a coordinate
  // taken straight from the destination port's own side, which every lane in a
  // bundle shares — the ports separate but the long run between them doesn't.
  // Only the two-bend form has a trunk that can carry the offset, so a bundle
  // gets it even when the user asked for one bend.
  if (laneOffset !== 0 && parallelSides) effectiveBends = 'two';

  // Generate path points based on bend type
  let pathPoints;
  if (effectiveBends === 'two' && parallelSides) {
    if (initOrient === 'H') {
      // HVH pattern
      const midX = (startX + endX) / 2 + trunkOffset;
      pathPoints = [
        { x: startX, y: startY },
        { x: midX, y: startY },
        { x: midX, y: endY },
        { x: endX, y: endY }
      ];
    } else {
      // VHV pattern
      const midY = (startY + endY) / 2 + trunkOffset;
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

// Below this the cap doesn't apply at all — the tangents get exactly the arc
// they asked for. ~57°, which covers all but the most extreme demands.
const LINEAR_TANGENT_CHORD = 1.0;

/**
 * Apply the tangent-chord cap WITHOUT saturating.
 *
 * A hard clamp is not usable here, because it is not injective: two arcs whose
 * tangents demand different extreme bows both land on exactly MAX_TANGENT_CHORD
 * and come out as the same circle. For a bundle of connections between one pair
 * of nodes that is fatal — the whole point of the fan is that its members
 * demand different bows, and at high vertex degree several of those demands are
 * extreme. They would clamp together and draw as a single line.
 *
 * So keep the cap exact below the knee and compress everything above it into
 * the sliver that remains, asymptotically rather than abruptly. Strictly
 * increasing over the whole range, so distinct demands stay distinct arcs.
 */
function capTangentChord(delta) {
  const magnitude = Math.abs(delta);
  if (magnitude <= LINEAR_TANGENT_CHORD) return delta;
  const over = magnitude - LINEAR_TANGENT_CHORD;
  const room = MAX_TANGENT_CHORD - LINEAR_TANGENT_CHORD;
  return Math.sign(delta) * (LINEAR_TANGENT_CHORD + room * (over / (over + room)));
}

// Smallest bow, in canvas pixels, worth drawing as an arc rather than a line.
//
// This is a PERFORMANCE floor as much as a visual one. An arc's radius is
// L / (2 sin δ), so as δ approaches zero the radius runs away — a 600px edge
// with a quarter-degree bow wants a radius in the millions. That arc is
// pixel-identical to a straight line, but it is not free: SVG arc rendering
// derives the circle centre from the endpoints and the radius, which is
// numerically ill-conditioned when the radius dwarfs the chord.
//
// Below this, emit a line. Whatever survives has a bow you can actually see,
// and a radius bounded by roughly L²/(8·MIN_VISIBLE_BOW).
export const MIN_VISIBLE_BOW = 0.4;

// How far a label's baseline must actually bend ON SCREEN, in CSS pixels,
// before it is worth curving. Shared by the settled render (NodeCanvas) and the
// live drag updater (useNodeDrag) so the two agree — see `labelCurveMinBow`.
//
// ZERO on purpose: curve every label whose connection curves, at every zoom.
// This briefly went to 8 to buy frames back by shedding curves, and that worked
// — but it was treating the symptom. The reason curved labels were expensive was
// that every character carried an exact, unique rotation matrix, and bucketing
// those (see CURVED_GLYPH_ANGLE_QUANTUM) takes 40 curved labels from 15.2ms to
// 8.4ms — the frame floor. With the cost gone there is no reason left to
// straighten anything, so this went back down.
//
// It stopped at 0.6 first, and 0.6 was still wrong for a reason worth recording:
// ANY positive value here makes the threshold zoom-dependent (see
// labelCurveMinBow), which makes the CURVED/STRAIGHT DECISION zoom-dependent —
// so zooming out far enough popped the flattest label or two from curved to
// straight mid-gesture. Sub-pixel or not, that is a visible discontinuity in the
// one interaction this whole rewrite exists to make smooth, and it is also a
// form change landing mid-drag, which the drag updater then has to chase. At 0
// the floor is a constant MIN_VISIBLE_BOW and the decision depends only on the
// geometry, so nothing about a label changes because the viewer moved.
//
// Which restores the original argument, now with a measurement behind it rather
// than an assumption: labels following their arcs IS Lombardi, and the count of
// curves is the wrong thing to economise on. What actually costs frames is
// distinct glyph matrices, and that is the quantum's job.
//
// `window.__labelCurveMinPx` overrides at runtime if a graph ever does want
// curves shed — the lever still works, it is just no longer the first resort.
export const LABEL_CURVE_MIN_SCREEN_PX = 0;

/**
 * The bow, in canvas units, a label must clear at this zoom before it curves.
 *
 * Converts the on-screen threshold back into canvas space by dividing out the
 * zoom, so the test is "can the viewer see this bend" rather than "is it big in
 * canvas coordinates". At the default threshold of 0 that conversion is inert
 * and this is the constant floor below — deliberately, per
 * LABEL_CURVE_MIN_SCREEN_PX. The zoom term is still here because the runtime
 * override needs it: a graph that does want curves shed wants them shed by what
 * the viewer can see, not by canvas units.
 *
 * Floors at MIN_VISIBLE_BOW: past that, solveLombardiArc already emitted a
 * straight line, so there is nothing left to curve either way.
 */
export function labelCurveMinBow(zoom) {
  const override = (typeof window !== 'undefined') ? Number(window.__labelCurveMinPx) : NaN;
  const px = (Number.isFinite(override) && override >= 0) ? override : LABEL_CURVE_MIN_SCREEN_PX;
  return Math.max(MIN_VISIBLE_BOW, px / Math.max(zoom, 0.01));
}

// The angle bucket curved labels snap their per-glyph rotations into.
//
// This is the whole reason curved labels are affordable, and it is a SEPARATE
// number from the canvas-wide `labelAngleQuantum` for a reason worth stating:
// that one switches off below 48 edges, and curved labels only exist below 40,
// so in the regime where curving happens the canvas-wide quantum is always
// zero. Curved labels were paying exact, unique rotations for every character
// precisely because nothing was left to bucket them.
//
// Measured (Electron 39, EmOne 59.4px, 1400x900, zoom sweep, median frame):
//
//     40 curved labels, exact angles ....  15.2 ms
//     40 curved labels, 4° buckets .....    8.4 ms   <- frame floor
//     40 curved labels, 9° buckets .....    8.3 ms
//
// 4° rather than 9° deliberately. A straight label snapped by q tilts as a
// whole and nobody notices; a curved one snaps each character independently, so
// neighbouring glyphs can land in different buckets and the text reads slightly
// wobbly along the arc instead of flowing. 4° halves the worst-case tilt to 2°
// and still collapses several hundred distinct matrices into a few dozen — the
// table above shows it already at the frame floor, so the extra precision is
// free. Raise toward 9 only if a measurement says the buckets are still the
// bottleneck; the win is nearly all in the first step away from exact.
//
// `window.__curvedGlyphQuantum` overrides at runtime (0 = exact angles).
export const CURVED_GLYPH_ANGLE_QUANTUM = 4;

/**
 * The rotation bucket a curved label's glyphs should snap to, given whatever
 * the canvas-wide quantum currently is. Takes the coarser of the two: a dense
 * canvas that has already decided on 9° shouldn't have curved labels quietly
 * rendering finer than everything around them.
 */
export function curvedGlyphQuantum(canvasQuantum = 0) {
  const override = (typeof window !== 'undefined') ? Number(window.__curvedGlyphQuantum) : NaN;
  const base = (Number.isFinite(override) && override >= 0) ? override : CURVED_GLYPH_ANGLE_QUANTUM;
  return Math.max(base, canvasQuantum || 0);
}

// Distance (local units) from the arrowhead polygon's origin to its tip.
//
// The polygon is "-26,34 26,34 0,-34", rendered as
// translate(origin) rotate(angle+90) scale(cw): under rotate(+90) the local -Y
// axis (the tip) maps to world direction `angle`, so the tip lands at
//   origin + cw * POLY_TIP * (cos angle, sin angle)
// and the back edge at the mirror of that, cw * POLY_TIP the other way.
//
// Lives here rather than in parallelEdgeUtils.js (which re-exports it) only
// because that module imports from this one, so this is the end of the chain
// both the straight/curved placement and the Lombardi placement can reach.
// One definition: the JSX polygon and every back-off calculation have to agree.
export const POLY_TIP = 34;

// Half the connection stroke width (27px) — the radius of the round line-cap.
// A line bulges this far past its geometric endpoint, so a trim has to stop
// this much short of the arrowhead's back edge to stay hidden under it.
export const ARROW_CAP_RADIUS = 13.5;

/**
 * How far back along its route a Lombardi connection's visible stroke stops,
 * measured from the node border, so its round cap ends flush with the
 * arrowhead's rear edge instead of poking out through the point.
 *
 * The arrowhead itself is NOT placed with this — see computeLombardiRouting,
 * which anchors the tip on the border and backs the polygon's origin off along
 * the tangent, exactly as getCurvedArrowPlacement does for curved edges.
 *
 * Both used to share one flat constant (44) with no connection-width term at
 * all. The polygon scales with width and the constant did not, so the tip
 * drifted by POLY_TIP px for every 1.0 on the Connection Width slider: 35px
 * clear of the border at 0.25x, and 92px INSIDE the node at 4x, while every
 * other routing style held its arrows on the border.
 */
export function lombardiLineTrim(connectionWidth = 1) {
  return (2 * POLY_TIP - ARROW_CAP_RADIUS) * (connectionWidth || 1);
}

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
    // Bearings tie only for edges running to the SAME neighbour — a bundle of
    // parallel connections. Their slots are consumed (a bundle of three still
    // takes three of this node's k directions, so the rest of the fan spaces
    // itself correctly around them) but not used: lombardiArcFor fans a bundle
    // explicitly, because no tie-break here can guarantee its members separate.
    // See BUNDLE_LANE_FRACTION. The tie still breaks by edge id so slots stay
    // put across renders.
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
  const delta = capTangentChord(((alpha - beta) / 2) * curvature);

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
export function lombardiArcFor(edge, sourceNode, destNode, sDims, dDims, tangents, curvature = 1, options = {}) {
  const p = { x: sourceNode.x + sDims.currentWidth / 2, y: sourceNode.y + sDims.currentHeight / 2 };
  const q = { x: destNode.x + dDims.currentWidth / 2, y: destNode.y + dDims.currentHeight / 2 };
  const chord = Math.atan2(q.y - p.y, q.x - p.x);

  const bundled = (options.curveInfo?.totalInPair ?? 1) > 1;
  let thetaP;
  let thetaQ;

  if (bundled) {
    // A BUNDLE IS FANNED EXPLICITLY, NOT BY ITS TANGENT SLOTS.
    //
    // Perfect angular resolution has nothing to say about parallel connections:
    // they all run to the same neighbour on the same bearing, so which of the
    // node's k directions each one gets is arbitrary — and the arithmetic makes
    // it worse than arbitrary. An arc's deviation from the chord is
    // δ = (α − β)/2 with α and β independently wrapped into (−π, π], so
    // consecutive members' deviations repeat with period 2π/(stepA + stepB):
    // equal-degree endpoints put every member on the SAME circle, and a node of
    // degree four or more repeats every other member. Both draw the bundle as
    // one line.
    //
    // So bow each member by a set amount instead, symmetrically about the chord
    // — the lens that both the straight styles and Lombardi's own drawings use
    // for a repeated relation. Solving δ from a target sagitta rather than
    // fixing the angle keeps the fan the same WIDTH on a short connection as on
    // a long one, which is what makes the members separately readable and
    // separately clickable at any distance.
    // The bow is measured FROM THE CHORD, so it is chord-relative and the rank
    // has to be read in the bundle's shared frame — otherwise a connection drawn
    // B→A bows to the same side as its A→B sibling and the pair coincides. See
    // bundleFrameSign.
    const chordLength = Math.hypot(q.x - p.x, q.y - p.y);
    const bow = parallelLaneRank(options.curveInfo)
      * (options.laneSpacing ?? 0)
      * bundleFrameSign(p, q);
    const half = chordLength > 1e-6 ? 2 * Math.atan((2 * bow) / chordLength) : 0;
    thetaP = chord + half;
    thetaQ = chord - half + Math.PI;
  } else {
    const assigned = tangents?.get?.(lombardiEdgeKey(edge));
    thetaP = assigned?.sourceAngle ?? chord;
    thetaQ = assigned?.destAngle ?? (chord + Math.PI);
  }

  const solved = solveLombardiArc(p, q, thetaP, thetaQ, curvature);
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
export const LABEL_PATH_SLACK = 1.4;

/**
 * The path a label used to ride, as a <textPath>. NOTHING RENDERS THIS ANY MORE
 * — `labelArcGlyphFrames` places the glyphs directly, for the reasons in its own
 * comment. What this is still for is saying, executably, WHICH labels curve:
 * both functions decide that through the same `solveLabelArcFrame`, and the
 * parity test in labelGlyphFrames.test.js holds them to it. If you delete this,
 * delete that test with it and the guards lose their reference.
 *
 * The label follows a circle CONCENTRIC with the edge's arc, at whatever radius
 * the placement chose — so a label nudged off the line to dodge something still
 * curves the same way the line does, just at a slightly different radius.
 *
 * @param {object} arc - from solveLombardiArc
 * @param {{x:number,y:number}} anchor - the chosen label position
 * @param {number} textWidth - estimated rendered width
 * @param {object} [options] - `span` supplies the path length directly, bypassing
 *   the slack multiplier below.
 * @returns {{d: string, sweep: number, radius: number}|null}
 */
/**
 * The circle a label rides and the direction it reads along it — everything
 * both label renderers need before they diverge into a path or into glyphs.
 *
 * @param {object} arc - from solveLombardiArc; only its CENTRE is used, since
 *   the label sits on a concentric circle through `anchor`, not on the edge's
 *   own arc.
 * @param {{x:number,y:number}} anchor - the chosen label position
 * @param {number} span - length of the text along the circle
 * @returns {{radius:number, mid:number, sweep:number, dir:number}|null} `mid` is
 *   the anchor's bearing from the centre, `dir` +1/-1 is the direction the text
 *   advances in, and null means "don't curve this label" (the caller's fallback
 *   is a straight one).
 */
function solveLabelArcFrame(arc, anchor, span, options = {}) {
  if (!arc || !anchor || !(span > 0)) return null;
  const maxSweep = options.maxSweep ?? MAX_LABEL_SWEEP;

  const dx = anchor.x - arc.cx;
  const dy = anchor.y - arc.cy;
  const radius = Math.hypot(dx, dy);
  if (!(radius > 1)) return null;

  const sweep = span / radius;
  if (!(sweep > 0) || sweep > maxSweep) return null;
  // How far the text's baseline actually departs from a straight one over its
  // own length. Below a pixel the two are the same picture — and this is the
  // case where the radius is enormous. A straight label is then the identical
  // result for less: one glyph matrix shared by the whole label instead of one
  // per character, and no per-glyph trig.
  //
  // `options.minBow` lets the caller raise this floor. The renderer sets it from
  // the zoom level, so the test becomes "is this bend visible ON SCREEN" rather
  // than "is it visible in canvas coordinates" — at low zoom a 3px canvas bow is
  // sub-pixel to the viewer, and not worth spending distinct glyph rotations on.
  // See CONNECTION LABEL RENDERING BUDGETS in NodeCanvas.
  if ((span * sweep) / 8 < (options.minBow ?? MIN_VISIBLE_BOW)) return null;

  const mid = Math.atan2(dy, dx);
  const half = sweep / 2;
  const at = (a) => ({ x: arc.cx + radius * Math.cos(a), y: arc.cy + radius * Math.sin(a) });

  // Text runs from a0 to a1, so the direction of travel decides whether it reads
  // upright or upside down. Pick the one heading rightward — and for a
  // near-vertical label, downward — which is the same rule the straight labels
  // use when they flip to stay readable.
  const readsUpright = (a0, a1) => {
    const p0 = at(a0);
    const p1 = at(a1);
    const runX = p1.x - p0.x;
    return Math.abs(runX) > 1e-6 ? runX > 0 : p1.y - p0.y > 0;
  };
  const dir = readsUpright(mid - half, mid + half) ? 1 : -1;

  return { radius, mid, sweep, dir };
}

export function labelArcPath(arc, anchor, textWidth, options = {}) {
  const span = options.span ?? (textWidth > 0 ? textWidth * (options.slack ?? LABEL_PATH_SLACK) : 0);
  const frame = solveLabelArcFrame(arc, anchor, span, options);
  if (!frame) return null;

  const { radius, mid, sweep, dir } = frame;
  const half = sweep / 2;
  const at = (a) => ({ x: arc.cx + radius * Math.cos(a), y: arc.cy + radius * Math.sin(a) });
  const a0 = mid - dir * half;
  const a1 = mid + dir * half;

  const p0 = at(a0);
  const p1 = at(a1);
  const sweepFlag = a1 > a0 ? 1 : 0;
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
 * Where each glyph of a curved label goes, so the renderer can place them
 * itself with SVG's per-character x/y/rotate lists.
 *
 * WHY NOT <textPath>
 * ──────────────────
 * A <textPath> is re-solved on every paint: the browser re-parameterises the
 * path by arc length and re-places every glyph along it, and none of that is
 * cached across frames. It is the single most expensive thing on this canvas
 * (500 labels measured at 1145ms/frame — see CONNECTION LABEL RENDERING BUDGETS
 * in NodeCanvas), and it is worst exactly when the view is being zoomed, because
 * scaling invalidates the text layout the parameterisation depends on.
 *
 * A circle needs none of that machinery. The positions are closed-form, so we
 * compute them once per render and hand the browser ordinary positioned glyphs.
 * That also makes the rotations quantizable (the same trick that made rotated
 * labels affordable in the first place) and lets curved and straight labels be
 * the SAME element, so crossing the bow threshold is an attribute change rather
 * than an unmount.
 *
 * The glyphs' CENTRES sit on the circle; `x`/`y` are the baseline origins SVG
 * wants, which is the centre walked back half an advance along the glyph's own
 * rotated direction. Rotations are quantized BEFORE that offset is computed, so
 * a quantized glyph still lands exactly on the circle.
 *
 * @param {object} arc - from solveLombardiArc (centre only, as above)
 * @param {{x:number,y:number}} anchor - the chosen label position
 * @param {number[]} advances - per-glyph advance widths in px, in render order
 * @param {object} [options] - `minBow`/`maxSweep` as for labelArcPath, plus
 *   `rotationQuantum` in degrees (0 = exact angles)
 * @returns {{x:number[], y:number[], rotate:number[], span:number,
 *            sweep:number, radius:number}|null}
 */
export function labelArcGlyphFrames(arc, anchor, advances, options = {}) {
  if (!Array.isArray(advances) || advances.length === 0) return null;
  let span = 0;
  for (let i = 0; i < advances.length; i++) {
    const w = advances[i];
    if (!(w >= 0) || !Number.isFinite(w)) return null;
    span += w;
  }

  const frame = solveLabelArcFrame(arc, anchor, span, options);
  if (!frame) return null;
  const { radius, mid, dir, sweep } = frame;

  const quantum = options.rotationQuantum ?? 0;
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;

  const x = new Array(advances.length);
  const y = new Array(advances.length);
  const rotate = new Array(advances.length);

  // Distance from the label's midpoint to the centre of the glyph being placed.
  // Starts half a span behind and walks forward one advance at a time.
  let cursor = -span / 2;
  for (let i = 0; i < advances.length; i++) {
    const w = advances[i];
    const angle = mid + (dir * (cursor + w / 2)) / radius;
    const cx = arc.cx + radius * Math.cos(angle);
    const cy = arc.cy + radius * Math.sin(angle);

    // Reading direction is the tangent, which is the radius turned a quarter
    // turn the way the text advances.
    let deg = angle * DEG + dir * 90;
    // Wrap into (-180, 180] before snapping, so the buckets are the same ones
    // the straight labels use and don't drift with winding.
    deg = ((((deg + 180) % 360) + 360) % 360) - 180;
    if (quantum > 0) deg = Math.round(deg / quantum) * quantum;

    const rad = deg * RAD;
    x[i] = cx - (w / 2) * Math.cos(rad);
    y[i] = cy - (w / 2) * Math.sin(rad);
    rotate[i] = deg;

    cursor += w;
  }

  return { x, y, rotate, span, sweep, radius };
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

/** The whole arc is visible — the answer whenever there is nothing to clip against. */
const FULL_ARC_RANGE = Object.freeze({ t0: 0, t1: 1 });

/** Below this fraction of the arc a "visible" range is too short to place into. */
const MIN_VISIBLE_ARC_FRACTION = 0.05;

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
  const { p, q, chord, arc } = lombardiArcFor(
    edge, sourceNode, destNode, sDims, dDims, tangents, curvature,
    { curveInfo: options.curveInfo, laneSpacing: options.laneSpacing }
  );

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

  // Each end's real occluder: a thing-group anchor hands us the GROUP's full
  // outer box, which is vastly bigger than the anchor node's own hitbox. Resolved
  // lazily because most edges never need either one.
  let sBoxCache = null;
  let dBoxCache = null;
  const sourceBox = () => (sBoxCache ??=
    options.sourceBounds || getNodeHitbox(sourceNode, sDims, !!selected?.has?.(sourceNode.id)));
  const destBox = () => (dBoxCache ??=
    options.destBounds || getNodeHitbox(destNode, dDims, !!selected?.has?.(destNode.id)));

  // Sampling is only needed to find where the arc crosses a node's box, which
  // in turn is only needed for an END THAT HAS AN ARROW, or for a caller that
  // asks for the visible range below. Hit-testing and the pie-menu anchor want
  // only the circle, and never pay for it.
  if (hasSourceArrow || hasDestArrow) {
    const sBox = sourceBox();
    const dBox = destBox();
    const fullPoints = arc ? sampleArc(arc) : [p, q];

    const cw = options.connectionWidth || 1;
    const lineTrim = lombardiLineTrim(cw);

    // Where an end sits after retreating `dist` from its node border.
    //
    // On an arc the retreat is measured as ARC LENGTH rather than as distance
    // along the sampled chords, which always undershoot the curve. The error is
    // invisible for a small back-off, but this one scales with connection width
    // and at 4x it is most of a node wide. Stepping in arc parameter is exact,
    // cheaper, and independent of how densely the arc happened to be sampled.
    const retreatFrom = (fromStart, box, dist) => {
      const border = trimRouteEnd(fullPoints, box, fromStart, 0).endpoint;
      if (!arc || !(arc.radius > 0) || arc.sweep === 0) {
        return trimRouteEnd(fullPoints, box, fromStart, dist).endpoint;
      }
      const step = dist / (arc.radius * Math.abs(arc.sweep));
      const t0 = arcParamOf(arc, border);
      return arcPointAt(arc, fromStart ? Math.min(1, t0 + step) : Math.max(0, t0 - step));
    };

    // Tangent-following arrowheads, anchored by their TIP.
    //
    // The tip goes on the node border and the polygon's origin is backed off
    // from it along the tangent — the same contract getCurvedArrowPlacement
    // uses, and the only one that survives both the width slider and a tight
    // bow. Retreating along the CURVE by the triangle's own length instead
    // leaves the tip off the border by the arc's sagitta, because the triangle
    // that then draws forward from there is straight: correct at low curvature,
    // and several pixels adrift exactly where the curve is most pronounced.
    const headingAt = (pt) => (arc ? arcPointAt(arc, arcParamOf(arc, pt)).angle : chord * (180 / Math.PI));
    const arrowFor = (fromStart, box, reverse) => {
      const tip = trimRouteEnd(fullPoints, box, fromStart, 0).endpoint;
      const angle = (reverse ? headingAt(tip) + 180 : headingAt(tip));
      const rad = angle * (Math.PI / 180);
      return {
        x: tip.x - cw * POLY_TIP * Math.cos(rad),
        y: tip.y - cw * POLY_TIP * Math.sin(rad),
        angle,
      };
    };

    // The line retreats FURTHER than the arrowhead's origin — back to where the
    // triangle's rear edge is — so the stroke's round cap ends flush under it.
    // Trimming to the origin instead (which is what sharing one constant with
    // the arrow amounted to) left the cap sitting at the polygon's centre,
    // fine at width 1 and increasingly visible either side of it.
    //
    // The drawn endpoints come from the same exact arc-length retreat the
    // arrowheads use — pathD is built from them — while `points` stays the
    // chord-trimmed polyline, which is all its consumers (label placement,
    // hit-testing) need and all they can use.
    //
    // The polyline is chord-trimmed but then has its own end REPLACED by the
    // exact one, so `points` still starts and ends exactly where the drawn path
    // does. Everything downstream depends on that agreeing — rebuildRoutedPath
    // reconstructs the hover trim from points[0] and points[last], and would
    // otherwise redraw the connection a fraction off its settled position the
    // moment you hovered it.
    points = fullPoints;
    if (hasSourceArrow) {
      points = trimRouteEnd(points, sBox, true, lineTrim).points;
      startPt = retreatFrom(true, sBox, lineTrim);
      points = [startPt, ...points.slice(1)];
      sourceArrow = arrowFor(true, sBox, true);
    }
    if (hasDestArrow) {
      points = trimRouteEnd(points, dBox, false, lineTrim).points;
      endPt = retreatFrom(false, dBox, lineTrim);
      points = [...points.slice(0, -1), endPt];
      destArrow = arrowFor(false, dBox, false);
    }
  }

  const from = startPt;
  const to = endPt;

  let visibleRange = null;

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
    /**
     * The stretch of the arc the reader can actually SEE, in arc parameters.
     *
     * An arrow-less end stops at its node's centre and is covered by the node
     * body, so the drawn curve is always a sub-range of [0,1] — and anything
     * positioning itself "in the middle of the connection" has to mean the
     * middle of THAT, not of the full centre-to-centre arc.
     *
     * Between two ordinary nodes the difference is a node-radius at each end and
     * nobody notices. Against a THING-GROUP anchor it is the difference between
     * on the line and nowhere near it: the occluder is the group's entire outer
     * box, so most of the arc can be hidden, and a label at the arc's own
     * midpoint lands deep inside the group with no connection under it.
     *
     * Lazy, and only the label placer reads it — an edge whose name is hidden
     * pays nothing.
     */
    get visibleRange() {
      if (visibleRange) return visibleRange;
      if (!arc) return (visibleRange = FULL_ARC_RANGE);
      const full = sampleArc(arc);
      const t0 = arcParamOf(arc, trimRouteEnd(full, sourceBox(), true, 0).endpoint);
      const t1 = arcParamOf(arc, trimRouteEnd(full, destBox(), false, 0).endpoint);
      // Degenerate (overlapping nodes, or a group box that swallows the whole
      // arc): a sliver gives the placer nothing to work with, and the full range
      // at least keeps the label near its connection.
      visibleRange = (t1 - t0) > MIN_VISIBLE_ARC_FRACTION ? { t0, t1 } : FULL_ARC_RANGE;
      return visibleRange;
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
