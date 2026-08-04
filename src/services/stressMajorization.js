/**
 * STRESS MAJORIZATION (SMACOF).
 *
 * Gansner, Koren & North, "Graph Drawing by Stress Majorization" (GD 2004).
 *
 * WHY THIS EXISTS ALONGSIDE THE FORCE SOLVER
 * ──────────────────────────────────────────
 * The force solver is a spring embedder with a cooling schedule: a heuristic
 * that stops when the clock says so. It has no objective it is provably
 * reducing, which is why "is this layout finished?" was historically answered
 * by looking at it — and why the honest answer for a long time was "press it
 * again".
 *
 * Stress majorization optimises an explicit objective:
 *
 *     stress(X) = Σ_ij w_ij (‖x_i − x_j‖ − d_ij)²
 *
 * and the majorization step is a DESCENT method — stress cannot increase, ever.
 * So convergence is a measurement (relative stress change < ε), not a guess,
 * and a run that has converged is finished in a sense the spring embedder can
 * never quite claim.
 *
 * WHAT MAKES IT RESPECT THIS CODEBASE'S SPACING
 * ─────────────────────────────────────────────
 * Textbook SMACOF uses unit graph distances, which would ignore everything
 * layoutGeometry.js knows about node boxes and label widths. Here `d_ij` is
 * built from `requiredEdgeLength` instead: adjacent nodes get exactly the
 * distance their boxes and edge label demand, and everything further gets a
 * multiple of the graph's median requirement. So a graph of wide nodes with
 * long relation names is laid out at the scale it actually needs, without any
 * separate correction pass.
 *
 * ALL POSITIONS HERE ARE CENTRES.
 */

import { requiredEdgeLength, labelSpanOf } from './layoutGeometry.js';

export const STRESS_DEFAULTS = {
  // Cap on BFS depth. Beyond this, pairs contribute nothing — the full
  // all-pairs matrix is O(N²) memory and the distant terms carry almost no
  // information about local structure anyway (sparse stress).
  maxHops: 6,
  iterations: 200,
  // Relative stress improvement below which the layout is converged. This is
  // the criterion the force solver never had.
  epsilon: 1e-4,
  // Above this node count, seed with PivotMDS rather than a circle.
  //
  // Deliberately low. The original reason to reach for PivotMDS was cost on big
  // graphs, but the decisive reason is QUALITY at any size: majorization is a
  // descent method, so it finds the nearest local minimum and stays there. Seed
  // a grid on a circle and it folds — the circle's index order wraps opposite
  // corners next to each other and no downhill step can unfold that. A
  // classical-MDS seed already has the global shape, so descent from it lands
  // in the right basin.
  pivotThreshold: 8,
  // Pivots scale with the graph; more than ~50 buys nothing.
  pivotCount: 50
};

// ============================================================================
// TARGET DISTANCES
// ============================================================================

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function buildAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map(n => [n.id, []]));
  (edges || []).forEach(e => {
    if (!adjacency.has(e.sourceId) || !adjacency.has(e.destinationId)) return;
    if (e.sourceId === e.destinationId) return;
    adjacency.get(e.sourceId).push(e.destinationId);
    adjacency.get(e.destinationId).push(e.sourceId);
  });
  return adjacency;
}

/**
 * Sparse BFS distances in HOPS, from every node, capped at maxHops.
 * @returns {Map<id, Map<id, number>>}
 */
export function hopDistances(nodes, adjacency, maxHops) {
  const all = new Map();
  nodes.forEach(source => {
    const dist = new Map([[source.id, 0]]);
    let frontier = [source.id];
    for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
      const next = [];
      for (const id of frontier) {
        for (const nbr of adjacency.get(id) || []) {
          if (dist.has(nbr)) continue;
          dist.set(nbr, hop);
          next.push(nbr);
        }
      }
      frontier = next;
    }
    dist.delete(source.id);
    all.set(source.id, dist);
  });
  return all;
}

/**
 * Convert hop counts into pixel targets using this codebase's spacing model.
 *
 * Adjacent pairs get their exact requirement — box extents plus label span.
 * Further pairs get hops × the median requirement, so the whole drawing is
 * scaled by what the graph actually needs rather than by an arbitrary constant.
 */
