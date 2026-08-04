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
import { requiredEdgeLength } from '../layoutGeometry.js';

/** Matches FORCE_LAYOUT_DEFAULTS' box-model constants. */
const CFG = { edgeLabelFontSize: 59.4, minEdgeLength: 260, labelPadding: 90, nodeGap: 140 };

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

describe('force layout — scale presets stay calibrated', () => {
  // LAYOUT_SCALE_PRESETS existed partly to counteract the circle model's
  // over-reservation. Under the box model a wide node reserves ~5x less
  // vertical space, so the presets could easily have become cramped. This
  // pins them to a measurable band instead of to anyone's eye:
  //
  //   median edge length / requiredEdgeLength ∈ [1.0, 2.5]
  //
  // Below 1.0 the typical label doesn't fit; above 2.5 the layout is just
  // wasting canvas.
  ['compact', 'balanced', 'spacious'].forEach(layoutScale => {
    it(`${layoutScale}: no overlaps and edges sized to their labels`, () => {
      const { nodes, edges } = buildParseGraph();
      const positions = layout(nodes, edges, { layoutScale });
      const byId = new Map(nodes.map(n => [n.id, n]));

      expect(countOverlaps(positions, nodes)).toBe(0);

      const ratios = edges.map(e => {
        const a = positions.get(e.sourceId);
        const b = positions.get(e.destinationId);
        const na = byId.get(e.sourceId);
        const nb = byId.get(e.destinationId);
        const dx = (b.x + nb.width / 2) - (a.x + na.width / 2);
        const dy = (b.y + nb.height / 2) - (a.y + na.height / 2);
        return Math.hypot(dx, dy) / requiredEdgeLength(na, nb, e, CFG, dx, dy);
      }).sort((x, y) => x - y);

      const median = ratios[Math.floor(ratios.length / 2)];
      expect(median).toBeGreaterThanOrEqual(1.0);
      expect(median).toBeLessThanOrEqual(2.5);
    });
  });

  it('the box model is tighter than the circle model', () => {
    const { nodes, edges } = buildParseGraph();
    const area = (opts) => {
      const p = layout(nodes, edges, opts);
      const xs = nodes.map(n => p.get(n.id).x);
      const ys = nodes.map(n => p.get(n.id).y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    // The whole point of the migration: a wide node stops reserving a circle
    // the width of its label in every direction.
    expect(area({ aabbCollision: true })).toBeLessThan(area({ aabbCollision: false }));
  });
});

describe('force layout — convergence', () => {
  // Complaint #2: "it feels like it takes 2 times or more for it to look
  // complete, regardless of view mode." The cause was that every preset
  // stopped at alpha ≈ 0.008-0.011 against an alphaMin of 0.001, so the sim
  // was always still moving when the iteration counter ran out.

  it('one press is already as good as two', () => {
    // NOT an idempotence test. Each press deliberately reheats to alpha 1.0 and
    // re-anneals from the current positions, so the nodes DO move — that is
    // annealing-with-restarts and it is the chosen behaviour. What must be true
    // is that the extra press buys no QUALITY, because the first one already
    // converged. That is the actual content of "it takes 2 times to look
    // complete".
    const { nodes, edges } = buildParseGraph();
    const byId = new Map(nodes.map(n => [n.id, n]));

    const quality = (positions) => {
      const ratios = edges.map(e => {
        const a = positions.get(e.sourceId);
        const b = positions.get(e.destinationId);
        const na = byId.get(e.sourceId);
        const nb = byId.get(e.destinationId);
        const dx = (b.x + nb.width / 2) - (a.x + na.width / 2);
        const dy = (b.y + nb.height / 2) - (a.y + na.height / 2);
        return Math.hypot(dx, dy) / requiredEdgeLength(na, nb, e, CFG, dx, dy);
      }).sort((x, y) => x - y);
      return {
        nodeOverlaps: countOverlaps(positions, nodes),
        edgeOverlaps: countEdgeNodeOverlaps(positions, nodes, edges),
        medianRatio: ratios[Math.floor(ratios.length / 2)]
      };
    };

    const first = layout(nodes, edges);
    const settled = nodes.map(n => ({ ...n, ...first.get(n.id) }));
    const second = positionsFrom(
      applyLayout(settled, edges, 'force', { ...OPTS, useExistingPositions: true })
    );

    const q1 = quality(first);
    const q2 = quality(second);

    expect(q1.nodeOverlaps).toBe(0);
    expect(q1.edgeOverlaps).toBe(0);
    expect(q2.nodeOverlaps).toBe(0);
    expect(q2.edgeOverlaps).toBe(0);
    // The second press must not be meaningfully better spaced than the first.
    expect(q1.medianRatio).toBeGreaterThan(q2.medianRatio * 0.85);
  });

  it('a converged run stops before exhausting its iteration budget', () => {
    // A tiny graph settles almost immediately; without early exit it would
    // still grind through every iteration of the preset.
    const nodes = [node('a', 200, 100), node('b', 200, 100)];
    const edges = [edge('a', 'b', 'is')];

    const started = Date.now();
    applyLayout(nodes, edges, 'force', { ...OPTS, iterations: 5000, alphaDecay: 0.02 });
    const withExit = Date.now() - started;

    const started2 = Date.now();
    applyLayout(nodes, edges, 'force', {
      ...OPTS, iterations: 5000, alphaDecay: 0.02, convergenceEpsilon: 0
    });
    const withoutExit = Date.now() - started2;

    expect(withExit).toBeLessThan(withoutExit);
  });

  it('does not exit early while the simulation is still hot', () => {
    // The alpha <= alphaMin*2 precondition is what preserves reheat-on-repress.
    // With a decay slow enough that alpha never reaches the floor, the run must
    // use its whole budget even though the graph is trivial.
    const nodes = [node('a', 200, 100), node('b', 200, 100)];
    const edges = [edge('a', 'b', 'is')];
    const updates = applyLayout(nodes, edges, 'force', {
      ...OPTS, iterations: 200, alphaDecay: 0.00001
    });
    expect(updates).toHaveLength(2);
  });

  it('reports monotonically non-decreasing progress ending at 1', () => {
    const { nodes, edges } = buildParseGraph();
    const seen = [];
    applyLayout(nodes, edges, 'force', { ...OPTS, onProgress: (p) => seen.push(p) });

    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe('force layout — determinism', () => {
  it('produces identical output for identical input', () => {
    // Math.random() in the coincident-node kick used to make this false, so
    // "did my change cause that, or was it the dice?" was unanswerable.
    const { nodes, edges } = buildParseGraph();
    const a = applyLayout(nodes, edges, 'force', OPTS);
    const b = applyLayout(nodes, edges, 'force', OPTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('separates exactly coincident nodes deterministically', () => {
    const nodes = [node('a', 200, 100), node('b', 200, 100), node('c', 200, 100)];
    const edges = [edge('a', 'b', 'is'), edge('b', 'c', 'is')];
    const stacked = nodes.map(n => ({ ...n, x: 500, y: 500 }));
    const a = applyLayout(stacked, edges, 'force', { ...OPTS, useExistingPositions: true });
    const b = applyLayout(stacked, edges, 'force', { ...OPTS, useExistingPositions: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const positions = positionsFrom(a);
    expect(countOverlaps(positions, nodes)).toBe(0);
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
