/**
 * ORTHOGONAL ROUTING HAS ITS OWN AUTO-LAYOUT.
 *
 * Same argument lombardiLayout.js makes, with the sign flipped.
 *
 * WHY THE SEEDS ARE THE OPPOSITE OF LOMBARDI'S
 * ────────────────────────────────────────────
 * A Lombardi drawing wants its neighbours distributed AROUND each node, so the
 * paper's constructions put vertices on circles — a node on a ring genuinely
 * has edges leaving it in every direction, and perfect angular resolution comes
 * almost for free.
 *
 * An orthogonal drawing wants the exact opposite. Two nodes that share an x or
 * a y coordinate are joined by a route with ZERO bends. Two nodes in general
 * position always need at least one, usually two. So the property that makes a
 * layout good under Manhattan/Clean routing is SHARED COORDINATES — rows and
 * columns — and a circle is the worst possible seed, because no two vertices on
 * one share anything.
 *
 * That is also why the force solver is an actively bad starting point here
 * rather than merely a mediocre one: a continuous energy minimum is in general
 * position by construction. No two nodes will share a coordinate, ever. It is
 * not a tuning failure, it is what a smooth minimum looks like.
 *
 * THE PIPELINE
 * ────────────
 *   1. SEED. Per-topology constructions chosen for the coordinates they SHARE:
 *      ranks for hierarchies, serpentine rows for chains, a rectangle (not a
 *      circle) for cycles, four axis-aligned rays for stars.
 *
 *   2. ALIGN. Snap near-shared coordinates into exactly-shared ones, under
 *      orthogonal-ordering constraints so nothing overtakes anything else and
 *      the arrangement the seed chose survives. This is the alignment stage of
 *      HOLA (Kieffer, Dwyer, Marriott & Wybrow, "HOLA: Human-like Orthogonal
 *      Network Layout", IEEE TVCG 2016), and the 1-D solve is the priority
 *      method from Brandes & Köpf's coordinate assignment (GD 2001).
 *
 *   3. CLEAR. Handled by pathClearance.js against the ROUTED POLYLINE, with
 *      aligned nodes restricted to their free axis so clearing a path cannot
 *      undo the alignment stage 2 just built.
 *
 * ALL POSITIONS HERE ARE CENTRES.
 */

import {
  boxOf,
  boxMTV,
  halfExtentTowards,
  requiredEdgeLength,
  labelSpanOf
} from './layoutGeometry.js';

// Two coordinates within this fraction of nodeGap are treated as "meant to be
// the same" and snapped together.
const SNAP_FRACTION = 0.5;

const halfW = (n) => boxOf(n).w / 2;
const halfH = (n) => boxOf(n).h / 2;

// ============================================================================
// SEEDS
// ============================================================================

/**
 * CHAIN → serpentine rows.
 *
 * A chain laid out as one straight line is already zero-bend, but at twenty
 * nodes it is also twenty node-widths across and unreadable. Wrapping it into
 * rows keeps every within-row edge zero-bend and costs one bend per wrap.
 *
 * Column x-positions are shared across rows, so the vertical wrap segments line
 * up into a lane instead of scattering.
 */
export function serpentineCentered(nodes, edges, cfg, meta = {}) {
  const order = chainOrder(nodes, edges, meta);
  if (order.length === 0) return new Map();

  const byId = new Map(nodes.map(n => [n.id, n]));
  const seq = order.map(id => byId.get(id)).filter(Boolean);
  const edgeBetween = pairIndex(edges);

  // Longest run that fits the target width.
  const gapFor = (a, b) => {
    const e = edgeBetween.get(pairKey(a.id, b.id));
    return requiredEdgeLength(a, b, e, cfg, 1, 0);
  };

  let perRow = seq.length;
  let width = 0;
  for (let i = 1; i < seq.length; i++) width += gapFor(seq[i - 1], seq[i]);
  if (width > cfg.width) {
    perRow = Math.max(2, Math.floor(Math.sqrt(seq.length * (cfg.width / Math.max(1, cfg.height)))));
  }

  // Shared column positions: each column is as wide as its widest occupant.
  const columns = Math.min(perRow, seq.length);
  const colWidth = new Array(columns).fill(0);
  seq.forEach((n, i) => {
    const c = i % columns;
    colWidth[c] = Math.max(colWidth[c], halfW(n) * 2);
  });

  const colX = [];
  let cursor = 0;
  for (let c = 0; c < columns; c++) {
    colX.push(cursor + colWidth[c] / 2);
    const next = seq[c + 1];
    const step = next
      ? Math.max(colWidth[c] / 2 + halfW(next) + cfg.nodeGap, gapFor(seq[c], next))
      : colWidth[c] + cfg.nodeGap;
    cursor += step;
  }

  const rowH = Math.max(...seq.map(halfH)) * 2 + cfg.nodeGap * 1.5;
  const out = new Map();
  seq.forEach((n, i) => {
    const row = Math.floor(i / columns);
    const idx = i % columns;
    // Alternate direction so consecutive nodes stay adjacent across the wrap.
    const col = row % 2 === 0 ? idx : columns - 1 - idx;
    out.set(n.id, { x: colX[col], y: row * rowH });
  });
  return out;
}

