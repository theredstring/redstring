/**
 * How far the connections inside a group reach, so its box holds them too.
 *
 * A group's box was its Things' box. A connection drawn between two of them is
 * not always inside that: a Lombardi arc can bow far out past both ends, a lane
 * of a parallel bundle sits off the chord, an orthogonal route runs its lanes
 * around the side, a self-loop hangs off its node. Its own group's box cut
 * through it. computeGroupLayout now folds in the box of every connection with
 * both ends among the group's members (`connectionBoundsOf` in its context),
 * from the same routing the renderer draws with.
 *
 * Two callers build the hook: the settled layout (groupLayouts.js, from
 * NodeCanvas's routing inputs) and the drag's live layout (useNodeDrag, from
 * the live positions and tangents), so a group's box is the same while it moves
 * and once it lands.
 *
 * The routes run centre to centre. The stretch inside each node is inside the
 * node's own box anyway, so it changes nothing. No minimum bow: below it the
 * renderer draws a gentle arc straight, and keying the box on that would make it
 * change with zoom.
 */
import { computeManhattanRouting, computeCleanRouting, lombardiArcFor } from '../../../utils/canvas/edgeRouting.js';
import { calculateParallelEdgePath } from '../../../utils/canvas/parallelEdgeUtils.js';
import { calculateSelfLoopPath } from '../../../utils/canvas/selfLoopUtils.js';

const ROUTED = new Set(['manhattan', 'clean', 'lombardi']);

const grow = (b, x, y) => {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
};
const emptyBounds = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

/** The exact box of a circular arc ({ cx, cy, radius, a0, sweep }): its ends and any extreme it passes. */
export function arcBounds(arc) {
  const b = emptyBounds();
  const a1 = arc.a0 + arc.sweep;
  grow(b, arc.cx + arc.radius * Math.cos(arc.a0), arc.cy + arc.radius * Math.sin(arc.a0));
  grow(b, arc.cx + arc.radius * Math.cos(a1), arc.cy + arc.radius * Math.sin(a1));
  const lo = Math.min(arc.a0, a1);
  const hi = Math.max(arc.a0, a1);
  for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
    const a = k * (Math.PI / 2);
    grow(b, arc.cx + arc.radius * Math.cos(a), arc.cy + arc.radius * Math.sin(a));
  }
  return b;
}

/**
 * The box of one connection as drawn between `src` and `dst` (nodes at their
 * drawn positions, with dims), or null when it can't be routed.
 *
 * @param {Object} route - { style ('straight' unless auto-routing is on), tangents,
 *   curvature, lombardiLaneSpacing, manhattanBends, orthogonalLaneSpacing,
 *   cleanLaneOffsets, cleanLaneSpacing, curveSpacing, curveInfo (Map) }
 */
export function connectionRouteBounds(edge, src, dst, sDims, dDims, route) {
  const curveInfo = route.curveInfo?.get?.(edge.id);
  const b = emptyBounds();
  if (src.id === dst.id) {
    const loop = calculateSelfLoopPath(src.x, src.y, sDims.currentWidth, sDims.currentHeight, curveInfo);
    grow(b, loop.loopCx - loop.radius, loop.loopCy - loop.radius);
    grow(b, loop.loopCx + loop.radius, loop.loopCy + loop.radius);
    return b;
  }
  const p = { x: src.x + sDims.currentWidth / 2, y: src.y + sDims.currentHeight / 2 };
  const q = { x: dst.x + dDims.currentWidth / 2, y: dst.y + dDims.currentHeight / 2 };
  let points;
  if (route.style === 'lombardi') {
    const { arc } = lombardiArcFor(edge, src, dst, sDims, dDims, route.tangents, route.curvature ?? 1, {
      curveInfo, laneSpacing: route.lombardiLaneSpacing,
    });
    if (arc) return arcBounds(arc);
    points = [p, q];
  } else if (route.style === 'manhattan') {
    points = computeManhattanRouting(src, dst, sDims, dDims, route.manhattanBends || 'auto', {
      curveInfo, laneSpacing: route.orthogonalLaneSpacing,
    }).points;
  } else if (route.style === 'clean') {
    points = computeCleanRouting(edge, src, dst, sDims, dDims, route.cleanLaneOffsets || new Map(), route.cleanLaneSpacing ?? 24).points;
  } else {
    const path = calculateParallelEdgePath(p.x, p.y, q.x, q.y, curveInfo, route.curveSpacing);
    points = [p, q];
    if (Number.isFinite(path?.apexX)) points.push({ x: path.apexX, y: path.apexY });
  }
  (points || []).forEach(pt => grow(b, pt.x, pt.y));
  return Number.isFinite(b.minX) ? b : null;
}

