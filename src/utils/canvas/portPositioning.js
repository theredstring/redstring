/**
 * Port positioning utilities for edge routing
 */

/** Smallest gap between two ports on the same side before they read as one. */
const MIN_LANE_SPACING = 6;

/** How close to a node's corner a spilled port is still allowed to sit. */
const MIN_CORNER_CLEARANCE = 6;

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
 * @param {number} [sideCount] - How many edges share this side in total. Needed
 *   to size the fan; without it the spacing cannot be compressed to fit and
 *   ports have to be folded back on top of each other instead. Defaults to just
 *   enough to contain the given index.
 * @returns {Object} Staggered port position with x, y
 */
export function calculateStaggeredPosition(basePort, side, edgeUsageIndex, dims, cornerRadius, cleanLaneSpacing = 24, sideCount = edgeUsageIndex + 1) {
  // Calculate available straight-edge space (avoiding rounded corners)
  const segmentLength = basePort.segmentEnd - basePort.segmentStart;
  const safeMargin = 12; // Additional margin from corners for visual clarity
  const usableLength = segmentLength - (safeMargin * 2);

  // A lone connection belongs on the middle of its side, whatever the geometry.
  if (sideCount <= 1) return basePort;

  // Use user spacing preference but adapt to available space
  const preferredSpacing = Math.max(100, cleanLaneSpacing);

  // Distribute OUTWARD FROM THE SIDE MIDPOINT, alternating sides:
  // index 0 → center, 1 → +1 lane, 2 → −1 lane, 3 → +2 lanes, ...
  //
  // This function previously measured every position from segmentStart, which
  // put a lone port at the START of the usable band rather than its middle —
  // the "single port - use center" comment described an intent the arithmetic
  // never implemented. With two ports it was worse: evenSpacing spanned the
  // full band, so index 0 and index 1 landed on the far LEFT and far RIGHT of
  // the side with nothing in the middle. That is why connections attached to
  // the top and bottom of a node straddled the center instead of meeting it.
  const rank = Math.ceil(edgeUsageIndex / 2) * (edgeUsageIndex % 2 === 1 ? 1 : -1);

  // The lane count used to come from how many ports fit at the preferred
  // spacing, and the index was taken MODULO it — so a side carrying more edges
  // than that wrapped, and edge 0 and edge N landed on the exact same port.
  // Between one pair of nodes that is the whole bug: several connections, one
  // visible line. Size the fan from the edges actually present instead and
  // compress the spacing until they fit, so distinct edges keep distinct ports
  // however many of them there are.
  const maxRank = Math.ceil((sideCount - 1) / 2);

  // Two bands, and the fan prefers the first:
  //
  //   - the corner-avoiding one this function has always used, which keeps
  //     ports on the straight part of the side where a connection meets the
  //     outline cleanly;
  //   - the node's actual half-side, which a port may spill toward when the
  //     first is too small to hold the fan. Short sides on a node with a large
  //     corner radius leave a usable band of zero, and there the preferred band
  //     alone would stack every port at the exact midpoint — the collapse this
  //     whole change exists to prevent.
  //
  // Overflowing toward the corner is a small cosmetic cost. Two connections
  // drawn as one line is not cosmetic.
  const sideLength = (side === 'left' || side === 'right') ? dims.currentHeight : dims.currentWidth;
  const hardHalf = Math.max(0, sideLength / 2 - MIN_CORNER_CLEARANCE);
  const preferredHalf = Math.max(0, usableLength / 2);
  const half = Math.max(preferredHalf, Math.min(hardHalf, maxRank * MIN_LANE_SPACING));
  const laneSpacing = maxRank > 0 ? Math.min(preferredSpacing, half / maxRank) : 0;
  const offsetFromCenter = rank * laneSpacing;

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
