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
  if (!curveInfo || curveInfo.totalInPair <= 1) {
    // Single edge - return straight line
    return {
      type: 'line',
      startX,
      startY,
      endX,
      endY
    };
  }

  const { pairIndex, totalInPair } = curveInfo;
  const curveSpacing = 100; // Pixels between parallel edge curves - EXAGGERATED CURVES
  console.log('calculateParallelEdgePath called with spacing:', curveSpacing, 'curveInfo:', curveInfo);

  // KEY FIX: Alternate curve direction based on index
  // Even indices (0, 2, 4...) curve one way, odd indices (1, 3, 5...) curve the opposite way
  const direction = pairIndex % 2 === 0 ? 1 : -1;

  // Calculate offset magnitude: 0, 1, 2... for pairs (0,1), (2,3), (4,5)...
  const offsetMagnitude = Math.floor((pairIndex + 1) / 2) * curveSpacing;
  const perpOffset = direction * offsetMagnitude;

  // Calculate perpendicular direction vector
  const edgeDx = endX - startX;
  const edgeDy = endY - startY;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

  if (edgeLen === 0) {
    // Degenerate case - same start and end point
    return {
      type: 'line',
      startX,
      startY,
      endX,
      endY
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
    apexY
  };
}