/** The route style as the renderer picks it: routed only with auto-routing on. */
export const drawnRouteStyle = (enableAutoRouting, routingStyle) => (
  enableAutoRouting && ROUTED.has(routingStyle) ? routingStyle : 'straight'
);

/** connectionRouteBounds' `route`, from the canvas's routing inputs under their own names. */
export const routeFrom = ({
  enableAutoRouting, routingStyle, lombardiTangents, lombardiCurvature, lombardiLaneSpacing, manhattanBends,
  orthogonalLaneSpacing, cleanLaneOffsets, cleanLaneSpacing, curveSpacing, edgeCurveInfo,
}) => ({
  style: drawnRouteStyle(enableAutoRouting, routingStyle),
  tangents: lombardiTangents,
  curvature: lombardiCurvature,
  lombardiLaneSpacing, manhattanBends, orthogonalLaneSpacing, cleanLaneOffsets, cleanLaneSpacing, curveSpacing,
  curveInfo: edgeCurveInfo,
});

// edges array → Map(source id → its connections). A drag builds the hook every
// frame from the same array, so the index is built once per array.
const bySourceCache = new WeakMap();
const bySourceOf = (edges) => {
  if (!Array.isArray(edges)) return new Map();
  let byNode = bySourceCache.get(edges);
  if (!byNode) {
    byNode = new Map();
    for (const edge of edges) {
      const destId = edge?.destinationId || edge?.targetId;
      if (!edge?.sourceId || !destId) continue;
      if (!byNode.has(edge.sourceId)) byNode.set(edge.sourceId, []);
      byNode.get(edge.sourceId).push(edge);
    }
    bySourceCache.set(edges, byNode);
  }
  return byNode;
};

/**
 * The `connectionBoundsOf(group)` hook computeGroupLayout reads: the box of the
 * connections with both ends among the group's members, or null.
 *
 * @param {Object} opts
 * @param {Iterable<Object>} opts.edges - The connections drawn (view ids).
 * @param {(id: string) => Object|undefined} opts.nodeOf - A node at its drawn position.
 * @param {(id: string) => Object|undefined} opts.dimsOf - Its dims.
 * @param {(node, dims) => { node, dims }} [opts.geometryFor] - Where a connection meets
 *   it (a Thing-group's anchor meets at its title; connectionEndGeometry).
 * @param {(groupId: string) => boolean} [opts.skipGroup] - A group drawn another way (a formula).
 * @param {(id: string) => boolean} [opts.isDrawnElsewhere] - A Thing drawn in a format instead.
 * @param {Object} opts.route - connectionRouteBounds' `route`.
 */
export function makeConnectionBoundsOf({ edges, nodeOf, dimsOf, geometryFor, skipGroup, isDrawnElsewhere, route }) {
  const byNode = bySourceOf(edges);
  if (byNode.size === 0) return null;
  const cache = new Map();
  const boundsOfEdge = (edge) => {
    if (cache.has(edge.id)) return cache.get(edge.id);
    const destId = edge.destinationId || edge.targetId;
    let result = null;
    const s0 = nodeOf(edge.sourceId);
    const d0 = nodeOf(destId);
    const sd0 = dimsOf(edge.sourceId);
    const dd0 = dimsOf(destId);
    if (s0 && d0 && sd0 && dd0) {
      const s = geometryFor ? geometryFor(s0, sd0) : { node: s0, dims: sd0 };
      const d = geometryFor ? geometryFor(d0, dd0) : { node: d0, dims: dd0 };
      result = connectionRouteBounds(edge, s.node, d.node, s.dims, d.dims, route);
    }
    cache.set(edge.id, result);
    return result;
  };
  return (group) => {
    if (skipGroup?.(group.id)) return null;
    const members = new Set(group.memberInstanceIds || []);
    if (members.size === 0) return null;
    const b = emptyBounds();
    members.forEach((id) => {
      if (isDrawnElsewhere?.(id)) return;
      (byNode.get(id) || []).forEach((edge) => {
        const destId = edge.destinationId || edge.targetId;
        if (!members.has(destId) || isDrawnElsewhere?.(destId)) return;
        const eb = boundsOfEdge(edge);
        if (!eb) return;
        grow(b, eb.minX, eb.minY);
        grow(b, eb.maxX, eb.maxY);
      });
    });
    return Number.isFinite(b.minX) ? b : null;
  };
}
