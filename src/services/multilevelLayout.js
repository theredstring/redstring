/**
 * MULTILEVEL (MULTI-SCALE) LAYOUT.
 *
 * Walshaw, "A Multilevel Algorithm for Force-Directed Graph Drawing" (GD 2000);
 * Hachul & Jünger's FM³ (GD 2004); Hu's sfdp (2005).
 *
 * THE PROBLEM IT SOLVES
 * ─────────────────────
 * A single-level solver has to do two incompatible jobs in one annealing run:
 * decide the GLOBAL arrangement (which clusters sit where) and settle the LOCAL
 * spacing (which node sits where inside a cluster). Global arrangement needs big
 * moves, local spacing needs small ones, and a cooling schedule can only be in
 * one of those regimes at a time. So the global part is usually still unfinished
 * when the sim cools — which is precisely why pressing auto-layout a second time
 * used to keep improving the result. The second press was doing the global work
 * the first press ran out of temperature for.
 *
 * Multilevel removes the conflict instead of budgeting for it. Collapse the
 * graph into a stack of progressively smaller graphs; lay out the coarsest,
 * where the global arrangement is a handful of nodes and therefore cheap and
 * easy; then interpolate down, refining locally at each level. By the time the
 * finest level runs, the global answer is already settled and only local
 * spacing is left.
 *
 * ALL POSITIONS HERE ARE CENTRES.
 */

import { boxOf } from './layoutGeometry.js';
import { stressLayout, STRESS_DEFAULTS } from './stressMajorization.js';

export const MULTILEVEL_DEFAULTS = {
  // Stop coarsening at this many nodes — small enough that the coarsest layout
  // is trivial, large enough to still carry the graph's shape.
  coarsestSize: 40,
  maxLevels: 12,
  // Iterations at the finest level; each coarser level gets more, since it has
  // fewer nodes and its decisions matter more.
  refineIterations: 60,
  // A supernode may not absorb more than this fraction of the graph, or its box
  // stops meaning anything and the coarse layout degenerates into a blob.
  maxClusterFraction: 0.25
};

// ============================================================================
// COARSENING
// ============================================================================

/**
 * One coarsening step by heavy-edge matching, weighted against size.
 *
 * Plain heavy-edge matching maximises merged edge weight, which on a graph with
 * one high-degree hub produces a single enormous supernode that swallows the
 * structure. Dividing by the merged size penalises that, so clusters stay
 * comparable and every coarse node's bounding box remains a meaningful stand-in
 * for what it contains.
 *
 * @returns {{nodes, edges, parentOf}|null} null when no further merge is useful
 */
