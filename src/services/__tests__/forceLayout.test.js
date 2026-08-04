/**
 * Geometric invariants for the force solver.
 *
 * Until this file existed, forceDirectedLayout had no geometric coverage at
 * all — the only integration tests asserted `toHaveLength(5)`. Everything here
 * is measured with the same helpers the pattern layouts are held to, so a
 * failure means the force path is worse than the pattern path on the same
 * graph rather than merely different.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout } from '../graphLayoutService.js';
import {
  node,
  edge,
  countOverlaps,
  countEdgeNodeOverlaps,
  minEdgeNodeClearance,
  buildParseGraph
} from './layoutHelpers.js';
import { straightPaths, orthogonalPaths, lombardiPaths } from '../pathClearance.js';

const OPTS = { width: 2000, height: 1500, padding: 200 };

/** applyLayout returns an update list; the helpers want a top-left Map. */
const positionsFrom = (updates) =>
  new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

const layout = (nodes, edges, options = {}) =>
  positionsFrom(applyLayout(nodes, edges, 'force', { ...OPTS, ...options }));

describe('force layout — node/node', () => {
  it('separates a small mixed-width graph', () => {
    const nodes = [
      node('wide', 600, 100),
      node('narrow', 140, 100),
      node('mid', 300, 100)
    ];
    const edges = [edge('wide', 'narrow', 'relates to'), edge('narrow', 'mid', 'relates to')];
    const positions = layout(nodes, edges);
    expect(countOverlaps(positions, nodes)).toBe(0);
  });

  it('separates the sentence-diagram graph', () => {
    const { nodes, edges } = buildParseGraph();
    const positions = layout(nodes, edges);
    expect(countOverlaps(positions, nodes)).toBe(0);
  });
});

describe('force layout — node/edge clearance', () => {
  // The shape the coordinate-frame bug is worst on: a very wide node whose
  // top-left is ~300px from its centre. The solver repels nodes from a
  // top-left→top-left segment while the renderer draws centre→centre.
  it('keeps a third node off a wide node\'s edge', () => {
    const nodes = [
      node('wide', 600, 100),
      node('far', 600, 100),
      node('bystander', 200, 100)
    ];
    const edges = [edge('wide', 'far', 'connects to')];
    const positions = layout(nodes, edges);

    const { min, worst } = minEdgeNodeClearance(positions, nodes, edges);
    expect(worst === null || min > 0,
      `edge ${worst?.edgeId} passes through node ${worst?.nodeId} (clearance ${min.toFixed(1)}px)`
    ).toBe(true);
  });

  it('draws no edge through an unrelated node on the sentence-diagram graph', () => {
    const { nodes, edges } = buildParseGraph();
    const positions = layout(nodes, edges);
    expect(countEdgeNodeOverlaps(positions, nodes, edges)).toBe(0);
  });

  // The clearance pass must clear the polyline the RENDERER will draw, not the
  // chord between the endpoints. A Manhattan route turns a corner somewhere the
  // chord never went; a Lombardi arc bows off it. Clearing the chord would
  // leave all three of these failing.
  const STYLES = [
    ['straight', straightPaths()],
    ['manhattan', orthogonalPaths('manhattan')],
    ['clean', orthogonalPaths('clean')],
    ['lombardi', lombardiPaths(1)]
  ];

  STYLES.forEach(([routingStyle, provider]) => {
    it(`keeps ${routingStyle} routes off unrelated nodes`, () => {
      const { nodes, edges } = buildParseGraph();
      const positions = layout(nodes, edges, { routingStyle });

      // Measured against the drawn geometry, with the hand-rolled
      // segment/rect test in layoutHelpers — not the solver's own primitives.
      const centers = new Map(nodes.map(n => {
        const p = positions.get(n.id);
        return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
      }));
      const drawn = () => provider(centers, nodes, edges);

      expect(countEdgeNodeOverlaps(positions, nodes, edges, drawn)).toBe(0);
    });
  });
});

describe('force layout — output shape', () => {
  it('returns finite integer positions for every node', () => {
    const { nodes, edges } = buildParseGraph();
    const updates = applyLayout(nodes, edges, 'force', OPTS);
    expect(updates).toHaveLength(nodes.length);
    updates.forEach(u => {
      expect(Number.isFinite(u.x)).toBe(true);
      expect(Number.isFinite(u.y)).toBe(true);
      expect(Number.isInteger(u.x)).toBe(true);
      expect(Number.isInteger(u.y)).toBe(true);
    });
  });
});