export function targetDistances(nodes, edges, hops, cfg) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edgeBetween = new Map();
  (edges || []).forEach(e => {
    const k = pairKey(e.sourceId, e.destinationId);
    const prev = edgeBetween.get(k);
    if (!prev || labelSpanOf(e, cfg.edgeLabelFontSize) > labelSpanOf(prev, cfg.edgeLabelFontSize)) {
      edgeBetween.set(k, e);
    }
  });

  const adjacentNeed = new Map();
  const needs = [];
  edgeBetween.forEach((e, k) => {
    const a = byId.get(e.sourceId);
    const b = byId.get(e.destinationId);
    if (!a || !b) return;
    // Direction is unknown before the layout exists, so average the two axes.
    const need = (requiredEdgeLength(a, b, e, cfg, 1, 0) + requiredEdgeLength(a, b, e, cfg, 0, 1)) / 2;
    adjacentNeed.set(k, need);
    needs.push(need);
  });

  needs.sort((x, y) => x - y);
  const unit = needs.length > 0 ? needs[Math.floor(needs.length / 2)] : cfg.minEdgeLength;

  const targets = new Map();
  hops.forEach((row, sourceId) => {
    const out = new Map();
    row.forEach((h, targetId) => {
      const exact = h === 1 ? adjacentNeed.get(pairKey(sourceId, targetId)) : null;
      out.set(targetId, exact ?? h * unit);
    });
    targets.set(sourceId, out);
  });
  return { targets, unit };
}

// ============================================================================
// SMACOF
// ============================================================================

/** Σ w_ij (‖xi − xj‖ − d_ij)², over the sparse pair set. Counted once per pair. */
export function stressOf(positions, targets) {
  let total = 0;
  targets.forEach((row, i) => {
    const pi = positions.get(i);
    if (!pi) return;
    row.forEach((d, j) => {
      if (i >= j) return; // each pair once
      const pj = positions.get(j);
      if (!pj) return;
      const actual = Math.hypot(pi.x - pj.x, pi.y - pj.y);
      const w = 1 / (d * d);
      total += w * (actual - d) * (actual - d);
    });
  });
  return total;
}

/**
 * Minimise stress by majorization.
 *
 * Each iteration replaces the objective with a convex quadratic upper bound
 * that touches it at the current configuration, then jumps to that bound's
 * minimum. Because the bound is above the objective everywhere and equal at the
 * current point, the new configuration's stress cannot be worse — which is the
 * guarantee the whole approach rests on.
 *
 * @returns {{centers: Map, iterations: number, stress: number, converged: boolean}}
 */
export function stressMajorize(initial, nodes, targets, options = {}) {
  const cfg = { ...STRESS_DEFAULTS, ...options };
  let positions = new Map(initial);

  // Precompute Σ_j w_ij per node — constant across iterations.
  const weightSum = new Map();
  targets.forEach((row, i) => {
    let s = 0;
    row.forEach(d => { s += 1 / (d * d); });
    weightSum.set(i, s);
  });

  let previous = stressOf(positions, targets);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < cfg.iterations; iter++) {
    iterations = iter + 1;
    const next = new Map();

    nodes.forEach(node => {
      const i = node.id;
      const pi = positions.get(i);
      const row = targets.get(i);
      const denom = weightSum.get(i);
      if (!pi || !row || !denom) { if (pi) next.set(i, pi); return; }

      let numX = 0;
      let numY = 0;
      row.forEach((d, j) => {
        const pj = positions.get(j);
        if (!pj) return;
        const w = 1 / (d * d);
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const actual = Math.hypot(dx, dy);
        // Coincident points have no direction; the majorization term reduces to
        // the neighbour's position, which is what pushes them apart next round.
        const ux = actual > 1e-9 ? dx / actual : 0;
        const uy = actual > 1e-9 ? dy / actual : 0;
        numX += w * (pj.x + d * ux);
        numY += w * (pj.y + d * uy);
      });

      next.set(i, { x: numX / denom, y: numY / denom });
    });

    positions = next;
    const current = stressOf(positions, targets);

    // Relative improvement. This is a real stopping criterion, not a schedule.
    if (previous > 0 && (previous - current) / previous < cfg.epsilon) {
      previous = current;
      converged = true;
      break;
    }
    previous = current;
  }

  return { centers: positions, iterations, stress: previous, converged };
}

// ============================================================================
// SEEDING
// ============================================================================

/**
 * PivotMDS — Brandes & Pich, "Eigensolver Methods for Progressive
 * Multidimensional Scaling of Large Data" (GD 2006).
 *
 * Classical MDS against a handful of well-spread pivots instead of the full
 * distance matrix, giving an O(N·k) seed that already has the graph's global
 * shape. SMACOF then only has to do local refinement, which is where it is
 * fast; started from noise on a large graph it spends most of its budget
 * discovering structure PivotMDS finds in one pass.
 */
