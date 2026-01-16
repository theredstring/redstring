/**
 * Utilities for calculating parallel edge paths with curve offsets
 * Ensures multiple edges between the same nodes curve in opposite directions
 */

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

  // Perpendicular unit vector (rotated 90 degrees counter-clockwise)
  const perpX = -edgeDy / edgeLen;
  const perpY = edgeDx / edgeLen;

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

