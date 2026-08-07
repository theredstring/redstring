import { describe, it, expect } from 'vitest';
import {
  TOPOLOGY,
  detectTopology,
  classifyComponent,
  buildComponents,
  chooseTreeRoot,
  buildSimpleGraph
} from '../topologyDetection.js';
import {
  patternLayout,
  treeLayout,
  cycleLayout,
  chainLayout,
  starLayout,
  layeredLayout,
  radialTreeLayout,
  arcChainLayout,
  layoutPlanFor,
  solveRingRadius,
  describeLayoutPlan,
  resolvePatternConfig,
  PATTERN_LAYOUT_DEFAULTS as D
} from '../patternLayouts.js';
import { applyLayout, estimateEdgeLabelWidth } from '../graphLayoutService.js';
import { requiredEdgeLength } from '../layoutGeometry.js';
import {
  lombardiRefine,
  lombardiResidual,
  clearArcsOfNodes,
  circularOrder,
  isRegular
} from '../lombardiLayout.js';
import { buildSimpleGraph as simpleGraph } from '../topologyDetection.js';
import { computeLombardiTangents, solveLombardiArc, arcPointAt } from '../../utils/canvas/edgeRouting.js';

import {
  FONT,
  node,
  edge,
  centersOf,
  distance,
  countOverlaps,
  expectLabelsFit,
  labelQuad,
  quadsOverlap,
  countLabelCollisions,
  PARSE,
  buildParseGraph
} from './layoutHelpers.js';

// ============================================================================

describe('topology detection', () => {
  it('classifies a branching tree', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('b', 'e')];
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('a');
  });

  it('classifies a path as a chain, not a tree', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.CHAIN);
  });

  it('classifies a ring as a cycle and recovers its order', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'a')];
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.CYCLE);
    expect(topology.meta.ringIds).toHaveLength(4);
    // Consecutive ring entries must be genuinely adjacent.
    const { adjacency } = buildSimpleGraph(nodes, edges);
    topology.meta.ringIds.forEach((id, i) => {
      const next = topology.meta.ringIds[(i + 1) % 4];
      expect(adjacency.get(id).has(next)).toBe(true);
    });
  });

  it('classifies a hub with MIXED edge directions as a star', () => {
    // Mixed directions mean association rather than containment — no node is
    // the parent of the others, so a ring is the honest depiction.
    const nodes = ['hub', 'a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('hub', 'a'), edge('b', 'hub'), edge('hub', 'c'), edge('d', 'hub')];
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.STAR);
    expect(topology.meta.hubId).toBe('hub');
  });

  // ── The bug this module exists to avoid ────────────────────────────────
  // A hierarchy is invisible in undirected shape: "root with three children"
  // is undirected-identical to a star, and "root with two children" to a path.
  // Only edge direction distinguishes them, so direction is tested first.

  it('calls a root with two children a tree, not a chain', () => {
    const nodes = ['root', 'a', 'b'].map(id => node(id));
    const { topology } = detectTopology(nodes, [edge('root', 'a'), edge('root', 'b')]).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('root');
  });

  it('calls a root with three children a tree, not a star', () => {
    const nodes = ['root', 'a', 'b', 'c'].map(id => node(id));
    const edges = ['a', 'b', 'c'].map(id => edge('root', id));
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('root');
  });

  it('recognizes an inward taxonomy ("Dog is a kind of Mammal")', () => {
    // The natural authoring direction points specific → general, which makes
    // the graph an anti-arborescence. It is still a tree, rooted at Animal.
    const nodes = ['Animal', 'Mammal', 'Bird', 'Dog', 'Cat'].map(id => node(id));
    const edges = [
      edge('Mammal', 'Animal', 'is a kind of'), edge('Bird', 'Animal', 'is a kind of'),
      edge('Dog', 'Mammal', 'is a kind of'), edge('Cat', 'Mammal', 'is a kind of')
    ];
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('Animal');
    expect(topology.meta.inverted).toBe(true);
  });

  it('keeps the general term above the specific ones', () => {
    const nodes = ['Animal', 'Mammal', 'Bird', 'Dog'].map(id => node(id));
    const positions = patternLayout(nodes, [
      edge('Mammal', 'Animal', 'is a kind of'), edge('Bird', 'Animal', 'is a kind of'),
      edge('Dog', 'Mammal', 'is a kind of')
    ], { width: 2000, height: 1500, treeDirection: 'vertical' });
    expect(positions.get('Animal').y).toBeLessThan(positions.get('Mammal').y);
    expect(positions.get('Mammal').y).toBeLessThan(positions.get('Dog').y);
  });

  it('can invert an inward hierarchy when flow direction is preferred', () => {
    const nodes = ['Effect', 'C1', 'C2', 'C3'].map(id => node(id));
    const edges = ['C1', 'C2', 'C3'].map(id => edge(id, 'Effect', 'causes'));
    const positions = patternLayout(nodes, edges, {
      width: 2000, height: 1500, treeDirection: 'vertical', rootPlacement: 'flow'
    });
    // Arrows run downward: causes above, effect below.
    expect(positions.get('Effect').y).toBeGreaterThan(positions.get('C1').y);
  });

  it('treats a non-branching hierarchy as a sequence', () => {
    // A spine has a root, but drawing it as a "tree" is just a long line —
    // chain layout serpentines instead of running off the canvas.
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.CHAIN);
  });

  it('treats a 3-node path as a chain rather than a degenerate star', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id));
    expect(detectTopology(nodes, [edge('a', 'b'), edge('b', 'c')]).components[0].topology.kind)
      .toBe(TOPOLOGY.CHAIN);
  });

  it('classifies a sparse directed acyclic graph with merges as a DAG', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.DAG);
  });

  it('refuses to call a complete graph a DAG', () => {
    // K4 is technically acyclic once oriented, but it is visually a mesh and
    // any layered rendering of it is spaghetti.
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [
      edge('a', 'b'), edge('a', 'c'), edge('a', 'd'),
      edge('b', 'c'), edge('b', 'd'), edge('c', 'd')
    ];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.MESH);
  });

  it('classifies a graph with a genuine directed cycle as mesh', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [
      edge('a', 'b'), edge('b', 'c'), edge('c', 'a'),
      edge('a', 'd'), edge('b', 'd')
    ];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.MESH);
  });

  it('classifies each connected component independently', () => {
    const nodes = ['t1', 't2', 't3', 'c1', 'c2', 'c3', 'f1'].map(id => node(id));
    const edges = [
      edge('t1', 't2'), edge('t1', 't3'),
      edge('c1', 'c2'), edge('c2', 'c3'), edge('c3', 'c1')
    ];
    const kinds = detectTopology(nodes, edges).components.map(c => c.topology.kind);
    expect(kinds).toContain(TOPOLOGY.CYCLE);
    expect(kinds).toContain(TOPOLOGY.SINGLE);
    // t1 → t2, t1 → t3 is a hierarchy, even though undirected it's a path
    expect(kinds).toContain(TOPOLOGY.TREE);
  });

  it('ignores self-loops and collapses parallel edges when reading shape', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id));
    const edges = [
      edge('a', 'a', 'refers to itself'),
      edge('a', 'b', 'x'), edge('a', 'b', 'a second relation'),
      edge('b', 'c')
    ];
    expect(detectTopology(nodes, edges).components[0].topology.kind).toBe(TOPOLOGY.CHAIN);
  });

  it('picks the unique directed source as tree root', () => {
    const nodes = ['leaf', 'mid', 'root'].map(id => node(id));
    const edges = [edge('root', 'mid'), edge('mid', 'leaf')];
    const { adjacency } = buildSimpleGraph(nodes, edges);
    expect(chooseTreeRoot(nodes, edges, adjacency)).toBe('root');
  });

  it('assigns every edge to exactly one component', () => {
    const nodes = ['a', 'b', 'x', 'y'].map(id => node(id));
    const edges = [edge('a', 'b'), edge('x', 'y')];
    const components = buildComponents(nodes, edges);
    expect(components).toHaveLength(2);
    expect(components.reduce((sum, c) => sum + c.edges.length, 0)).toBe(2);
  });

  it('handles empty and single-node input', () => {
    expect(detectTopology([], []).components).toHaveLength(0);
    expect(classifyComponent({ nodes: [node('a')], edges: [], simpleEdges: [] }).kind)
      .toBe(TOPOLOGY.SINGLE);
  });
});

