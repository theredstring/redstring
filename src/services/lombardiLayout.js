/**
 * LOMBARDI HAS ITS OWN AUTO-LAYOUT.
 *
 * This is not a variation on the straight-line layouts and not a post-process
 * on top of them. When the routing style is 'lombardi', patternLayout hands the
 * whole job to the pipeline in this file instead of running its usual
 * shape → layout dispatch. Everything here exists because a Lombardi drawing is
 * defined by a property no other layout in this codebase is even aware of.
 *
 * WHY IT HAS TO BE SEPARATE
 * ─────────────────────────
 * Every other layout solves ONE problem: put nodes far enough apart that the
 * edges and their labels fit. Distance. A Lombardi drawing adds a second,
 * independent problem — ANGLE — and the two are not solvable in sequence:
 *
 *   Perfect angular resolution says a degree-k node's edges leave it at k
 *   directions spaced 2π/k apart. Those directions are fixed by the graph, not
 *   by the drawing. But an edge is a circular ARC, and Property 1 of the paper
 *   (Duncan, Eppstein, Goodrich, Kobourov & Nöllenburg, arXiv:1009.0579) says an
 *   arc makes the SAME angle with its chord at both of its endpoints. So an arc
 *   that leaves p at +δ from the chord MUST arrive at q at −δ. Two independently
 *   assigned tangents are one constraint too many for one arc.
 *
 * The renderer resolves that conflict by splitting the difference
 * (solveLombardiArc). That always produces a drawable arc, but the leftover — how
 * far each end misses its assigned direction — is visible: it's the arc that
 * doesn't quite meet its node where the fan says it should, and at large values
 * it's the arc that bulges into a lasso.
 *
 * The paper's own algorithms make the residual exactly zero, and they do it by
 * CHOOSING WHERE THE VERTICES GO (their Property 2: for a prescribed pair of
 * tangents, the locus of valid positions for the third vertex is itself a
 * circle). Placement is the lever. Which means the layout — not the renderer —
 * is where a Lombardi drawing is actually won or lost.
 *
 * WHAT THIS PIPELINE DOES
 * ───────────────────────
 *   1. SEED. Each component starts from the construction the paper uses for its
 *      shape: one circle for a regular graph or a ring (§2, circular Lombardi
 *      drawings), concentric rings for a hierarchy (§5, the Lombardi
 *      Spirograph), an open circle for a path. These are chosen for their
 *      ANGLES — a node on a ring has its neighbours genuinely around it — while
 *      still solving the usual distance constraints.
 *
 *   2. REFINE. The part that is real Lombardi math rather than "draw it round".
 *      See lombardiRefine: there is a closed form for the chord direction that
 *      zeroes an edge's residual, and relaxing toward it costs no edge length.
 *
 *   3. CLEAR. The paper's definition requires that the only vertices an arc
 *      touches are its two endpoints. A straight-line layout gets this for free
 *      from its distance constraints; an arc bows off its chord and can swing
 *      through a node that the chord cleared. See clearArcsOfNodes.
 *
 * The tangent solve and the arc solve are imported from the RENDERER's module,
 * deliberately. The layout is optimising the exact geometry that will be drawn;
 * if these two ever computed arcs differently, the layout would be minimising a
 * residual the drawing doesn't have.
 */

import {
  computeLombardiTangents,
  solveLombardiArc,
  sampleArc,
  lombardiEdgeKey,
} from '../utils/canvas/edgeRouting.js';
import { clearPathsOfNodes, lombardiPaths } from './pathClearance.js';

const TAU = Math.PI * 2;

const wrapPi = (a) => {
  const r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return r === -Math.PI ? Math.PI : r;
};

export const LOMBARDI_REFINE_DEFAULTS = {
  // Angular relaxation. 80 iterations at 0.35 damping converges well inside a
  // millisecond for the graph sizes a person actually looks at, and the early
  // exit usually fires long before.
  iterations: 80,
  damping: 0.35,
  // Stop once the mean residual is under ~1.5°, which is far below the point
  // anyone can see an arc missing its slot.
  tolerance: 0.026,
  // Arc-vs-node clearance passes.
  clearancePasses: 6,
  clearancePadding: 24,
  // Max gap between arc samples when testing clearance. Half a node's minimum
  // dimension, so nothing can slip between two consecutive samples.
  clearanceStep: 30,
  // How far a node may end up from where the seed put it. Unbounded by default;
  // see the header of lombardiRefine for when a caller should set it.
  maxDrift: Infinity,
};

/**
 * Adapt centre positions to the {node, dims} shape the renderer's tangent solve
 * expects. Sharing that function is the whole point — see the header.
 */
