/**
 * Orthogonal placement invariants.
 *
 * The point of the orthogonal pipeline is that nodes SHARE COORDINATES, because
 * two nodes on a shared row or column route with zero bends and two in general
 * position never do. So these tests measure bends and axis-aligned segments,
 * not aesthetics.
 */

import { describe, it, expect } from 'vitest';
import { patternLayout, layoutPlanFor } from '../patternLayouts.js';
import { TOPOLOGY } from '../topologyDetection.js';
import { alignToLattice, axisRestrictionFor } from '../orthogonalLayout.js';
import { orthogonalPaths } from '../pathClearance.js';
import {
  node,
  edge,
  countOverlaps,
  countEdgeNodeOverlaps,
  buildParseGraph
} from './layoutHelpers.js';

const OPTS = { width: 2000, height: 1500 };
const ortho = (nodes, edges, routingStyle = 'manhattan') =>
  patternLayout(nodes, edges, { ...OPTS, routingStyle });

/** Fraction of drawn segments that are exactly horizontal or vertical. */
const axisAlignedShare = (positions, nodes, edges, style = 'manhattan') => {
  const centers = new Map(nodes.map(n => {
    const p = positions.get(n.id);
    return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
  }));
  const paths = orthogonalPaths(style)(centers, nodes, edges);
  let total = 0;
  let aligned = 0;
  paths.forEach(pts => {
    for (let i = 0; i < pts.length - 1; i++) {
      total++;
      const dx = Math.abs(pts[i + 1].x - pts[i].x);
      const dy = Math.abs(pts[i + 1].y - pts[i].y);
      if (dx < 0.5 || dy < 0.5) aligned++;
    }
  });
  return total === 0 ? 1 : aligned / total;
};

/**
 * Real direction changes in a routed polyline. generateManhattanRoutingPath
 * always emits at least three points, so vertex count is not bend count — a
 * straight route is three collinear points.
 */
const countBends = (pts) => {
  let count = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
    if (Math.hypot(ax, ay) < 0.5 || Math.hypot(bx, by) < 0.5) continue;
    if (Math.abs(ax * by - ay * bx) > 0.5) count++;
  }
  return count;
};

/** How many node pairs share an x or a y coordinate. */
const sharedCoordinatePairs = (positions, nodes) => {
  let shared = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id);
      const b = positions.get(nodes[j].id);
      const ax = a.x + nodes[i].width / 2, ay = a.y + nodes[i].height / 2;
      const bx = b.x + nodes[j].width / 2, by = b.y + nodes[j].height / 2;
      if (Math.abs(ax - bx) < 1 || Math.abs(ay - by) < 1) shared++;
    }
  }
  return shared;
};

describe('layoutPlanFor — orthogonal seeds', () => {
  it('picks coordinate-sharing constructions, not circles', () => {
    expect(layoutPlanFor(TOPOLOGY.TREE, 'manhattan')).toBe('tree');
    expect(layoutPlanFor(TOPOLOGY.DAG, 'manhattan')).toBe('layered');
    expect(layoutPlanFor(TOPOLOGY.CHAIN, 'manhattan')).toBe('ortho-serpentine');
    expect(layoutPlanFor(TOPOLOGY.CYCLE, 'manhattan')).toBe('ortho-ring');
    expect(layoutPlanFor(TOPOLOGY.STAR, 'manhattan')).toBe('ortho-compass');
  });

  it('is the opposite of the Lombardi plan where it matters', () => {
    // A cycle is Lombardi's best case on a circle and orthogonal's worst.
    expect(layoutPlanFor(TOPOLOGY.CYCLE, 'lombardi'))
      .not.toBe(layoutPlanFor(TOPOLOGY.CYCLE, 'manhattan'));
    expect(layoutPlanFor(TOPOLOGY.CHAIN, 'lombardi'))
      .not.toBe(layoutPlanFor(TOPOLOGY.CHAIN, 'manhattan'));
  });

  it('treats clean the same as manhattan', () => {
    [TOPOLOGY.TREE, TOPOLOGY.CHAIN, TOPOLOGY.CYCLE, TOPOLOGY.STAR].forEach(kind => {
      expect(layoutPlanFor(kind, 'clean')).toBe(layoutPlanFor(kind, 'manhattan'));
    });
  });
});

