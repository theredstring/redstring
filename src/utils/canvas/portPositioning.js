/**
 * Port positioning utilities for edge routing
 */

/**
 * Get base port position on a node side (respecting rounded corners)
 * @param {Object} node - Node with x, y coordinates
 * @param {Object} dims - Dimensions object with currentWidth and currentHeight
 * @param {string} side - Side of the node ('top', 'bottom', 'left', 'right')
 * @param {number} cornerRadius - Corner radius of the node
 * @returns {Object} Port position with x, y, segmentStart, and segmentEnd
 */
export function getPortPosition(node, dims, side, cornerRadius) {
  // Ensure we respect the actual corner radius (40px) and don't allow ports too close to corners
  const r = Math.min(cornerRadius, Math.min(dims.currentWidth, dims.currentHeight) / 2);
  const cornerBuffer = 8; // Additional buffer beyond the corner radius for visual clarity
  const effectiveCornerSize = r + cornerBuffer;

  // Position ports on the straight edge segments, with comprehensive corner avoidance
  switch (side) {
    case 'top':
      return {
        x: node.x + dims.currentWidth / 2,
        y: node.y,
        // Available segment excludes corners with buffer
        segmentStart: node.x + effectiveCornerSize,
        segmentEnd: node.x + dims.currentWidth - effectiveCornerSize
      };
    case 'bottom':
      return {
        x: node.x + dims.currentWidth / 2,
        y: node.y + dims.currentHeight,
        segmentStart: node.x + effectiveCornerSize,
        segmentEnd: node.x + dims.currentWidth - effectiveCornerSize
      };
    case 'left':
      return {
        x: node.x,
        y: node.y + dims.currentHeight / 2,
        segmentStart: node.y + effectiveCornerSize,
        segmentEnd: node.y + dims.currentHeight - effectiveCornerSize
      };
    case 'right':
      return {
        x: node.x + dims.currentWidth,
        y: node.y + dims.currentHeight / 2,
        segmentStart: node.y + effectiveCornerSize,
        segmentEnd: node.y + dims.currentHeight - effectiveCornerSize
      };
    default:
      return { x: node.x + dims.currentWidth / 2, y: node.y + dims.currentHeight / 2 };
  }
}

/**
 * Calculate staggered position along an edge to distribute connections
 * @param {Object} basePort - Base port position with x, y, segmentStart, segmentEnd
 * @param {string} side - Side of the node
 * @param {number} edgeUsageIndex - Index of edge usage for distribution
 * @param {Object} dims - Dimensions object
 * @param {number} cornerRadius - Corner radius
 * @param {number} cleanLaneSpacing - Preferred spacing between connections
 * @returns {Object} Staggered port position with x, y
 */
export function calculateStaggeredPosition(basePort, side, edgeUsageIndex, dims, cornerRadius, cleanLaneSpacing = 24) {
  // Calculate available straight-edge space (avoiding rounded corners)
  const segmentLength = basePort.segmentEnd - basePort.segmentStart;
  const safeMargin = 12; // Additional margin from corners for visual clarity
  const usableLength = segmentLength - (safeMargin * 2);

  if (usableLength <= 0) {
    // Not enough space for distribution, use center
    return basePort;
  }

  // Use user spacing preference but adapt to available space
  const preferredSpacing = Math.max(100, cleanLaneSpacing);

  // Calculate how many ports can fit with preferred spacing
  const idealPortCount = Math.floor(usableLength / preferredSpacing) + 1;
  const actualPortCount = Math.max(1, idealPortCount);

  // Distribute OUTWARD FROM THE SIDE MIDPOINT, alternating sides:
  // slot 0 → center, 1 → +1 lane, 2 → −1 lane, 3 → +2 lanes, ...
  //
  // This function previously measured every position from segmentStart, which
  // put a lone port at the START of the usable band rather than its middle —
  // the "single port - use center" comment described an intent the arithmetic
  // never implemented. With two ports it was worse: evenSpacing spanned the
  // full band, so index 0 and index 1 landed on the far LEFT and far RIGHT of
  // the side with nothing in the middle. That is why connections attached to
  // the top and bottom of a node straddled the center instead of meeting it.
  const slot = ((edgeUsageIndex % actualPortCount) + actualPortCount) % actualPortCount;
  const rank = Math.ceil(slot / 2) * (slot % 2 === 1 ? 1 : -1);
  const laneSpacing = actualPortCount > 1 ? usableLength / (actualPortCount - 1) : 0;

  // Clamp to the usable band so the outermost lanes can't escape into the
  // rounded corners when the fan is wider than the straight edge.
  const halfBand = usableLength / 2;
  const offsetFromCenter = Math.max(-halfBand, Math.min(halfBand, rank * laneSpacing));

  // basePort.x/y is the exact midpoint of this side, and the usable band is
  // symmetric about it, so offsetting from the base port keeps slot 0 centered.
  switch (side) {
    case 'top':
    case 'bottom':
      return {
        x: basePort.x + offsetFromCenter,
        y: basePort.y
      };
    case 'left':
    case 'right':
      return {
        x: basePort.x,
        y: basePort.y + offsetFromCenter
      };
    default:
      return basePort;
  }
}
