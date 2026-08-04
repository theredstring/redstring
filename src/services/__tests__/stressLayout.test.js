/**
 * Multilevel + stress majorization.
 *
 * The property that distinguishes this solver from the spring embedder is that
 * it optimises an explicit objective and that objective provably never
 * increases. So the tests are mostly about the objective, not about how the
 * result looks.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout } from '../graphLayoutService.js';
import {
  stressLayout,
  stressMajorize,
  stressOf,
  hopDistances,
  targetDistances,
  circleSeed,
  pivotMDS
} from '../stressMajorization.js';
import { coarsen, coarsenOnce, multilevelStressLayout } from '../multilevelLayout.js';
import {
  node,
  edge,
  countOverlaps,
  countEdgeNodeOverlaps,
  buildParseGraph
} from './layoutHelpers.js';

const CFG = { edgeLabelFontSize: 59.4, minEdgeLength: 260, labelPadding: 90, nodeGap: 140 };
const OPTS = { width: 2000, height: 1500, padding: 200 };

const gridGraph = (w, h) => {
  const nodes = [];
  const edges = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) nodes.push(node(`g${x}_${y}`, 200, 100));
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) edges.push(edge(`g${x}_${y}`, `g${x + 1}_${y}`, 'to'));
      if (y + 1 < h) edges.push(edge(`g${x}_${y}`, `g${x}_${y + 1}`, 'to'));
    }
  }
  return { nodes, edges };
};

const buildAdjacency = (nodes, edges) => {
  const a = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => { a.get(e.sourceId).push(e.destinationId); a.get(e.destinationId).push(e.sourceId); });
  return a;
};

describe('hop distances and targets', () => {
  it('respects the hop cap', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 200, 100));
    const edges = Array.from({ length: 11 }, (_, i) => edge(`n${i}`, `n${i + 1}`, ''));
    const hops = hopDistances(nodes, buildAdjacency(nodes, edges), 3);
    const from0 = hops.get('n0');
    expect(from0.get('n3')).toBe(3);
    expect(from0.has('n4')).toBe(false);   // beyond the cap
    expect(from0.has('n0')).toBe(false);   // no self term
  });

  it('gives adjacent pairs their exact required edge length', () => {
    // This is what makes stress respect the box model instead of unit lengths:
    // a long label must translate into a longer target distance.
    const a = node('a', 200, 100);
    const b = node('b', 200, 100);
    const shortEdge = [edge('a', 'b', 'is')];
    const longEdge = [edge('a', 'b', 'influenced the development of')];

    const t1 = targetDistances([a, b], shortEdge, hopDistances([a, b], buildAdjacency([a, b], shortEdge), 6), CFG);
    const t2 = targetDistances([a, b], longEdge, hopDistances([a, b], buildAdjacency([a, b], longEdge), 6), CFG);

    expect(t2.targets.get('a').get('b')).toBeGreaterThan(t1.targets.get('a').get('b'));
  });
});

describe('stress majorization', () => {
  it('never increases stress — the guarantee the force solver lacks', () => {
    const { nodes, edges } = gridGraph(5, 5);
    const adjacency = buildAdjacency(nodes, edges);
    const hops = hopDistances(nodes, adjacency, 6);
    const { targets, unit } = targetDistances(nodes, edges, hops, CFG);

    let positions = circleSeed(nodes, unit);
    let previous = stressOf(positions, targets);

    for (let step = 0; step < 15; step++) {
      const result = stressMajorize(positions, nodes, targets, { iterations: 1, epsilon: 0 });
      positions = result.centers;
      const current = stressOf(positions, targets);
      expect(current).toBeLessThanOrEqual(previous + 1e-6);
      previous = current;
    }
  });

  it('converges and reports it', () => {
    const { nodes, edges } = gridGraph(4, 4);
    const result = stressLayout(nodes, edges, CFG, { iterations: 500 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThan(500);
  });

  it('recovers the shape of a grid', () => {
    // A 5x5 grid has an unambiguous embedding, so the ratio of the diagonal to
    // one side is a real check that global structure was found.
    const { nodes, edges } = gridGraph(5, 5);
    const { centers } = stressLayout(nodes, edges, CFG, { iterations: 400 });
    const d = (a, b) => Math.hypot(centers.get(a).x - centers.get(b).x, centers.get(a).y - centers.get(b).y);
    const side = d('g0_0', 'g4_0');
    const diagonal = d('g0_0', 'g4_4');
    expect(diagonal / side).toBeGreaterThan(1.2);
    expect(diagonal / side).toBeLessThan(1.6); // √2 ≈ 1.41
  });

  it('is deterministic', () => {
    const { nodes, edges } = gridGraph(4, 4);
    const a = stressLayout(nodes, edges, CFG, {});
    const b = stressLayout(nodes, edges, CFG, {});
    expect(JSON.stringify([...a.centers])).toBe(JSON.stringify([...b.centers]));
  });

  it('handles degenerate input', () => {
    expect(stressLayout([], [], CFG, {}).centers.size).toBe(0);
    expect(stressLayout([node('solo', 200, 100)], [], CFG, {}).centers.size).toBe(1);
  });

  it('pivotMDS produces finite, spread-out, deterministic coordinates', () => {
    const { nodes, edges } = gridGraph(8, 8);
    const adjacency = buildAdjacency(nodes, edges);
    const a = pivotMDS(nodes, adjacency, 300, 20);
    const b = pivotMDS(nodes, adjacency, 300, 20);
    expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
    [...a.values()].forEach(p => {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    });
    const xs = [...a.values()].map(p => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
  });
});

describe('coarsening', () => {
  it('shrinks the graph and maps every node to a parent', () => {
    const { nodes, edges } = gridGraph(6, 6);
    const coarse = coarsenOnce(nodes, edges, {});
    expect(coarse.nodes.length).toBeLessThan(nodes.length);
    nodes.forEach(n => expect(coarse.parentOf.has(n.id)).toBe(true));
  });

  it('never lets one supernode swallow the graph', () => {
    // A hub with 40 leaves is exactly the shape plain heavy-edge matching
    // collapses into a single blob whose box means nothing.
    const nodes = [node('hub', 200, 100), ...Array.from({ length: 40 }, (_, i) => node(`l${i}`, 200, 100))];
    const edges = Array.from({ length: 40 }, (_, i) => edge('hub', `l${i}`, ''));
    const coarse = coarsenOnce(nodes, edges, {});
    const largest = Math.max(...coarse.nodes.map(n => n.clusterSize));
    expect(largest).toBeLessThanOrEqual(Math.ceil(nodes.length * 0.25));
  });

  it('builds a level stack that terminates', () => {
    const { nodes, edges } = gridGraph(12, 12);
    const levels = coarsen(nodes, edges, { coarsestSize: 20 });
    expect(levels.length).toBeGreaterThan(1);
    expect(levels[0].nodes.length).toBe(nodes.length);
    // Strictly decreasing.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].nodes.length).toBeLessThan(levels[i - 1].nodes.length);
    }
  });

  it('drops self-loops and merges parallel edges when projecting', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b', 'x'), edge('c', 'd', 'y'), edge('a', 'c', 'z'), edge('b', 'd', 'w')];
    const coarse = coarsenOnce(nodes, edges, {});
    coarse.edges.forEach(e => expect(e.sourceId).not.toBe(e.destinationId));
    const keys = coarse.edges.map(e => e.id);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('multilevel end to end', () => {
  it('lays out a graph too large for one level', () => {
    const { nodes, edges } = gridGraph(10, 10);
    const result = multilevelStressLayout(nodes, edges, CFG, { coarsestSize: 20 });
    expect(result.levels).toBeGreaterThan(1);
    expect(result.centers.size).toBe(nodes.length);
    [...result.centers.values()].forEach(p => {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    });
  });

  it('is deterministic', () => {
    const { nodes, edges } = gridGraph(8, 8);
    const a = multilevelStressLayout(nodes, edges, CFG, { coarsestSize: 16 });
    const b = multilevelStressLayout(nodes, edges, CFG, { coarsestSize: 16 });
    expect(JSON.stringify([...a.centers])).toBe(JSON.stringify([...b.centers]));
  });
});

describe('the stress solver through applyLayout', () => {
  it('inherits the same geometric guarantees as the force solver', () => {
    // The whole reason both solvers share the post-loop tail: clearance is a
    // solver-independent projection, so a new solver gets it for free.
    const { nodes, edges } = buildParseGraph();
    const updates = applyLayout(nodes, edges, 'force', { ...OPTS, solver: 'stress' });
    const positions = new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

    expect(updates).toHaveLength(nodes.length);
    expect(countOverlaps(positions, nodes)).toBe(0);
    expect(countEdgeNodeOverlaps(positions, nodes, edges)).toBe(0);
  });

  it('falls back to the force solver for grouped graphs', () => {
    // Group forces have no SMACOF analogue, so stress is skipped — but the run
    // must still succeed rather than producing nothing.
    const { nodes, edges } = buildParseGraph();
    const grouped = applyLayout(nodes, edges, 'force', {
      ...OPTS,
      solver: 'stress',
      groups: [{ id: 'g1', memberInstanceIds: [nodes[0].id, nodes[1].id] }]
    });
    expect(grouped).toHaveLength(nodes.length);
  });

  it('recomputes from scratch, so repeat presses land in the same place', () => {
    // useExistingPositions is true for every ungrouped run, so the stress path
    // must NOT be gated on it or the setting would be unreachable. Choosing
    // stress means choosing a solver with no temperature to reheat: it
    // descends to a minimum and stays there.
    const { nodes, edges } = buildParseGraph();
    const seeded = nodes.map((n, i) => ({ ...n, x: i * 300, y: i * 120 }));
    const a = applyLayout(seeded, edges, 'force', {
      ...OPTS, solver: 'stress', useExistingPositions: true
    });
    const b = applyLayout(seeded, edges, 'force', {
      ...OPTS, solver: 'stress', useExistingPositions: true
    });
    expect(a).toHaveLength(nodes.length);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
