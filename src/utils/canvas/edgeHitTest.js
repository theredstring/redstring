/**
 * Which connection is under a canvas point (P4.01), moved verbatim from
 * NodeCanvas. NodeCanvas passes its render-time view of the graph as `scene`;
 * everything else here is pure.
 */
import { NODE_HEIGHT } from '../../constants';
import { distanceToPolyline, edgeHitScore } from './geometryUtils.js';
import { distanceToQuadraticBezier, calculateCurveControlPoint } from './parallelEdgeUtils.js';
import { distanceToSelfLoop } from './selfLoopUtils.js';
import { generateManhattanRoutingPath, generateCleanRoutingPath, lombardiArcFor, distanceToArc } from './edgeRouting.js';

// Connection grab radius floors, in SCREEN pixels — see edgeHitThreshold.
// The base radius is expressed in canvas units, which shrink on screen as you
// zoom out; these keep the real target usable at any zoom. 44px is Apple's HIG
// minimum touch target, and touch also scales the base radius up because a
// fingertip has nothing like a cursor's precision.
export const EDGE_HIT_FLOOR_PX_MOUSE = 24;
export const EDGE_HIT_FLOOR_PX_TOUCH = 44;
export const EDGE_HIT_TOUCH_BOOST = 1.4;

// How much closer a rival has to be before it takes the hover away from the
// connection already showing, as a fraction of the grab radius.
//
// Pure nearest-wins is the right answer for a CLICK, which happens at one
// instant. It is the wrong answer for hover, which is a continuous judgement
// re-made every frame: wherever two connections are near-tied, the winner
// alternates under a pixel of cursor jitter, and since entering a new target
// restarts the 180ms dwell, one flickering frame costs the user the whole
// delay. Sustained flicker means hover never settles at all.
//
// Curved styles are where the tie zones live. A straight connection crosses its
// neighbours at a point; a Lombardi arc bows clear of its chord, detours
// through territory other connections occupy, and meets them at shallow angles
// — so the near-tie is a STRETCH, not a point, and the more extreme the bow the
// longer it runs. That is why the flicker showed up on the big arcs first and
// left ordinary connections alone.
//
// Hysteresis, the same remedy runCulling applies to the visible set for the
// same reason. Deliberately modest: enough to cover jitter and shallow
// crossings, not enough to hold hover on a connection you have genuinely left.
export const EDGE_HOVER_STICKY_FRACTION = 0.25;

