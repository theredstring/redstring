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

  it('classifies a hub with leaves as a star', () => {
    const nodes = ['hub', 'a', 'b', 'c', 'd'].map(id => node(id));
    const edges = ['a', 'b', 'c', 'd'].map(id => edge('hub', id));
    const { topology } = detectTopology(nodes, edges).components[0];
    expect(topology.kind).toBe(TOPOLOGY.STAR);
    expect(topology.meta.hubId).toBe('hub');
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
    // t1-t2-t3 is a 3-node path
    expect(kinds).toContain(TOPOLOGY.CHAIN);
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
      ...['Root', 'Cat1', 'Cat2', 'Leaf'].map(id => node(id)),
      ...['Xxx', 'Yyy', 'Zzz'].map(id => node(id))
    ];
    const edges = [
      edge('Root', 'Cat1', 'contains'), edge('Root', 'Cat2', 'contains'),
      edge('Cat1', 'Leaf', 'contains'),
      edge('Xxx', 'Yyy', 'causes'), edge('Yyy', 'Zzz', 'causes'), edge('Zzz', 'Xxx', 'reinforces')
    ];
    const positions = patternLayout(nodes, edges, { width: 2000, height: 1500 });

    const band = (ids) => {
      const ys = ids.map(id => positions.get(id).y);
      return { min: Math.min(...ys), max: Math.max(...ys) + 100 };
    };
    const first = band(['Root', 'Cat1', 'Cat2', 'Leaf']);
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
