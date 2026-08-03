/**
 * Pattern layouts — deterministic layouts for graphs with a recognizable shape.
 *
 * WHY THESE EXIST
 * Force-directed layout is the general solver and stays the default. But it is
 * a physics simulation: it converges to *a* good arrangement, not *the* good
 * arrangement, and small changes move everything. When a graph has an obvious
 * shape, a dedicated layout is predictable — the same graph lands the same way
 * every time, and the arrangement itself carries meaning (depth = generality in
 * a tree, ring order = sequence in a cycle).
 *
 * THE ONE GEOMETRY FACT THAT DRIVES EVERYTHING
 * NodeCanvas draws connection labels ROTATED ALONG the edge, centered at the
 * edge midpoint. So a label does not consume horizontal space — it consumes
 * EDGE LENGTH. Every constraint in this file is therefore the same constraint:
 *
 *     |edge| >= halfExtent(a, dir) + halfExtent(b, dir) + labelWidth + padding
 *
 * That single inequality is what makes these layouts label-aware. "influenced
 * the development of" between two nodes forces those nodes apart; "is a"
 * doesn't. Tree levels, ring radii, chain spacing and star spokes are all just
 * different ways of solving it.
 *
 * COORDINATE CONVENTION
 * Everything in this file works in NODE CENTERS. The exported entry points
 * convert to top-left at the very end, because that is what instance positions
 * are. (The force solver conflates the two; these layouts don't, which is why
 * wide nodes stop overlapping.)
 */

import { estimateEdgeLabelWidth, forceDirectedLayout } from './graphLayoutService.js';
import {
  TOPOLOGY,
  TOPOLOGY_LAYOUT,
  detectTopology,
  buildSimpleGraph,
  chooseTreeRoot
} from './topologyDetection.js';

export const PATTERN_LAYOUT_DEFAULTS = {
  width: 2000,
  height: 1500,

  // Minimum clear space between two node boxes that aren't connected.
  nodeGap: 140,
  // Extra clearance added around an edge label, along the edge.
  labelPadding: 90,
  // No edge is ever shorter than this, even between two tiny unlabeled nodes.
  minEdgeLength: 260,
  // Must track NodeCanvas: 59.4 × textSettings.fontSize × connectionLabelSize.
  edgeLabelFontSize: 59.4,

  // Tree/layered: a level gap of at least this fraction of the widest sibling
  // fan at that level. Keeps parent→child edges steep enough that adjacent
  // labels separate perpendicular to each other instead of running collinear.
  steepnessFactor: 0.35,

  // 'auto' scores vertical vs horizontal and keeps whichever fits the canvas
  // aspect better. Long labels stretch the level axis, so this matters.
  treeDirection: 'auto',

  // 'top' | 'flow' — where the root of an inward-pointing hierarchy goes.
  // See the note in treeLayoutCentered; 'top' keeps the general term above.
  rootPlacement: 'top',

  // Gap between independently laid-out connected components.
  componentGap: 460,

  // Fallback for components with no clean structure.
  fallbackAlgorithm: 'force',

  // Which edge routing the result will be drawn with. Only 'lombardi' changes
  // anything — see the LOMBARDI section below for why arcs need a different
  // shape of layout AND more room than chords.
  routingStyle: 'straight',
  lombardiCurvature: 1.0
};

const MIN_BOX = 60;

// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

const boxOf = (node) => ({
  w: Math.max(node?.width || 0, node?.labelWidth || 0, MIN_BOX),
  h: Math.max(node?.height || 0, MIN_BOX)
});

/**
 * Half-extent of a node's box measured along direction (dx, dy) — i.e. how far
 * the node's edge-attachment point sits from its center for an edge leaving in
 * that direction. This is what makes spacing tight for edges leaving a wide
 * node vertically and generous for edges leaving it horizontally.
 */
function halfExtentTowards(node, dx, dy) {
  const { w, h } = boxOf(node);
  const halfW = w / 2;
  const halfH = h / 2;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6) return halfH;
  if (ay < 1e-6) return halfW;
  const len = Math.hypot(dx, dy);
  return Math.min(halfW / (ax / len), halfH / (ay / len));
}

/** Worst-case radius — the circumscribed circle. Used before directions exist. */
const circumRadius = (node) => {
  const { w, h } = boxOf(node);
  return Math.hypot(w, h) / 2;
};

const labelSpanOf = (edge, fontSize) => estimateEdgeLabelWidth(edge?.name || '', fontSize);

/**
 * The core constraint: minimum center-to-center distance for this edge.
 * `dx, dy` is the direction the edge will run; pass (1,0)/(0,1) when the axis
 * is known, or the actual delta during a refinement pass.
 */
function requiredEdgeLength(a, b, edge, cfg, dx = 1, dy = 0) {
  const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
  const clearance = halfExtentTowards(a, dx, dy) + halfExtentTowards(b, dx, dy);
  return Math.max(cfg.minEdgeLength, clearance + label + (label > 0 ? cfg.labelPadding : cfg.nodeGap));
}

/**
 * Smallest radius R at which a ring of nodes can be spaced so that every
 * adjacent pair is at least `chords[i]` apart.
 *
 * A chord of length c subtends 2·asin(c / 2R). The ring closes only when those
 * angles sum to at most 2π, and that sum shrinks monotonically as R grows — so
 * binary search finds the tightest R that fits. This is what lets a ring of
 * short labels stay compact while one long label on one edge opens the whole
 * circle just enough to fit it.
 */
export function solveRingRadius(chords) {
  if (chords.length === 0) return 0;
  const maxChord = Math.max(...chords);
  const totalChord = chords.reduce((sum, c) => sum + c, 0);
  if (chords.length === 1) return maxChord / 2;
  if (chords.length === 2) return maxChord / 2;

  const angleSum = (R) => chords.reduce(
    (sum, c) => sum + 2 * Math.asin(Math.min(1, c / (2 * R))), 0
  );

  let lo = maxChord / 2;
  let hi = Math.max(maxChord, totalChord / 2);
  let guard = 0;
  while (angleSum(hi) > 2 * Math.PI && guard++ < 80) hi *= 1.5;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (angleSum(mid) > 2 * Math.PI) lo = mid; else hi = mid;
  }
  return hi;
}