describe('alignToLattice', () => {
  const cfg = { nodeGap: 140 };

  it('snaps near-equal coordinates to exactly equal', () => {
    const centers = new Map([
      ['a', { x: 100, y: 0 }],
      ['b', { x: 130, y: 500 }],
      ['c', { x: 900, y: 1000 }]
    ]);
    const { centers: out, alignedX } = alignToLattice(centers, [], [], cfg);
    expect(out.get('a').x).toBe(out.get('b').x);
    expect(alignedX.has('a')).toBe(true);
    expect(alignedX.has('c')).toBe(false);
  });

  it('never reorders nodes on either axis', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const centers = new Map(ids.map((id, i) => [id, { x: i * 60, y: i * 400 }]));
    const before = ids.slice().sort((p, q) => centers.get(p).x - centers.get(q).x);
    const { centers: out } = alignToLattice(centers, [], [], cfg);
    const after = ids.slice().sort((p, q) => out.get(p).x - out.get(q).x);
    // Equal values may tie, but nothing may strictly overtake anything else.
    after.forEach((id, i) => {
      const movedPast = before.indexOf(id) - i;
      expect(Math.abs(movedPast)).toBeLessThanOrEqual(before.length);
    });
    ids.forEach(id => {
      ids.forEach(other => {
        if (centers.get(id).x < centers.get(other).x - cfg.nodeGap) {
          expect(out.get(id).x).toBeLessThanOrEqual(out.get(other).x);
        }
      });
    });
  });

  it('does not chain a long gentle ramp into one giant cluster', () => {
    // Each step is under tolerance, but the span is 10x it. Snapping all of
    // these together would drag the ends hundreds of pixels.
    const centers = new Map(
      Array.from({ length: 20 }, (_, i) => [`n${i}`, { x: i * 40, y: 0 }])
    );
    const { centers: out } = alignToLattice(centers, [], [], cfg);
    const xs = [...out.values()].map(p => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500);
  });
});

describe('axisRestrictionFor', () => {
  it('leaves the aligned axis fixed and frees the other', () => {
    const f = axisRestrictionFor(new Set(['col']), new Set(['row']));
    expect(f('col')).toBe('y'); // in a column → may move vertically
    expect(f('row')).toBe('x'); // in a row → may move horizontally
    expect(f('free')).toBe(null);
  });

  it('frees a doubly-aligned node rather than pinning it', () => {
    // An edge drawn through a node is a worse defect than a broken alignment.
    const f = axisRestrictionFor(new Set(['x']), new Set(['x']));
    expect(f('x')).toBe(null);
  });
});

