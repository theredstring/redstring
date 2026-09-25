/**
 * Whole-graph edge geometry used by labels and the edge pie menu (moved
 * verbatim from NodeCanvas's memos): the crossing index routed labels avoid, and
 * the anchor the edge pie menu opens at. NodeCanvas memoizes each on its
 * original dependencies. P3.05 builds label placement on these.
 */
import { calculateSelfLoopPath } from '../../../utils/canvas/selfLoopUtils.js';
import { computeManhattanRouting, computeCleanRouting, computeLombardiRouting } from '../../../utils/canvas/edgeRouting.js';
import { placeLabelOnRoute } from '../../../utils/canvas/edgeLabelPlacement.js';
import { getVisualConnectionEndpoints } from '../../../utils/canvas/nodeHitbox.js';
import { calculateParallelEdgePath } from '../../../utils/canvas/parallelEdgeUtils.js';
import { getNodeHitbox } from '../../../utils/canvas/nodeHitbox.js';
import { trimRouteEnd, lombardiArcFor, sampleArc } from '../../../utils/canvas/edgeRouting.js';
import { samePolylines, buildEdgeSegmentIndex } from '../../../utils/canvas/edgeLabelPlacement.js';
import { getVisibleObstacleRects } from '../../../utils/canvas/edgeLabelPlacement.js';

/** Where the edge pie menu anchors on the selected connection (null when none). */
export function computeSelectedEdgeMidpoint(ctx) {
  const {
    selectedEdgeId, selectedEdgeIds, edgesMap, nodeById, baseDimsById, edgeCurveInfo, enableAutoRouting,
    routingStyle, manhattanBends, orthogonalLaneSpacing, cleanLaneOffsets, cleanLaneSpacing,
    lombardiTangents, lombardiCurvature, selectedInstanceIds, lombardiLaneSpacing, connectionWidth,
    lombardiMinBow, curveSpacing,
  } = ctx;
  const edgeId = selectedEdgeId || (selectedEdgeIds.size === 1 ? [...selectedEdgeIds][0] : null);
  if (!edgeId) return null;
  const edge = edgesMap.get(edgeId);
  if (!edge) return null;
  const destId = edge.destinationId || edge.targetId;
  const srcNode = nodeById.get(edge.sourceId);
  const dstNode = nodeById.get(destId);
  if (!srcNode || !dstNode) return null;
  const sDims = baseDimsById.get(edge.sourceId) || { currentWidth: 120, currentHeight: 40 };
  const dDims = baseDimsById.get(destId) || { currentWidth: 120, currentHeight: 40 };

  let x, y, angleDeg;

  if (edge.sourceId === destId) {
    // Self-loop: the chord midpoint is the node's own center, which would bury
    // the menu under the node. Use the loop's apex, where its label sits.
    const loop = calculateSelfLoopPath(
      srcNode.x, srcNode.y, sDims.currentWidth, sDims.currentHeight, edgeCurveInfo.get(edgeId)
    );
    x = loop.loopCx + loop.radius * Math.cos(loop.outwardAngle);
    y = loop.loopCy + loop.radius * Math.sin(loop.outwardAngle);
    angleDeg = 0;
  } else if (enableAutoRouting && (routingStyle === 'manhattan' || routingStyle === 'clean' || routingStyle === 'lombardi')) {
    const routing = routingStyle === 'manhattan'
      ? computeManhattanRouting(srcNode, dstNode, sDims, dDims, manhattanBends, {
        curveInfo: edgeCurveInfo.get(edgeId), laneSpacing: orthogonalLaneSpacing,
      })
      : routingStyle === 'clean'
        ? computeCleanRouting(edge, srcNode, dstNode, sDims, dDims, cleanLaneOffsets, cleanLaneSpacing)
        : computeLombardiRouting(edge, srcNode, dstNode, sDims, dDims, lombardiTangents, {
          curvature: lombardiCurvature, selectedInstanceIds,
          curveInfo: edgeCurveInfo.get(edgeId), laneSpacing: lombardiLaneSpacing,
          connectionWidth,
          minBow: lombardiMinBow,
        });
    const placement = placeLabelOnRoute(routing);
    x = placement.x;
    y = placement.y;
    angleDeg = placement.angle;
  } else {
    // Straight/curved: mirror the label render exactly — visible (border-clipped)
    // segment through calculateParallelEdgePath, whose apex is the label point
    // and bows with the curve on parallel edges.
    const visible = getVisualConnectionEndpoints(
      srcNode, dstNode, sDims, dDims,
      selectedInstanceIds.has(edge.sourceId),
      selectedInstanceIds.has(destId),
      true, null, null
    );
    const path = calculateParallelEdgePath(
      visible.x1, visible.y1, visible.x2, visible.y2,
      edgeCurveInfo.get(edgeId), curveSpacing
    );
    x = path.apexX ?? (visible.x1 + visible.x2) / 2;
    y = path.apexY ?? (visible.y1 + visible.y2) / 2;
    angleDeg = path.labelAngle ?? 0;
  }

  // Normalize into (-90, 90] so the button row never flips end-for-end as the
  // connection crosses vertical — button order has to stay stable.
  let normalized = ((angleDeg % 180) + 180) % 180;
  if (normalized > 90) normalized -= 180;

  return {
    x,
    y,
    angle: normalized * (Math.PI / 180), // PieMenu's anchorAngle is radians
    sourceId: edge.sourceId,
    destinationId: destId,
  };
}