/** Distribute 2π across the ring, giving each gap angle in proportion to need. */
function ringAngles(chords, radius) {
  const needed = chords.map(c => 2 * Math.asin(Math.min(1, c / (2 * radius))));
  const total = needed.reduce((sum, a) => sum + a, 0);
  const slack = Math.max(0, 2 * Math.PI - total);
  const angles = [];
  let theta = -Math.PI / 2; // start at 12 o'clock
  for (let i = 0; i < chords.length; i++) {
    angles.push(theta);
    const share = total > 0 ? needed[i] / total : 1 / chords.length;
    theta += needed[i] + slack * share;
  }
  return angles;
}

/** Longest-label edge for each unordered node pair, keyed "a|b". */
function buildEdgeIndex(edges, fontSize) {
  const index = new Map();
  (edges || []).forEach(edge => {
    if (!edge || edge.sourceId === edge.destinationId) return;
    const key = edge.sourceId < edge.destinationId
      ? `${edge.sourceId}|${edge.destinationId}`
      : `${edge.destinationId}|${edge.sourceId}`;
    const existing = index.get(key);
    if (!existing || labelSpanOf(edge, fontSize) > labelSpanOf(existing, fontSize)) {
      index.set(key, edge);
    }
  });
  return index;
}

const lookupEdge = (index, a, b) => index.get(a < b ? `${a}|${b}` : `${b}|${a}`) || null;

function bboxOfCenters(positions, nodeById) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach((pos, id) => {
    const { w, h } = boxOf(nodeById.get(id));
    minX = Math.min(minX, pos.x - w / 2);
    maxX = Math.max(maxX, pos.x + w / 2);
    minY = Math.min(minY, pos.y - h / 2);
    maxY = Math.max(maxY, pos.y + h / 2);
  });
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Center positions → instance (top-left) positions. */
function centersToTopLeft(positions, nodeById) {
  const out = new Map();
  positions.forEach((pos, id) => {
    const { w, h } = boxOf(nodeById.get(id));
    out.set(id, { x: pos.x - w / 2, y: pos.y - h / 2 });
  });
  return out;
}

// ============================================================================
// LEVEL GAP SOLVER (shared by tree + layered)
// ============================================================================

/**
 * Turn per-level edge lists into main-axis gaps.
 *
 * For each edge we already know its cross-axis offset (the horizontal shift
 * between parent and child in a vertical tree). The required straight-line
 * length L and that offset give the main-axis component by Pythagoras:
 *
 *     gap >= sqrt(L² - Δcross²)
 *
 * An edge that already runs far sideways needs less vertical room; a straight
 * parent-above-child edge needs the whole label length. Taking the max over
 * every edge crossing a level yields the tightest gap that still fits every
 * label at that depth.
 */
function resolveLevelGaps(levelEdges, levelSpread, cfg, vertical) {
  return levelEdges.map((edgesAtLevel, depth) => {
    let gap = cfg.minEdgeLength;

    edgesAtLevel.forEach(({ a, b, edge, crossDelta, span = 1 }) => {
      const dirX = vertical ? crossDelta : 1;
      const dirY = vertical ? 1 : crossDelta;
      const required = requiredEdgeLength(a, b, edge, cfg, dirX, dirY) / Math.max(1, span);
      const mainComponent = Math.sqrt(Math.max(0, required * required - crossDelta * crossDelta));
      const floor = vertical
        ? (boxOf(a).h + boxOf(b).h) / 2 + cfg.nodeGap
        : (boxOf(a).w + boxOf(b).w) / 2 + cfg.nodeGap;
      gap = Math.max(gap, mainComponent, floor);
    });

    // Keep edges steep enough that adjacent sibling labels don't run collinear.
    gap = Math.max(gap, (levelSpread[depth] || 0) * cfg.steepnessFactor);
    return gap;
  });
}

// ============================================================================
// TREE
// ============================================================================

/**
 * Tidy tree layout with variable node sizes and label-aware level gaps.
 *
 * Cross-axis placement is the classic bottom-up pass: a leaf claims its own
 * width, an internal node claims the sum of its children's claims and centers
 * itself over them. Main-axis placement is the label solver above.
 */
function treeLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);
  const rootId = meta.rootId && nodeById.has(meta.rootId)
    ? meta.rootId
    : chooseTreeRoot(nodes, edges, adjacency, cfg.rootId);

  if (!rootId) return new Map();

  // Spanning tree by BFS. In a true tree this IS the tree; if a caller forces
  // 'tree' on a graph with extra edges, the spanning tree is a sane skeleton
  // and the surplus edges just get drawn over it.
  const children = new Map(nodes.map(n => [n.id, []]));
  const depth = new Map([[rootId, 0]]);
  const order = [rootId];
  for (let head = 0; head < order.length; head++) {
    const id = order[head];
    Array.from(adjacency.get(id) || []).forEach(neighborId => {
      if (depth.has(neighborId)) return;
      depth.set(neighborId, depth.get(id) + 1);
      children.get(id).push(neighborId);
      order.push(neighborId);
    });
  }
  // Anything unreachable (disconnected input) hangs off the root.
  nodes.forEach(node => {
    if (!depth.has(node.id)) {
      depth.set(node.id, 1);
      children.get(rootId).push(node.id);
      order.push(node.id);
    }
  });

  const maxDepth = Math.max(...Array.from(depth.values()));

  const attempt = (vertical) => {
    const crossExtent = (id) => {
      const { w, h } = boxOf(nodeById.get(id));
      return vertical ? w : h;
    };
    const siblingGap = Math.max(cfg.nodeGap, cfg.edgeLabelFontSize * 1.4);

    const cross = new Map();

    const descendantsOf = (id) => {
      const list = [];
      const stack = [...(children.get(id) || [])];
      while (stack.length) {
        const current = stack.pop();
        list.push(current);
        stack.push(...(children.get(current) || []));
      }
      return list;
    };

    const place = (id, start) => {
      const kids = children.get(id) || [];
      const self = crossExtent(id);

      if (kids.length === 0) {
        cross.set(id, start + self / 2);
        return self;
      }

      let cursor = start;
      let total = 0;
      kids.forEach((kid, index) => {
        if (index > 0) { cursor += siblingGap; total += siblingGap; }
        const span = place(kid, cursor);
        cursor += span;
        total += span;
      });

      let center = (cross.get(kids[0]) + cross.get(kids[kids.length - 1])) / 2;

      // A node wider than everything below it widens its own subtree band.
      if (self > total) {
        const shift = (self - total) / 2;
        descendantsOf(id).forEach(descId => {
          cross.set(descId, cross.get(descId) + shift);
        });
        center += shift;
        total = self;
      }

      cross.set(id, center);
      return total;
    };

    place(rootId, 0);

    // Collect the edges crossing each level, with their cross-axis offsets.
    const levelEdges = Array.from({ length: maxDepth }, () => []);
    const levelSpread = new Array(maxDepth).fill(0);
    children.forEach((kids, parentId) => {
      if (kids.length === 0) return;
      const d = depth.get(parentId);
      if (d >= maxDepth) return;
      const parent = nodeById.get(parentId);
      let minCross = Infinity;
      let maxCross = -Infinity;
      kids.forEach(kidId => {
        const crossDelta = Math.abs(cross.get(kidId) - cross.get(parentId));
        levelEdges[d].push({
          a: parent,
          b: nodeById.get(kidId),
          edge: lookupEdge(edgeIndex, parentId, kidId),
          crossDelta
        });
        minCross = Math.min(minCross, cross.get(kidId));
        maxCross = Math.max(maxCross, cross.get(kidId));
      });
      levelSpread[d] = Math.max(levelSpread[d], maxCross - minCross);
    });

    const gaps = resolveLevelGaps(levelEdges, levelSpread, cfg, vertical);

    const mainAt = [0];
    for (let d = 0; d < maxDepth; d++) mainAt.push(mainAt[d] + gaps[d]);

    // Where the root goes when the hierarchy points inward — "Dog is a kind of
    // Mammal", arrows running from specific to general. Structure alone can't
    // settle this, because the same shape means opposite things:
    //
    //   'top'  — the root is always at depth 0, whichever way arrows point.
    //            Matches the Tree of Porphyry, UML inheritance and cladograms:
    //            the general term sits above, arrows read upward toward it.
    //   'flow' — arrows always run down the page, so an inward hierarchy puts
    //            its root at the bottom. Matches the layered DAG layout and
    //            suits convergence ("five causes → one effect").
    const sign = (cfg.rootPlacement === 'flow' && meta.inverted) ? -1 : 1;

    const positions = new Map();
    nodes.forEach(node => {
      const d = depth.get(node.id);
      const main = mainAt[d] * sign;
      const c = cross.get(node.id) ?? 0;
      positions.set(node.id, vertical ? { x: c, y: main } : { x: main, y: c });
    });
    return positions;
  };

  const direction = cfg.treeDirection || 'auto';
  if (direction === 'vertical') return attempt(true);
  if (direction === 'horizontal') return attempt(false);

  // 'auto': lay out both ways, keep whichever fits the canvas better. With
  // long labels the level axis stretches, so the better orientation is the one
  // that spends that stretch on the canvas's longer side.
  return pickBetterFit(attempt(true), attempt(false), nodeById, cfg);
}

// ============================================================================
// CYCLE
// ============================================================================

/**
 * Ring layout for circuits. Node order follows the actual cycle, so the loop is
 * drawn as a loop with no crossings, and the radius is solved from the chord
 * each edge needs — one long relation name opens the ring exactly enough to fit
 * it rather than forcing a uniformly huge circle.
 */
function cycleLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  let ring = (meta.ringIds || []).filter(id => nodeById.has(id));
  if (ring.length !== nodes.length) ring = nodes.map(n => n.id);
  if (ring.length === 0) return new Map();
  if (ring.length === 1) return new Map([[ring[0], { x: 0, y: 0 }]]);

  const chordFor = (idA, idB, radiusFn) => {
    const a = nodeById.get(idA);
    const b = nodeById.get(idB);
    const edge = lookupEdge(edgeIndex, idA, idB);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(cfg.minEdgeLength, radiusFn(a) + radiusFn(b) + label + gap);
  };

  // Pass 1 — worst-case radii, no directions known yet.
  let chords = ring.map((id, i) => chordFor(id, ring[(i + 1) % ring.length], circumRadius));
  let radius = solveRingRadius(chords);
  let angles = ringAngles(chords, radius);
  let positions = new Map(ring.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));

  // Pass 2 — now that directions exist, re-measure with real directional
  // extents. Wide-but-short nodes on a ring reclaim a lot of space here.
  chords = ring.map((id, i) => {
    const nextId = ring[(i + 1) % ring.length];
    const from = positions.get(id);
    const to = positions.get(nextId);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const a = nodeById.get(id);
    const b = nodeById.get(nextId);
    const edge = lookupEdge(edgeIndex, id, nextId);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    return Math.max(
      cfg.minEdgeLength,
      halfExtentTowards(a, dx, dy) + halfExtentTowards(b, dx, dy) + label + gap
    );
  });
  radius = solveRingRadius(chords);
  angles = ringAngles(chords, radius);
  positions = new Map(ring.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));

  return positions;
}

// ============================================================================
// CHAIN
// ============================================================================

