/**
 * THE GROUPLESS REMAINDER IS STILL A GRAPH.
 *
 * When a graph has groups, groupSeparatedLayout solves each group's interior
 * as a subgraph and then places the groups relative to one another. Everything
 * NOT in a group used to fall through that machinery entirely: each ungrouped
 * node was dropped at the average position of its already-placed neighbours
 * plus ~80px of jitter. For a node whose neighbours are ungrouped too, that
 * average is the node placed just before it — so a groupless component walked
 * itself into a single jitter-sized pile, and on the pattern/tree paths (which
 * skip the Phase-3 force refinement) the pile was the final answer.
 *
 * These tests hold the remainder to the same standard as a group's interior:
 * it gets laid out, it does not overlap itself, and a component that hangs off
 * a group stays recognisably attached to it.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout } from '../graphLayoutService.js';
import { node, edge, countOverlaps } from './layoutHelpers.js';

const OPTS = { width: 3000, height: 2200, padding: 200 };

// Every solver that reaches groupSeparatedLayout, including the two that skip
// Phase 3 — the collapse was invisible under 'force' alone.
const ALGORITHMS = ['force', 'pattern', 'tree-tidy', 'cycle'];

const positionsOf = (updates) => new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

/** Two groups of chained nodes, to force the group-separated path. */
const twoGroups = () => {
  const nodes = [];
  const edges = [];
  const groups = [];
  ['a', 'b'].forEach(prefix => {
    const ids = [];
    for (let i = 1; i <= 4; i++) {
      const id = `${prefix}${i}`;
      nodes.push(node(id));
      ids.push(id);
      if (i > 1) edges.push(edge(`${prefix}${i - 1}`, id, 'rel'));
    }
    groups.push({ id: `g${prefix}`, name: prefix.toUpperCase(), memberInstanceIds: ids });
  });
  return { nodes, edges, groups };
};

const spanOf = (positions, nodes) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const p = positions.get(n.id);
    if (!p) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + n.width);
    maxY = Math.max(maxY, p.y + n.height);
  });
  return { width: maxX - minX, height: maxY - minY };
};

describe('groupless remainder', () => {
  describe.each(ALGORITHMS)('%s', (algorithm) => {
    it('lays a groupless chain out instead of piling it on one point', () => {
      const { nodes, edges, groups } = twoGroups();
      const loose = [];
      for (let i = 1; i <= 8; i++) {
        const n = node(`u${i}`);
        nodes.push(n);
        loose.push(n);
        if (i > 1) edges.push(edge(`u${i - 1}`, `u${i}`, 'rel'));
      }
      edges.push(edge('u1', 'a1', 'rel'));

      const positions = positionsOf(applyLayout(nodes, edges, algorithm, { ...OPTS, groups }));

      expect(countOverlaps(positions, loose)).toBe(0);
      // An 8-node chain of 300px nodes cannot honestly fit in a box narrower
      // than a couple of nodes in BOTH directions. The bug produced ~350x1100.
      const span = spanOf(positions, loose);
      expect(Math.max(span.width, span.height)).toBeGreaterThan(8 * 300 * 0.4);
    });

    it('spreads groupless nodes that have no edges at all', () => {
      const { nodes, edges, groups } = twoGroups();
      const loose = [];
      for (let i = 1; i <= 6; i++) {
        const n = node(`u${i}`);
        nodes.push(n);
        loose.push(n);
      }

      const positions = positionsOf(applyLayout(nodes, edges, algorithm, { ...OPTS, groups }));

      // The bug stacked all six on the same coordinate: 15 overlapping pairs.
      expect(countOverlaps(positions, loose)).toBe(0);
    });

    it('keeps a satellite near the group it hangs off, not near unrelated loose nodes', () => {
      // Two satellites, one per group. Bundling the whole remainder into one
      // block would drag each satellite to wherever the other one landed.
      const { nodes, edges, groups } = twoGroups();
      nodes.push(node('sa'), node('sb'));
      edges.push(edge('sa', 'a1', 'rel'), edge('sb', 'b1', 'rel'));

      const positions = positionsOf(applyLayout(nodes, edges, algorithm, { ...OPTS, groups }));

      // Measured against each group's centroid, not one member: a group's own
      // interior is ~4 nodes long, so which END of it a given member sits at
      // says nothing about which group the satellite is attached to.
      const centroid = (gId) => {
        const members = groups.find(g => g.id === gId).memberInstanceIds;
        const sum = members.reduce((acc, id) => {
          const p = positions.get(id);
          return { x: acc.x + p.x, y: acc.y + p.y };
        }, { x: 0, y: 0 });
        return { x: sum.x / members.length, y: sum.y / members.length };
      };
      const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      expect(dist(positions.get('sa'), centroid('ga')))
        .toBeLessThan(dist(positions.get('sa'), centroid('gb')));
      expect(dist(positions.get('sb'), centroid('gb')))
        .toBeLessThan(dist(positions.get('sb'), centroid('ga')));
    });

    it('handles a remainder much larger than the groups', () => {
      const { nodes, edges, groups } = twoGroups();
      const loose = [];
      for (let i = 1; i <= 20; i++) {
        const n = node(`u${i}`);
        nodes.push(n);
        loose.push(n);
        if (i > 1) edges.push(edge(`u${Math.floor(i / 2)}`, `u${i}`, 'rel'));
      }

      const positions = positionsOf(applyLayout(nodes, edges, algorithm, { ...OPTS, groups }));

      // The bug produced ~340x140 for all twenty — 190 overlapping pairs.
      expect(countOverlaps(positions, loose)).toBe(0);
    });
  });
});