/**
 * CYCLE → a RECTANGLE, not a circle.
 *
 * cycleLayoutCentered puts the ring on a circle, which is right for straight
 * and Lombardi routing and worst-case for orthogonal: every one of the ring's
 * edges lands in general position and needs two bends. Distributed over four
 * sides of a rectangle, all but the four corner edges are zero-bend.
 */
export function rectRingCentered(nodes, edges, cfg, meta = {}) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const ring = (meta.ringIds || nodes.map(n => n.id)).filter(id => byId.has(id));
  if (ring.length === 0) return new Map();
  if (ring.length < 4) {
    // Too few to make a rectangle; a single row is already all zero-bend.
    return serpentineCentered(nodes, edges, { ...cfg, width: Infinity }, { startId: ring[0] });
  }

  const edgeBetween = pairIndex(edges);

  // Walk the ring as ARC LENGTH around the perimeter rather than splitting it
  // into four independently-placed sides. Placing each side on its own with an
  // even `t` ignores what happens ACROSS a corner: the last node of one side
  // and the first of the next are laid out by different calculations and end up
  // overlapping, since neither accounts for the other's extents.
  const gaps = ring.map((id, i) => {
    const a = byId.get(id);
    const b = byId.get(ring[(i + 1) % ring.length]);
    const e = edgeBetween.get(pairKey(a.id, b.id));
    // Unknown which side this pair will land on, so demand the larger of the
    // two axes — a corner pair genuinely needs both.
    return Math.max(
      requiredEdgeLength(a, b, e, cfg, 1, 0),
      requiredEdgeLength(a, b, e, cfg, 0, 1)
    );
  });

  const perimeter = gaps.reduce((s, g) => s + g, 0);
  const side = Math.max(perimeter / 4, cfg.minEdgeLength);
  const width = side;
  const height = side;

  // Position on the perimeter → point on the rectangle, starting at the
  // top-left corner and running clockwise.
  const pointAt = (d) => {
    const t = ((d % perimeter) + perimeter) % perimeter;
    const scaled = (t / perimeter) * (2 * width + 2 * height);
    if (scaled <= width) return { x: -width / 2 + scaled, y: -height / 2 };
    if (scaled <= width + height) return { x: width / 2, y: -height / 2 + (scaled - width) };
    if (scaled <= 2 * width + height) return { x: width / 2 - (scaled - width - height), y: height / 2 };
    return { x: -width / 2, y: height / 2 - (scaled - 2 * width - height) };
  };

  const out = new Map();
  let travelled = 0;
  ring.forEach((id, i) => {
    out.set(id, pointAt(travelled));
    travelled += gaps[i];
  });
  return out;
}

/**
 * STAR → compass placement. Every spoke is zero-bend.
 *
 * Leaves are assigned to the ray whose axis is CHEAPEST for that pair, so wide
 * leaves go north/south (where only their height has to clear the hub) and tall
 * ones go east/west. That is the same direction-aware reasoning halfExtentTowards
 * exists for, applied to placement rather than spacing.
 */