/**
 * Serpentine layout for paths. Spacing is per-edge rather than uniform, so a
 * chain reads as a sentence: tightly-linked steps sit close, verbose relations
 * get the room their label needs. Rows alternate direction so the sequence
 * stays continuous when it wraps.
 */
function chainLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  // Walk the path from an endpoint.
  let startId = meta.startId && nodeById.has(meta.startId) ? meta.startId : null;
  if (!startId) {
    startId = nodes.find(n => (adjacency.get(n.id) || new Set()).size <= 1)?.id || nodes[0].id;
  }
  const order = [startId];
  const seen = new Set([startId]);
  let current = startId;
  for (;;) {
    const next = Array.from(adjacency.get(current) || []).find(id => !seen.has(id));
    if (!next) break;
    order.push(next);
    seen.add(next);
    current = next;
  }
  nodes.forEach(node => { if (!seen.has(node.id)) order.push(node.id); });

  const maxRowWidth = Math.max(cfg.width, cfg.minEdgeLength * 3);
  const positions = new Map();

  let x = 0;
  let y = 0;
  let rowStartX = 0;
  let direction = 1;
  let rowMaxHeight = boxOf(nodeById.get(order[0])).h;
  positions.set(order[0], { x, y });

  for (let i = 1; i < order.length; i++) {
    const prevId = order[i - 1];
    const id = order[i];
    const prev = nodeById.get(prevId);
    const node = nodeById.get(id);
    const edge = lookupEdge(edgeIndex, prevId, id);

    const step = requiredEdgeLength(prev, node, edge, cfg, 1, 0);
    const nextX = x + direction * step;
    const rowExtent = Math.abs(nextX - rowStartX) + boxOf(node).w / 2;

    if (rowExtent > maxRowWidth) {
      // Wrap. The wrapping edge runs vertically, so IT has to fit the label.
      const drop = requiredEdgeLength(prev, node, edge, cfg, 0, 1);
      y += Math.max(drop, rowMaxHeight / 2 + boxOf(node).h / 2 + cfg.nodeGap);
      direction *= -1;
      rowStartX = x;
      rowMaxHeight = boxOf(node).h;
      positions.set(id, { x, y });
    } else {
      x = nextX;
      rowMaxHeight = Math.max(rowMaxHeight, boxOf(node).h);
      positions.set(id, { x, y });
    }
  }

  return positions;
}

// ============================================================================
// STAR
// ============================================================================

/**
 * Hub and spokes. Spoke length satisfies each label individually; the ring
 * radius also has to keep neighbouring satellites from colliding, so the final
 * radius is the larger of the two constraints.
 */
function starLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  let hubId = meta.hubId && nodeById.has(meta.hubId) ? meta.hubId : null;
  if (!hubId) {
    hubId = nodes.reduce((best, node) => (
      (adjacency.get(node.id) || new Set()).size > (adjacency.get(best.id) || new Set()).size ? node : best
    ), nodes[0]).id;
  }

  const hub = nodeById.get(hubId);
  const satellites = nodes.filter(node => node.id !== hubId).map(node => node.id);
  if (satellites.length === 0) return new Map([[hubId, { x: 0, y: 0 }]]);

  // Solve the two constraints, then re-solve once the spoke directions are
  // known: a wide, short node on a vertical spoke needs far less room than its
  // worst-case (circumscribed) radius suggests.
  const solve = (priorAngles) => {
    // A spoke runs radially, so the label competes with the RADIAL extent of
    // the two nodes; two neighbouring satellites sit side by side, so they
    // compete with each other's TANGENTIAL extent. For a wide, short node
    // those two numbers differ by a factor of three.
    const radial = (node, i) => (priorAngles
      ? halfExtentTowards(node, Math.cos(priorAngles[i]), Math.sin(priorAngles[i]))
      : circumRadius(node));
    const tangential = (node, i) => (priorAngles
      ? halfExtentTowards(node, -Math.sin(priorAngles[i]), Math.cos(priorAngles[i]))
      : circumRadius(node));

    let radius = cfg.minEdgeLength;
    satellites.forEach((id, i) => {
      const edge = lookupEdge(edgeIndex, hubId, id);
      const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
      const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
      radius = Math.max(radius, radial(hub, i) + radial(nodeById.get(id), i) + label + gap);
    });

    const chords = satellites.map((id, i) => {
      const nextIndex = (i + 1) % satellites.length;
      return tangential(nodeById.get(id), i)
        + tangential(nodeById.get(satellites[nextIndex]), nextIndex)
        + cfg.nodeGap;
    });
    radius = Math.max(radius, solveRingRadius(chords));
    return { radius, angles: ringAngles(chords, radius) };
  };

  const coarse = solve(null);
  const directional = solve(coarse.angles);

  const positions = new Map([[hubId, { x: 0, y: 0 }]]);
  satellites.forEach((id, i) => {
    positions.set(id, {
      x: Math.cos(directional.angles[i]) * directional.radius,
      y: Math.sin(directional.angles[i]) * directional.radius
    });
  });
  return positions;
}

// ============================================================================
// LOMBARDI
// ============================================================================
//
// Lombardi routing draws every edge as a circular arc and gives every node
// PERFECT ANGULAR RESOLUTION — its incident edges leave evenly spaced around
// the full 2π. That changes what a good layout is, in two ways:
//
// 1. RADIAL BEATS ROWS. In a row-based layout (tree levels, layered DAG
//    ranks) a node's neighbours are all clustered in roughly one direction.
//    Perfect angular resolution then has to fan those edges out across
//    directions the geometry doesn't support, and the arcs bow hard to
//    compensate — the drawing curdles. Radial layouts put a node's neighbours
//    genuinely around it, so the even fan is close to the natural bearings and
//    the arcs stay gentle. This is why the paper's own constructions are
//    circular and k-circular; the Spirograph in §5 is exactly concentric rings.
//
// 2. ARCS NEED MORE ROOM THAN CHORDS. Every spacing constraint in this file is
//    measured along the straight line between two nodes. An arc is longer than
//    that chord (the label rides the arc) and bulges sideways off it (the bow
//    needs clearance). See arcAwareConfig.
//
// Only the layouts that were row-based get replaced. CYCLE and STAR are
// already radial — they are the paper's circular drawing and its degree-1 case
// — and MESH still belongs to the force solver.
// ---------------------------------------------------------------------------

