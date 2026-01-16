/**
 * Utilities for calculating parallel edge paths with curve offsets
 * Ensures multiple edges between the same nodes curve in opposite directions
 */

/**
 * Calculate minimum distance from point (px, py) to quadratic Bezier curve
 * Uses sampling approach for simplicity (exact solution requires solving cubic)
 * @param {number} px - Point X coordinate
 * @param {number} py - Point Y coordinate
 * @param {number} x0 - Start point X (P0)
 * @param {number} y0 - Start point Y (P0)
 * @param {number} cx - Control point X (P1)
 * @param {number} cy - Control point Y (P1)
 * @param {number} x1 - End point X (P2)
 * @param {number} y1 - End point Y (P2)
 * @param {number} samples - Number of samples along the curve (default 20)
 * @returns {number} Minimum distance from point to curve
 */
export function distanceToQuadraticBezier(px, py, x0, y0, cx, cy, x1, y1, samples = 20) {
  let minDist = Infinity;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Quadratic Bezier: B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
    const invT = 1 - t;
    const bx = invT * invT * x0 + 2 * invT * t * cx + t * t * x1;
    const by = invT * invT * y0 + 2 * invT * t * cy + t * t * y1;

    const dx = px - bx;
    const dy = py - by;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) minDist = dist;
  }

  return minDist;
}

/**
 * Get point at parameter t on quadratic Bézier curve
 * @param {number} t - Parameter value (0 to 1)
 * @param {number} x0 - Start point X (P0)
 * @param {number} y0 - Start point Y (P0)
 * @param {number} cx - Control point X (P1)
 * @param {number} cy - Control point Y (P1)
 * @param {number} x1 - End point X (P2)
 * @param {number} y1 - End point Y (P2)
 * @returns {Object} Point { x, y } at parameter t
 */
export function getPointOnQuadraticBezier(t, x0, y0, cx, cy, x1, y1) {
  const invT = 1 - t;
  return {
    x: invT * invT * x0 + 2 * invT * t * cx + t * t * x1,
    y: invT * invT * y0 + 2 * invT * t * cy + t * t * y1
  };
}

/**
 * Generate a trimmed Bézier path from t=tStart to t=tEnd
 * Uses de Casteljau's algorithm to subdivide the curve while maintaining the same shape
 * @param {number} x0 - Start point X (P0)
 * @param {number} y0 - Start point Y (P0)
 * @param {number} cx - Control point X (P1)
 * @param {number} cy - Control point Y (P1)
 * @param {number} x1 - End point X (P2)
 * @param {number} y1 - End point Y (P2)
 * @param {number} tStart - Start parameter (0 to 1)
 * @param {number} tEnd - End parameter (0 to 1)
 * @returns {Object} Trimmed path info
 */
export function getTrimmedBezierPath(x0, y0, cx, cy, x1, y1, tStart = 0, tEnd = 1) {
  // Handle edge cases
  if (tStart >= tEnd || tStart < 0 || tEnd > 1) {
    return {
      path: `M ${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`,
      startX: x0,
      startY: y0,
      ctrlX: cx,
      ctrlY: cy,
      endX: x1,
      endY: y1
    };
  }

  // De Casteljau's algorithm: First trim from 0 to tEnd, then from relative tStart to 1
  // This gives us the subcurve from tStart to tEnd

  // Step 1: Split at tEnd to get curve from 0 to tEnd
  // First level of subdivision
  const p01x_end = x0 + tEnd * (cx - x0);
  const p01y_end = y0 + tEnd * (cy - y0);
  const p12x_end = cx + tEnd * (x1 - cx);
  const p12y_end = cy + tEnd * (y1 - cy);
  // Second level - the point at tEnd
  const endPtX = p01x_end + tEnd * (p12x_end - p01x_end);
  const endPtY = p01y_end + tEnd * (p12y_end - p01y_end);

  // The curve from 0 to tEnd has control point p01_end
  const newCx_0toEnd = p01x_end;
  const newCy_0toEnd = p01y_end;

  // Step 2: Now split this subcurve (from 0 to tEnd) at relative position tStart/tEnd
  const relT = tStart / tEnd;

  // First level for the 0-to-tEnd curve
  const q01x = x0 + relT * (newCx_0toEnd - x0);
  const q01y = y0 + relT * (newCy_0toEnd - y0);
  const q12x = newCx_0toEnd + relT * (endPtX - newCx_0toEnd);
  const q12y = newCy_0toEnd + relT * (endPtY - newCy_0toEnd);

  // Second level - the point at tStart on original curve
  const startPtX = q01x + relT * (q12x - q01x);
  const startPtY = q01y + relT * (q12y - q01y);

  // The curve from tStart to tEnd uses q12 as its control point
  const finalCx = q12x;
  const finalCy = q12y;

  return {
    path: `M ${startPtX} ${startPtY} Q ${finalCx} ${finalCy} ${endPtX} ${endPtY}`,
    startX: startPtX,
    startY: startPtY,
    ctrlX: finalCx,
    ctrlY: finalCy,
    endX: endPtX,
    endY: endPtY
  };
}