export function pivotMDS(nodes, adjacency, unit, pivotCount) {
  const n = nodes.length;
  const k = Math.min(pivotCount, n);
  if (k < 2) return new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));

  // Max-min pivot selection: each new pivot is the node furthest from all
  // chosen so far, which spreads them over the graph rather than clumping.
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const pivots = [nodes[0].id];
  const minDist = new Array(n).fill(Infinity);

  const bfsFrom = (sourceId) => {
    const d = new Array(n).fill(-1);
    d[index.get(sourceId)] = 0;
    let frontier = [sourceId];
    let hop = 0;
    while (frontier.length > 0) {
      hop++;
      const next = [];
      for (const id of frontier) {
        for (const nbr of adjacency.get(id) || []) {
          const ni = index.get(nbr);
          if (ni === undefined || d[ni] !== -1) continue;
          d[ni] = hop;
          next.push(nbr);
        }
      }
      frontier = next;
    }
    // Disconnected nodes: treat as far, but finite, so the matrix stays usable.
    for (let i = 0; i < n; i++) if (d[i] === -1) d[i] = hop + 2;
    return d;
  };

  const columns = [];
  for (let p = 0; p < k; p++) {
    const d = bfsFrom(pivots[pivots.length - 1]);
    columns.push(d);
    for (let i = 0; i < n; i++) minDist[i] = Math.min(minDist[i], d[i]);
    if (p + 1 < k) {
      let far = 0;
      for (let i = 1; i < n; i++) if (minDist[i] > minDist[far]) far = i;
      pivots.push(nodes[far].id);
    }
  }

  // Double-centre the squared-distance matrix.
  const C = columns.map(col => col.map(v => v * v));
  const rowMean = new Array(n).fill(0);
  const colMean = new Array(k).fill(0);
  let grand = 0;
  for (let p = 0; p < k; p++) {
    for (let i = 0; i < n; i++) { rowMean[i] += C[p][i] / k; colMean[p] += C[p][i] / n; }
  }
  for (let p = 0; p < k; p++) grand += colMean[p] / k;
  const B = [];
  for (let p = 0; p < k; p++) {
    B.push(new Array(n));
    for (let i = 0; i < n; i++) B[p][i] = -0.5 * (C[p][i] - rowMean[i] - colMean[p] + grand);
  }

  // Two leading eigenvectors of BᵀB by power iteration with deflation.
  const mulBtB = (v) => {
    const tmp = new Array(k).fill(0);
    for (let p = 0; p < k; p++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += B[p][i] * v[i];
      tmp[p] = s;
    }
    const out = new Array(n).fill(0);
    for (let p = 0; p < k; p++) {
      for (let i = 0; i < n; i++) out[i] += B[p][i] * tmp[p];
    }
    return out;
  };
  const normalise = (v) => {
    const len = Math.hypot(...v) || 1;
    return v.map(x => x / len);
  };

  // Deterministic start vector — no Math.random, so layouts stay reproducible.
  let v1 = normalise(Array.from({ length: n }, (_, i) => Math.sin(i + 1)));
  for (let it = 0; it < 60; it++) v1 = normalise(mulBtB(v1));

  let v2 = normalise(Array.from({ length: n }, (_, i) => Math.cos(i + 1)));
  for (let it = 0; it < 60; it++) {
    let w = mulBtB(v2);
    const dot = w.reduce((s, x, i) => s + x * v1[i], 0);
    w = w.map((x, i) => x - dot * v1[i]);   // deflate
    v2 = normalise(w);
  }

  // Scale so the spread matches the graph's own distance unit.
  const spread = (v) => Math.max(...v) - Math.min(...v) || 1;
  const scale = (unit * Math.sqrt(n)) / 2;
  const sx = scale / spread(v1);
  const sy = scale / spread(v2);

  return new Map(nodes.map((node, i) => ({ node, i }))
    .map(({ node, i }) => [node.id, { x: v1[i] * sx, y: v2[i] * sy }]));
}

/** Deterministic circular seed for small graphs. */
export function circleSeed(nodes, unit) {
  const radius = (unit * nodes.length) / (2 * Math.PI) || unit;
  return new Map(nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, nodes.length);
    return [node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }];
  }));
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Lay out one connected component by stress majorization.
 * @returns {{centers: Map, stress: number, iterations: number, converged: boolean}}
 */
export function stressLayout(nodes, edges, cfg, options = {}) {
  const opts = { ...STRESS_DEFAULTS, ...options };
  if (nodes.length === 0) return { centers: new Map(), stress: 0, iterations: 0, converged: true };
  if (nodes.length === 1) {
    return { centers: new Map([[nodes[0].id, { x: 0, y: 0 }]]), stress: 0, iterations: 0, converged: true };
  }

  const adjacency = buildAdjacency(nodes, edges);
  const hops = hopDistances(nodes, adjacency, opts.maxHops);
  const { targets, unit } = targetDistances(nodes, edges, hops, cfg);

  const seed = options.initial
    ? new Map(options.initial)
    : (nodes.length >= opts.pivotThreshold
      ? pivotMDS(nodes, adjacency, unit, opts.pivotCount)
      : circleSeed(nodes, unit));

  return stressMajorize(seed, nodes, targets, opts);
}