function fanFor(centers, nodes, edges) {
  const boxes = new Map(nodes.map(n => [n.id, {
    currentWidth: Math.max(n.width || 0, n.labelWidth || 0, 60),
    currentHeight: Math.max(n.height || 0, 60),
  }]));
  const shifted = nodes.map(n => {
    const c = centers.get(n.id);
    const b = boxes.get(n.id);
    return { id: n.id, x: (c?.x ?? 0) - b.currentWidth / 2, y: (c?.y ?? 0) - b.currentHeight / 2 };
  });
  return computeLombardiTangents(shifted, edges, boxes);
}

/**
 * How far, in radians, each edge's arc misses the directions the fan assigned
 * it. Zero means the drawing is an exact Lombardi drawing.
 *
 * Derivation. For an edge p→q with chord direction c, the fan demands a
 * departure deviation α = θp − c and an arrival deviation β = θq + π − c. The
 * single arc that can be drawn departs at δ and arrives at −δ, and
 * solveLombardiArc picks δ = (α − β)/2. Substituting, the miss at each end is
 * the same number:
 *
 *     residual = α − δ = −(−δ) − β = (α + β)/2
 *
 * @returns {{ mean: number, max: number, perEdge: Map<string, number> }}
 */
export function lombardiResidual(centers, nodes, edges, fan = null) {
  const tangents = fan || fanFor(centers, nodes, edges);
  const perEdge = new Map();
  let total = 0;
  let max = 0;
  let counted = 0;

  (edges || []).forEach(edge => {
    if (!edge || edge.sourceId === edge.destinationId) return;
    const p = centers.get(edge.sourceId);
    const q = centers.get(edge.destinationId);
    const slot = tangents.get(lombardiEdgeKey(edge));
    if (!p || !q || !slot) return;

    const c = Math.atan2(q.y - p.y, q.x - p.x);
    const alpha = wrapPi(slot.sourceAngle - c);
    const beta = wrapPi(slot.destAngle + Math.PI - c);
    const residual = Math.abs(wrapPi((alpha + beta) / 2));

    perEdge.set(lombardiEdgeKey(edge), residual);
    total += residual;
    if (residual > max) max = residual;
    counted += 1;
  });

  return { mean: counted > 0 ? total / counted : 0, max, perEdge };
}

/**
 * Relax positions until each arc can honour BOTH of its endpoints' assigned
 * tangents — the closest a fixed-topology layout can get to the exact drawings
 * the paper constructs.
 *
 * THE CLOSED FORM THIS IS BUILT ON
 * Setting the residual (α + β)/2 to zero and solving for the chord direction c:
 *
 *     (θp − c) + (θq + π − c) = 0   ⟹   c = (θp + θq + π) / 2
 *
 * The chord should BISECT the two tangent demands. That is a complete answer
 * for a single edge, and it says something useful: the fix is a pure ROTATION.
 * Nothing about the required distance between p and q enters it.
 *
 * Which is why this can run after the seed without undoing it. Rotating an edge
 * about its own midpoint preserves its length exactly, so every label
 * constraint the seed solved survives the refinement untouched. The two passes
 * are genuinely orthogonal: the seed owns distance, this owns angle.
 *
 * It is not a closed form for the WHOLE graph, because rotating an edge changes
 * the bearings at both of its endpoints and therefore re-solves the fan there.
 * So it's iterated: re-solve the fan, rotate every edge toward its bisector,
 * average the displacements each node receives, damp, repeat. A node with many
 * edges is pulled in many directions at once and the average is what settles it,
 * which is also why hubs move less than leaves without any explicit weighting.
 *
 * WHAT ROTATION PRESERVES, AND WHAT IT DOESN'T
 * Length, yes — and that is the whole basis for running this after the seed. But
 * NOT shape, and on a sparse graph the difference is enormous. A chain is a
 * kinematic chain: every rotation pivots the entire remainder of the path, and
 * those rotations compound, so a node near the far end swings by a multiple of
 * any single correction. Measured on a twenty-node coil, this pass moved a node
 * 1496px — three windings — to buy 0.85° of residual, and the spiral it was
 * seeded onto came out crossing itself.
 *
 * Hence `maxDrift`: a leash back to the seed. The seed does not just own
 * distance, it owns every property that lives in more than one edge at a time
 * — which winding a node is on, whether the drawing self-intersects — and this
 * pass is blind to all of them. Callers that seeded a shape worth keeping pass
 * the clearance it was built with; the default is unbounded, for seeds like the
 * force solver's that have no structure to protect.
 */
/**
 * Pull anything that has wandered further than `limit` from the seed back to
 * the edge of that radius, along the line it wandered off on.
 *
 * Applied BEFORE restoreLengths every iteration, not once at the end, so the
 * relaxation keeps working from a legal position rather than sailing off and
 * being reeled in afterwards. Lengths get the last word either way.
 */
