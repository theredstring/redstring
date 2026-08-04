/**
 * Shared fixtures and geometric assertions for layout tests.
 *
 * Extracted from patternLayouts.test.js so the force solver can be held to the
 * same invariants the pattern layouts already satisfy. patternLayouts.test.js
 * imports from here; forceLayout.test.js imports the same helpers, so a graph
 * that passes under one layout is measured identically under the other.
 *
 * IMPORTANT: the geometry in this file is deliberately INDEPENDENT of
 * services/layoutGeometry.js. These are the assertions; reusing the
 * implementation's own primitives would let a bug in the implementation agree
 * with itself and pass. Keep them hand-rolled and obvious.
 */

import { expect } from 'vitest';
import { PATTERN_LAYOUT_DEFAULTS as D } from '../patternLayouts.js';
import { estimateEdgeLabelWidth } from '../graphLayoutService.js';

export const FONT = D.edgeLabelFontSize;

// ============================================================================
// FIXTURE BUILDERS
// ============================================================================

export const node = (id, width = 300, height = 100) => ({
  id, width, height, labelWidth: width, labelHeight: height, x: 0, y: 0
});

export const edge = (sourceId, destinationId, name = '') => ({
  id: `${sourceId}-${destinationId}`, sourceId, destinationId, name
});

/** Top-left layout output → the node centres every Lombardi routine works in. */
export const centersOf = (positions, nodes) => new Map(nodes.map(n => {
  const p = positions.get(n.id);
  return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
}));

/** Center-to-center distance for a pair, from a top-left position map. */
export const distance = (positions, nodes, aId, bId) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const a = positions.get(aId);
  const b = positions.get(bId);
  const na = byId.get(aId);
  const nb = byId.get(bId);
  return Math.hypot(
    (b.x + nb.width / 2) - (a.x + na.width / 2),
    (b.y + nb.height / 2) - (a.y + na.height / 2)
  );
};

// ============================================================================
// NODE-NODE
// ============================================================================

export const countOverlaps = (positions, nodes) => {
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id);
      const b = positions.get(nodes[j].id);
      if (!a || !b) continue;
      if (a.x < b.x + nodes[j].width && a.x + nodes[i].width > b.x &&
          a.y < b.y + nodes[j].height && a.y + nodes[i].height > b.y) overlaps++;
    }
  }
  return overlaps;
};

// ============================================================================
// NODE-EDGE — the invariant this overhaul exists to establish
// ============================================================================

/** Distance from point P to segment AB. Hand-rolled; see file header. */
const pointSegmentDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Distance from segment AB to an axis-aligned rectangle. Zero when the segment
 * touches or enters the rect — negative depths are not distinguished, since the
 * only assertion that matters is "> 0".
 */
export const segmentRectDistance = (ax, ay, bx, by, rect) => {
  const { minX, minY, maxX, maxY } = rect;
  const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(ax, ay) || inside(bx, by)) return 0;

  // Segment vs each of the four edges of the rect.
  const corners = [
    [minX, minY, maxX, minY],
    [maxX, minY, maxX, maxY],
    [maxX, maxY, minX, maxY],
    [minX, maxY, minX, minY]
  ];
  const cross = (x1, y1, x2, y2) => x1 * y2 - y1 * x2;
  for (const [cx1, cy1, cx2, cy2] of corners) {
    const d1 = cross(bx - ax, by - ay, cx1 - ax, cy1 - ay);
    const d2 = cross(bx - ax, by - ay, cx2 - ax, cy2 - ay);
    const d3 = cross(cx2 - cx1, cy2 - cy1, ax - cx1, ay - cy1);
    const d4 = cross(cx2 - cx1, cy2 - cy1, bx - cx1, by - cy1);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  }

  // Disjoint: nearest approach is a corner-to-segment or endpoint-to-edge pair.
  let best = Infinity;
  for (const [cx, cy] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
    best = Math.min(best, pointSegmentDist(cx, cy, ax, ay, bx, by));
  }
  return best;
};

/** The node's drawn rectangle, from a top-left position map. */
export const rectOf = (positions, n) => {
  const p = positions.get(n.id);
  return { minX: p.x, minY: p.y, maxX: p.x + n.width, maxY: p.y + n.height };
};

/**
 * Straight center-to-center polylines — the default drawn geometry, and the
 * only one that needs no routing module. Stage 1b passes real providers here.
 */
export const straightPolylines = (positions, nodes, edges) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map();
  edges.forEach(e => {
    const a = positions.get(e.sourceId);
    const b = positions.get(e.destinationId);
    const na = byId.get(e.sourceId);
    const nb = byId.get(e.destinationId);
    if (!a || !b || !na || !nb) return;
    out.set(e.id, [
      { x: a.x + na.width / 2, y: a.y + na.height / 2 },
      { x: b.x + nb.width / 2, y: b.y + nb.height / 2 }
    ]);
  });
  return out;
};

/**
 * Smallest gap between any drawn edge polyline and any node it does not
 * connect. This is goal #1 expressed as a number: > 0 means no edge touches a
 * node it isn't attached to.
 *
 * @param {Function} pathsFor (positions, nodes, edges) => Map<edgeId, {x,y}[]>
 * @returns {{ min: number, worst: {edgeId, nodeId}|null }}
 */
