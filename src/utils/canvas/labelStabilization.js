/**
 * Label Position Stabilization
 * Prevents label jitter during interactions by caching positions
 * and applying smoothing to small movements.
 *
 * This module implements the missing stabilizeLabelPosition() function
 * that is called throughout NodeCanvas.jsx but was never defined.
 */

// Internal cache: edgeId -> { lastX, lastY, lastAngle, timestamp }
const stabilizationCache = new Map();

// Stabilization parameters
const POSITION_THRESHOLD = 5; // px - don't update if moved less than this
const ANGLE_SNAP_THRESHOLD = 5; // degrees - snap if within this range
const ANGLE_SNAP_INCREMENT = 15; // degrees - snap to multiples of this

/**
 * Stabilize label position to prevent jitter during interactions
 * Uses velocity-based smoothing and distance thresholds
 *
 * @param {string} edgeId - Edge identifier
 * @param {number} x - Proposed x position
 * @param {number} y - Proposed y position
 * @param {number} angle - Proposed angle in degrees
 * @returns {Object} { x, y, angle } - Stabilized position
 */
export const stabilizeLabelPosition = (edgeId, x, y, angle) => {
  const cached = stabilizationCache.get(edgeId);

  if (!cached) {
    // First time seeing this edge - store and return as-is
    stabilizationCache.set(edgeId, {
      lastX: x,
      lastY: y,
      lastAngle: angle,
      timestamp: Date.now()
    });
    return { x, y, angle };
  }

  // Calculate distance moved
  const dx = x - cached.lastX;
  const dy = y - cached.lastY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // If small movement, return cached position (prevent jitter)
  if (distance < POSITION_THRESHOLD) {
    return {
      x: cached.lastX,
      y: cached.lastY,
      angle: cached.lastAngle
    };
  }

  // Past the deadband, adopt the requested position outright.
  //
  // This used to lerp 30% of the way toward the target and write the lerped
  // value back to the cache. That only converges if something re-invokes it every
  // frame — nothing does. It is called once per React render, so a label whose
  // placement changed (routing style switched, node moved, text changed) settled
  // permanently 70% short of where it belonged, hovering off its own connection.
  // The 5px deadband above is the actual anti-jitter mechanism; the lerp was
  // never anything but lag.
  const smoothX = x;
  const smoothY = y;

  // Snap angle to nearest increment if close
  // This prevents labels from wiggling at near-horizontal/vertical angles
  let smoothAngle = angle;
  const nearestSnap = Math.round(angle / ANGLE_SNAP_INCREMENT) * ANGLE_SNAP_INCREMENT;
  if (Math.abs(angle - nearestSnap) < ANGLE_SNAP_THRESHOLD) {
    smoothAngle = nearestSnap;
  }

  // Update cache with new stabilized position
  stabilizationCache.set(edgeId, {
    lastX: smoothX,
    lastY: smoothY,
    lastAngle: smoothAngle,
    timestamp: Date.now()
  });

  return {
    x: smoothX,
    y: smoothY,
    angle: smoothAngle
  };
};

/**
 * Clear stabilization cache
 * Call this when layout changes significantly:
 * - Auto-layout triggered
 * - Zoom level changes significantly
 * - Graph switches (activeGraphId changes)
 * - Manual layout reset
 */
export const clearLabelStabilization = () => {
  stabilizationCache.clear();
};

/**
 * Clear stabilization for a specific edge
 * Useful when an edge is deleted or its endpoints change dramatically
 *
 * @param {string} edgeId - Edge identifier to clear
 */
export const clearEdgeStabilization = (edgeId) => {
  stabilizationCache.delete(edgeId);
};

/**
 * Get current cache size (for debugging)
 * @returns {number} Number of cached label positions
 */
export const getStabilizationCacheSize = () => {
  return stabilizationCache.size;
};