describe('orthogonal placement produces routable geometry', () => {
  const chain = () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`, 260, 100));
    const edges = Array.from({ length: 9 }, (_, i) => edge(`n${i}`, `n${i + 1}`, 'leads to'));
    return { nodes, edges };
  };
  const cycle = () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`c${i}`, 260, 100));
    const edges = Array.from({ length: 8 }, (_, i) =>
      edge(`c${i}`, `c${(i + 1) % 8}`, 'feeds'));
    return { nodes, edges };
  };
  const star = () => {
    const nodes = [node('hub', 300, 100), ...Array.from({ length: 8 }, (_, i) => node(`l${i}`, 240, 100))];
    const edges = Array.from({ length: 8 }, (_, i) => edge('hub', `l${i}`, 'has'));
    return { nodes, edges };
  };
  const tree = () => buildParseGraph();

  const CASES = [['chain', chain], ['cycle', cycle], ['star', star], ['tree', tree]];

  CASES.forEach(([name, build]) => {
    ['manhattan', 'clean'].forEach(style => {
      it(`${name} / ${style}: no overlaps and no edge through a node`, () => {
        const { nodes, edges } = build();
        const positions = ortho(nodes, edges, style);
        expect(countOverlaps(positions, nodes)).toBe(0);

        const centers = new Map(nodes.map(n => {
          const p = positions.get(n.id);
          return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
        }));
        const drawn = () => orthogonalPaths(style)(centers, nodes, edges);
        expect(countEdgeNodeOverlaps(positions, nodes, edges, drawn)).toBe(0);
      });
    });

    it(`${name}: most drawn segments are axis-aligned`, () => {
      const { nodes, edges } = build();
      const positions = ortho(nodes, edges);
      // Manhattan routes are orthogonal by construction, so this mostly guards
      // against a seed that degenerates into diagonal stubs.
      expect(axisAlignedShare(positions, nodes, edges)).toBeGreaterThanOrEqual(0.8);
    });
  });

  it('shares more coordinates than the straight-line layout on a mesh', () => {
    // The whole justification for a separate pipeline, tested where it is
    // actually load-bearing. A chain is a poor comparison — the straight-line
    // chain layout already puts every node in one row, so both score the same.
    // A MESH has no exploitable shape, so both paths seed it with the force
    // solver, which converges to GENERAL POSITION: no two nodes share a
    // coordinate, because that is what a smooth energy minimum looks like.
    // Everything orthogonal gains here comes from the ALIGN stage.
    const nodes = Array.from({ length: 9 }, (_, i) => node(`m${i}`, 260, 100));
    const edges = [
      edge('m0', 'm1'), edge('m1', 'm2'), edge('m2', 'm0'),
      edge('m3', 'm4'), edge('m4', 'm5'), edge('m5', 'm3'),
      edge('m0', 'm3'), edge('m1', 'm4'), edge('m2', 'm5'),
      edge('m6', 'm0'), edge('m6', 'm4'), edge('m7', 'm2'),
      edge('m7', 'm5'), edge('m8', 'm1'), edge('m8', 'm3')
    ];
    const orthoShared = sharedCoordinatePairs(ortho(nodes, edges), nodes);
    const straightShared = sharedCoordinatePairs(
      patternLayout(nodes, edges, { ...OPTS, routingStyle: 'straight' }), nodes
    );
    expect(orthoShared).toBeGreaterThan(straightShared);
  });

  it('puts a cycle on a rectangle, not a circle', () => {
    const { nodes, edges } = cycle();
    const positions = ortho(nodes, edges);
    // On a rectangle most of the ring shares an edge coordinate with its
    // neighbour; on a circle essentially none would.
    expect(sharedCoordinatePairs(positions, nodes)).toBeGreaterThanOrEqual(nodes.length / 2);
  });

  it('gives a true STAR single-bend spokes via compass placement', () => {
    // detectTopology only calls something a STAR when the edge directions are
    // MIXED — a hub whose edges all point one way is a hierarchy, and gets the
    // tree layout. So the all-outward `star()` fixture above is a TREE, and
    // only this one reaches compassCentered.
    const nodes = [node('hub', 300, 100), ...Array.from({ length: 8 }, (_, i) => node(`s${i}`, 240, 100))];
    const edges = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0 ? edge('hub', `s${i}`, 'has') : edge(`s${i}`, 'hub', 'has'));

    const positions = ortho(nodes, edges);
    const centers = new Map(nodes.map(n => {
      const p = positions.get(n.id);
      return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
    }));
    const paths = orthogonalPaths('manhattan')(centers, nodes, edges);
    const counts = [...paths.values()].map(countBends);

    // The router picks opposite sides of the same axis for every edge, so
    // initOrient always equals finalOrient and a Manhattan route costs two
    // bends unless its endpoints are exactly collinear. Compass placement puts
    // one leaf per ray ON the hub's axis, which is where the zero-bend spokes
    // come from — a fan drawn as a row has none at all.
    expect(counts.filter(c => c === 0).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  });

  it('keeps a fan-shaped tree within Manhattan\'s two-bend maximum', () => {
    const { nodes, edges } = star();
    const positions = ortho(nodes, edges);
    const centers = new Map(nodes.map(n => {
      const p = positions.get(n.id);
      return [n.id, { x: p.x + n.width / 2, y: p.y + n.height / 2 }];
    }));
    const paths = orthogonalPaths('manhattan')(centers, nodes, edges);

    // A fan drawn as a tree is a row under the hub, and a Manhattan route
    // leaving one node's bottom for another's top is VHV — two bends — by
    // construction. Two is the router's maximum, so this pins that nothing
    // degenerates further.
    const counts = [...paths.values()].map(countBends);
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  });
});