// ============================================================================

describe('ring radius solver', () => {
  it('closes the ring, and no wider than necessary', () => {
    const chords = [400, 420, 380, 440, 400, 410];
    const radius = solveRingRadius(chords);
    const angleSum = (R) => chords.reduce((sum, c) => sum + 2 * Math.asin(Math.min(1, c / (2 * R))), 0);
    expect(angleSum(radius)).toBeLessThanOrEqual(2 * Math.PI + 1e-6);
    // Shrinking even slightly must break closure — i.e. this is the tight fit.
    expect(angleSum(radius * 0.98)).toBeGreaterThan(2 * Math.PI);
  });

  it('never shrinks below half the longest chord', () => {
    // One very long label can be the binding constraint rather than closure:
    // its chord cannot exceed the diameter.
    const chords = [400, 400, 1800, 400, 400];
    const radius = solveRingRadius(chords);
    expect(radius).toBeGreaterThanOrEqual(900);
    const angleSum = chords.reduce((sum, c) => sum + 2 * Math.asin(Math.min(1, c / (2 * radius))), 0);
    expect(angleSum).toBeLessThanOrEqual(2 * Math.PI + 1e-6);
  });

  it('grows monotonically as chords grow', () => {
    const small = solveRingRadius([300, 300, 300, 300]);
    const large = solveRingRadius([300, 300, 1200, 300]);
    expect(large).toBeGreaterThan(small);
  });
});

// ============================================================================

describe('label-aware spacing', () => {
  it('gives a long relation name more room than a short one — tree', () => {
    const nodes = ['root', 'short', 'long'].map(id => node(id));
    const positions = treeLayout(nodes, [
      edge('root', 'short', 'is'),
      edge('root', 'long', 'was profoundly influenced by the development of')
    ], { rootId: 'root' });

    const longNeed = estimateEdgeLabelWidth('was profoundly influenced by the development of', FONT);
    expect(distance(positions, nodes, 'root', 'long')).toBeGreaterThanOrEqual(longNeed);
  });

  it('opens a ring only as much as its longest label demands', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const shortRing = cycleLayout(nodes, [
      edge('a', 'b', 'to'), edge('b', 'c', 'to'), edge('c', 'd', 'to'), edge('d', 'a', 'to')
    ]);
    const longRing = cycleLayout(nodes, [
      edge('a', 'b', 'to'), edge('b', 'c', 'to'), edge('c', 'd', 'to'),
      edge('d', 'a', 'is causally downstream of and reinforces')
    ]);
    const spanOf = (positions) => {
      const xs = Array.from(positions.values()).map(p => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanOf(longRing)).toBeGreaterThan(spanOf(shortRing));
  });

  it('spaces chain steps individually rather than uniformly', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id));
    const positions = chainLayout(nodes, [
      edge('a', 'b', 'then'),
      edge('b', 'c', 'is eventually transformed into')
    ], { startId: 'a', width: 100000 });
    expect(distance(positions, nodes, 'b', 'c'))
      .toBeGreaterThan(distance(positions, nodes, 'a', 'b'));
  });

  it('accounts for node size, not just labels', () => {
    const narrow = [node('r', 200), node('k', 200)];
    const wide = [node('r', 1200), node('k', 1200)];
    const e = [edge('r', 'k', 'has')];
    expect(distance(treeLayout(wide, e, { rootId: 'r', treeDirection: 'horizontal' }), wide, 'r', 'k'))
      .toBeGreaterThan(distance(treeLayout(narrow, e, { rootId: 'r', treeDirection: 'horizontal' }), narrow, 'r', 'k'));
  });
});

// ============================================================================

