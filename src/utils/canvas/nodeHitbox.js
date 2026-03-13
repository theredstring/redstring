/**
 * Node Hitbox Calculation Utilities
 * Provides accurate visual bounds calculation for nodes including selection stroke,
 * line-node intersection, and visual connection endpoint resolution.
 */

/**
 * Calculate exact visual hitbox bounds for a node
 * Accounts for base dimensions, visual inset, and selection stroke extension
 *
 * @param {Object} node - Node instance with x, y coordinates
 * @param {Object} dims - Dimensions from getNodeDimensions() with currentWidth/currentHeight
 * @param {boolean} isSelected - Whether node is selected (adds 8px stroke)
 * @returns {Object} { minX, minY, maxX, maxY } - Rectangular bounds
 */
export const getNodeHitbox = (node, dims, isSelected = false) => {
  // Visual inset: Node background rect is positioned at (x+6, y+6) with dimensions (width-12, height-12)
  // This creates a 6px visual inset on all sides (from Node.jsx rendering)
  const VISUAL_INSET = 6;

  // Selection stroke is 12px wide (from Node.jsx: strokeWidth={12})
  // The stroke is centered on the rect edge, so it extends 6px outward from the visual boundary
  const strokeExtension = isSelected ? 6 : 0;

  return {
    minX: node.x + VISUAL_INSET - strokeExtension,
    minY: node.y + VISUAL_INSET - strokeExtension,
    maxX: node.x + dims.currentWidth - VISUAL_INSET + strokeExtension,
    maxY: node.y + dims.currentHeight - VISUAL_INSET + strokeExtension
  };
};

/**
 * Calculate intersection point of a line with a rectangular node bounds
 * Uses ray-AABB (Axis-Aligned Bounding Box) intersection
 *
 * @param {number} x1, y1 - Line start point (ray origin)
 * @param {number} x2, y2 - Line end point (defines ray direction)
 * @param {Object} hitbox - Node hitbox { minX, minY, maxX, maxY }
 * @param {number} cornerRadius - Corner radius for visual accuracy (default 40px)
 * @returns {Object} { x, y } - Intersection point, or center if line starts inside
 */
export const getLineNodeIntersection = (x1, y1, x2, y2, hitbox, cornerRadius = 40) => {
  const { minX, minY, maxX, maxY } = hitbox;

  // Calculate rectangle center (fallback if line starts inside)
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Calculate ray direction
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Handle zero-length ray
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: centerX, y: centerY };
  }

  // Check if start point is inside the rectangle
  const startInside = x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY;

  if (startInside) {
    // Ray starts inside - find exit point
    // Calculate intersection parameters for all four sides
    const tRight = dx !== 0 ? (maxX - x1) / dx : Infinity;
    const tLeft = dx !== 0 ? (minX - x1) / dx : Infinity;
    const tBottom = dy !== 0 ? (maxY - y1) / dy : Infinity;
    const tTop = dy !== 0 ? (minY - y1) / dy : Infinity;

    // Find smallest positive t (closest exit point in ray direction)
    const validT = [tRight, tLeft, tBottom, tTop].filter(t => t > 0.001);

    if (validT.length === 0) {
      return { x: centerX, y: centerY };
    }

    const tExit = Math.min(...validT);
    return {
      x: x1 + dx * tExit,
      y: y1 + dy * tExit
    };
  } else {
    // Ray starts outside - find entry point
    // Calculate intersection parameters for all four sides
    const tRight = dx !== 0 ? (maxX - x1) / dx : -Infinity;
    const tLeft = dx !== 0 ? (minX - x1) / dx : -Infinity;
    const tBottom = dy !== 0 ? (maxY - y1) / dy : -Infinity;
    const tTop = dy !== 0 ? (minY - y1) / dy : -Infinity;

    // For entry, we want the largest t_min (where ray enters)
    const tMinX = Math.min(tLeft, tRight);
    const tMaxX = Math.max(tLeft, tRight);
    const tMinY = Math.min(tTop, tBottom);
    const tMaxY = Math.max(tTop, tBottom);

    const tEntry = Math.max(tMinX, tMinY);
    const tExit = Math.min(tMaxX, tMaxY);

    // Check if ray intersects the rectangle
    if (tEntry > tExit || tExit < 0) {
      // No intersection - return closest point on rectangle edge
      const clampedX = Math.max(minX, Math.min(maxX, x1));
      const clampedY = Math.max(minY, Math.min(maxY, y1));
      return { x: clampedX, y: clampedY };
    }

    // Return entry point (or exit if entry is behind ray origin)
    const t = tEntry >= 0 ? tEntry : tExit;
    return {
      x: x1 + dx * t,
      y: y1 + dy * t
    };
  }
};