export function compassCentered(nodes, edges, cfg, meta = {}) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const hubId = meta.hubId && byId.has(meta.hubId) ? meta.hubId : degreeHub(nodes, edges);
  const hub = byId.get(hubId);
  if (!hub) return new Map();

  const leaves = nodes.filter(n => n.id !== hubId);
  const edgeBetween = pairIndex(edges);
  const AXES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

  // Balanced round-robin, cheapest-axis-first. Strictly preferring the cheap
  // axis piles every leaf onto one ray — for a star of wide nodes, north and
  // south are cheapest for ALL of them — which is a row, not a compass.
  const scored = leaves.map(leaf => {
    const e = edgeBetween.get(pairKey(hubId, leaf.id));
    const costs = AXES.map(([dx, dy]) => requiredEdgeLength(hub, leaf, e, cfg, dx, dy));
    return { leaf, costs, best: costs.indexOf(Math.min(...costs)) };
  }).sort((a, b) => Math.min(...a.costs) - Math.min(...b.costs));

  const rays = [[], [], [], []];
  scored.forEach(({ leaf, best }) => {
    // Take the cheapest axis among those currently least loaded, so the four
    // rays stay within one leaf of each other.
    const fewest = Math.min(...rays.map(r => r.length));
    const eligible = [0, 1, 2, 3].filter(a => rays[a].length === fewest);
    const target = eligible.includes(best) ? best : eligible[0];
    rays[target].push(leaf);
  });

  // Each ray becomes a LINE OF LEAVES PERPENDICULAR TO IT, all at one distance
  // from the hub — a row above, a row below, a column each side. Every spoke is
  // then a single bend, and the leaf sitting on the hub's own axis is zero-bend.
  // Stacking them along the ray instead would put the far ones directly behind
  // the near ones' edges, which is the shape this layout exists to avoid.
  //
  // Lane offsets perpendicular to the ray put the FIRST leaf exactly ON the
  // hub's axis and alternate the rest outward from it.
  //
  // Centring the lanes instead would look tidier and be strictly worse: the
  // router picks opposite sides of the SAME axis for every edge, so initOrient
  // always equals finalOrient and a Manhattan route is two bends unless its
  // endpoints are exactly collinear. Putting one leaf per ray on the axis is
  // therefore the only way to buy a zero-bend spoke at all.
  const lanes = rays.map((leavesOnRay, axis) => {
    const [dx, dy] = AXES[axis];
    const perp = [dy, dx]; // (0,±1) → (±1,0) and vice versa
    const extents = leavesOnRay.map(leaf => halfExtentTowards(leaf, perp[0], perp[1]));

    const offsets = [];
    let positive = 0;
    let negative = 0;
    leavesOnRay.forEach((leaf, i) => {
      let offset;
      if (i === 0) {
        offset = 0;
        positive = extents[0];
        negative = extents[0];
      } else if (i % 2 === 1) {
        offset = positive + cfg.nodeGap + extents[i];
        positive = offset + extents[i];
      } else {
        offset = -(negative + cfg.nodeGap + extents[i]);
        negative = -offset + extents[i];
      }
      offsets.push(offset);
    });

    // Distance out: the largest requirement on this ray, so no spoke is short.
    let distance = 0;
    leavesOnRay.forEach(leaf => {
      const e = edgeBetween.get(pairKey(hubId, leaf.id));
      distance = Math.max(distance, requiredEdgeLength(hub, leaf, e, cfg, dx, dy));
    });

    return {
      leaves: leavesOnRay,
      perp,
      offsets,
      distance,
      // How far this ray's row/column reaches SIDEWAYS from the hub's axis...
      lateralReach: Math.max(0, ...offsets.map((o, i) => Math.abs(o) + extents[i])),
      // ...and how thick it is along its own ray.
      halfThickness: Math.max(0, ...leavesOnRay.map(leaf => halfExtentTowards(leaf, dx, dy)))
    };
  });

  // Corner clearance. Each ray is a row (N, S) or a column (E, W), and a row's
  // sideways reach is measured on the same axis a column's distance is. With
  // two or more leaves per ray those two grow independently, and past about
  // seven leaves the end of the north row lands on top of the east column —
  // node overlaps that no amount of routing can fix. Pushing each ray out past
  // the perpendicular rays' reach separates them on that axis outright.
  //
  // One pass suffices: lateralReach does not depend on distance, so nothing
  // here feeds back into the numbers it is computed from.
  const reachOf = (a, b) => Math.max(lanes[a].lateralReach, lanes[b].lateralReach);
  [0, 2].forEach(axis => {  // N, S — rows; cleared against the E/W columns
    lanes[axis].distance = Math.max(
      lanes[axis].distance,
      reachOf(1, 3) + cfg.nodeGap + lanes[axis].halfThickness
    );
  });
  [1, 3].forEach(axis => {  // E, W — columns; cleared against the N/S rows
    lanes[axis].distance = Math.max(
      lanes[axis].distance,
      reachOf(0, 2) + cfg.nodeGap + lanes[axis].halfThickness
    );
  });

  const out = new Map([[hubId, { x: 0, y: 0 }]]);
  lanes.forEach(({ leaves: leavesOnRay, perp, offsets, distance }, axis) => {
    const [dx, dy] = AXES[axis];
    leavesOnRay.forEach((leaf, i) => {
      out.set(leaf.id, {
        x: dx * distance + perp[0] * offsets[i],
        y: dy * distance + perp[1] * offsets[i]
      });
    });
  });

  return out;
}