describe('pattern layouts produce usable geometry', () => {
  const cases = [
    {
      name: 'taxonomy tree',
      nodes: ['Animal', 'Mammal', 'Bird', 'Dog', 'Cat', 'Eagle'].map(id => node(id, 340)),
      edges: [
        edge('Animal', 'Mammal', 'is a kind of'), edge('Animal', 'Bird', 'is a kind of'),
        edge('Mammal', 'Dog', 'is a domesticated variety of'), edge('Mammal', 'Cat', 'is a kind of'),
        edge('Bird', 'Eagle', 'is a kind of')
      ]
    },
    {
      name: 'feedback cycle',
      nodes: ['Demand', 'Price', 'Supply', 'Capacity'].map(id => node(id)),
      edges: [
        edge('Demand', 'Price', 'pushes up'), edge('Price', 'Supply', 'incentivizes'),
        edge('Supply', 'Capacity', 'justifies further'), edge('Capacity', 'Demand', 'eventually saturates')
      ]
    },
    {
      name: 'sequence',
      nodes: Array.from({ length: 8 }, (_, i) => node(`s${i}`)),
      edges: Array.from({ length: 7 }, (_, i) => edge(`s${i}`, `s${i + 1}`, 'is transformed by'))
    },
    {
      name: 'hub and spokes',
      nodes: ['hub', 'a', 'b', 'c', 'd', 'e'].map(id => node(id)),
      edges: ['a', 'b', 'c', 'd', 'e'].map(id => edge('hub', id, 'is associated with'))
    },
    {
      name: 'pipeline DAG',
      nodes: ['Raw', 'Clean', 'Enrich', 'Model', 'Deploy'].map(id => node(id)),
      edges: [
        edge('Raw', 'Clean', 'feeds'), edge('Raw', 'Enrich', 'feeds'),
        edge('Clean', 'Model', 'trains'), edge('Enrich', 'Model', 'trains'),
        edge('Model', 'Deploy', 'is released as')
      ]
    },
    {
      name: 'mixed components',
      nodes: [
        ...['R', 'C1', 'C2', 'L1'].map(id => node(id)),
        ...['X', 'Y', 'Z'].map(id => node(id)),
        ...['F1', 'F2', 'F3'].map(id => node(id))
      ],
      edges: [
        edge('R', 'C1', 'contains'), edge('R', 'C2', 'contains'), edge('C1', 'L1', 'contains'),
        edge('X', 'Y', 'causes'), edge('Y', 'Z', 'causes'), edge('Z', 'X', 'reinforces')
      ]
    }
  ];

  cases.forEach(({ name, nodes, edges }) => {
    it(`${name}: no node overlaps and every label fits`, () => {
      const positions = patternLayout(nodes, edges, { width: 2000, height: 1500 });
      expect(positions.size).toBe(nodes.length);
      expect(countOverlaps(positions, nodes)).toBe(0);
      expectLabelsFit(positions, nodes, edges);
    });

    it(`${name}: is deterministic`, () => {
      const a = patternLayout(nodes, edges, { width: 2000, height: 1500 });
      const b = patternLayout(nodes, edges, { width: 2000, height: 1500 });
      expect(JSON.stringify([...a])).toBe(JSON.stringify([...b]));
    });
  });

  it('places every node exactly once, including isolated ones', () => {
    const nodes = ['a', 'b', 'lonely'].map(id => node(id));
    const positions = patternLayout(nodes, [edge('a', 'b', 'x')], {});
    expect([...positions.keys()].sort()).toEqual(['a', 'b', 'lonely']);
  });

  it('keeps disconnected components apart', () => {
    const nodes = ['a', 'b', 'x', 'y'].map(id => node(id));
    const positions = patternLayout(nodes, [edge('a', 'b', 'to'), edge('x', 'y', 'to')], {});
    expect(countOverlaps(positions, nodes)).toBe(0);
  });

  it('packs components side by side rather than wrapping on a slight overshoot', () => {
    // Two cycles side by side are a little wider than the canvas (~1.26x).
    // Wrapping strictly at the canvas width would stack them into a tall
    // ribbon that is WORSE to look at (~1.40x the canvas height); the packer
    // should accept the mild horizontal overshoot instead, because that is
    // the arrangement you can actually see at once.
    const first = ['Aaa', 'Bbb', 'Ccc', 'Ddd'];
    const second = ['Www', 'Xxx', 'Yyy', 'Zzz'];
    const ring = (ids) => ids.map((id, i) => edge(
      id, ids[(i + 1) % ids.length], i === 2 ? 'reinforces' : 'causes'
    ));
    const nodes = [...first, ...second].map(id => node(id));
    const positions = patternLayout(nodes, [...ring(first), ...ring(second)], {
      width: 2000, height: 1500
    });

    const band = (ids) => {
      const ys = ids.map(id => positions.get(id).y);
      return { min: Math.min(...ys), max: Math.max(...ys) + 100 };
    };
    const a = band(first);
    const b = band(second);
    // Overlapping vertical bands ⟹ they sit beside each other, not stacked.
    expect(Math.min(a.max, b.max)).toBeGreaterThan(Math.max(a.min, b.min));
  });

  it('survives degenerate input', () => {
    expect(patternLayout([], []).size).toBe(0);
    expect(patternLayout(null, null).size).toBe(0);
    expect(patternLayout([node('a')], []).size).toBe(1);
    expect(patternLayout([node('a')], [edge('a', 'a', 'loops')]).size).toBe(1);
    // edges referencing nodes that aren't in the graph
    expect(patternLayout([node('a'), node('b')], [edge('a', 'ghost', 'x')]).size).toBe(2);
  });

  it('never emits non-finite coordinates', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(`n${i}`, 100 + i * 40, 60 + i * 5));
    const edges = Array.from({ length: 29 }, (_, i) => edge(`n${Math.floor(i / 2)}`, `n${i + 1}`, 'x'.repeat(i)));
    patternLayout(nodes, edges, {}).forEach(pos => {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    });
  });

  it('respects a forced orientation', () => {
    const nodes = ['r', 'a', 'b'].map(id => node(id));
    const edges = [edge('r', 'a', 'has'), edge('r', 'b', 'has')];
    const vertical = treeLayout(nodes, edges, { rootId: 'r', treeDirection: 'vertical' });
    const horizontal = treeLayout(nodes, edges, { rootId: 'r', treeDirection: 'horizontal' });
    expect(vertical.get('a').y).toBeGreaterThan(vertical.get('r').y);
    expect(horizontal.get('a').x).toBeGreaterThan(horizontal.get('r').x);
  });

  it('orders layers by dependency depth', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
    const edges = [edge('a', 'b', 'to'), edge('a', 'c', 'to'), edge('b', 'd', 'to'), edge('c', 'd', 'to')];
    const positions = layeredLayout(nodes, edges, { treeDirection: 'vertical' });
    expect(positions.get('b').y).toBeGreaterThan(positions.get('a').y);
    expect(positions.get('d').y).toBeGreaterThan(positions.get('b').y);
  });

  const starCenters = (positions) => (id) => ({
    x: positions.get(id).x + 150,
    y: positions.get(id).y + 50
  });

  it('puts the hub at the centre of a star', () => {
    const leaves = ['a', 'b', 'c', 'd'];
    const nodes = ['hub', ...leaves].map(id => node(id));
    const positions = starLayout(nodes, leaves.map(id => edge('hub', id, 'relates to')));
    const center = starCenters(positions);
    const hub = center('hub');

    // Centre means the satellites' centroid, not one fixed radius. Spokes are
    // NOT all the same length even when the labels are: a 300x100 node needs
    // 150 of radial clearance on a horizontal spoke and 50 on a vertical one,
    // so equal-length labels sit on an ellipse. That is the arrangement where
    // the visible gap between the boxes is uniform, which is the thing being
    // looked at — equal centre-to-centre radii would make it lopsided.
    const centroid = leaves.reduce((acc, id) => ({
      x: acc.x + center(id).x / leaves.length,
      y: acc.y + center(id).y / leaves.length
    }), { x: 0, y: 0 });
    expect(Math.hypot(centroid.x - hub.x, centroid.y - hub.y)).toBeLessThan(1);
  });

  it('does not drag every spoke out to the longest label', () => {
    const leaves = ['a', 'b', 'c', 'd'];
    const nodes = ['hub', ...leaves].map(id => node(id));
    const edges = leaves.map((id, i) =>
      edge('hub', id, i === 0 ? 'has been formally superseded by' : 'is a'));
    const positions = starLayout(nodes, edges, { width: 2000, height: 1500 });
    const center = starCenters(positions);
    const hub = center('hub');
    const radiusOf = (id) => Math.hypot(center(id).x - hub.x, center(id).y - hub.y);

    expectLabelsFit(positions, nodes, edges);
    // One verbose relation used to set a single radius for the whole ring.
    leaves.slice(1).forEach(id => {
      expect(radiusOf(id)).toBeLessThan(radiusOf('a') * 0.6);
    });
  });
});

