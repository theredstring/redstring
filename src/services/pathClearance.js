/**
 * KEEPING DRAWN EDGES OFF NODES THEY DON'T CONNECT.
 *
 * This is a generalization of lombardiLayout.js's `clearArcsOfNodes`, which was
 * the only place in the codebase that actually guaranteed this — and only for
 * Lombardi arcs. Every other routing style relied on a repulsion FORCE inside
 * the force simulation, which is scaled by `alpha` and therefore fades out
 * exactly when the layout is settling. A force can express a preference. It
 * cannot express "never".
 *
 * WHY A PROJECTION AND NOT A FORCE
 * ────────────────────────────────
 * The standard answer in the graph-drawing literature (Dwyer, Marriott &
 * Stuckey, "Fast Node Overlap Removal", GD 2005; and IPSep-CoLa, Dwyer, Koren &
 * Marriott, TVCG 2006) is to alternate an unconstrained gradient step with a
 * PROJECTION onto the feasible set. Constraints hold at the end because
 * projection is the last thing that happens. That is precisely the shape here:
 * the solver arranges, then this runs last and clears.
 *
 * WHY IT TAKES A PATH PROVIDER
 * ────────────────────────────
 * A straight-line layout gets edge clearance incidentally: the constraint that
 * keeps two nodes apart also keeps the line between them clear. Nothing else
 * does. A Lombardi arc bows off its chord; a Manhattan route leaves its chord
 * entirely and turns a corner somewhere the chord never went. So clearing "the
 * line between the endpoints" is not clearing the drawing.
 *
 * `pathsFor` therefore returns the polyline that will ACTUALLY BE DRAWN, and
 * the providers below get it by calling the renderer's own exported functions
 * in edgeRouting.js rather than reimplementing them. That is the same
 * discipline lombardiLayout.js already follows, and for the same reason: if
 * layout and renderer ever computed geometry differently, layout would be
 * clearing a path the drawing doesn't have.
 *
 * ALL POSITIONS HERE ARE CENTRES.
 */

import { boxOf, polylineBoxMTV } from './layoutGeometry.js';
import {
  generateManhattanRoutingPath,
  generateCleanRoutingPath,
  computeLombardiTangents,
  solveLombardiArc,
  sampleArc,
  lombardiEdgeKey
} from '../utils/canvas/edgeRouting.js';

// Resultant pushes below this are treated as settled — two near-opposite
// violations can cancel to a sub-pixel residue that would otherwise keep the
// loop reporting movement forever.
const SETTLED = 0.01;

// Passes a node may keep violating before the offending edge's endpoints are
// nudged too. Low enough to rescue a wedged node quickly, high enough that
// ordinary violations resolve by moving only the intruder.
const STALL_PASSES = 2;

// Fraction of the intruder's displacement applied (in reverse) to each endpoint
// of the offending edge. Small, so the path stays near where the solver put it.
const RELIEF_SHARE = 0.35;

export const CLEARANCE_DEFAULTS = {
  // Relaxation passes. Each one only touches actual violations, so this
  // converges fast; 6 matches what the Lombardi version has always used.
  passes: 6,
  // Clear space demanded between a node's box and any edge passing it.
  padding: 24,
  // Cap on how far one pass may move a single node. Unbounded MTV pushes on a
  // dense graph ping-pong; capping and letting the pass count do the work
  // converges instead.
  maxShiftPerPass: 70
};

// ============================================================================
// PATH PROVIDERS
// ============================================================================

/** Adapt centres to the {node, dims} shape the renderer's routing expects. */
function renderShapes(centers, nodes) {
  const dims = new Map();
  const topLeft = new Map();
  nodes.forEach(n => {
    const { w, h } = boxOf(n);
    dims.set(n.id, { currentWidth: w, currentHeight: h });
    const c = centers.get(n.id);
    if (c) topLeft.set(n.id, { id: n.id, x: c.x - w / 2, y: c.y - h / 2 });
  });
  return { dims, topLeft };
}

const realEdges = (edges, centers) => (edges || []).filter(e => e
  && e.sourceId !== e.destinationId
  && centers.has(e.sourceId)
  && centers.has(e.destinationId));