// ============================================================================
// ALIGN
// ============================================================================

/**
 * Snap near-shared coordinates into exactly-shared ones.
 *
 * Two nodes whose x values differ by less than half a nodeGap were almost
 * certainly meant to be in the same column; making them exactly equal converts
 * a two-bend route into a zero-bend one. The seeds above already produce
 * genuine alignment, so most of the work here is on MESH components coming out
 * of the force solver, plus cleaning up rounding in the others.
 *
 * The ORDERING CONSTRAINT is what keeps this safe: clusters are snapped to
 * their own mean and processed in sorted order, and a cluster is only formed
 * from coordinates already adjacent in that order. So no node ever crosses
 * another on either axis, and the arrangement the user is looking at survives.
 *
 * @returns {{centers: Map, alignedX: Set, alignedY: Set}}
 */
export function alignToLattice(centers, nodes, edges, cfg) {
  const gap = cfg.nodeGap ?? 140;
  const tolerance = cfg.snapTolerance ?? gap * SNAP_FRACTION;
  let out = new Map(centers);
  const alignedX = new Set();
  const alignedY = new Set();

  // ---- Edge-driven alignment, first --------------------------------------
  // Global clustering alone barely fires on force-solver output: a continuous
  // energy minimum spreads nodes out, so almost no two coordinates land within
  // half a nodeGap of each other and nothing gets snapped.
  //
  // But not all alignments are worth the same. Aligning two CONNECTED nodes
  // converts a two-bend route into a zero-bend one; aligning two unrelated
  // nodes only tidies. So connected pairs get a larger tolerance and are
  // resolved first, by union-find over the "should share this coordinate"
  // relation, with each group settling on its members' mean.
  const alignEdges = (axis, aligned) => {
    const parent = new Map(nodes.map(n => [n.id, n.id]));
    const find = (id) => {
      while (parent.get(id) !== id) {
        parent.set(id, parent.get(parent.get(id)));
        id = parent.get(id);
      }
      return id;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    let any = false;
    (edges || []).forEach(e => {
      const a = out.get(e.sourceId);
      const b = out.get(e.destinationId);
      if (!a || !b || e.sourceId === e.destinationId) return;
      if (Math.abs(a[axis] - b[axis]) <= (cfg.edgeSnapTolerance ?? gap)) {
        union(e.sourceId, e.destinationId);
        any = true;
      }
    });
    if (!any) return;

    const groups = new Map();
    nodes.forEach(n => {
      const root = find(n.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(n.id);
    });

    groups.forEach(ids => {
      if (ids.length < 2) return;
      const mean = ids.reduce((s, id) => s + out.get(id)[axis], 0) / ids.length;
      ids.forEach(id => {
        out.set(id, { ...out.get(id), [axis]: mean });
        aligned.add(id);
      });
    });
  };

  alignEdges('x', alignedX);
  alignEdges('y', alignedY);

  // ---- Global clustering, second -----------------------------------------
  const snapAxis = (axis, aligned) => {
    const entries = [...out.entries()]
      .map(([id, p]) => ({ id, v: p[axis] }))
      .sort((a, b) => a.v - b.v);
    if (entries.length === 0) return;

    let cluster = [entries[0]];
    const flush = () => {
      if (cluster.length > 1) {
        const mean = cluster.reduce((s, e) => s + e.v, 0) / cluster.length;
        cluster.forEach(e => {
          out.set(e.id, { ...out.get(e.id), [axis]: mean });
          aligned.add(e.id);
        });
      }
      cluster = [];
    };

    for (let i = 1; i < entries.length; i++) {
      // Compare against the cluster's leading edge, not its mean, so a long
      // gentle ramp of near-equal values can't chain into one giant cluster
      // that drags a node halfway across the drawing.
      if (entries[i].v - cluster[0].v <= tolerance) cluster.push(entries[i]);
      else { flush(); cluster = [entries[i]]; }
    }
    flush();
  };

  snapAxis('x', alignedX);
  snapAxis('y', alignedY);

  return { centers: out, alignedX, alignedY };
}

/**
 * Push overlapping boxes apart, minimum-translation, in place.
 *
 * Needed between clearance rounds: sliding a node out of an edge's lane can put
 * it inside a neighbour, and with nothing to separate them the next round sees
 * a different violation and oscillates. Same alternation the force solver's
 * terminal block uses, minus the bounds clamping (components are packed later).
 */
export function separateBoxes(centers, nodes, cfg, passes = 3) {
  const out = new Map(centers);
  const gap = cfg.nodeGap ?? 140;
  const boxes = new Map(nodes.map(n => [n.id, { hw: halfW(n), hh: halfH(n) }]));

  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = out.get(nodes[i].id);
        const b = out.get(nodes[j].id);
        if (!a || !b) continue;
        const mtv = boxMTV(a, boxes.get(nodes[i].id), b, boxes.get(nodes[j].id), gap);
        if (!mtv) continue;
        out.set(nodes[i].id, { x: a.x - mtv.dx / 2, y: a.y - mtv.dy / 2 });
        out.set(nodes[j].id, { x: b.x + mtv.dx / 2, y: b.y + mtv.dy / 2 });
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/**
 * Which axis a node may still move along without losing its alignment.
 *
 * Handed to clearPathsOfNodes so the CLEAR stage can push a node off an edge
 * without undoing the column or row that ALIGN just put it in. A node aligned
 * on both axes is left free rather than pinned — an edge drawn through a node
 * is a worse defect than a broken alignment.
 */
export function axisRestrictionFor(alignedX, alignedY) {
  return (nodeId) => {
    const x = alignedX.has(nodeId);
    const y = alignedY.has(nodeId);
    if (x && !y) return 'y';   // column matters → may move vertically
    if (y && !x) return 'x';   // row matters → may move horizontally
    return null;
  };
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function pairIndex(edges) {
  const index = new Map();
  (edges || []).forEach(e => {
    const k = pairKey(e.sourceId, e.destinationId);
    const existing = index.get(k);
    // Keep the widest label — that is the binding spacing requirement.
    if (!existing || labelSpanOf(e, 59.4) > labelSpanOf(existing, 59.4)) index.set(k, e);
  });
  return index;
}

function degreeHub(nodes, edges) {
  const degree = new Map(nodes.map(n => [n.id, 0]));
  (edges || []).forEach(e => {
    degree.set(e.sourceId, (degree.get(e.sourceId) || 0) + 1);
    degree.set(e.destinationId, (degree.get(e.destinationId) || 0) + 1);
  });
  let best = nodes[0]?.id;
  let bestDeg = -1;
  degree.forEach((d, id) => { if (d > bestDeg) { bestDeg = d; best = id; } });
  return best;
}

/** Walk a chain from one endpoint to the other. */
function chainOrder(nodes, edges, meta) {
  const ids = new Set(nodes.map(n => n.id));
  const adjacency = new Map(nodes.map(n => [n.id, []]));
  (edges || []).forEach(e => {
    if (!ids.has(e.sourceId) || !ids.has(e.destinationId)) return;
    if (e.sourceId === e.destinationId) return;
    adjacency.get(e.sourceId).push(e.destinationId);
    adjacency.get(e.destinationId).push(e.sourceId);
  });

  let start = meta.startId && ids.has(meta.startId) ? meta.startId : null;
  if (!start) {
    for (const [id, nbrs] of adjacency) {
      if (nbrs.length === 1) { start = id; break; }
    }
  }
  if (!start) start = nodes[0]?.id;
  if (!start) return [];

  const order = [];
  const seen = new Set();
  let current = start;
  while (current && !seen.has(current)) {
    order.push(current);
    seen.add(current);
    current = (adjacency.get(current) || []).find(n => !seen.has(n));
  }
  // Anything disconnected from the walk still has to be placed.
  nodes.forEach(n => { if (!seen.has(n.id)) order.push(n.id); });
  return order;
}
