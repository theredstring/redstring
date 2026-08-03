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
  PATTERN_LAYOUT_DEFAULTS as D
} from '../patternLayouts.js';
import { applyLayout, estimateEdgeLabelWidth } from '../graphLayoutService.js';

const FONT = D.edgeLabelFontSize;

const node = (id, width = 300, height = 100) => ({
  id, width, height, labelWidth: width, labelHeight: height, x: 0, y: 0
});
const edge = (sourceId, destinationId, name = '') => ({ sourceId, destinationId, name });

/** Center-to-center distance for a pair, from a top-left position map. */
const distance = (positions, nodes, aId, bId) => {
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

const countOverlaps = (positions, nodes) => {
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

/**
 * The invariant the whole module exists to guarantee: an edge is at least as
 * long as the label drawn along it.
 */
const expectLabelsFit = (positions, nodes, edges) => {
  edges.forEach(e => {
    const needed = estimateEdgeLabelWidth(e.name, FONT);
    if (needed === 0) return;
    expect(distance(positions, nodes, e.sourceId, e.destinationId)).toBeGreaterThanOrEqual(needed);
  });
};

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
    // Chain + cycle together are a little wider than the canvas. Wrapping
    // strictly at the canvas width would stack them into a tall ribbon; the
    // packer should accept the mild horizontal overshoot instead, because
    // that is the arrangement you can actually see at once.
    const nodes = [
      ...['Aaa', 'Bbb', 'Ccc'].map(id => node(id)),
      ...['Xxx', 'Yyy', 'Zzz'].map(id => node(id))
    ];
    const edges = [
      edge('Aaa', 'Bbb', 'causes'), edge('Bbb', 'Ccc', 'causes'), edge('Ccc', 'Aaa', 'reinforces'),
      edge('Xxx', 'Yyy', 'causes'), edge('Yyy', 'Zzz', 'causes'), edge('Zzz', 'Xxx', 'reinforces')
    ];
    const positions = patternLayout(nodes, edges, { width: 2000, height: 1500 });

    const band = (ids) => {
      const ys = ids.map(id => positions.get(id).y);
      return { min: Math.min(...ys), max: Math.max(...ys) + 100 };
    };
    const first = band(['Aaa', 'Bbb', 'Ccc']);
    const second = band(['Xxx', 'Yyy', 'Zzz']);
    // Overlapping vertical bands ⟹ they sit beside each other, not stacked.
    expect(Math.min(first.max, second.max)).toBeGreaterThan(Math.max(first.min, second.min));
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

  it('puts the hub at the centre of a star', () => {
    const nodes = ['hub', 'a', 'b', 'c', 'd'].map(id => node(id));
    const positions = starLayout(nodes, ['a', 'b', 'c', 'd'].map(id => edge('hub', id, 'relates to')));
    const center = (id) => ({
      x: positions.get(id).x + 150,
      y: positions.get(id).y + 50
    });
    const hub = center('hub');
    const radii = ['a', 'b', 'c', 'd'].map(id => Math.hypot(center(id).x - hub.x, center(id).y - hub.y));
    radii.forEach(r => expect(Math.abs(r - radii[0])).toBeLessThan(1));
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

  it('surrounds the root with its children instead of stacking them on one side', () => {
    const { nodes, edges } = taxonomy();
    const rows = patternLayout(nodes, edges, { width: 2000, height: 1500 });
    const rings = patternLayout(nodes, edges, { width: 2000, height: 1500, routingStyle: 'lombardi' });

    // This is the property that matters to the routing: a node whose neighbours
    // sit all around it can hand each edge a tangent near its natural bearing,
    // so the arcs stay gentle. A row layout puts every child on one side, which
    // perfect angular resolution then has to fan out against the geometry.
    const bearingSpan = (pos) => {
      const centerOf = (id) => {
        const p = pos.get(id);
        const n = nodes.find(x => x.id === id);
        return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
      };
      const root = centerOf('root');
      const bearings = ['a', 'b', 'c']
        .map(id => Math.atan2(centerOf(id).y - root.y, centerOf(id).x - root.x))
        .sort((x, y) => x - y);
      return bearings[bearings.length - 1] - bearings[0];
    };

    expect(bearingSpan(rows)).toBeLessThan(Math.PI);
    expect(bearingSpan(rings)).toBeGreaterThan(Math.PI);
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