/** Straight centre-to-centre chords — the default routing style. */
export const straightPaths = () => (centers, nodes, edges) => {
  const out = new Map();
  realEdges(edges, centers).forEach(e => {
    out.set(e.id, [centers.get(e.sourceId), centers.get(e.destinationId)]);
  });
  return out;
};

/**
 * Orthogonal routes, via the renderer's own path builders.
 * @param {'manhattan'|'clean'} style
 */
export const orthogonalPaths = (style = 'manhattan', opts = {}) => (centers, nodes, edges) => {
  const { dims, topLeft } = renderShapes(centers, nodes);
  const out = new Map();
  realEdges(edges, centers).forEach(e => {
    const s = topLeft.get(e.sourceId);
    const d = topLeft.get(e.destinationId);
    const sD = dims.get(e.sourceId);
    const dD = dims.get(e.destinationId);
    if (!s || !d || !sD || !dD) return;
    const points = style === 'clean'
      ? generateCleanRoutingPath(e, s, d, sD, dD, opts.cleanLaneOffsets || new Map(), opts.cleanLaneSpacing ?? 24)
      : generateManhattanRoutingPath(e, s, d, sD, dD, opts.manhattanBends ?? 'auto');
    if (points && points.length >= 2) out.set(e.id, points);
  });
  return out;
};

/** Lombardi arcs, solved exactly as the renderer solves them. */
export const lombardiPaths = (curvature = 1) => (centers, nodes, edges) => {
  const { dims, topLeft } = renderShapes(centers, nodes);
  const tangents = computeLombardiTangents([...topLeft.values()], edges, dims);
  const out = new Map();
  realEdges(edges, centers).forEach(e => {
    const p = centers.get(e.sourceId);
    const q = centers.get(e.destinationId);
    const slot = tangents.get(lombardiEdgeKey(e));
    if (!slot) { out.set(e.id, [p, q]); return; }
    const solved = solveLombardiArc(p, q, slot.sourceAngle, slot.destAngle, curvature);
    out.set(e.id, (solved && !solved.straight) ? sampleArc(solved) : [p, q]);
  });
  return out;
};

// ============================================================================
// THE PROJECTION
// ============================================================================

/**
 * Push nodes out from under any drawn edge they don't belong to.
 *
 * Normally only the intruding node moves: displacing an endpoint changes the
 * very path being cleared, and the two chase each other. The exception is a
 * node that stays in violation for STALL_PASSES — see the wedge case below,
 * where the gap is narrower than the node and moving it alone cannot succeed.
 *
 * @param {Map<string,{x:number,y:number}>} centers node CENTRES; not mutated
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Function} pathsFor (centers, nodes, edges) => Map<edgeId, {x,y}[]>
 * @param {Object} options see CLEARANCE_DEFAULTS, plus:
 *        `pinned`  Set of node ids that must not move at all
 *        `axisFor` (nodeId) => 'x' | 'y' | null — restrict a node's movement to
 *                  one axis, so an aligned layout can clear paths without
 *                  losing its alignment
 * @returns {{centers: Map, moved: boolean, passes: number}}
 */