// Representative tangent-chord angle, used only to size the spacing allowance.
// Perfect angular resolution puts adjacent edges 2π/k apart at a degree-k node,
// so a typical edge gets pulled off its chord by something on that order; 30°
// is the figure for the mid-degree nodes that dominate a real graph and errs
// generously for the sparse ones. It is NOT the angle any particular arc gets —
// that comes out of the per-node solve at render time.
const REPRESENTATIVE_DELTA = Math.PI / 6;

// Mirror of MAX_TANGENT_CHORD in utils/canvas/edgeRouting.js. Duplicated rather
// than imported to keep this layout service free of canvas-render imports; it
// only bounds a spacing allowance, so drift here costs padding, not geometry.
const MAX_LAYOUT_DELTA = 1.32;

/**
 * Inflate the spacing constraints to account for arcs rather than chords.
 *
 * An arc subtending 2δ is δ/sin δ times as long as its chord, and bulges
 * (L/2)·tan(δ/2) away from it. The first matters because labels are laid along
 * the edge, so the edge has to be longer to fit the same text; the second
 * because the bow can swing into a neighbour that a straight line would clear.
 */
function arcAwareConfig(cfg) {
  if (cfg.routingStyle !== 'lombardi') return cfg;
  const delta = Math.min(MAX_LAYOUT_DELTA, REPRESENTATIVE_DELTA * (cfg.lombardiCurvature ?? 1));
  if (delta < 1e-3) return cfg;
  const alongFactor = delta / Math.sin(delta);
  const bowFactor = 1 + Math.tan(delta / 2);
  return {
    ...cfg,
    minEdgeLength: cfg.minEdgeLength * alongFactor,
    labelPadding: cfg.labelPadding * alongFactor,
    nodeGap: cfg.nodeGap * bowFactor
  };
}

/**
 * Concentric-ring layout for hierarchies — the Euclidean form of the paper's
 * k-circular drawing, and what its Halin-graph construction (Theorem 3) reduces
 * to once you drop the hyperbolic model.
 *
 * The root sits at the centre and each BFS level occupies a ring. A node's
 * children get a WEDGE of its parent's wedge, sized by how many leaves the
 * subtree carries, so a bushy branch takes the room it needs and a thin one
 * doesn't hoard any. Ring radii are solved from the same label constraint the
 * row-based tree uses, plus a circumference check so a wide ring doesn't
 * self-collide.
 *
 * Works for DAGs too — the BFS tree of a DAG is a perfectly good skeleton, and
 * the extra (non-tree) edges just become additional arcs between rings.
 */
function radialLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) return new Map([[nodes[0].id, { x: 0, y: 0 }]]);

  const rootId = chooseTreeRoot(nodes, edges, adjacency, meta.rootId);
  if (!rootId) return new Map();

  // BFS skeleton.
  const parent = new Map([[rootId, null]]);
  const children = new Map(nodes.map(n => [n.id, []]));
  const depth = new Map([[rootId, 0]]);
  const order = [rootId];
  for (let head = 0; head < order.length; head++) {
    const id = order[head];
    (adjacency.get(id) || new Set()).forEach(neighborId => {
      if (parent.has(neighborId)) return;
      parent.set(neighborId, id);
      depth.set(neighborId, depth.get(id) + 1);
      children.get(id).push(neighborId);
      order.push(neighborId);
    });
  }
  // Unreachable strays (shouldn't happen inside one component) hang off the root
  // rather than landing on top of it at the origin.
  nodes.forEach(node => {
    if (parent.has(node.id)) return;
    parent.set(node.id, rootId);
    depth.set(node.id, 1);
    children.get(rootId).push(node.id);
    order.push(node.id);
  });

  // Leaf weight per subtree, bottom-up (order is BFS, so reverse it).
  const weight = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const kids = children.get(id);
    weight.set(id, kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + weight.get(k), 0));
  }

  const byDepth = [];
  order.forEach(id => {
    const d = depth.get(id);
    if (!byDepth[d]) byDepth[d] = [];
    byDepth[d].push(id);
  });

  // Ring radii: each ring clears both the parent→child label constraint (radial)
  // and the room every node on it needs side by side (circumferential).
  const radii = [0];
  for (let d = 1; d < byDepth.length; d++) {
    let step = cfg.minEdgeLength;
    byDepth[d].forEach(id => {
      const parentNode = nodeById.get(parent.get(id));
      const node = nodeById.get(id);
      const edge = lookupEdge(edgeIndex, parent.get(id), id);
      const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
      const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
      step = Math.max(step, circumRadius(parentNode) + circumRadius(node) + label + gap);
    });
    const chords = byDepth[d].map(id => 2 * circumRadius(nodeById.get(id)) + cfg.nodeGap);
    radii[d] = Math.max(radii[d - 1] + step, solveRingRadius(chords));
  }

  // Wedge subdivision, top-down.
  const positions = new Map([[rootId, { x: 0, y: 0 }]]);
  const wedges = new Map([[rootId, { start: -Math.PI / 2, span: 2 * Math.PI }]]);
  order.forEach(id => {
    const kids = children.get(id);
    if (kids.length === 0) return;
    const wedge = wedges.get(id);
    const total = kids.reduce((sum, k) => sum + weight.get(k), 0) || kids.length;
    let cursor = wedge.start;
    kids.forEach(kidId => {
      const span = wedge.span * (weight.get(kidId) / total);
      wedges.set(kidId, { start: cursor, span });
      const angle = cursor + span / 2;
      const radius = radii[depth.get(kidId)];
      positions.set(kidId, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      cursor += span;
    });
  });

  return positions;
}

