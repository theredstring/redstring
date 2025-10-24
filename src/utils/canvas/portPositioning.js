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

  // If we have multiple ports, distribute them evenly across available space
  let position;
  if (actualPortCount === 1) {
    // Single port - use center
    position = 0;
  } else {
    // Multiple ports - distribute evenly with slight variations to prevent perfect overlap
    const evenSpacing = usableLength / (actualPortCount - 1);
    const basePosition = (edgeUsageIndex % actualPortCount) * evenSpacing;

    // Add small deterministic variation based on port position to prevent perfect alignment
    // Use port coordinates for stable hash regardless of edge order
    const portHash = Math.abs((basePort.x * 23 + basePort.y * 19) % 7); // 0-6
    const variation = (portHash - 3) * 2; // -6 to +6 pixel variation

    position = basePosition + variation;
  }

  // Convert relative position to absolute coordinates
  const offsetFromStart = Math.max(0, Math.min(usableLength, position));

  switch (side) {
    case 'top':
    case 'bottom':
      return {
        x: basePort.segmentStart + safeMargin + offsetFromStart,
        y: basePort.y
      };
    case 'left':
    case 'right':
      return {
        x: basePort.x,
        y: basePort.segmentStart + safeMargin + offsetFromStart
      };
    default:
      return basePort;
  }
}