/** The segment index of every routed connection's visible polyline, for label crossing counts. */
export function computeLabelCrossingIndex(ctx) {
  const {
    showConnectionNames, isRoutedStyle, edges, LABEL_CROSSING_BUDGET, anchorPositionUpdatesRef, nodeById,
    baseDimsById, anchorGeometryFor, routingStyle, manhattanBends, edgeCurveInfo, orthogonalLaneSpacing,
    cleanLaneOffsets, cleanLaneSpacing, lombardiTangents, lombardiCurvature, lombardiLaneSpacing,
    labelCrossingLastRef, labelCrossingGenerationRef,
  } = ctx;
  if (!showConnectionNames || !isRoutedStyle) return null;
  if (edges.length < 2 || edges.length > LABEL_CROSSING_BUDGET) return null;

  // A label may only dodge what is actually DRAWN. Every routed style runs its
  // geometry to the node CENTRES and lets the node body cover the ends, so the
  // raw polyline carries a stretch nobody can see; indexing it makes the placer
  // count crossings against lines that aren't there, and since betterPlacement
  // ranks crossings above everything else, one phantom pushes a label off a
  // connection that had clear space. Between two ordinary nodes the phantom is
  // a node-radius at each end; on a THING-GROUP anchor it's the group's whole
  // outer box, which is why labels near a group were floating off their lines.
  //
  // Always the UNSELECTED hitbox: trimming by the 6 px selection outline made
  // every selection re-solve every label, which reshuffles a few (F-21, F-72).
  // Labels stay put on select instead (D-18).
  const occluderFor = (node, dims) => {
    const vb = node.isGroupAnchor ? anchorPositionUpdatesRef.current.get(node.id)?.outerBounds : null;
    return vb
      ? { minX: vb.x, minY: vb.y, maxX: vb.x + vb.width, maxY: vb.y + vb.height }
      : getNodeHitbox(node, dims, false);
  };
  const visibleOnly = (pts, srcNode, dstNode, sDims, dDims) => {
    if (!pts || pts.length < 2) return pts;
    const fromSource = trimRouteEnd(pts, occluderFor(srcNode, sDims), true, 0).points;
    return trimRouteEnd(fromSource, occluderFor(dstNode, dDims), false, 0).points;
  };

  const polylines = new Map();
  for (const edge of edges) {
    const destId = edge.destinationId || edge.targetId;
    // Self-loops hug their own node, where a label has nowhere better to go.
    if (!destId || edge.sourceId === destId) continue;
    const srcRaw = nodeById.get(edge.sourceId);
    const dstRaw = nodeById.get(destId);
    if (!srcRaw || !dstRaw) continue;
    const sDimsRaw = baseDimsById.get(edge.sourceId);
    const dDimsRaw = baseDimsById.get(destId);
    if (!sDimsRaw || !dDimsRaw) continue;
    // Route from the same boxes the renderer routes from. occluderFor below
    // already trimmed against the group's REAL outer bounds while these
    // endpoints came from the anchor's stored instance box, so for any
    // connection into a node-group the indexed polyline and the drawn one
    // were different lines. See anchorGeometryFor.
    const { node: srcNode, dims: sDims } = anchorGeometryFor(srcRaw, sDimsRaw);
    const { node: dstNode, dims: dDims } = anchorGeometryFor(dstRaw, dDimsRaw);

    let raw;
    if (routingStyle === 'manhattan') {
      raw = computeManhattanRouting(
        srcNode, dstNode, sDims, dDims, manhattanBends,
        { curveInfo: edgeCurveInfo.get(edge.id), laneSpacing: orthogonalLaneSpacing }
      ).points;
    } else if (routingStyle === 'clean') {
      raw = computeCleanRouting(
        edge, srcNode, dstNode, sDims, dDims, cleanLaneOffsets, cleanLaneSpacing
      ).points;
    } else {
      const { p, q, arc } = lombardiArcFor(
        edge, srcNode, dstNode, sDims, dDims, lombardiTangents, lombardiCurvature,
        { curveInfo: edgeCurveInfo.get(edge.id), laneSpacing: lombardiLaneSpacing }
      );
      raw = arc ? sampleArc(arc, 24) : [p, q];
    }
    polylines.set(edge.id, visibleOnly(raw, srcNode, dstNode, sDims, dDims));
  }
  // Same geometry as last time (a write that replaced `edges` without moving
  // anything)? Keep the index and its generation: a new one re-solves every label.
  const last = labelCrossingLastRef.current;
  if (last && samePolylines(last.polylines, polylines)) return last.index;
  const index = buildEdgeSegmentIndex(polylines);
  // Stamped so a cached placement names the landscape it was solved against
  // (labelSignature). Refs written in a memo body: nothing renders from them.
  if (index) index.generation = ++labelCrossingGenerationRef.current;
  labelCrossingLastRef.current = { polylines, index };
  return index;
}