export function clearPathsOfNodes(centers, nodes, edges, pathsFor, options = {}) {
  const cfg = { ...CLEARANCE_DEFAULTS, ...options };
  const pinned = cfg.pinned instanceof Set ? cfg.pinned : new Set();
  const axisFor = typeof cfg.axisFor === 'function' ? cfg.axisFor : () => null;

  const boxes = new Map(nodes.map(n => {
    const { w, h } = boxOf(n);
    return [n.id, { hw: w / 2, hh: h / 2 }];
  }));

  const edgeById = new Map((edges || []).map(e => [e.id, e]));

  let out = new Map(centers);
  const stalled = new Map();
  let movedEver = false;
  let usedPasses = 0;

  for (let pass = 0; pass < cfg.passes; pass++) {
    usedPasses = pass + 1;
    const paths = pathsFor(out, nodes, edges);

    // Jacobi, not Gauss-Seidel: collect every violation against a node first,
    // then move it once along the RESULTANT.
    //
    // Applying each edge's push the moment it is found looks equivalent and
    // isn't. A node wedged between two edges gets shoved off the first and
    // straight onto the second, then back — it oscillates and the pass budget
    // runs out with the node still on an edge. Summing first sends it out
    // along the one direction that relieves both.
    const push = new Map();

    paths.forEach((points, edgeId) => {
      const edge = edgeById.get(edgeId);
      if (!edge || !points || points.length < 2) return;

      nodes.forEach(node => {
        if (node.id === edge.sourceId || node.id === edge.destinationId) return;
        if (pinned.has(node.id)) return;
        const at = out.get(node.id);
        const box = boxes.get(node.id);
        if (!at || !box) return;

        // No densification: polylineBoxMTV tests whole segments, so a node
        // can't slip between two samples the way it could with point sampling.
        const mtv = polylineBoxMTV(points, at, box, cfg.padding);
        if (!mtv) return;

        const acc = push.get(node.id) || { dx: 0, dy: 0, deepest: null, edge: null };
        acc.dx += mtv.dx;
        acc.dy += mtv.dy;
        if (!acc.deepest || mtv.depth > acc.deepest.depth) {
          acc.deepest = mtv;
          acc.edge = edge;
        }
        push.set(node.id, acc);
      });
    });

    if (push.size === 0) break;

    let movedThisPass = false;
    push.forEach((acc, nodeId) => {
      let { dx, dy } = acc;

      // WEDGE ESCAPE. A node sitting in the notch between two edges that meet
      // at a shared endpoint gets near-opposite pushes, and the resultant
      // cancels to nothing — so summing alone leaves it pinned there forever,
      // which is exactly what happens to a leaf node caught under a fan of
      // edges converging on its neighbour.
      //
      // When the resultant is much smaller than the deepest single violation,
      // stop averaging and commit to that one, overshooting past the apex so
      // the next pass starts outside the notch instead of back inside it.
      const deepest = acc.deepest;
      if (deepest && Math.hypot(dx, dy) < deepest.depth * 0.5) {
        dx = deepest.dx * 1.5;
        dy = deepest.dy * 1.5;
      }

      // WIDEN THE WEDGE. If a node has been violating for several passes it is
      // not merely misplaced — the gap it sits in is narrower than the node is,
      // so no amount of moving that ONE node can satisfy both sides. It just
      // ping-pongs between them.
      //
      // The way out is to stop treating edge endpoints as immovable and give
      // the deepest offending edge a reciprocal nudge, exactly as the force
      // simulation's node↔edge repulsion does. Endpoints move a fraction of
      // what the intruder does, so the path stays close to where the solver
      // put it while the corridor opens enough to admit the node.
      stalled.set(nodeId, (stalled.get(nodeId) || 0) + 1);
      if (stalled.get(nodeId) >= STALL_PASSES && acc.edge) {
        const relief = RELIEF_SHARE;
        [acc.edge.sourceId, acc.edge.destinationId].forEach(endId => {
          if (pinned.has(endId)) return;
          const ep = out.get(endId);
          if (!ep) return;
          out.set(endId, { x: ep.x - dx * relief, y: ep.y - dy * relief });
        });
      }

      // Axis restriction is a PREFERENCE, clearance is the GUARANTEE. An
      // aligned node is asked to stay in its row or column, but if the axis it
      // is allowed to move along cannot relieve the violation — a whole row of
      // leaves with an edge running horizontally through it, where sliding
      // sideways never helps — the restriction is dropped for that node. A
      // broken alignment is a smaller defect than an edge drawn through a node.
      const axis = axisFor(nodeId);
      if (axis === 'x' && Math.abs(dx) > SETTLED) dy = 0;
      else if (axis === 'y' && Math.abs(dy) > SETTLED) dx = 0;

      const shift = Math.hypot(dx, dy);
      if (shift < SETTLED) return;
      if (shift > cfg.maxShiftPerPass) {
        const k = cfg.maxShiftPerPass / shift;
        dx *= k;
        dy *= k;
      }

      const at = out.get(nodeId);
      out.set(nodeId, { x: at.x + dx, y: at.y + dy });
      movedThisPass = true;
      movedEver = true;
    });

    if (!movedThisPass) break;
  }

  return { centers: out, moved: movedEver, passes: usedPasses };
}