/**
 * Calculate the control point for a curved parallel edge
 * @param {number} startX - Start X coordinate
 * @param {number} startY - Start Y coordinate
 * @param {number} endX - End X coordinate
 * @param {number} endY - End Y coordinate
 * @param {Object} curveInfo - Curve info: { pairIndex, totalInPair }
 * @returns {Object|null} Control point { ctrlX, ctrlY } or null if straight line
 */
export function calculateCurveControlPoint(startX, startY, endX, endY, curveInfo) {
  if (!curveInfo || curveInfo.totalInPair <= 1) {
    return null;
  }

  const { pairIndex, totalInPair } = curveInfo;
  const curveSpacing = 100;

  const edgeDx = endX - startX;
  const edgeDy = endY - startY;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

  if (edgeLen === 0) {
    return null;
  }

  const centerIndex = (totalInPair - 1) / 2;
  const offsetSteps = pairIndex - centerIndex;
  const perpOffset = offsetSteps * curveSpacing;

  // Normalize perpendicular direction for consistent curve direction
  const useCanonical = startX !== endX ? (startX <= endX) : (startY <= endY);
  const normDx = useCanonical ? edgeDx : -edgeDx;
  const normDy = useCanonical ? edgeDy : -edgeDy;

  const perpX = -normDy / edgeLen;
  const perpY = normDx / edgeLen;

  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const ctrlX = midX + perpX * perpOffset;
  const ctrlY = midY + perpY * perpOffset;

  return { ctrlX, ctrlY };
}

/**
 * Calculate the path for an edge, applying curve offset if it's part of a parallel edge pair
 * @param {number} startX - Start X coordinate
 * @param {number} startY - Start Y coordinate
 * @param {number} endX - End X coordinate
 * @param {number} endY - End Y coordinate
 * @param {Object|null} curveInfo - Curve info from edgeCurveInfo map: { pairIndex, totalInPair }
 * @returns {Object} Path object with type ('line' or 'curve'), path string, and control point
 */
export function calculateParallelEdgePath(startX, startY, endX, endY, curveInfo) {
  // Calculate edge vector for angle calculation (needed for both line and curve)
  const edgeDx = endX - startX;
  const edgeDy = endY - startY;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
  const labelAngle = Math.atan2(edgeDy, edgeDx) * (180 / Math.PI);

  if (!curveInfo || curveInfo.totalInPair <= 1) {
    // Single edge - return straight line with midpoint for label
    return {
      type: 'line',
      path: `M ${startX} ${startY} L ${endX} ${endY}`,
      startX,
      startY,
      endX,
      endY,
      ctrlX: null,
      ctrlY: null,
      apexX: (startX + endX) / 2,
      apexY: (startY + endY) / 2,
      labelAngle
    };
  }

  const { pairIndex, totalInPair } = curveInfo;
  const curveSpacing = 100; // Pixels between parallel edge curves

  // SYMMETRICAL DISTRIBUTION: Distribute edges symmetrically around the center axis
  // For 2 edges: centerIndex=0.5, offsets=[-0.5, +0.5] * spacing
  // For 3 edges: centerIndex=1, offsets=[-1, 0, +1] * spacing
  // For 4 edges: centerIndex=1.5, offsets=[-1.5, -0.5, +0.5, +1.5] * spacing
  const centerIndex = (totalInPair - 1) / 2;
  const offsetSteps = pairIndex - centerIndex;
  const perpOffset = offsetSteps * curveSpacing;

  if (edgeLen === 0) {
    // Degenerate case - same start and end point
    return {
      type: 'line',
      path: `M ${startX} ${startY} L ${endX} ${endY}`,
      startX,
      startY,
      endX,
      endY,
      ctrlX: null,
      ctrlY: null,
      apexX: startX,
      apexY: startY,
      labelAngle: 0
    };
  }

  // CRITICAL: Normalize perpendicular direction so all edges in a pair curve consistently
  // Without this, edges going A→B vs B→A would have opposite perpendicular vectors
  // and would curve in the same visual direction instead of opposite
  // We use a canonical direction: always compute perp as if going from min(start,end) to max
  const useCanonical = startX !== endX ? (startX <= endX) : (startY <= endY);
  const normDx = useCanonical ? edgeDx : -edgeDx;
  const normDy = useCanonical ? edgeDy : -edgeDy;

  // Perpendicular unit vector (rotated 90 degrees counter-clockwise from canonical direction)
  const perpX = -normDy / edgeLen;
  const perpY = normDx / edgeLen;

  // Control point at midpoint, offset perpendicular to edge
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const ctrlX = midX + perpX * perpOffset;
  const ctrlY = midY + perpY * perpOffset;

  // Generate quadratic Bezier path
  const path = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;

  // Calculate apex (t=0.5 on Quadratic Bezier) for label positioning
  // B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2
  const apexX = 0.25 * startX + 0.5 * ctrlX + 0.25 * endX;
  const apexY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;

  return {
    type: 'curve',
    path,
    ctrlX,
    ctrlY,
    startX,
    startY,
    endX,
    endY,
    apexX,
    apexY,
    labelAngle
  };
}