/**
 * A path laid around a circle instead of serpentined across the canvas — the
 * paper's *circular Lombardi drawing* of a chain, with all vertices on one
 * circle and every edge an arc meeting it at a constant angle.
 *
 * One gap is left open so the sequence reads as a sequence and not a loop, and
 * so the first and last node don't end up as neighbours.
 */
function arcChainLayoutCentered(nodes, edges, cfg, meta = {}) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { adjacency } = buildSimpleGraph(nodes, edges);
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  if (nodes.length <= 2) return chainLayoutCentered(nodes, edges, cfg, meta);

  // Same walk chainLayoutCentered does — start from an endpoint and follow.
  let startId = meta.startId && nodeById.has(meta.startId) ? meta.startId : null;
  if (!startId) {
    startId = nodes.find(n => (adjacency.get(n.id) || new Set()).size <= 1)?.id || nodes[0].id;
  }
  const order = [startId];
  const seen = new Set([startId]);
  let current = startId;
  for (;;) {
    const next = Array.from(adjacency.get(current) || []).find(id => !seen.has(id));
    if (!next) break;
    order.push(next);
    seen.add(next);
    current = next;
  }
  nodes.forEach(node => { if (!seen.has(node.id)) order.push(node.id); });

  // Chords for the real edges, then one deliberately wide chord to hold the
  // circle open between the last node and the first.
  const chords = [];
  for (let i = 0; i < order.length - 1; i++) {
    const a = nodeById.get(order[i]);
    const b = nodeById.get(order[i + 1]);
    const edge = lookupEdge(edgeIndex, order[i], order[i + 1]);
    const label = labelSpanOf(edge, cfg.edgeLabelFontSize);
    const gap = label > 0 ? cfg.labelPadding : cfg.nodeGap;
    chords.push(Math.max(cfg.minEdgeLength, circumRadius(a) + circumRadius(b) + label + gap));
  }
  chords.push(Math.max(...chords) * 1.5);

  const radius = solveRingRadius(chords);
  const angles = ringAngles(chords, radius);
  return new Map(order.map((id, i) => [id, {
    x: Math.cos(angles[i]) * radius,
    y: Math.sin(angles[i]) * radius
  }]));
}

// ============================================================================
// LAYERED (DAG)
// ============================================================================

/**
 * Sugiyama-style layered layout for directed acyclic graphs — pipelines,
 * dependency chains, derivations. Flow direction is consistent (all edges point
 * the same way), crossings are reduced by barycenter sweeps, and layer gaps use
 * the same label solver as trees.
 */
function layeredLayoutCentered(nodes, edges, cfg) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edgeIndex = buildEdgeIndex(edges, cfg.edgeLabelFontSize);

  const directed = (edges || []).filter(e => e && e.sourceId !== e.destinationId);

  // Break any residual cycles by reversing back edges found in DFS.
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  directed.forEach(e => {
    if (outgoing.has(e.sourceId) && nodeById.has(e.destinationId)) {
      outgoing.get(e.sourceId).push(e.destinationId);
    }
  });
  const state = new Map(); // 0 unvisited, 1 in-stack, 2 done
  const backEdges = new Set();
  const dfs = (id) => {
    state.set(id, 1);
    (outgoing.get(id) || []).forEach(next => {
      const s = state.get(next) || 0;
      if (s === 1) backEdges.add(`${id}|${next}`);
      else if (s === 0) dfs(next);
    });
    state.set(id, 2);
  };
  nodes.forEach(node => { if (!(state.get(node.id) || 0)) dfs(node.id); });

  const arcs = directed.map(e => (
    backEdges.has(`${e.sourceId}|${e.destinationId}`)
      ? { ...e, sourceId: e.destinationId, destinationId: e.sourceId, _reversed: true }
      : e
  ));

  // Longest-path layering: every node sits one below its deepest predecessor.
  const incoming = new Map(nodes.map(n => [n.id, []]));
  const outArcs = new Map(nodes.map(n => [n.id, []]));
  arcs.forEach(arc => {
    if (!incoming.has(arc.destinationId) || !outArcs.has(arc.sourceId)) return;
    incoming.get(arc.destinationId).push(arc.sourceId);
    outArcs.get(arc.sourceId).push(arc.destinationId);
  });

  const layer = new Map();
  const resolveLayer = (id, guard = 0) => {
    if (layer.has(id)) return layer.get(id);
    if (guard > nodes.length) return 0;
    const preds = incoming.get(id) || [];
    const value = preds.length === 0
      ? 0
      : Math.max(...preds.map(p => resolveLayer(p, guard + 1) + 1));
    layer.set(id, value);
    return value;
  };
  nodes.forEach(node => resolveLayer(node.id));

  const layerCount = Math.max(...Array.from(layer.values())) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  nodes.forEach(node => layers[layer.get(node.id)].push(node.id));

  // Barycenter sweeps to cut crossings.
  const positionInLayer = new Map();
  const reindex = () => layers.forEach(ids => ids.forEach((id, i) => positionInLayer.set(id, i)));
  reindex();

  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    const range = downward
      ? Array.from({ length: layerCount }, (_, i) => i)
      : Array.from({ length: layerCount }, (_, i) => layerCount - 1 - i);

    range.forEach(index => {
      const neighborsOf = downward ? incoming : outArcs;
      layers[index].sort((a, b) => {
        const bary = (id) => {
          const list = (neighborsOf.get(id) || []).map(x => positionInLayer.get(x)).filter(v => v !== undefined);
          return list.length ? list.reduce((s, v) => s + v, 0) / list.length : positionInLayer.get(id);
        };
        return bary(a) - bary(b);
      });
    });
    reindex();
  }

  const attempt = (vertical) => {
    // Cross-axis placement: pack each layer, then slide it so its center of
    // mass sits under the center of mass of the layer above.
    const crossExtent = (id) => {
      const { w, h } = boxOf(nodeById.get(id));
      return vertical ? w : h;
    };
    const siblingGap = Math.max(cfg.nodeGap, cfg.edgeLabelFontSize * 1.4);

    const cross = new Map();
    layers.forEach((ids, index) => {
      let cursor = 0;
      ids.forEach((id, i) => {
        if (i > 0) cursor += siblingGap;
        cross.set(id, cursor + crossExtent(id) / 2);
        cursor += crossExtent(id);
      });

      if (index === 0) return;
      // Align to predecessors' average position.
      let want = 0;
      let counted = 0;
      ids.forEach(id => {
        const preds = (incoming.get(id) || []).filter(p => cross.has(p));
        if (preds.length === 0) return;
        want += preds.reduce((s, p) => s + cross.get(p), 0) / preds.length - cross.get(id);
        counted += 1;
      });
      if (counted > 0) {
        const shift = want / counted;
        ids.forEach(id => cross.set(id, cross.get(id) + shift));
      }
    });

    // Layer gaps: an edge spanning k layers divides its requirement across
    // them, so long-range dependencies don't blow the whole diagram apart.
    const levelEdges = Array.from({ length: Math.max(0, layerCount - 1) }, () => []);
    const levelSpread = new Array(Math.max(0, layerCount - 1)).fill(0);
    arcs.forEach(arc => {
      const from = layer.get(arc.sourceId);
      const to = layer.get(arc.destinationId);
      if (from === undefined || to === undefined || to <= from) return;
      const span = to - from;
      const crossDelta = Math.abs((cross.get(arc.destinationId) ?? 0) - (cross.get(arc.sourceId) ?? 0)) / span;
      for (let d = from; d < to; d++) {
        levelEdges[d].push({
          a: nodeById.get(arc.sourceId),
          b: nodeById.get(arc.destinationId),
          edge: lookupEdge(edgeIndex, arc.sourceId, arc.destinationId),
          crossDelta,
          span
        });
        levelSpread[d] = Math.max(levelSpread[d], crossDelta);
      }
    });

    const gaps = resolveLevelGaps(levelEdges, levelSpread, cfg, vertical);
    const mainAt = [0];
    for (let d = 0; d < layerCount - 1; d++) mainAt.push(mainAt[d] + gaps[d]);

    const positions = new Map();
    nodes.forEach(node => {
      const main = mainAt[layer.get(node.id)] ?? 0;
      const c = cross.get(node.id) ?? 0;
      positions.set(node.id, vertical ? { x: c, y: main } : { x: main, y: c });
    });
    return positions;
  };

  const direction = cfg.treeDirection || 'auto';
  if (direction === 'vertical') return attempt(true);
  if (direction === 'horizontal') return attempt(false);
  return pickBetterFit(attempt(true), attempt(false), nodeById, cfg);
}

