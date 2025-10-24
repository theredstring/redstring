/**
 * Geometry and coordinate transformation utilities for canvas operations
 */

import { getNodeDimensions } from '../../utils.js';

/**
 * Transforms client/screen coordinates to canvas coordinates
 * @param {number} clientX - X coordinate in client/screen space
 * @param {number} clientY - Y coordinate in client/screen space
 * @param {Object} containerRect - Container bounding rectangle
 * @param {Object} panOffset - Current pan offset {x, y}
 * @param {number} zoomLevel - Current zoom level
 * @param {Object} canvasSize - Canvas size object with offsetX, offsetY
 * @returns {{x: number, y: number}} Coordinates in canvas space
 */
export function clientToCanvasCoordinates(clientX, clientY, containerRect, panOffset, zoomLevel, canvasSize) {
  if (!containerRect) return { x: 0, y: 0 };

  // Transform: (client - container offset - pan) / zoom + canvas offset
  const x = (clientX - containerRect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
  const y = (clientY - containerRect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;

  return { x, y };
}

/**
 * Clamp coordinates to canvas bounds
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} canvasSize - Canvas size with offsetX, offsetY, width, height
 * @returns {{x: number, y: number}} Clamped coordinates
 */
export function clampCoordinates(x, y, canvasSize) {
  const boundedX = Math.min(Math.max(x, canvasSize.offsetX), canvasSize.offsetX + canvasSize.width);
  const boundedY = Math.min(Math.max(y, canvasSize.offsetY), canvasSize.offsetY + canvasSize.height);
  return { x: boundedX, y: boundedY };
}

/**
 * Check if a point is inside a node's bounds
 * @param {Object} nodeData - Node object with x, y, scale
 * @param {number} clientX - Client X coordinate
 * @param {number} clientY - Client Y coordinate
 * @param {Object} containerRect - Container bounding rectangle
 * @param {Object} panOffset - Pan offset {x, y}
 * @param {number} zoomLevel - Zoom level
 * @param {Object} canvasSize - Canvas size
 * @param {string|null} previewingNodeId - ID of node being previewed
 * @returns {boolean} True if point is inside node
 */
export function isInsideNode(nodeData, clientX, clientY, containerRect, panOffset, zoomLevel, canvasSize, previewingNodeId = null) {
  if (!containerRect || !nodeData) return false;

  const scaledX = (clientX - containerRect.left - panOffset.x) / zoomLevel + canvasSize.offsetX;
  const scaledY = (clientY - containerRect.top - panOffset.y) / zoomLevel + canvasSize.offsetY;

  // Get base dimensions
  const { currentWidth, currentHeight } = getNodeDimensions(nodeData, previewingNodeId === nodeData.id, null);

  // Apply node scale if it exists (for dragged nodes)
  const nodeScale = nodeData.scale || 1;
  const scaledWidth = currentWidth * nodeScale;
  const scaledHeight = currentHeight * nodeScale;

  const nodeX = nodeData.x;
  const nodeY = nodeData.y;

  // Calculate the center point for scaling
  const centerX = nodeX + currentWidth / 2;
  const centerY = nodeY + currentHeight / 2;

  // Calculate scaled bounds centered on the original center
  const scaledNodeX = centerX - scaledWidth / 2;
  const scaledNodeY = centerY - scaledHeight / 2;

  return (
    scaledX >= scaledNodeX &&
    scaledX <= scaledNodeX + scaledWidth &&
    scaledY >= scaledNodeY &&
    scaledY <= scaledNodeY + scaledHeight
  );
}

/**
 * Fast line-rectangle intersection test for edge culling
 * Uses Cohen-Sutherland-like quick reject/accept
 * @param {number} x1 - Line start X
 * @param {number} y1 - Line start Y
 * @param {number} x2 - Line end X
 * @param {number} y2 - Line end Y
 * @param {Object} rect - Rectangle with minX, maxX, minY, maxY
 * @returns {boolean} True if line intersects rectangle
 */
export function lineIntersectsRect(x1, y1, x2, y2, rect) {
  const left = rect.minX, right = rect.maxX, top = rect.minY, bottom = rect.maxY;

  // Trivial accept if any endpoint inside
  if (x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) return true;
  if (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom) return true;

  // Compute line deltas
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Helper to test intersection with a vertical boundary
  const intersectsVertical = (x) => {
    if (dx === 0) return false;
    const t = (x - x1) / dx;
    if (t < 0 || t > 1) return false;
    const y = y1 + t * dy;
    return y >= top && y <= bottom;
  };

  // Helper to test intersection with a horizontal boundary
  const intersectsHorizontal = (y) => {
    if (dy === 0) return false;
    const t = (y - y1) / dy;
    if (t < 0 || t > 1) return false;
    const x = x1 + t * dx;
    return x >= left && x <= right;
  };

  return (
    intersectsVertical(left) ||
    intersectsVertical(right) ||
    intersectsHorizontal(top) ||
    intersectsHorizontal(bottom)
  );
}

/**
 * Snap coordinates to grid
 * @param {number} mouseX - Mouse X in canvas coordinates
 * @param {number} mouseY - Mouse Y in canvas coordinates
 * @param {number} nodeWidth - Width of node being snapped
 * @param {number} nodeHeight - Height of node being snapped
 * @param {string} gridMode - Grid mode ('off', 'hover', 'always')
 * @param {number} gridSize - Grid cell size
 * @returns {{x: number, y: number}} Snapped coordinates
 */
export function snapToGrid(mouseX, mouseY, nodeWidth, nodeHeight, gridMode, gridSize) {
  if (gridMode === 'off') {
    return { x: mouseX, y: mouseY };
  }

  // Snap to grid vertices - use Math.floor to ensure mouse snaps to grid line above
  const nearestGridX = Math.floor(mouseX / gridSize) * gridSize;
  const nearestGridY = Math.floor(mouseY / gridSize) * gridSize;

  // Calculate snapped position - center the node on the grid vertex
  // This ensures the node's center (where text is) aligns with grid intersections
  const snappedX = nearestGridX - (nodeWidth / 2);
  const snappedY = nearestGridY - (nodeHeight / 2);

  return { x: snappedX, y: snappedY };
}

/**
 * Snap coordinates to grid with optional animation
 * @param {number} mouseX - Mouse X in canvas coordinates
 * @param {number} mouseY - Mouse Y in canvas coordinates
 * @param {number} nodeWidth - Width of node being snapped
 * @param {number} nodeHeight - Height of node being snapped
 * @param {Object|null} currentPos - Current position for animation {x, y}
 * @param {string} gridMode - Grid mode ('off', 'hover', 'always')
 * @param {number} gridSize - Grid cell size
 * @returns {{x: number, y: number}} Snapped coordinates (possibly animated)
 */
export function snapToGridAnimated(mouseX, mouseY, nodeWidth, nodeHeight, currentPos, gridMode, gridSize) {
  if (gridMode === 'off') {
    return { x: mouseX, y: mouseY };
  }

  const snapped = snapToGrid(mouseX, mouseY, nodeWidth, nodeHeight, gridMode, gridSize);

  // In grid mode, always snap instantly for precise positioning
  if (gridMode === 'hover' || gridMode === 'always') {
    return snapped;
  }

  // Only apply animation in off mode if we have a current position
  if (currentPos && gridMode === 'off') {
    const snapAnimationFactor = 0.4; // Quick snap (0.3 = slower, 0.6 = faster)
    const animatedX = currentPos.x + (snapped.x - currentPos.x) * snapAnimationFactor;
    const animatedY = currentPos.y + (snapped.y - currentPos.y) * snapAnimationFactor;

    return { x: animatedX, y: animatedY };
  }

  return snapped;
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value  
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Inflate (expand) rectangle by padding on all sides
 * @param {Object} rect - Rectangle with x, y, width, height
 * @param {number} pad - Padding amount
 * @returns {Object} Expanded rectangle
 */
export function inflateRect(rect, pad) {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2
  };
}

/**
 * Check if line segment intersects any rectangles in array
 * @param {number} x1 - Line start X
 * @param {number} y1 - Line start Y
 * @param {number} x2 - Line end X
 * @param {number} y2 - Line end Y
 * @param {Array} rects - Array of rectangles to check
 * @returns {boolean} True if line intersects any rectangle
 */
export function segmentIntersectsAnyRect(x1, y1, x2, y2, rects) {
  return rects.some((r) => {
    return lineIntersectsRect(x1, y1, x2, y2, r);
  });
}

/**
 * Calculate minimum distance from point to rectangle
 * @param {number} x - Point X coordinate
 * @param {number} y - Point Y coordinate
 * @param {Object} rect - Rectangle with x, y, width, height
 * @returns {number} Distance (0 if point inside rectangle)
 */
export function pointToRectDistance(x, y, rect) {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if rectangle intersects any in obstacle list
 * @param {Object} rect - Rectangle to test with x, y, width, height
 * @param {Array} obstacles - Array of obstacle rectangles
 * @returns {boolean} True if intersection found
 */
export function rectIntersectsAny(rect, obstacles) {
  return obstacles.some(obs => {
    return !(rect.x > obs.x + obs.width || rect.x + rect.width < obs.x ||
             rect.y > obs.y + obs.height || rect.y + rect.height < obs.y);
  });
}
