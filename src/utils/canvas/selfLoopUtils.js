const SELF_LOOP_BASE_RADIUS = 45;
const SELF_LOOP_STEP_RADIUS = 32;
const SELF_LOOP_HALF_GAP_DEG = 45;

export function getSelfLoopRadius(pairIndex = 0) {
  return SELF_LOOP_BASE_RADIUS + pairIndex * SELF_LOOP_STEP_RADIUS;
}

/**
 * Compute the SVG arc geometry for a self-referential edge.
 *
 * The arc is anchored on the node's rounded top-left corner: two points straddle the
 * corner's outward diagonal (pointing up-and-to-the-left), and the arc bulges outward
 * along that diagonal. Multiple self-loops on the same node stack at increasing radii
 * via `curveInfo.pairIndex`.
 *
 * Returns:
 *   path                  — SVG path "d" string
 *   anchorA               — endpoint on the LEFT side of the corner (source/tail convention)
 *   anchorB               — endpoint on the TOP side of the corner (destination/head convention)
 *   arrowAngleA/B         — degrees; direction pointing INTO the node from that anchor
 *   loopCx, loopCy, radius — loop-circle geometry, used for hit-testing
 *   outwardAngle          — angle (radians, screen coords) of the diagonal from corner to outside
 *   wedgeHalfAngle        — half-angle (radians) of the minor-arc wedge the arc does NOT cover,
 *                           measured at the loop circle center
 */
export function calculateSelfLoopPath(nodeX, nodeY, nodeW, nodeH, curveInfo) {
  const pairIndex = curveInfo?.pairIndex ?? 0;
  const R = getSelfLoopRadius(pairIndex);

  const cornerR = Math.min(nodeW, nodeH) / 2;
  const cornerCx = nodeX + cornerR;
  const cornerCy = nodeY + cornerR;

  const outwardAngle = Math.atan2(-1, -1); // screen-coords: up-and-left diagonal = 225° = 5π/4
  const outX = Math.cos(outwardAngle);
  const outY = Math.sin(outwardAngle);

  const halfGap = (SELF_LOOP_HALF_GAP_DEG * Math.PI) / 180;
  const angleA = outwardAngle - halfGap;
  const angleB = outwardAngle + halfGap;

  const anchorA = {
    x: cornerCx + cornerR * Math.cos(angleA),
    y: cornerCy + cornerR * Math.sin(angleA),
  };
  const anchorB = {
    x: cornerCx + cornerR * Math.cos(angleB),
    y: cornerCy + cornerR * Math.sin(angleB),
  };

  const chordHalfLen = cornerR * Math.sin(halfGap);
  const midX = (anchorA.x + anchorB.x) / 2;
  const midY = (anchorA.y + anchorB.y) / 2;

  const centerOffset = Math.sqrt(Math.max(0, R * R - chordHalfLen * chordHalfLen));
  const loopCx = midX + centerOffset * outX;
  const loopCy = midY + centerOffset * outY;

  // Major arc from A outward to B. SVG: large-arc-flag=1, sweep-flag=0 gives the arc on the
  // outward side (CCW in screen terms).
  const path = `M ${anchorA.x},${anchorA.y} A ${R},${R} 0 1,0 ${anchorB.x},${anchorB.y}`;

  // Arrow at an anchor points INTO the node along the line from anchor to corner center.
  const arrowAngleA = Math.atan2(cornerCy - anchorA.y, cornerCx - anchorA.x) * (180 / Math.PI);
  const arrowAngleB = Math.atan2(cornerCy - anchorB.y, cornerCx - anchorB.x) * (180 / Math.PI);

  const wedgeHalfAngle = Math.asin(Math.min(1, chordHalfLen / R));

  return {
    path,
    anchorA,
    anchorB,
    arrowAngleA,
    arrowAngleB,
    loopCx,
    loopCy,
    radius: R,
    outwardAngle,
    wedgeHalfAngle,
    cornerR,
  };
}

export function distanceToSelfLoop(px, py, nodeX, nodeY, nodeW, nodeH, curveInfo) {
  const geom = calculateSelfLoopPath(nodeX, nodeY, nodeW, nodeH, curveInfo);
  const dx = px - geom.loopCx;
  const dy = py - geom.loopCy;
  const distToCenter = Math.sqrt(dx * dx + dy * dy);
  // Exclude the minor-arc wedge (the slice of the loop circle closest to the node that we
  // don't actually draw). That wedge is centered on the inward direction (outwardAngle + π).
  const pointAngle = Math.atan2(dy, dx);
  const inwardAngle = geom.outwardAngle + Math.PI;
  let diff = pointAngle - inwardAngle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) < geom.wedgeHalfAngle) return Infinity;
  return Math.abs(distToCenter - geom.radius);
}

export function countSelfLoopsForNode(edges, instanceId) {
  let n = 0;
  edges.forEach((edge) => {
    if (edge.sourceId === instanceId && edge.destinationId === instanceId) n += 1;
  });
  return n;
}