function leash(next, seed, limit) {
  if (!Number.isFinite(limit)) return next;
  const out = new Map(next);
  next.forEach((p, id) => {
    const origin = seed.get(id);
    if (!origin) return;
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (d <= limit || d === 0) return;
    out.set(id, { x: origin.x + (dx / d) * limit, y: origin.y + (dy / d) * limit });
  });
  return out;
}

export function lombardiRefine(centers, nodes, edges, options = {}) {
  const cfg = { ...LOMBARDI_REFINE_DEFAULTS, ...options };
  const real = (edges || []).filter(e => e
    && e.sourceId !== e.destinationId
    && centers.has(e.sourceId)
    && centers.has(e.destinationId));
  if (real.length === 0 || centers.size < 2) return new Map(centers);

  // Lengths the seed established. The angular pass must not erode them, so they
  // are restored after each iteration.
  const targetLength = new Map();
  real.forEach(edge => {
    const p = centers.get(edge.sourceId);
    const q = centers.get(edge.destinationId);
    targetLength.set(lombardiEdgeKey(edge), Math.hypot(q.x - p.x, q.y - p.y));
  });

  let current = new Map(centers);
  let best = current;
  let bestMean = lombardiResidual(current, nodes, edges).mean;

  for (let iter = 0; iter < cfg.iterations; iter++) {
    const tangents = fanFor(current, nodes, edges);
    const sum = new Map();
    const count = new Map();

    const push = (id, dx, dy) => {
      const s = sum.get(id) || { x: 0, y: 0 };
      s.x += dx; s.y += dy;
      sum.set(id, s);
      count.set(id, (count.get(id) || 0) + 1);
    };

    let meanResidual = 0;
    let counted = 0;

    real.forEach(edge => {
      const p = current.get(edge.sourceId);
      const q = current.get(edge.destinationId);
      const slot = tangents.get(lombardiEdgeKey(edge));
      if (!slot) return;

      const c = Math.atan2(q.y - p.y, q.x - p.x);
      const alpha = wrapPi(slot.sourceAngle - c);
      const beta = wrapPi(slot.destAngle + Math.PI - c);
      // Rotating the chord by exactly this lands it on the bisector.
      const delta = wrapPi((alpha + beta) / 2);
      meanResidual += Math.abs(delta);
      counted += 1;
      if (Math.abs(delta) < 1e-6) return;

      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);
      const rotate = (pt) => {
        const dx = pt.x - mx;
        const dy = pt.y - my;
        return { x: mx + dx * cos - dy * sin, y: my + dx * sin + dy * cos };
      };
      const rp = rotate(p);
      const rq = rotate(q);
      push(edge.sourceId, rp.x - p.x, rp.y - p.y);
      push(edge.destinationId, rq.x - q.x, rq.y - q.y);
    });

    meanResidual = counted > 0 ? meanResidual / counted : 0;
    if (meanResidual <= cfg.tolerance) {
      best = current;
      bestMean = meanResidual;
      break;
    }

    const next = new Map(current);
    sum.forEach((s, id) => {
      const n = count.get(id) || 1;
      const at = current.get(id);
      next.set(id, {
        x: at.x + (s.x / n) * cfg.damping,
        y: at.y + (s.y / n) * cfg.damping,
      });
    });

    current = restoreLengths(leash(next, centers, cfg.maxDrift), real, targetLength);

    // Keep the best iterate rather than the last: the relaxation is damped, not
    // monotone, and on a frustrated graph (one with no exact drawing) it can
    // orbit a minimum rather than settle into it.
    const mean = lombardiResidual(current, nodes, edges).mean;
    if (mean < bestMean) {
      bestMean = mean;
      best = current;
    }
  }

  return best;
}

/**
 * Keep edge lengths inside the band the seed established.
 *
 * Rotating one edge preserves its own length, but a node sitting on several
 * edges moves by the AVERAGE of their rotations, and that average is not a
 * rotation of any single one — so lengths drift. Left alone the drift is
 * inward, which would quietly undo the label spacing the seed solved for.
 *
 * A BAND rather than a fixed length, because the seed's length is a MINIMUM
 * (it's what the label needs), not a target. Pinning every edge to it exactly
 * would leave the angular relaxation almost no room to work on a frustrated
 * graph — one whose fan admits no exact drawing at all. Letting edges grow, but
 * never shrink below what their label needs, gives the relaxation somewhere to
 * go while keeping the guarantee the seed was solving for.
 */