// ============================================================================

describe('applyLayout integration', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => node(id));
  const edges = [
    edge('a', 'b', 'leads to'), edge('a', 'c', 'leads to'),
    edge('c', 'd', 'leads to'), edge('c', 'e', 'leads to')
  ];

  it('routes pattern aliases through the detector', () => {
    ['pattern', 'auto', 'conditional'].forEach(alias => {
      const updates = applyLayout(nodes, edges, alias, { width: 2000, height: 1500 });
      expect(updates).toHaveLength(5);
      updates.forEach(u => {
        expect(Number.isInteger(u.x)).toBe(true);
        expect(Number.isInteger(u.y)).toBe(true);
      });
    });
  });

  it('routes explicit shape names to their layouts', () => {
    ['tree', 'hierarchical', 'cycle', 'chain', 'star', 'layered'].forEach(name => {
      expect(applyLayout(nodes, edges, name, { width: 2000, height: 1500 })).toHaveLength(5);
    });
  });

  it('falls back to the force solver when groups are present', () => {
    // Pattern layouts don't model group containment, so a grouped graph must
    // keep using the group-aware force path.
    const groups = [{ id: 'g1', memberInstanceIds: ['a', 'b'] }];
    const updates = applyLayout(nodes, edges, 'pattern', { width: 2000, height: 1500, groups });
    expect(updates).toHaveLength(5);
  });

  it('still handles the pre-existing algorithms', () => {
    ['force', 'grid', 'circular', 'radial'].forEach(name => {
      expect(applyLayout(nodes, edges, name, { width: 2000, height: 1500 })).toHaveLength(5);
    });
  });

  it('describeLayoutPlan reports the plan without moving anything', () => {
    const plan = describeLayoutPlan(nodes, edges);
    expect(plan.components).toHaveLength(1);
    expect(plan.components[0].layout).toBe('tree');
    expect(plan.summary.dominant).toBe(TOPOLOGY.TREE);
  });
});


// ===========================================================================
// LOMBARDI
// ===========================================================================

describe('layoutPlanFor', () => {
  it('leaves every topology alone under straight routing', () => {
    expect(layoutPlanFor(TOPOLOGY.TREE, 'straight')).toBe('tree');
    expect(layoutPlanFor(TOPOLOGY.DAG, 'straight')).toBe('layered');
    expect(layoutPlanFor(TOPOLOGY.CHAIN, 'straight')).toBe('chain');
  });

  it('swaps the row-based layouts for radial ones under Lombardi', () => {
    // Rows cluster a node's neighbours in one direction, which is exactly what
    // perfect angular resolution has to fight.
    expect(layoutPlanFor(TOPOLOGY.TREE, 'lombardi')).toBe('radial');
    expect(layoutPlanFor(TOPOLOGY.DAG, 'lombardi')).toBe('radial');
    expect(layoutPlanFor(TOPOLOGY.CHAIN, 'lombardi')).toBe('arc-chain');
  });

  it('leaves the already-radial layouts untouched', () => {
    // These ARE the paper's circular drawings; there is nothing to improve.
    expect(layoutPlanFor(TOPOLOGY.CYCLE, 'lombardi')).toBe('cycle');
    expect(layoutPlanFor(TOPOLOGY.STAR, 'lombardi')).toBe('star');
    expect(layoutPlanFor(TOPOLOGY.MESH, 'lombardi')).toBe('force');
  });
});

describe('radialTreeLayout', () => {
  const hierarchy = () => {
    const nodes = ['root', 'a', 'b', 'c', 'a1', 'a2', 'b1'].map(id => node(id));
    const edges = [
      edge('root', 'a'), edge('root', 'b'), edge('root', 'c'),
      edge('a', 'a1'), edge('a', 'a2'), edge('b', 'b1'),
    ];
    return { nodes, edges };
  };

  it('puts each BFS level on its own ring', () => {
    const { nodes, edges } = hierarchy();
    const pos = radialTreeLayout(nodes, edges, { topologyMeta: { rootId: 'root' } });
    const centerOf = (id) => {
      const p = pos.get(id);
      const n = nodes.find(x => x.id === id);
      return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
    };
    const root = centerOf('root');
    const r = (id) => Math.hypot(centerOf(id).x - root.x, centerOf(id).y - root.y);

    // Depth 1 all share a radius, as do depth 2, and depth 2 is further out.
    expect(r('a')).toBeCloseTo(r('b'), 3);
    expect(r('b')).toBeCloseTo(r('c'), 3);
    expect(r('a1')).toBeCloseTo(r('a2'), 3);
    expect(r('a1')).toBeGreaterThan(r('a'));
  });

  it('gives a bushier subtree a wider wedge', () => {
    const { nodes, edges } = hierarchy();
    const pos = radialTreeLayout(nodes, edges, { topologyMeta: { rootId: 'root' } });
    const centerOf = (id) => {
      const p = pos.get(id);
      const n = nodes.find(x => x.id === id);
      return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
    };
    const root = centerOf('root');
    const bearing = (id) => Math.atan2(centerOf(id).y - root.y, centerOf(id).x - root.x);
    // 'a' carries 2 leaves, 'b' carries 1, 'c' carries itself. The wedge widths
    // follow, so a's two children straddle a wider arc than b's lone child.
    const aSpread = Math.abs(bearing('a1') - bearing('a2'));
    expect(aSpread).toBeGreaterThan(0.1);
  });

  it('separates every node by at least the node gap', () => {
    const { nodes, edges } = hierarchy();
    const pos = radialTreeLayout(nodes, edges, { topologyMeta: { rootId: 'root' } });
    const ids = nodes.map(n => n.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(60);
      }
    }
  });

  it('handles a single node and an empty graph', () => {
    expect(radialTreeLayout([node('solo')], []).size).toBe(1);
    expect(radialTreeLayout([], []).size).toBe(0);
  });
});