export const minEdgeNodeClearance = (positions, nodes, edges, pathsFor = straightPolylines) => {
  const paths = pathsFor(positions, nodes, edges);
  let min = Infinity;
  let worst = null;

  edges.forEach(e => {
    const pts = paths.get(e.id);
    if (!pts || pts.length < 2) return;
    nodes.forEach(n => {
      if (n.id === e.sourceId || n.id === e.destinationId) return;
      const rect = rectOf(positions, n);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segmentRectDistance(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rect);
        if (d < min) { min = d; worst = { edgeId: e.id, nodeId: n.id }; }
      }
    });
  });

  return { min: min === Infinity ? Infinity : min, worst };
};

/** Count of (edge, non-incident node) pairs that actually intersect. */
export const countEdgeNodeOverlaps = (positions, nodes, edges, pathsFor = straightPolylines) => {
  const paths = pathsFor(positions, nodes, edges);
  let hits = 0;
  edges.forEach(e => {
    const pts = paths.get(e.id);
    if (!pts || pts.length < 2) return;
    nodes.forEach(n => {
      if (n.id === e.sourceId || n.id === e.destinationId) return;
      const rect = rectOf(positions, n);
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentRectDistance(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rect) === 0) {
          hits++;
          break;
        }
      }
    });
  });
  return hits;
};

// ============================================================================
// EDGE LABELS
// ============================================================================

/**
 * The invariant the pattern module exists to guarantee: an edge is at least as
 * long as the label drawn along it.
 */
export const expectLabelsFit = (positions, nodes, edges) => {
  edges.forEach(e => {
    const needed = estimateEdgeLabelWidth(e.name, FONT);
    if (needed === 0) return;
    expect(distance(positions, nodes, e.sourceId, e.destinationId)).toBeGreaterThanOrEqual(needed);
  });
};

/** Where NodeCanvas actually draws a label: edge midpoint, rotated to the edge. */
export const labelQuad = (positions, byId, e) => {
  const c = (id) => {
    const n = byId.get(id);
    const p = positions.get(id);
    return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
  };
  const a = c(e.sourceId);
  const b = c(e.destinationId);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const hw = estimateEdgeLabelWidth(e.name, FONT) / 2;
  const hh = FONT * 1.2 / 2;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  return [
    [cx + ux * hw + uy * hh, cy + uy * hw - ux * hh],
    [cx + ux * hw - uy * hh, cy + uy * hw + ux * hh],
    [cx - ux * hw - uy * hh, cy - uy * hw + ux * hh],
    [cx - ux * hw + uy * hh, cy - uy * hw - ux * hh]
  ];
};

/** Separating-axis overlap test for two convex quads. */
export const quadsOverlap = (P, Q) => {
  for (const poly of [P, Q]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % 4];
      const ax = -(y2 - y1);
      const ay = x2 - x1;
      const project = (pts) => pts.reduce((acc, [x, y]) => {
        const d = x * ax + y * ay;
        return [Math.min(acc[0], d), Math.max(acc[1], d)];
      }, [Infinity, -Infinity]);
      const p = project(P);
      const q = project(Q);
      if (p[1] < q[0] || q[1] < p[0]) return false;
    }
  }
  return true;
};

export const countLabelCollisions = (positions, nodes, edges) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const quads = edges.filter(e => e.name).map(e => labelQuad(positions, byId, e));
  let hits = 0;
  for (let i = 0; i < quads.length; i++) {
    for (let j = i + 1; j < quads.length; j++) {
      if (quadsOverlap(quads[i], quads[j])) hits++;
    }
  }
  return hits;
};

// ============================================================================
// THE SENTENCE-DIAGRAM FIXTURE
// ============================================================================

/**
 * One root, consistent head→dependent flow, many subtrees of wildly uneven
 * depth, and long relation names on every edge. This is the shape that exposed
 * both of the layout's original failure modes: bounding-box subtree packing (a
 * deep subtree beside a shallow one left a void the height of the deeper one)
 * and sibling labels colliding because a tilted label sweeps far more
 * cross-axis space than the line it sits on.
 *
 * It is also the best available stress test for the force solver, because node
 * widths vary by ~4x — which is exactly what a single-radius collision model
 * gets wrong.
 */
export const PARSE = [
  ['announced', 'committee', 'nominal subject'],
  ['announced', 'decision', 'direct object'],
  ['announced', 'yesterday', 'temporal modifier'],
  ['committee', 'the', 'determiner'],
  ['committee', 'oversight', 'compound modifier'],
  ['committee', 'congressional', 'adjectival modifier'],
  ['decision', 'its', 'possessive'],
  ['decision', 'final', 'adjectival modifier'],
  ['decision', 'postpone', 'clausal complement'],
  ['postpone', 'vote', 'direct object'],
  ['vote', 'confirmation', 'compound modifier'],
  ['vote', 'nominee', 'oblique object'],
  ['nominee', 'whom', 'relative pronoun'],
  ['nominee', 'opposed', 'relative clause'],
  ['opposed', 'senators', 'nominal subject'],
  ['opposed', 'vigorously', 'adverbial modifier'],
  ['senators', 'several', 'determiner'],
  ['senators', 'state', 'oblique object'],
  ['state', 'same', 'adjectival modifier'],
  ['yesterday', 'late', 'adverbial modifier']
];

export const buildParseGraph = () => {
  const ids = [...new Set(PARSE.flatMap(([h, d]) => [h, d]))];
  const nodes = ids.map(id => node(id, Math.max(180, 60 + id.length * 46), 100));
  const edges = PARSE.map(([h, d, rel]) => edge(h, d, rel));
  return { nodes, edges };
};
