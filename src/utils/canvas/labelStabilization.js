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

/**
 * How far the angle may drift before the position deadband stops holding.
 *
 * The deadband freezes position AND angle together, which is right as long as
 * they move together. They don't always: a long connection whose far end swings
 * pivots the line about a label that barely moves, so the label can need a
 * several-degree correction while its centre travels under 5px. Releasing on
 * either one keeps a held label from lying about its own direction.
 */
const ANGLE_THRESHOLD = 1; // degrees

/** Shortest angular distance between two bearings, in degrees. */
const angleDistance = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

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
  if (distance < POSITION_THRESHOLD
      && angleDistance(angle, cached.lastAngle) < ANGLE_THRESHOLD) {
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

  // The angle is the placement's, unmodified.
  //
  // It used to be snapped to the nearest multiple of 15 degrees whenever it fell
  // within 5 of one — which is two thirds of all angles, tilted by up to 5
  // degrees each. A label is drawn along the connection it names, so that is not
  // stabilization, it is a deliberate mismatch between a label and its own line:
  // a connection running at -26 degrees got a label drawn at -30. Long labels
  // made it obvious, since the same tilt displaces the ends further the wider the
  // text; on a straight Lombardi connection, where there is no curve to disguise
  // it, the label visibly crossed the line it was supposed to sit on.
  //
  // Its stated purpose — stopping labels wiggling near horizontal and vertical —
  // is already served twice over, and by mechanisms that don't lie about the
  // direction. describeSegments assigns axis-aligned segments an EXACT 0 or 90
  // rather than the measured atan2, so there is no float noise there to damp;
  // and quantizeLabelAngle in NodeCanvas buckets rotations for the glyph atlas
  // against a stated on-screen error budget, with the bucket size snapped onto a
  // divisor of 90 precisely so that 0 and 90 survive untouched.
  const smoothAngle = angle;

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