describe('arcChainLayout', () => {
  const chainOf = (n) => {
    const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`));
    const edges = [];
    for (let i = 0; i < n - 1; i++) edges.push(edge(`n${i}`, `n${i + 1}`));
    return { nodes, edges };
  };

  it('places the whole chain on one circle', () => {
    const { nodes, edges } = chainOf(6);
    const pos = arcChainLayout(nodes, edges, { topologyMeta: { startId: 'n0' } });
    const centers = nodes.map(n => {
      const p = pos.get(n.id);
      return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
    });
    // Three points determine the circle exactly; the centroid does not, because
    // the ring is deliberately left open and the points aren't balanced round it.
    const [p, q, r] = [centers[0], centers[2], centers[4]];
    const d = 2 * (p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y));
    const cx = ((p.x ** 2 + p.y ** 2) * (q.y - r.y) + (q.x ** 2 + q.y ** 2) * (r.y - p.y)
      + (r.x ** 2 + r.y ** 2) * (p.y - q.y)) / d;
    const cy = ((p.x ** 2 + p.y ** 2) * (r.x - q.x) + (q.x ** 2 + q.y ** 2) * (p.x - r.x)
      + (r.x ** 2 + r.y ** 2) * (q.x - p.x)) / d;
    const radii = centers.map(c => Math.hypot(c.x - cx, c.y - cy));
    // Every vertex on a common circle is the defining property of a circular
    // Lombardi drawing.
    radii.forEach(radius => expect(radius).toBeCloseTo(radii[0], 3));
  });

  it('leaves the circle open so the sequence does not read as a loop', () => {
    const { nodes, edges } = chainOf(6);
    const pos = arcChainLayout(nodes, edges, { topologyMeta: { startId: 'n0' } });
    const centerOf = (id) => {
      const p = pos.get(id);
      const n = nodes.find(x => x.id === id);
      return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
    };
    const gap = (a, b) => {
      const p = centerOf(a); const q = centerOf(b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    // The unconnected ends are held further apart than any linked pair.
    expect(gap('n0', 'n5')).toBeGreaterThan(gap('n0', 'n1'));
    expect(gap('n0', 'n5')).toBeGreaterThan(gap('n2', 'n3'));
  });

  it('falls back to the serpentine chain for degenerate lengths', () => {
    expect(arcChainLayout([node('a'), node('b')], [edge('a', 'b')]).size).toBe(2);
  });

  // Font size is pinned rather than defaulted: the label is over half of every
  // chord, so the size labels are drawn at decides where the bow-to-ring switch
  // falls. 32 is a realistic connection-label setting; at this size the switch
  // lands at nine nodes, and the cases below stay clear of it.
  const ringOf = (n, opts = {}) => {
    const nodes = Array.from({ length: n }, (_, i) => node(`c${i}`, 300, 100));
    const edges = Array.from({ length: n - 1 }, (_, i) => edge(`c${i}`, `c${i + 1}`, 'leads to'));
    const pos = arcChainLayout(nodes, edges, {
      edgeLabelFontSize: 32,
      topologyMeta: { startId: 'c0' },
      ...opts
    });
    const xs = nodes.map(nd => pos.get(nd.id).x);
    const ys = nodes.map(nd => pos.get(nd.id).y);
    return {
      nodes,
      edges,
      pos,
      width: Math.max(...xs) - Math.min(...xs) + 300,
      height: Math.max(...ys) - Math.min(...ys) + 100
    };
  };

  it('draws a short sequence flat, not as a circle', () => {
    // Five nodes bent round a ring is a circle nobody asked for. While staying
    // flat is affordable, the chain stays flat.
    [3, 5, 8].forEach(n => {
      const { width, height } = ringOf(n);
      expect(width).toBeGreaterThan(height * 2);
    });
  });

  it('curls up once staying flat gets too wide', () => {
    // The same eight-node chain, drawn either way purely by moving the width it
    // is allowed. This tests the mechanism rather than where the default
    // threshold happens to fall.
    const flat = ringOf(8, { arcChainTargetWidth: 100000 });
    const curled = ringOf(8, { arcChainTargetWidth: 500 });
    expect(flat.width).toBeGreaterThan(flat.height * 2);
    expect(curled.width).toBeLessThan(curled.height * 2);
    // Curling is what buys the compactness.
    expect(curled.width).toBeLessThan(flat.width);
  });

  it('grows with the length of the sequence', () => {
    // The ring's circumference IS the chain, so its size is a consequence of
    // the content rather than of a constant. Measured within each regime, since
    // the bow-to-ring switch is deliberately a step change.
    const rings = [12, 20, 30].map(n => ringOf(n).width);
    rings.forEach((w, i) => { if (i > 0) expect(w).toBeGreaterThan(rings[i - 1]); });
    const bows = [3, 5, 8].map(n => ringOf(n).width);
    bows.forEach((w, i) => { if (i > 0) expect(w).toBeGreaterThan(bows[i - 1]); });
  });

  it('stays compact — a ring, not a run across the canvas', () => {
    // The reason to draw a sequence round a circle at all: its width is the
    // chain's length over π. Laid out in a line, 20 nodes at these sizes would
    // span upward of 12000px.
    const { width, height } = ringOf(20);
    expect(width).toBeLessThan(6000);
    // Roughly as tall as it is wide, which is what "circular" means here.
    expect(width / height).toBeGreaterThan(0.6);
    expect(width / height).toBeLessThan(1.7);
  });

  it('begins at the top, where the tangent is level', () => {
    // A circle has no rotation that levels every tangent, so the placement
    // decides only WHERE the readable part goes. It goes at the beginning.
    const { pos, nodes } = ringOf(20);
    const topMost = nodes.reduce((best, nd) =>
      (pos.get(nd.id).y < pos.get(best.id).y ? nd : best), nodes[0]);
    expect(topMost.id).toBe('c0');

    const centre = (id) => {
      const p = pos.get(id);
      return { x: p.x + 150, y: p.y + 50 };
    };
    const tiltOf = (a, b) => {
      const deg = Math.abs(Math.atan2(centre(b).y - centre(a).y, centre(b).x - centre(a).x) * 180 / Math.PI);
      return deg > 90 ? 180 - deg : deg;
    };
    expect(tiltOf('c0', 'c1')).toBeLessThan(15);
  });
});

describe('patternLayout under Lombardi routing', () => {
  const taxonomy = () => {
    const nodes = ['root', 'a', 'b', 'c', 'a1', 'a2'].map(id => node(id));
    const edges = [
      edge('root', 'a'), edge('root', 'b'), edge('root', 'c'),
      edge('a', 'a1'), edge('a', 'a2'),
    ];
    return { nodes, edges };
  };

  it('produces a drawing whose arcs can honour both endpoints', () => {
    // THE headline property. Under straight routing, "how far does each arc miss
    // the tangent its node assigned it" is a question nobody asks and nothing
    // optimises, so a row-based layout scores badly on it by accident. The
    // Lombardi pipeline optimises it directly.
    const { nodes, edges } = taxonomy();
    const rows = patternLayout(nodes, edges, { width: 2000, height: 1500 });
    const lombardi = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'lombardi' });

    const residualOf = (pos) => lombardiResidual(centersOf(pos, nodes), nodes, edges).mean;

    expect(residualOf(lombardi)).toBeLessThan(residualOf(rows));
    // Under 3 degrees is close enough that no arc visibly misses its slot.
    expect(residualOf(lombardi)).toBeLessThan(3 * Math.PI / 180);
  });

  it('reserves more room per edge to account for the bow', () => {
    const { nodes, edges } = taxonomy();
    const spread = (pos) => {
      const xs = Array.from(pos.values()).map(p => p.x);
      const ys = Array.from(pos.values()).map(p => p.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    const tight = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'lombardi', lombardiCurvature: 0 });
    const bowed = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'lombardi', lombardiCurvature: 1.5 });
    expect(spread(bowed)).toBeGreaterThan(spread(tight));
  });

  it('leaves non-Lombardi routing byte-identical to before', () => {
    const { nodes, edges } = taxonomy();
    const a = patternLayout(nodes, edges, { width: 2000, height: 1500 });
    const b = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'straight' });
    expect(Array.from(b.entries())).toEqual(Array.from(a.entries()));
  });

  it('reports the Lombardi plan through describeLayoutPlan', () => {
    const { nodes, edges } = taxonomy();
    const plan = describeLayoutPlan(nodes, edges, { routingStyle: 'lombardi' });
    expect(plan.routingStyle).toBe('lombardi');
    expect(plan.components[0].layout).toBe('radial');
  });
});

describe('applyLayout exposes the Lombardi-native layouts by name', () => {
  const nodes = ['root', 'a', 'b', 'c'].map(id => node(id));
  const edges = [edge('root', 'a'), edge('root', 'b'), edge('root', 'c')];

  it.each(['radial-tree', 'concentric'])('%s runs the concentric layout', (name) => {
    expect(applyLayout(nodes, edges, name, { width: 2000, height: 1500 })).toHaveLength(4);
  });

  it('arc-chain runs the open-circle layout', () => {
    const chain = ['n0', 'n1', 'n2', 'n3'].map(id => node(id));
    const links = [edge('n0', 'n1'), edge('n1', 'n2'), edge('n2', 'n3')];
    expect(applyLayout(chain, links, 'arc-chain', { width: 2000, height: 1500 })).toHaveLength(4);
  });
});


// ===========================================================================
// LOMBARDI'S OWN AUTO-LAYOUT (services/lombardiLayout.js)
// ===========================================================================

describe('lombardiResidual', () => {
  const nodes = [node('p'), node('q')];
  const edges = [edge('p', 'q')];

  it('is zero when a single edge already runs along both tangents', () => {
    // Degree 1 at each end, so each fan slot points straight at the other node
    // and the arc is a straight line. Nothing to miss.
    const centers = new Map([['p', { x: 0, y: 0 }], ['q', { x: 800, y: 0 }]]);
    expect(lombardiResidual(centers, nodes, edges).mean).toBeCloseTo(0, 6);
  });

  it('reports per-edge as well as aggregate', () => {
    const centers = new Map([['p', { x: 0, y: 0 }], ['q', { x: 800, y: 0 }]]);
    const r = lombardiResidual(centers, nodes, edges);
    expect(r.perEdge.get('p-q')).toBeDefined();
    expect(r.max).toBeGreaterThanOrEqual(r.mean);
  });

  it('ignores self-loops, which are drawn by the self-loop path', () => {
    const withLoop = [...edges, edge('p', 'p')];
    const centers = new Map([['p', { x: 0, y: 0 }], ['q', { x: 800, y: 0 }]]);
    expect(lombardiResidual(centers, nodes, withLoop).perEdge.has('p-p')).toBe(false);
  });
});

describe('lombardiRefine', () => {
  const taxonomy = () => {
    const nodes = ['root', 'a', 'b', 'c', 'a1', 'a2'].map(id => node(id));
    const edges = [
      edge('root', 'a'), edge('root', 'b'), edge('root', 'c'),
      edge('a', 'a1'), edge('a', 'a2'),
    ];
    return { nodes, edges };
  };

  it('reduces the residual', () => {
    const { nodes, edges } = taxonomy();
    const seed = centersOf(radialTreeLayout(nodes, edges, { topologyMeta: { rootId: 'root' } }), nodes);
    const before = lombardiResidual(seed, nodes, edges).mean;
    const after = lombardiResidual(lombardiRefine(seed, nodes, edges), nodes, edges).mean;
    expect(after).toBeLessThan(before);
  });

  it('never lets an edge fall below the length the seed gave it', () => {
    // The seed's length is what the label needs. The angular pass is allowed to
    // stretch an edge but never to squeeze one, or labels stop fitting.
    const { nodes, edges } = taxonomy();
    const seed = centersOf(radialTreeLayout(nodes, edges, { topologyMeta: { rootId: 'root' } }), nodes);
    const refined = lombardiRefine(seed, nodes, edges);
    const lengthIn = (m, e) => {
      const p = m.get(e.sourceId);
      const q = m.get(e.destinationId);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    edges.forEach(e => {
      expect(lengthIn(refined, e)).toBeGreaterThan(lengthIn(seed, e) * 0.97);
    });
  });

  it('does not buy the improvement by making arcs curlier', () => {
    // Rotating a chord changes the residual (α+β)/2 but leaves the curvature
    // (α−β)/2 untouched — so the relaxation is free. This asserts the identity
    // holds in practice, which is the reason this pass is safe to run at all.
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'];
    const nodes = ids.map(id => node(id));
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % ids.length]));
    const seed = centersOf(cycleLayout(nodes, edges, { topologyMeta: { ringIds: ids } }), nodes);
    const refined = lombardiRefine(seed, nodes, edges);

    const curvature = (centers) => {
      const boxes = new Map(nodes.map(n => [n.id, { currentWidth: n.width, currentHeight: n.height }]));
      const shifted = nodes.map(n => {
        const c = centers.get(n.id);
        return { id: n.id, x: c.x - n.width / 2, y: c.y - n.height / 2 };
      });
      const fan = computeLombardiTangents(shifted, edges, boxes);
      return edges.reduce((sum, e) => {
        const s = fan.get(e.id);
        if (!s) return sum;
        const arc = solveLombardiArc(centers.get(e.sourceId), centers.get(e.destinationId), s.sourceAngle, s.destAngle, 1);
        return sum + Math.abs(arc?.delta ?? 0);
      }, 0) / edges.length;
    };

    expect(curvature(refined)).toBeCloseTo(curvature(seed), 2);
  });

  it('leaves a graph that is already exact alone', () => {
    const nodes = [node('p'), node('q')];
    const edges = [edge('p', 'q')];
    const seed = new Map([['p', { x: 0, y: 0 }], ['q', { x: 800, y: 0 }]]);
    const refined = lombardiRefine(seed, nodes, edges);
    expect(refined.get('q').x).toBeCloseTo(800, 0);
    expect(refined.get('q').y).toBeCloseTo(0, 0);
  });

  it('is a no-op on graphs with nothing to relax', () => {
    expect(lombardiRefine(new Map(), [], []).size).toBe(0);
    const solo = new Map([['a', { x: 0, y: 0 }]]);
    expect(lombardiRefine(solo, [node('a')], []).size).toBe(1);
  });
});

describe('clearArcsOfNodes', () => {
  // An UNCONNECTED intruder, so the arc under test is unaffected by its
  // presence — the fan only counts nodes an edge actually touches.
  const withIntruderAt = (x, y) => ({
    nodes: [node('p'), node('q'), node('mid')],
    edges: [edge('p', 'q')],
    centers: new Map([
      ['p', { x: -600, y: 0 }],
      ['q', { x: 600, y: 0 }],
      ['mid', { x, y }],
    ]),
  });

  it('pushes a node out from under a straight (degenerate) arc', () => {
    // Regression: clearance used to test only the arc's SAMPLES, and a
    // degenerate arc has no samples between its endpoints — so an edge running
    // straight through a node was never detected at all.
    const { nodes, edges, centers } = withIntruderAt(0, 0);
    const cleared = clearArcsOfNodes(centers, nodes, edges, { clearancePadding: 20 });
    expect(Math.hypot(cleared.get('mid').y - 0, cleared.get('mid').x - 0)).toBeGreaterThan(0);
  });

  it('pushes a node out from under a bowed arc', () => {
    // Place the intruder on the arc itself rather than on the chord, which is
    // the case a chord-based clearance check cannot see.
    const probe = withIntruderAt(1e6, 1e6); // far away, so the fan is clean
    const boxes = new Map(probe.nodes.map(n => [n.id, { currentWidth: n.width, currentHeight: n.height }]));
    const shifted = probe.nodes.map(n => {
      const c = probe.centers.get(n.id);
      return { id: n.id, x: c.x - n.width / 2, y: c.y - n.height / 2 };
    });
    const fan = computeLombardiTangents(shifted, probe.edges, boxes);
    const slot = fan.get('p-q');
    // Force a bow by demanding tangents the chord doesn't already satisfy.
    const arc = solveLombardiArc(probe.centers.get('p'), probe.centers.get('q'),
      slot.sourceAngle + 0.6, slot.destAngle + 0.6, 1);

    // The arc apex, if the fan produced one; otherwise the straight case is
    // already covered above.
    if (!arc || arc.straight) return;
    const apex = arcPointAt(arc, 0.5);
    const { nodes, edges, centers } = withIntruderAt(apex.x, apex.y);
    const cleared = clearArcsOfNodes(centers, nodes, edges, { clearancePadding: 20 });
    expect(cleared.get('mid')).not.toEqual(centers.get('mid'));
  });

  it('never moves an arc\'s own endpoints', () => {
    const { nodes, edges, centers } = withIntruderAt(0, 0);
    const before = { p: { ...centers.get('p') }, q: { ...centers.get('q') } };
    const cleared = clearArcsOfNodes(centers, nodes, edges, { clearancePadding: 20 });
    expect(cleared.get('p')).toEqual(before.p);
    expect(cleared.get('q')).toEqual(before.q);
  });

  it('leaves a already-clear drawing untouched', () => {
    const nodes = [node('p'), node('q')];
    const edges = [edge('p', 'q')];
    const centers = new Map([['p', { x: 0, y: 0 }], ['q', { x: 900, y: 0 }]]);
    const cleared = clearArcsOfNodes(centers, nodes, edges);
    expect(cleared.get('p')).toEqual(centers.get('p'));
    expect(cleared.get('q')).toEqual(centers.get('q'));
  });
});

describe('circular Lombardi seeding (paper section 2)', () => {
  const ring = (n) => {
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const nodes = ids.map(id => node(id));
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % n]));
    return { ids, nodes, edges };
  };

  it('recognises a regular graph', () => {
    const { nodes, edges } = ring(6);
    expect(isRegular(nodes, simpleGraph(nodes, edges).adjacency)).toBe(true);
  });

  it('does not call a hierarchy regular', () => {
    const nodes = ['root', 'a', 'b', 'c'].map(id => node(id));
    const edges = [edge('root', 'a'), edge('root', 'b'), edge('root', 'c')];
    expect(isRegular(nodes, simpleGraph(nodes, edges).adjacency)).toBe(false);
  });

  it('orders the circle so adjacent vertices stay adjacent', () => {
    const { ids, nodes, edges } = ring(6);
    const order = circularOrder(nodes, simpleGraph(nodes, edges).adjacency);
    expect(new Set(order).size).toBe(6);
    // Following a ring's own adjacency reproduces the ring.
    const adjacency = simpleGraph(nodes, edges).adjacency;
    for (let i = 0; i < order.length - 1; i++) {
      expect(adjacency.get(order[i]).has(order[i + 1])).toBe(true);
    }
  });

  it('places every vertex of a regular graph on one circle', () => {
    const { ids, nodes, edges } = ring(6);
    const pos = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'lombardi' });
    const centers = centersOf(pos, nodes);
    const pts = ids.map(id => centers.get(id));
    const [a, b, c] = [pts[0], pts[2], pts[4]];
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const cx = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y)
      + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
    const cy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x)
      + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
    const radii = pts.map(p => Math.hypot(p.x - cx, p.y - cy));
    radii.forEach(r => expect(r).toBeCloseTo(radii[0], 0));
  });
});

// ============================================================================

describe('large irregular trees (sentence-diagram shape)', () => {
  // One root, consistent head→dependent flow, many subtrees of wildly uneven
  // depth, and long relation names on every edge. This is the shape that
  // exposed both of the layout's original failure modes: bounding-box subtree
  // packing (a deep subtree beside a shallow one left a void the height of the
  // deeper one) and sibling labels colliding because a tilted label sweeps far
  // more cross-axis space than the line it sits on.
  // PARSE, build, labelQuad, quadsOverlap and countLabelCollisions now live in
  // ./layoutHelpers.js so the force solver is measured by the same rulers.
  const build = buildParseGraph;

  it('is recognized as a single tree', () => {
    const { nodes, edges } = build();
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('announced');
  });

  ['vertical', 'horizontal'].forEach(treeDirection => {
    it(`${treeDirection}: no node overlaps and no colliding labels`, () => {
      const { nodes, edges } = build();
      const positions = treeLayout(nodes, edges, { width: 2000, height: 1500, treeDirection });
      expect(countOverlaps(positions, nodes)).toBe(0);
      expectLabelsFit(positions, nodes, edges);
      // Fitting each label along its own edge is NOT sufficient — a tilted
      // label sweeps across neighbours. This is the check that catches it.
      expect(countLabelCollisions(positions, nodes, edges)).toBe(0);
    });
  });

  it('packs subtrees by contour, not by bounding box', () => {
    // A deep-narrow subtree beside a shallow-wide one must interlock. Bounding
    // box packing would reserve the full width of each at every depth.
    const nodes = ['root', 'deep', 'wide', 'd1', 'd2', 'd3', 'w1', 'w2'].map(id => node(id, 300, 100));
    const edges = [
      edge('root', 'deep', 'to'), edge('root', 'wide', 'to'),
      edge('deep', 'd1', 'to'), edge('d1', 'd2', 'to'), edge('d2', 'd3', 'to'),
      edge('wide', 'w1', 'to'), edge('wide', 'w2', 'to')
    ];
    const positions = treeLayout(nodes, edges, { rootId: 'root', treeDirection: 'vertical' });
    const xs = [...positions.values()].map(p => p.x);
    const span = Math.max(...xs) - Math.min(...xs) + 300;
    // The deep chain is one column wide; interlocked, the whole tree needs
    // roughly the wide subtree's span plus that column — not both in full.
    expect(span).toBeLessThan(300 * 5);
    expect(countOverlaps(positions, nodes)).toBe(0);
  });

  it('stays fast on a 200-node tree', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`, 300, 100));
    const edges = Array.from({ length: 199 }, (_, i) =>
      edge(`n${Math.floor(i / 3)}`, `n${i + 1}`, 'is a component of'));
    const started = Date.now();
    const positions = treeLayout(nodes, edges, { width: 2000, height: 1500 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(positions.size).toBe(200);
    expect(countOverlaps(positions, nodes)).toBe(0);
  });
});