// One geometric test for every routing style, so hover and selection can never
// disagree about which connection is under the pointer. Hover used to own this
// math privately while selection leaned on the transparent SVG stroke drawn
// around each path — a narrower target (radius ~25 canvas units against
// hover's 40–50) that also resolves topmost-wins instead of nearest-wins.
// Curved styles suffered worst: a Lombardi arc or a parallel fan bows away
// from where the stroke sits, so the line you aimed at was not the line that
// got the tap.
//
// Returns { edgeId, distance, point, connection } for the NEAREST connection
// within `threshold` canvas units, or null. `point` is the closest point on
// the winner's REAL drawn geometry — the arc, the Manhattan run, the Bézier —
// not on the chord between its endpoints. The controller's auto-aim is the
// caller that needs it: aiming at a chord in a curved style walks the camera
// to a spot with nothing drawn on it. Every style computes that point already
// on its way to a distance; it was simply being thrown away.
//
// `options.stickyEdgeId` biases the scan toward a connection the caller is
// already showing — see EDGE_HOVER_STICKY_FRACTION. Callers that want an
// honest nearest-wins (click, tap, the controller) simply omit it.
//
// `scene` is NodeCanvas's render-time view of the graph (see the destructure
// below); `labelTruncationRef` is read at call time.
export function findNearestEdgeAtCanvasPoint(cx, cy, threshold, scene, options = {}) {
  const {
    visibleEdges, nodeById, baseDimsById, previewingNodeId, edgeCurveInfo, nodePrototypesMap,
    enableAutoRouting, routingStyle, cleanLaneOffsets, cleanLaneSpacing, manhattanBends,
    lombardiTangents, lombardiCurvature, lombardiLaneSpacing, orthogonalLaneSpacing, curveSpacing,
    lombardiMinBow, anchorGeometryFor, labelTruncationRef,
  } = scene;
  let foundEdgeId = null;
  let foundConnectionPayload = null;
  let closestDistance = Infinity;
  // Ranking key, which is the true distance for every connection EXCEPT the
  // sticky one. Kept separate so `closestDistance` — and therefore the
  // `distance` handed back to callers — stays the real measurement.
  let closestScore = Infinity;
  const stickyEdgeId = options.stickyEdgeId ?? null;
  const stickyMargin = stickyEdgeId ? threshold * EDGE_HOVER_STICKY_FRACTION : 0;
  // One scratch object reused across the whole scan, copied out only when an
  // edge actually becomes the winner: this loop runs over every visible edge
  // on every pointer move, and the styles here were written to avoid exactly
  // this kind of per-edge garbage.
  const nearest = { x: 0, y: 0 };
  let foundPoint = null;

  for (let i = visibleEdges.length - 1; i >= 0; i--) {
    const edge = visibleEdges[i];
    const sourceRaw = nodeById.get(edge.sourceId);
    const targetRaw = nodeById.get(edge.destinationId);
    if (!sourceRaw || !targetRaw) continue;

    const sourceDimsRaw = baseDimsById.get(sourceRaw.id);
    const targetDimsRaw = baseDimsById.get(targetRaw.id);
    if (!sourceDimsRaw || !targetDimsRaw) continue;

    // Route from the same boxes the renderer routes from. A thing-group
    // anchor is drawn from the GROUP's pill, not from the anchor's stored
    // instance box, and every other reader of this geometry — the tangent
    // solve, the label crossing index, renderConnectionEdge, the drag's live
    // updater — already substitutes it. The pointer test was the last one
    // that didn't, so a connection into a group was measured against a curve
    // nobody had drawn. See anchorGeometryFor.
    const { node: sourceInstance, dims: sourceDims } = anchorGeometryFor(sourceRaw, sourceDimsRaw);
    const { node: targetInstance, dims: targetDims } = anchorGeometryFor(targetRaw, targetDimsRaw);

    const isSourcePreviewing = previewingNodeId === sourceInstance.id;
    const isTargetPreviewing = previewingNodeId === targetInstance.id;
    const x1 = sourceInstance.x + sourceDims.currentWidth / 2;
    const y1 = sourceInstance.y + (isSourcePreviewing ? NODE_HEIGHT / 2 : sourceDims.currentHeight / 2);
    const x2 = targetInstance.x + targetDims.currentWidth / 2;
    const y2 = targetInstance.y + (isTargetPreviewing ? NODE_HEIGHT / 2 : targetDims.currentHeight / 2);

    let distance = Infinity;

    if (edge.sourceId === edge.destinationId) {
      distance = distanceToSelfLoop(
        cx, cy,
        sourceInstance.x, sourceInstance.y,
        sourceDims.currentWidth, sourceDims.currentHeight,
        edgeCurveInfo.get(edge.id),
        nearest
      );
    } else if (enableAutoRouting && routingStyle === 'clean') {
      const pathPoints = generateCleanRoutingPath(
        edge, sourceInstance, targetInstance, sourceDims, targetDims,
        cleanLaneOffsets, cleanLaneSpacing
      );
      distance = distanceToPolyline(cx, cy, pathPoints, nearest);
    } else if (enableAutoRouting && routingStyle === 'lombardi') {
      // Closed form, not sampling. This runs for every visible edge on every
      // pointer move; building the full routing descriptor here (sampled
      // polyline, path string, arrowhead trims) and then walking the polyline
      // made hover cost ~2x what the orthogonal styles cost, on top of the
      // garbage it generated.
      const { p, q, arc } = lombardiArcFor(
        edge, sourceInstance, targetInstance, sourceDims, targetDims,
        lombardiTangents, lombardiCurvature,
        // Same fan the renderer drew, so the hit-test picks the member of a
        // bundle actually under the pointer — and the same straight/curved
        // verdict, or a connection drawn as a line is measured as a bow.
        {
          curveInfo: edgeCurveInfo.get(edge.id),
          laneSpacing: lombardiLaneSpacing,
          minBow: lombardiMinBow,
        }
      );
      distance = arc
        ? distanceToArc(cx, cy, arc, nearest)
        : distanceToPolyline(cx, cy, [p, q], nearest);
    } else if (enableAutoRouting && routingStyle === 'manhattan') {
      const pathPoints = generateManhattanRoutingPath(
        edge, sourceInstance, targetInstance, sourceDims, targetDims,
        manhattanBends,
        // Same lane the renderer drew, or the hit-test picks the wrong member
        // of a bundle — every one of them would test against the un-fanned
        // centre route.
        { curveInfo: edgeCurveInfo.get(edge.id), laneSpacing: orthogonalLaneSpacing }
      );
      distance = distanceToPolyline(cx, cy, pathPoints, nearest);
    } else {
      const curveInfo = edgeCurveInfo.get(edge.id);
      if (curveInfo && curveInfo.totalInPair > 1) {
        // Distance to the quadratic Bézier. Must use the SAME curveSpacing as
        // the renderer (200 * multiConnectionCurve) — the default
        // (BASE_CURVE_SPACING = 100) bunches the test curves at half the drawn
        // fan-out, so with 3+ parallel edges the nearest computed curve is no
        // longer the one under the pointer.
        const ctrlPoint = calculateCurveControlPoint(x1, y1, x2, y2, curveInfo, curveSpacing);
        if (ctrlPoint) {
          distance = distanceToQuadraticBezier(
            cx, cy,
            x1, y1,
            ctrlPoint.ctrlX, ctrlPoint.ctrlY,
            x2, y2,
            40, // finer sampling to disambiguate tightly packed curves
            nearest
          );
        }
      } else {
        const A = cx - x1;
        const B = cy - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        if (lenSq > 0) {
          let param = dot / lenSq;
          if (param < 0) param = 0;
          else if (param > 1) param = 1;
          const xx = x1 + param * C;
          const yy = y1 + param * D;
          const dx = cx - xx;
          const dy = cy - yy;
          distance = Math.sqrt(dx * dx + dy * dy);
          nearest.x = xx;
          nearest.y = yy;
        }
      }
    }

    const score = edgeHitScore(distance, threshold, edge.id === stickyEdgeId, stickyMargin);
    if (score >= closestScore) continue;
    // Keep scanning: for overlapping connections the nearest edge wins, not
    // the first one found within the threshold.
    closestScore = score;
    closestDistance = distance;
    foundEdgeId = edge.id;
    // Copied, not aliased — `nearest` is about to be overwritten by the next
    // edge in the scan.
    foundPoint = { x: nearest.x, y: nearest.y };

    let connectionName = edge.connectionName || 'Connection';
    let connectionColor = edge.color || '#000000';

    if ((!connectionName || connectionName === 'Connection') && edge.definitionNodeIds?.length) {
      const defNode = nodePrototypesMap.get(edge.definitionNodeIds[0]);
      if (defNode) {
        connectionName = defNode.name || connectionName;
        connectionColor = defNode.color || connectionColor;
      }
    } else if ((!edge.definitionNodeIds || edge.definitionNodeIds.length === 0) && edge.typeNodeId) {
      const typeNode = nodePrototypesMap.get(edge.typeNodeId);
      if (typeNode) {
        connectionName = typeNode.name || connectionName;
        connectionColor = typeNode.color || connectionColor;
      }
    }

    const sourceEndpoint = {
      id: sourceInstance.id,
      name: sourceInstance.name,
      color: sourceInstance.color,
      width: sourceDims.currentWidth,
      height: isSourcePreviewing ? NODE_HEIGHT : sourceDims.currentHeight,
      prototypeId: sourceInstance.prototypeId
    };
    const targetEndpoint = {
      id: targetInstance.id,
      name: targetInstance.name,
      color: targetInstance.color,
      width: targetDims.currentWidth,
      height: isTargetPreviewing ? NODE_HEIGHT : targetDims.currentHeight,
      prototypeId: targetInstance.prototypeId
    };
    // Orient the preview to match the canvas: whichever endpoint sits further
    // left on the canvas is shown on the left of the hover aid. Our brains
    // can't easily re-map a connection whose on-canvas left→right order is
    // reversed in the preview. Arrows are keyed by node id
    // (directionality.arrowsToward), so swapping the display order of
    // source/target is lossless.
    const flipForCanvasOrder = targetInstance.x < sourceInstance.x;

    foundConnectionPayload = {
      id: edge.id,
      name: connectionName,
      color: connectionColor,
      definitionNodeIds: edge.definitionNodeIds,
      typeNodeId: edge.typeNodeId,
      source: flipForCanvasOrder ? targetEndpoint : sourceEndpoint,
      target: flipForCanvasOrder ? sourceEndpoint : targetEndpoint,
      directionality: edge.directionality,
      // Whether the canvas is currently showing this connection's name in
      // full. The hover aid uses it to decide it is needed at a zoom level
      // where it would normally stand down — see labelTruncationRef.
      labelTruncated: labelTruncationRef.current.get(edge.id) === true
    };
  }

  return foundEdgeId
    ? { edgeId: foundEdgeId, distance: closestDistance, point: foundPoint, connection: foundConnectionPayload }
    : null;
}

// Grab radius for findNearestEdgeAtCanvasPoint, in canvas units.
//
// Routed styles get a wider base radius: their geometry doesn't run where a
// naive chord would, so the pointer is often further from the line than the
// user's aim suggests. On top of that both tiers take a screen-space FLOOR —
// the base radius is fixed in graph units, so zooming out used to shrink the
// real target to a handful of pixels. A finger is roughly 44px wide (Apple's
// HIG minimum) and can't aim anywhere near as precisely as a cursor, so touch
// gets both a bigger floor and a multiplier on the base.
export function edgeHitThreshold(pointerKind = 'mouse', isRoutedStyle, connectionWidth, zoom) {
  const base = (isRoutedStyle ? 50 : 40) * Math.max(1, connectionWidth);
  const isTouch = pointerKind === 'touch';
  const floorPx = isTouch ? EDGE_HIT_FLOOR_PX_TOUCH : EDGE_HIT_FLOOR_PX_MOUSE;
  return Math.max(base * (isTouch ? EDGE_HIT_TOUCH_BOOST : 1), floorPx / (zoom || 1));
}
