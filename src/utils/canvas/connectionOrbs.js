/**
 * Connection endpoint "orbs" — the direction toggles that appear at each end of
 * a hovered or selected connection. An end with no arrow draws a dot; an end
 * with one draws the arrowhead itself. Acting on either toggles that end's
 * arrow, which is how directionality is authored on the canvas.
 *
 * The hit test lives out here rather than inside NodeCanvas because two input
 * paths ask the same question and must get the same answer: a finger tapping an
 * orb, and the controller's crosshair deciding what A is standing on. If those
 * two ever disagree — different radius, different tie-break — the same aim
 * toggles an arrow on one device and selects the connection on the other, which
 * is exactly the class of inconsistency that is impossible to attribute.
 *
 * Orb positions are written per render by renderConnectionEdge into a
 * Map<edgeId, orb[]> (see connectionOrbHitsRef), in CANVAS space. Callers do
 * their own client→canvas conversion first.
 */

/**
 * The orb nearest (px, py) that the point actually lands on, or null.
 *
 * Nearest-wins rather than first-wins: two connections meeting at the same node
 * put their orbs within a radius of each other, and "whichever edge happened to
 * render first" is not an answer the user can predict.
 *
 * @param {Map<string, Array<{cx:number, cy:number, r:number, edgeId:string, nodeId:string}>>} orbsByEdge
 * @param {number} px canvas-space x
 * @param {number} py canvas-space y
 * @param {number} padding multiplier on each orb's radius. 1 is the disc as
 *   drawn (what a crosshair or cursor aims at); touch passes more than 1,
 *   because a finger is both wider and less precise than either.
 * @returns {{cx:number, cy:number, r:number, edgeId:string, nodeId:string} | null}
 */
export const nearestConnectionOrb = (orbsByEdge, px, py, padding = 1) => {
  if (!orbsByEdge || orbsByEdge.size === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const orbs of orbsByEdge.values()) {
    if (!orbs) continue;
    for (const orb of orbs) {
      const dist = Math.hypot(px - orb.cx, py - orb.cy);
      if (dist <= orb.r * padding && dist < bestDist) {
        best = orb;
        bestDist = dist;
      }
    }
  }
  return best;
};

/**
 * Padding for a finger. Slightly generous so a tap that lands just outside the
 * transparent hit disc still registers.
 */
export const ORB_HIT_PADDING_TOUCH = 1.15;