// ============================================================================
// EDGE LENGTH vs REQUIREMENT
// ============================================================================

/**
 * The property the layouts exist to deliver, stated as a number.
 *
 * `slack` is an edge's drawn length divided by the length that edge actually
 * needs — the two nodes' extents along it, plus the label, plus padding. 1.0
 * is exactly right. Below 1.0 the label overflows the edge it is drawn along.
 * Well above 1.0 is the failure this suite was extended to catch: nodes flung
 * apart far enough that the connection stops reading as a connection.
 *
 * This is measured with layoutGeometry's own primitives, unlike the assertions
 * in layoutHelpers. That is deliberate and it is a weaker guarantee: it pins
 * the layouts to the spacing model rather than to an independent ruler. The
 * hand-rolled checks (countOverlaps, expectLabelsFit, countLabelCollisions)
 * remain the ones that would catch the model itself being wrong.
 */
const slackOf = (positions, nodes, edges, cfg = {}) => {
  // Resolved, not the raw defaults: labelPadding is derived from the label font
  // size, so `PATTERN_LAYOUT_DEFAULTS.labelPadding` is not what got applied.
  const c = resolvePatternConfig(cfg);
  const byId = new Map(nodes.map(n => [n.id, n]));
  return edges.map(e => {
    const a = positions.get(e.sourceId);
    const b = positions.get(e.destinationId);
    const na = byId.get(e.sourceId);
    const nb = byId.get(e.destinationId);
    const dx = (b.x + nb.width / 2) - (a.x + na.width / 2);
    const dy = (b.y + nb.height / 2) - (a.y + na.height / 2);
    return Math.hypot(dx, dy) / requiredEdgeLength(na, nb, e, c, dx, dy);
  });
};