function restoreLengths(centers, edges, targetLength, passes = 2, maxStretch = 1.35) {
  let out = new Map(centers);
  for (let pass = 0; pass < passes; pass++) {
    const sum = new Map();
    const count = new Map();
    const push = (id, dx, dy) => {
      const s = sum.get(id) || { x: 0, y: 0 };
      s.x += dx; s.y += dy;
      sum.set(id, s);
      count.set(id, (count.get(id) || 0) + 1);
    };

    edges.forEach(edge => {
      const target = targetLength.get(lombardiEdgeKey(edge));
      if (!target) return;
      const p = out.get(edge.sourceId);
      const q = out.get(edge.destinationId);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return;
      // Inside the band, leave it alone.
      const bound = length < target ? target : (length > target * maxStretch ? target * maxStretch : null);
      if (bound === null) return;
      const correction = (bound - length) / 2;
      if (Math.abs(correction) < 0.5) return;
      const ux = dx / length;
      const uy = dy / length;
      push(edge.sourceId, -ux * correction, -uy * correction);
      push(edge.destinationId, ux * correction, uy * correction);
    });

    if (sum.size === 0) break;
    const next = new Map(out);
    sum.forEach((s, id) => {
      const n = count.get(id) || 1;
      const at = out.get(id);
      next.set(id, { x: at.x + s.x / n, y: at.y + s.y / n });
    });
    out = next;
  }
  return out;
}

/**
 * Push nodes out from under arcs that pass through them.
 *
 * The paper makes this part of the DEFINITION of a Lombardi drawing: "the only
 * vertices that intersect the arc for an edge (u, v) are its two endpoints".
 * Straight-line layouts satisfy it incidentally, because the constraint that
 * keeps two nodes apart also keeps the line between them clear. An arc doesn't
 * follow its chord — it bulges (L/2)·tan(δ/2) off it — so it can sweep through
 * a node the chord comfortably missed. Nothing before this step can see that,
 * because nothing before this step has solved the arcs.
 *
 * Only the intruding node moves. Moving an endpoint would change the very arc
 * being cleared, and the two would chase each other.
 */
export function clearArcsOfNodes(centers, nodes, edges, options = {}) {
  const cfg = { ...LOMBARDI_REFINE_DEFAULTS, ...options };
  // The mechanism is now shared — see services/pathClearance.js. What stays
  // Lombardi-specific is only WHICH geometry gets cleared: the arcs, solved
  // exactly as the renderer solves them.
  const { centers: out } = clearPathsOfNodes(
    centers,
    nodes,
    (edges || []).filter(e => e && e.sourceId !== e.destinationId),
    lombardiPaths(options.lombardiCurvature ?? 1),
    {
      passes: cfg.clearancePasses,
      padding: cfg.clearancePadding,
      maxShiftPerPass: Infinity
    }
  );
  return out;
}

/**
 * Order a regular graph's vertices around one circle.
 *
 * §2 of the paper characterises exactly which regular graphs admit a *circular
 * Lombardi drawing* — all vertices on a common circle — via a decomposition into
 * 1-regular and 2-regular subgraphs. That characterisation decides EXISTENCE and
 * needs perfect matchings and Petersen's theorem; we don't need the decision,
 * only a good placement, so this takes the geometry (vertices on one circle) and
 * leaves the existence question alone. A greedy walk keeps adjacent vertices
 * adjacent on the circle, which is what makes the chords short and the arcs
 * gentle.
 */
export function circularOrder(nodes, adjacency) {
  if (nodes.length === 0) return [];
  const remaining = new Set(nodes.map(n => n.id));
  const order = [];
  let current = nodes[0].id;

  while (remaining.size > 0) {
    order.push(current);
    remaining.delete(current);
    if (remaining.size === 0) break;

    // Prefer an unplaced neighbour, breaking ties toward the one with the
    // fewest remaining options so the walk doesn't strand a vertex.
    let next = null;
    let bestOptions = Infinity;
    (adjacency.get(current) || new Set()).forEach(id => {
      if (!remaining.has(id)) return;
      let options = 0;
      (adjacency.get(id) || new Set()).forEach(other => { if (remaining.has(other)) options += 1; });
      if (options < bestOptions) { bestOptions = options; next = id; }
    });

    current = next ?? remaining.values().next().value;
  }

  return order;
}

/** True when every vertex has the same degree — the paper's §2 precondition. */
export function isRegular(nodes, adjacency) {
  if (nodes.length < 3) return false;
  const degree = (adjacency.get(nodes[0].id) || new Set()).size;
  if (degree < 2) return false;
  return nodes.every(n => (adjacency.get(n.id) || new Set()).size === degree);
}

export default {
  lombardiRefine,
  lombardiResidual,
  clearArcsOfNodes,
  circularOrder,
  isRegular,
  LOMBARDI_REFINE_DEFAULTS,
};