/** Keep whichever of two candidate layouts fits the target canvas better. */
function pickBetterFit(a, b, nodeById, cfg) {
  const score = (positions) => {
    const box = bboxOfCenters(positions, nodeById);
    return Math.max(box.width / Math.max(1, cfg.width), box.height / Math.max(1, cfg.height));
  };
  return score(a) <= score(b) ? a : b;
}

// ============================================================================
// FLOATERS + COMPONENT PACKING
// ============================================================================

/** Unconnected nodes: a plain grid, sized to the widest of them. */
function gridBlockCentered(nodes, cfg) {
  const positions = new Map();
  if (nodes.length === 0) return positions;

  const cellW = Math.max(...nodes.map(n => boxOf(n).w)) + cfg.nodeGap;
  const cellH = Math.max(...nodes.map(n => boxOf(n).h)) + cfg.nodeGap;
  const columns = Math.max(1, Math.min(nodes.length, Math.round(Math.sqrt(nodes.length * (cfg.width / Math.max(1, cfg.height))))));

  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x: (index % columns) * cellW,
      y: Math.floor(index / columns) * cellH
    });
  });
  return positions;
}

/** Shelf-pack blocks into rows that wrap at `rowLimit`. */
function shelfPack(blocks, rowLimit, cfg) {
  const placements = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let width = 0;

  blocks.forEach(block => {
    if (cursorX > 0 && cursorX + block.bbox.width > rowLimit) {
      cursorX = 0;
      cursorY += rowHeight + cfg.componentGap;
      rowHeight = 0;
    }
    placements.push({ block, x: cursorX, y: cursorY });
    cursorX += block.bbox.width + cfg.componentGap;
    rowHeight = Math.max(rowHeight, block.bbox.height);
    width = Math.max(width, cursorX - cfg.componentGap);
  });

  return { placements, width, height: cursorY + rowHeight };
}

/**
 * Place independently laid-out components relative to each other.
 *
 * Wrapping strictly at the canvas width is the wrong rule on an infinite pan
 * surface: a row that overshoots by 15% gets broken, and three modest
 * components stack into a tall ribbon nobody can see at once. So instead of
 * one fixed limit, try every break point the block widths actually allow and
 * keep the arrangement that needs the least zooming out to see whole.
 */
function packComponents(blocks, cfg) {
  const widest = Math.max(0, ...blocks.map(b => b.bbox.width));

  // Candidate limits: the prefix sums are the only widths at which the
  // wrapping behaviour changes, plus the canvas width itself.
  const candidates = new Set([Math.max(cfg.width, widest)]);
  let running = 0;
  blocks.forEach(block => {
    running += block.bbox.width + cfg.componentGap;
    candidates.add(Math.max(widest, running - cfg.componentGap));
  });

  let best = null;
  let bestScore = Infinity;
  candidates.forEach(limit => {
    const packed = shelfPack(blocks, limit, cfg);
    // "How far would you have to zoom out to see all of it?"
    const score = Math.max(
      packed.width / Math.max(1, cfg.width),
      packed.height / Math.max(1, cfg.height)
    );
    if (score < bestScore) { bestScore = score; best = packed; }
  });

  const merged = new Map();
  (best?.placements || []).forEach(({ block, x, y }) => {
    const offsetX = x - block.bbox.minX;
    const offsetY = y - block.bbox.minY;
    block.positions.forEach((pos, id) => {
      merged.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
    });
  });
  return merged;
}