describe('edges are as long as their labels need, and not much longer', () => {
  it('does not stretch a short-label edge to match a long-label sibling', () => {
    // The reported symptom: one edge at its true minimum and every other edge
    // at that same length, because a shared per-depth gap took the maximum.
    const nodes = ['Animal', 'Mammal', 'Bird', 'Dog', 'Cat', 'Eagle', 'Sparrow']
      .map(id => node(id, 60 + id.length * 24, 100));
    const edges = [
      edge('Animal', 'Mammal', 'is a'),
      edge('Animal', 'Bird', 'is a'),
      edge('Mammal', 'Dog', 'is a'),
      edge('Mammal', 'Cat', 'has been domesticated as'),
      edge('Bird', 'Eagle', 'is a'),
      edge('Bird', 'Sparrow', 'is a')
    ];
    const positions = treeLayout(nodes, edges, { width: 2000, height: 1500 });
    const slack = slackOf(positions, nodes, edges);

    slack.forEach(s => expect(s).toBeGreaterThanOrEqual(1));
    // The long sibling is "Cat"; the three "is a" edges beside and below it
    // must not have been dragged out to its length.
    expect(Math.max(...slack)).toBeLessThan(1.6);
  });

  it('keeps every edge near its requirement on a mixed-label tree', () => {
    const { nodes, edges } = buildParseGraph();
    const positions = treeLayout(nodes, edges, { width: 2000, height: 1500 });
    const slack = slackOf(positions, nodes, edges);
    slack.forEach(s => expect(s).toBeGreaterThanOrEqual(1));
    const mean = slack.reduce((a, b) => a + b, 0) / slack.length;
    expect(mean).toBeLessThan(1.4);
  });
});