export function coarsenOnce(nodes, edges, opts = {}) {
  const cfg = { ...MULTILEVEL_DEFAULTS, ...opts };
  const byId = new Map(nodes.map(n => [n.id, n]));
  const sizeOf = (n) => n.clusterSize || 1;
  const maxSize = Math.max(2, Math.floor(nodes.length * cfg.maxClusterFraction));

  const degree = new Map(nodes.map(n => [n.id, 0]));
  const incident = new Map(nodes.map(n => [n.id, []]));
  (edges || []).forEach(e => {
    if (e.sourceId === e.destinationId) return;
    if (!byId.has(e.sourceId) || !byId.has(e.destinationId)) return;
    degree.set(e.sourceId, degree.get(e.sourceId) + 1);
    degree.set(e.destinationId, degree.get(e.destinationId) + 1);
    incident.get(e.sourceId).push(e);
    incident.get(e.destinationId).push(e);
  });

  // Lowest degree first: peripheral nodes pair off before hubs get a chance to
  // absorb everything. Ties broken by id so the result is deterministic.
  const order = [...nodes].sort((a, b) => {
    const d = degree.get(a.id) - degree.get(b.id);
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
  });

  const matched = new Set();
  const parentOf = new Map();
  const clusters = [];

  order.forEach(node => {
    if (matched.has(node.id)) return;
    let best = null;
    let bestScore = -Infinity;

    (incident.get(node.id) || []).forEach(e => {
      const otherId = e.sourceId === node.id ? e.destinationId : e.sourceId;
      if (matched.has(otherId) || otherId === node.id) return;
      const other = byId.get(otherId);
      if (!other) return;
      const merged = sizeOf(node) + sizeOf(other);
      if (merged > maxSize) return;
      const score = 1 / (sizeOf(node) * sizeOf(other));
      if (score > bestScore || (score === bestScore && String(otherId) < String(best?.id))) {
        bestScore = score;
        best = other;
      }
    });

    matched.add(node.id);
    if (best) {
      matched.add(best.id);
      clusters.push([node, best]);
    } else {
      clusters.push([node]);
    }
  });

  if (clusters.length >= nodes.length) return null; // nothing merged

  const coarseNodes = clusters.map((members, i) => {
    const id = `L${members.map(m => m.id).join('~')}`;
    members.forEach(m => parentOf.set(m.id, id));

    // Box of the pair placed side by side along their shorter shared axis, so
    // a supernode's extents still approximate the room its members need and
    // every downstream consumer of nodeBox keeps working unchanged.
    const boxes = members.map(m => boxOf(m));
    const w = boxes.reduce((s, b) => s + b.w, 0);
    const h = boxes.reduce((s, b) => s + b.h, 0);
    const sideBySide = { width: w, height: Math.max(...boxes.map(b => b.h)) };
    const stacked = { width: Math.max(...boxes.map(b => b.w)), height: h };
    const chosen = sideBySide.width * sideBySide.height <= stacked.width * stacked.height
      ? sideBySide : stacked;

    return {
      id,
      width: chosen.width,
      height: chosen.height,
      labelWidth: chosen.width,
      labelHeight: chosen.height,
      clusterSize: members.reduce((s, m) => s + sizeOf(m), 0),
      members: members.map(m => m.id)
    };
  });

  // Project edges, dropping self-loops and merging parallels (widest label wins,
  // matching how spacing is derived everywhere else).
  const coarseEdges = new Map();
  (edges || []).forEach(e => {
    const a = parentOf.get(e.sourceId);
    const b = parentOf.get(e.destinationId);
    if (!a || !b || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const prev = coarseEdges.get(key);
    const name = e.name || '';
    if (!prev || name.length > (prev.name || '').length) {
      coarseEdges.set(key, { id: key, sourceId: a, destinationId: b, name });
    }
  });

  return { nodes: coarseNodes, edges: [...coarseEdges.values()], parentOf };
}

/**
 * Build the full level stack, finest first.
 * @returns {Array<{nodes, edges, parentOf}>}
 */
export function coarsen(nodes, edges, opts = {}) {
  const cfg = { ...MULTILEVEL_DEFAULTS, ...opts };
  const levels = [{ nodes, edges, parentOf: null }];

  let current = { nodes, edges };
  for (let level = 0; level < cfg.maxLevels; level++) {
    if (current.nodes.length <= cfg.coarsestSize) break;
    const next = coarsenOnce(current.nodes, current.edges, cfg);
    if (!next) break;
    levels.push(next);
    current = next;
  }
  return levels;
}

// ============================================================================
// THE V-CYCLE
// ============================================================================

/**
 * Lay out by coarsening, solving the smallest graph, then refining downward.
 *
 * @returns {{centers: Map, levels: number, stress: number, converged: boolean}}
 */
export function multilevelStressLayout(nodes, edges, cfg, options = {}) {
  const opts = { ...MULTILEVEL_DEFAULTS, ...STRESS_DEFAULTS, ...options };
  if (nodes.length === 0) return { centers: new Map(), levels: 0, stress: 0, converged: true };

  const levels = coarsen(nodes, edges, opts);

  // Coarsest level: no seed, full iteration budget. This is where the global
  // arrangement is decided, and it is cheap here precisely because the graph is
  // small — the whole point of the construction.
  const coarsest = levels[levels.length - 1];
  let result = stressLayout(coarsest.nodes, coarsest.edges, cfg, {
    ...opts,
    iterations: opts.iterations
  });
  let centers = result.centers;

  // Walk back down. Each child starts at its parent supernode's position, with
  // a small deterministic offset so the two members of a cluster don't begin
  // exactly coincident (which would leave the majorization step with no
  // direction to separate them along).
  for (let level = levels.length - 1; level > 0; level--) {
    const finer = levels[level - 1];
    const mapping = levels[level].parentOf;
    const spread = Math.max(40, (cfg.nodeGap ?? 140) / 4);

    const seeded = new Map();
    finer.nodes.forEach((node, i) => {
      const parent = mapping.get(node.id);
      const at = centers.get(parent);
      if (!at) { seeded.set(node.id, { x: 0, y: 0 }); return; }
      // Deterministic, not random: layouts must be reproducible.
      const angle = (i * 2.399963229728653); // golden angle, radians
      seeded.set(node.id, {
        x: at.x + Math.cos(angle) * spread,
        y: at.y + Math.sin(angle) * spread
      });
    });

    // Refinement only — the arrangement is already decided, so this needs far
    // fewer iterations than a from-scratch solve at this size would.
    result = stressLayout(finer.nodes, finer.edges, cfg, {
      ...opts,
      initial: seeded,
      iterations: opts.refineIterations
    });
    centers = result.centers;
  }

  return {
    centers,
    levels: levels.length,
    stress: result.stress,
    converged: result.converged
  };
}