/** Parallel-edge curve offsets: each connection's index within its node pair. */
export function computeEdgeCurveInfo(ctx) {
  const { edges } = ctx;
  const edgePairGroups = new Map();
  const curveInfoMap = new Map();

  edges.forEach(edge => {
    const key = [edge.sourceId, edge.destinationId].sort().join('-');
    if (!edgePairGroups.has(key)) {
      edgePairGroups.set(key, []);
    }
    edgePairGroups.get(key).push(edge.id);
  });

  edgePairGroups.forEach((edgeIds) => {
    const total = edgeIds.length;
    edgeIds.forEach((edgeId, idx) => {
      curveInfoMap.set(edgeId, { pairIndex: idx, totalInPair: total });
    });
  });

  return curveInfoMap;
}

/** The node boxes and crossing index routed labels dodge. */
export function computeLabelObstacleOptions(ctx) {
  const {
    showConnectionNames, isRoutedStyle, nodes, visibleNodeIds, baseDimsById, selectedInstanceIds,
    EMPTY_OBSTACLES, labelCrossingIndex,
  } = ctx;
  return ({
    obstacles: (showConnectionNames && isRoutedStyle)
      ? getVisibleObstacleRects(nodes, visibleNodeIds, baseDimsById, 18, selectedInstanceIds)
      : EMPTY_OBSTACLES,
    segmentIndex: labelCrossingIndex,
  });
}