describe('tree orientation is a convention, not a function of the window', () => {
  it('lays the same tree out identically at every canvas aspect', () => {
    const { nodes, edges } = buildParseGraph();
    const shapes = [[2000, 1500], [1500, 2000], [3000, 1000], [900, 3000]].map(([width, height]) => {
      const p = treeLayout(nodes, edges, { width, height });
      // Compare shape, not absolute placement.
      const origin = p.get(nodes[0].id);
      return nodes.map(n => {
        const q = p.get(n.id);
        return `${Math.round(q.x - origin.x)},${Math.round(q.y - origin.y)}`;
      }).join(' ');
    });
    shapes.forEach(s => expect(s).toBe(shapes[0]));
  });

  it('runs depth downward', () => {
    const nodes = ['root', 'a', 'b'].map(id => node(id));
    const edges = [edge('root', 'a', 'has'), edge('root', 'b', 'has')];
    const p = treeLayout(nodes, edges, { rootId: 'root', width: 3000, height: 600 });
    // Even on a canvas whose shape argues loudly for a sideways tree.
    expect(p.get('a').y).toBeGreaterThan(p.get('root').y);
    expect(p.get('b').y).toBeGreaterThan(p.get('root').y);
  });
});

describe('hierarchies are oriented by the arrow, not by authoring order', () => {
  const taxonomy = (arrowed) => {
    const ids = ['Animal', 'Mammal', 'Bird', 'Dog', 'Cat'];
    const pairs = [['Animal', 'Mammal'], ['Animal', 'Bird'], ['Mammal', 'Dog'], ['Mammal', 'Cat']];
    return {
      nodes: ids.map(id => node(id)),
      // Authored general→specific throughout. When `arrowed`, every arrowhead
      // points the OTHER way — "Mammal is a kind of Animal" — which is an
      // ordinary way to build a taxonomy and used to be read upside down.
      edges: pairs.map(([general, specific]) => ({
        ...edge(general, specific, 'is a kind of'),
        directionality: { arrowsToward: arrowed ? [general] : [specific] }
      }))
    };
  };

  it('roots an outward taxonomy at the general term', () => {
    const { nodes, edges } = taxonomy(false);
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('Animal');
    expect(topology.meta.inverted).toBe(false);
  });

  it('sees an inward taxonomy when only the arrows say so', () => {
    const { nodes, edges } = taxonomy(true);
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('Animal');
    // Endpoint order alone would report inverted:false here.
    expect(topology.meta.inverted).toBe(true);
  });

  it('falls back to endpoint order when nothing carries an arrow', () => {
    const ids = ['Animal', 'Mammal', 'Bird', 'Dog'];
    const nodes = ids.map(id => node(id));
    const edges = [
      edge('Animal', 'Mammal', 'contains'),
      edge('Animal', 'Bird', 'contains'),
      edge('Mammal', 'Dog', 'contains')
    ];
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.TREE);
    expect(topology.meta.rootId).toBe('Animal');
  });
});