/**
 * Get visual connection endpoints on node edges (not centers)
 * For straight/curved connections that should draw to node boundaries
 *
 * @param {Object} sourceNode - Source node with x, y coordinates
 * @param {Object} targetNode - Target node with x, y coordinates
 * @param {Object} sourceDims - Source dimensions from getNodeDimensions()
 * @param {Object} targetDims - Target dimensions from getNodeDimensions()
 * @param {boolean} sourceSelected - Whether source is selected
 * @param {boolean} targetSelected - Whether target is selected
 * @param {boolean} applyInset - Whether to apply 4px inset for arrow spacing (default true)
 * @returns {Object} { x1, y1, x2, y2 } - Visual connection endpoints
 */
export const getVisualConnectionEndpoints = (
  sourceNode,
  targetNode,
  sourceDims,
  targetDims,
  sourceSelected = false,
  targetSelected = false,
  applyInset = true
) => {
  // Calculate center-to-center line (conceptual connection)
  const centerX1 = sourceNode.x + sourceDims.currentWidth / 2;
  const centerY1 = sourceNode.y + sourceDims.currentHeight / 2;
  const centerX2 = targetNode.x + targetDims.currentWidth / 2;
  const centerY2 = targetNode.y + targetDims.currentHeight / 2;

  // Get accurate hitboxes (includes selection stroke if selected)
  const sourceHitbox = getNodeHitbox(sourceNode, sourceDims, sourceSelected);
  const targetHitbox = getNodeHitbox(targetNode, targetDims, targetSelected);

  // Find intersection points where line exits source and enters target
  // From source center toward target center - where does it exit source?
  const start = getLineNodeIntersection(
    centerX1, centerY1,  // Source center (ray origin)
    centerX2, centerY2,  // Target center (ray direction)
    sourceHitbox
  );

  // From target center toward source center - where does it exit target?
  const end = getLineNodeIntersection(
    centerX2, centerY2,  // Target center (ray origin)
    centerX1, centerY1,  // Source center (ray direction)
    targetHitbox
  );

  // For label placement, we want true edge positions without inset
  if (!applyInset) {
    return {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y
    };
  }

  // Apply small inset (4px) to move endpoints inward for better visual spacing
  // This prevents arrows from touching the exact node edge
  const ARROW_INSET = 4;

  // Calculate direction from intersection to center and move inward
  const dx1 = centerX1 - start.x;
  const dy1 = centerY1 - start.y;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const insetStart = len1 > 0 ? {
    x: start.x + (dx1 / len1) * ARROW_INSET,
    y: start.y + (dy1 / len1) * ARROW_INSET
  } : start;

  const dx2 = centerX2 - end.x;
  const dy2 = centerY2 - end.y;
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  const insetEnd = len2 > 0 ? {
    x: end.x + (dx2 / len2) * ARROW_INSET,
    y: end.y + (dy2 / len2) * ARROW_INSET
  } : end;

  return {
    x1: insetStart.x,
    y1: insetStart.y,
    x2: insetEnd.x,
    y2: insetEnd.y
  };
};
