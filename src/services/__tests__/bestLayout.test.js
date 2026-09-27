/**
 * The default auto-layout ('best'): several candidate layouts, each finished
 * by the label repair, the cleanest kept. These pin the guarantees it has to
 * keep whichever candidate wins; the quality comparison itself lives in the
 * layout bench (test/layout-bench), which is a report, not a gate.
 */
import { describe, it, expect } from 'vitest';
import { applyLayout } from '../graphLayoutService.js';
import { detectCommunities, significantCommunities } from '../communityDetection.js';
import { repairLayout } from '../layoutRepair.js';
import { node, edge, countOverlaps, countEdgeNodeOverlaps, buildParseGraph } from './layoutHelpers.js';

const OPTS = { width: 2000, height: 1500, padding: 200, edgeLabelFontSize: 59.4 };
const positionsFrom = (updates) => new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

/** Two dense 6-cliques joined by one bridge: unmistakable community structure. */
const twoCliques = () => {
  const nodes = [];
  const edges = [];
  for (const c of ['a', 'b']) {
    for (let i = 0; i < 6; i++) nodes.push(node(`${c}${i}`, 220, 100));
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) edges.push(edge(`${c}${i}`, `${c}${j}`));
  }
  edges.push(edge('a0', 'b0', 'bridges'));
  return { nodes, edges };
};

describe("'best' layout", () => {
  it('places every node, with no overlaps and no line through a node', () => {
    const { nodes, edges } = buildParseGraph();
    const positions = positionsFrom(applyLayout(nodes, edges, 'best', OPTS));
    expect(positions.size).toBe(nodes.length);
    expect(countOverlaps(positions, nodes)).toBe(0);
    expect(countEdgeNodeOverlaps(positions, nodes, edges)).toBe(0);
  });

  it('is deterministic', () => {
    const { nodes, edges } = buildParseGraph();
    const a = applyLayout(nodes, edges, 'best', OPTS);
    const b = applyLayout(nodes, edges, 'best', OPTS);
    expect(a).toEqual(b);
  });

  it('keeps separated communities apart', () => {
    const { nodes, edges } = twoCliques();
    const p = positionsFrom(applyLayout(nodes, edges, 'best', OPTS));
    const centroid = (c) => {
      const ids = nodes.filter(n => n.id.startsWith(c));
      return {
        x: ids.reduce((s, n) => s + p.get(n.id).x, 0) / ids.length,
        y: ids.reduce((s, n) => s + p.get(n.id).y, 0) / ids.length
      };
    };
    const A = centroid('a'), B = centroid('b');
    // Every node is nearer its own community's centre than the other's.
    nodes.forEach(n => {
      const q = p.get(n.id);
      const own = n.id.startsWith('a') ? A : B, other = n.id.startsWith('a') ? B : A;
      expect(Math.hypot(q.x - own.x, q.y - own.y)).toBeLessThan(Math.hypot(q.x - other.x, q.y - other.y));
    });
  });
});

describe('community detection', () => {
  it('finds the two cliques', () => {
    const { nodes, edges } = twoCliques();
    const { communities, modularity } = detectCommunities(nodes, edges);
    expect(communities.map(c => c.slice().sort())).toEqual([
      ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'],
      ['b0', 'b1', 'b2', 'b3', 'b4', 'b5']
    ]);
    expect(modularity).toBeGreaterThan(0.3);
  });

  it('reports no significant structure in a ring', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`));
    const edges = nodes.map((n, i) => edge(n.id, nodes[(i + 1) % 6].id));
    expect(significantCommunities(nodes, edges)).toBeNull();
  });
});

describe('label repair', () => {
  it('clears a label drawn across an unrelated connection without creating overlaps', () => {
    // A long horizontal connection with a short vertical one crossing its
    // middle: the vertical line runs straight through the horizontal label.
    const nodes = [node('l', 200, 100), node('r', 200, 100), node('t', 200, 100), node('b', 200, 100)];
    const edges = [edge('l', 'r', 'is a necessary precondition for'), edge('t', 'b', 'causes')];
    const positions = new Map([
      ['l', { x: 0, y: 400 }], ['r', { x: 1600, y: 400 }],
      ['t', { x: 700, y: 0 }], ['b', { x: 700, y: 800 }]
    ]);
    const result = repairLayout(positions, nodes, edges, OPTS);
    expect(result.after).toBeLessThan(result.before);
    expect(countOverlaps(result.positions, nodes)).toBe(0);
  });
});