// ============================================================================
// ENTRY POINTS
// ============================================================================

const resolveConfig = (options) => ({ ...PATTERN_LAYOUT_DEFAULTS, ...options });

/** Wrap a centered layout function as an applyLayout-compatible layout. */
function asTopLeftLayout(fn) {
  return (nodes, edges, options = {}) => {
    if (!nodes || nodes.length === 0) return new Map();
    const cfg = resolveConfig(options);
    const centers = fn(nodes, edges || [], cfg, options.topologyMeta || {});
    return centersToTopLeft(centers, new Map(nodes.map(n => [n.id, n])));
  };
}

export const treeLayout = asTopLeftLayout(treeLayoutCentered);
export const cycleLayout = asTopLeftLayout(cycleLayoutCentered);
export const chainLayout = asTopLeftLayout(chainLayoutCentered);
export const starLayout = asTopLeftLayout(starLayoutCentered);
export const layeredLayout = asTopLeftLayout(layeredLayoutCentered);
export const radialTreeLayout = asTopLeftLayout(radialLayoutCentered);
export const arcChainLayout = asTopLeftLayout(arcChainLayoutCentered);

/**
 * Which layout each topology gets, given how the edges will be DRAWN.
 *
 * Under straight/orthogonal routing this is just TOPOLOGY_LAYOUT. Under
 * Lombardi the row-based layouts are swapped for radial ones — see the LOMBARDI
 * section above for why a fan of evenly spaced arcs is at war with a layout
 * that stacks a node's neighbours in one direction.
 */
export function layoutPlanFor(kind, routingStyle) {
  if (routingStyle !== 'lombardi') return TOPOLOGY_LAYOUT[kind];
  switch (kind) {
    case TOPOLOGY.TREE: return 'radial';
    case TOPOLOGY.DAG: return 'radial';
    case TOPOLOGY.CHAIN: return 'arc-chain';
    // CYCLE and STAR are already the paper's circular drawings; MESH keeps the
    // force solver, which has no directional bias to fight in the first place.
    default: return TOPOLOGY_LAYOUT[kind];
  }
}

/**
 * Conditional auto-layout: detect each connected component's shape, lay it out
 * with the layout that fits, and pack the results.
 *
 * A graph that is a taxonomy next to a feedback loop next to twelve floaters
 * gets a tree, a ring, and a grid — not one compromise blob.
 *
 * Anything with no clean structure falls through to the force solver, which is
 * still the right tool for genuinely tangled graphs.
 */
export function patternLayout(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) return new Map();
  const cfg = resolveConfig(options);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const { components } = detectTopology(nodes, edges || [], options);

  const runFallback = options.fallbackLayout || forceDirectedLayout;
  const blocks = [];
  const floaters = [];

  components.forEach(component => {
    const kind = component.topology.kind;
    if (kind === TOPOLOGY.SINGLE) {
      floaters.push(component.nodes[0]);
      return;
    }

    const componentCfg = arcAwareConfig({
      ...cfg,
      // Give each component room proportional to its size rather than the
      // whole canvas, so orientation choices and wrapping stay sensible.
      width: Math.max(cfg.minEdgeLength * 4, cfg.width * Math.sqrt(component.nodes.length / nodes.length)),
      height: Math.max(cfg.minEdgeLength * 4, cfg.height * Math.sqrt(component.nodes.length / nodes.length))
    });

    let positions;
    switch (layoutPlanFor(kind, cfg.routingStyle)) {
      case 'radial':
        positions = radialLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'arc-chain':
        positions = arcChainLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'tree':
        positions = treeLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'cycle':
        positions = cycleLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'chain':
        positions = chainLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'star':
        positions = starLayoutCentered(component.nodes, component.edges, componentCfg, component.topology.meta);
        break;
      case 'layered':
        positions = layeredLayoutCentered(component.nodes, component.edges, componentCfg);
        break;
      default:
        positions = runFallback(component.nodes, component.edges, {
          ...componentCfg,
          groups: [],
          useExistingPositions: false
        });
    }

    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind,
      size: component.nodes.length
    });
  });

  if (floaters.length > 0) {
    const positions = gridBlockCentered(floaters, cfg);
    blocks.push({
      positions,
      bbox: bboxOfCenters(positions, nodeById),
      kind: TOPOLOGY.SINGLE,
      size: floaters.length
    });
  }

  return centersToTopLeft(packComponents(blocks, cfg), nodeById);
}

/**
 * Report what patternLayout would do, without moving anything. Useful for UI
 * ("this graph is a tree — lay it out as one?") and for debugging.
 */
export function describeLayoutPlan(nodes, edges, options = {}) {
  const { components, summary } = detectTopology(nodes || [], edges || [], options);
  const routingStyle = options.routingStyle ?? PATTERN_LAYOUT_DEFAULTS.routingStyle;
  return {
    summary,
    routingStyle,
    components: components.map(component => ({
      kind: component.topology.kind,
      confidence: component.topology.confidence,
      layout: layoutPlanFor(component.topology.kind, routingStyle),
      nodeCount: component.nodes.length,
      edgeCount: component.edges.length
    }))
  };
}

export default {
  patternLayout,
  describeLayoutPlan,
  layoutPlanFor,
  radialTreeLayout,
  arcChainLayout,
  treeLayout,
  cycleLayout,
  chainLayout,
  starLayout,
  layeredLayout,
  solveRingRadius,
  PATTERN_LAYOUT_DEFAULTS
};
