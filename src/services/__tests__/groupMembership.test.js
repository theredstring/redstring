/**
 * GROUP MEMBERSHIP IS A HARD CONSTRAINT.
 *
 * Everything here asserts one invariant: when the layout finishes, the set of
 * nodes that LOOK like they are inside a group's rect is exactly the set of
 * nodes that ARE members of it. A viewer reads containment off the drawing —
 * there is no other channel — so a non-member inside a rect isn't a cosmetic
 * imperfection, it's the layout asserting something false about the graph.
 *
 * The rect these tests measure against is the one the RENDERER draws
 * (deriveGroupVisualBounds), not the member bounding box: for a node-group
 * that includes the title bar hanging above the canvas, which is exactly the
 * strip a node can sit in while passing a bbox-only check.
 *
 * The geometry here is hand-rolled on purpose — see layoutHelpers.js. These
 * are the assertions, not the implementation's own primitives.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout, deriveGroupVisualBounds } from '../graphLayoutService.js';
import { node, edge } from './layoutHelpers.js';

const OPTS = { width: 3000, height: 2200, padding: 200 };

const positionsOf = (updates) => new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

/** The rect a renderer would draw for `group`, from a top-left position map. */
const renderedRect = (group, positions, nodes) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (group.memberInstanceIds || []).forEach(id => {
    const p = positions.get(id);
    const n = byId.get(id);
    if (!p || !n) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + n.width);
    maxY = Math.max(maxY, p.y + n.height);
  });
  if (minX === Infinity) return null;
  const vb = deriveGroupVisualBounds(group, { minX, minY, maxX, maxY });
  return { minX: vb.x, minY: vb.y, maxX: vb.x + vb.w, maxY: vb.y + vb.h };
};

/**
 * Every (node, group) pair where the node's body overlaps the group's drawn
 * rect but the node is not a member of that group.
 */
const intruders = (positions, nodes, groups) => {
  const found = [];
  groups.forEach(group => {
    const rect = renderedRect(group, positions, nodes);
    if (!rect) return;
    const members = new Set(group.memberInstanceIds || []);
    nodes.forEach(n => {
      if (members.has(n.id)) return;
      const p = positions.get(n.id);
      if (!p) return;
      if (p.x + n.width > rect.minX && p.x < rect.maxX &&
          p.y + n.height > rect.minY && p.y < rect.maxY) {
        found.push(`${n.id} inside ${group.id}`);
      }
    });
  });
  return found;
};

/** Two groups of four, plus loose nodes, wired densely enough to pull together. */
const twoGroupGraph = () => {
  const nodes = [
    ...['a1', 'a2', 'a3', 'a4'].map(id => node(id, 240, 100)),
    ...['b1', 'b2', 'b3', 'b4'].map(id => node(id, 240, 100)),
    node('loose1', 240, 100),
    node('loose2', 240, 100)
  ];
  const edges = [
    edge('a1', 'a2', 'has'), edge('a2', 'a3', 'has'), edge('a3', 'a4', 'has'),
    edge('b1', 'b2', 'has'), edge('b2', 'b3', 'has'), edge('b3', 'b4', 'has'),
    // Cross-group springs: these are what drag members into the other rect.
    edge('a1', 'b1', 'relates to'), edge('a4', 'b4', 'relates to'),
    edge('loose1', 'a2', 'notes'), edge('loose1', 'b2', 'notes'),
    edge('loose2', 'a3', 'notes'), edge('loose2', 'b3', 'notes')
  ];
  const groups = [
    { id: 'A', name: 'Group A', memberInstanceIds: ['a1', 'a2', 'a3', 'a4'] },
    { id: 'B', name: 'Group B', memberInstanceIds: ['b1', 'b2', 'b3', 'b4'] }
  ];
  return { nodes, edges, groups };
};

describe('non-members finish outside every group rect', () => {
  it('keeps one group\'s members out of the other group\'s rect', () => {
    // The case the exclusion pass used to miss entirely: it only ever ejected
    // UNGROUPED nodes, so a member of A parked inside B's rect survived every
    // polish stage and rendered as a member of B.
    const { nodes, edges, groups } = twoGroupGraph();
    const positions = positionsOf(applyLayout(nodes, edges, 'force', { ...OPTS, groups }));
    expect(intruders(positions, nodes, groups)).toEqual([]);
  });

  it('keeps ungrouped nodes out of every group rect', () => {
    const { nodes, edges, groups } = twoGroupGraph();
    const positions = positionsOf(applyLayout(nodes, edges, 'force', { ...OPTS, groups }));
    ['loose1', 'loose2'].forEach(id => {
      const n = nodes.find(x => x.id === id);
      const p = positions.get(id);
      groups.forEach(g => {
        const rect = renderedRect(g, positions, nodes);
        const overlaps = p.x + n.width > rect.minX && p.x < rect.maxX &&
                         p.y + n.height > rect.minY && p.y < rect.maxY;
        expect(overlaps, `${id} sits inside ${g.id}`).toBe(false);
      });
    });
  });

  it('protects the title bar of a node-group, not just its canvas', () => {
    // A node-group's title hangs ABOVE the member bounding box. Enforcing
    // bbox + padding leaves that strip open, and a node parked in it renders
    // underneath the group's own title.
    const { nodes, edges } = twoGroupGraph();
    const groups = [
      {
        id: 'A',
        name: 'A Node Group With A Long Title',
        linkedNodePrototypeId: 'proto-a',
        memberInstanceIds: ['a1', 'a2', 'a3', 'a4']
      },
      { id: 'B', name: 'Group B', memberInstanceIds: ['b1', 'b2', 'b3', 'b4'] }
    ];
    const positions = positionsOf(applyLayout(nodes, edges, 'force', { ...OPTS, groups }));
    expect(intruders(positions, nodes, groups)).toEqual([]);
  });

  it('does not leave a node ping-ponging between two rects', () => {
    // The eject used to step out of whichever rect the node was in RIGHT NOW.
    // Between two close rects that never converges — out of A into B, out of B
    // into A — and which one it finishes inside comes down to the parity of the
    // loop bound. The union-eject beside it only fires on a node overlapping
    // two rects AT ONCE, which is exactly what a node in the gap never does.
    //
    // Squeezing the canvas is what forces the two rects close enough to trip it.
    const { nodes, edges, groups } = twoGroupGraph();
    [1600, 2000, 2600, 3000].forEach(width => {
      const positions = positionsOf(applyLayout(nodes, edges, 'force', {
        ...OPTS, width, height: width * 0.75, groups
      }));
      expect(intruders(positions, nodes, groups), `at width ${width}`).toEqual([]);
    });
  });

  it('holds for a nested group: the parent\'s own members stay out of the child', () => {
    // Containment is derived from member subsets, so C ⊂ A. A member of A that
    // is not a member of C must finish outside C's rect while remaining inside
    // A's — ejecting toward its own group's centre is what makes that possible.
    const nodes = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(id => node(id, 240, 100));
    const edges = [
      edge('a1', 'a2', 'has'), edge('a2', 'a3', 'has'), edge('a3', 'a4', 'has'),
      edge('a4', 'a5', 'has'), edge('a5', 'a6', 'has'), edge('a6', 'a1', 'has')
    ];
    const groups = [
      { id: 'A', name: 'Outer', memberInstanceIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] },
      { id: 'C', name: 'Inner', memberInstanceIds: ['a1', 'a2'] }
    ];
    const positions = positionsOf(applyLayout(nodes, edges, 'force', { ...OPTS, groups }));
    const inner = groups[1];
    const rect = renderedRect(inner, positions, nodes);
    ['a3', 'a4', 'a5', 'a6'].forEach(id => {
      const n = nodes.find(x => x.id === id);
      const p = positions.get(id);
      const overlaps = p.x + n.width > rect.minX && p.x < rect.maxX &&
                       p.y + n.height > rect.minY && p.y < rect.maxY;
      expect(overlaps, `${id} sits inside the nested group`).toBe(false);
    });
  });
});

describe('grouped graphs keep their routing-native layout', () => {
  // Every one of these used to be discarded: applyLayout sent any graph with a
  // group straight to the force solver, so a Lombardi or orthogonal routing
  // style got arcs and elbows drawn over a spring layout.
  const PATTERN_ALGOS = ['pattern', 'radial-tree', 'arc-chain', 'tree-tidy', 'layered', 'ring'];

  PATTERN_ALGOS.forEach(algorithm => {
    it(`'${algorithm}' lays out grouped graphs and still excludes non-members`, () => {
      const { nodes, edges, groups } = twoGroupGraph();
      const updates = applyLayout(nodes, edges, algorithm, {
        ...OPTS,
        groups,
        routingStyle: algorithm === 'radial-tree' || algorithm === 'arc-chain' ? 'lombardi' : 'straight'
      });
      expect(updates).toHaveLength(nodes.length);
      updates.forEach(u => {
        expect(Number.isFinite(u.x), `${u.instanceId}.x`).toBe(true);
        expect(Number.isFinite(u.y), `${u.instanceId}.y`).toBe(true);
      });
      expect(intruders(positionsOf(updates), nodes, groups)).toEqual([]);
    });
  });

  // A group's interior is laid out by the same pipeline an ungrouped graph
  // uses, so it has to reserve the same room. It didn't: the edges handed to
  // that pipeline were rebuilt as bare {sourceId, destinationId} pairs, which a
  // layout reads as UNLABELLED — it reserves the plain node gap and the text is
  // drawn across whatever is there. Grouping a graph silently halved its
  // connection spacing.
  const spacingGraph = () => {
    const LONG = 'is the long winded precondition for';
    const nodes = ['a1', 'a2', 'a3', 'a4'].map(id => node(id, 240, 100));
    const edges = [
      edge('a1', 'a2', LONG), edge('a2', 'a3', LONG), edge('a3', 'a4', LONG)
    ];
    return { nodes, edges, groups: [{ id: 'A', name: 'A', memberInstanceIds: ['a1', 'a2', 'a3', 'a4'] }] };
  };

  const shortestEdge = (updates, nodes, edges) => {
    const p = new Map(updates.map(u => [u.instanceId, u]));
    const centre = (id) => {
      const n = nodes.find(x => x.id === id);
      return { x: p.get(id).x + n.width / 2, y: p.get(id).y + n.height / 2 };
    };
    return Math.min(...edges.map(e => {
      const a = centre(e.sourceId);
      const b = centre(e.destinationId);
      return Math.hypot(a.x - b.x, a.y - b.y);
    }));
  };

  it('reserves the same room for a labelled connection inside a group as outside one', () => {
    const { nodes, edges, groups } = spacingGraph();
    const opts = { ...OPTS, edgeLabelFontSize: 32, routingStyle: 'lombardi' };
    const ungrouped = shortestEdge(applyLayout(nodes, edges, 'pattern', opts), nodes, edges);
    const grouped = shortestEdge(applyLayout(nodes, edges, 'pattern', { ...opts, groups }), nodes, edges);
    // Not "roughly similar" — the grouped interior runs the identical solver on
    // the identical subgraph, so anything materially shorter means the label
    // went missing on the way in.
    expect(grouped).toBeGreaterThan(ungrouped * 0.9);
  });

  it('is deterministic for a grouped Lombardi layout, ungrouped nodes included', () => {
    // The pattern interiors are constructions, so pressing the button twice has
    // to land in the same place. Group placement used to scatter ungrouped and
    // multi-group nodes with Math.random, which was invisible while every
    // grouped graph went to the force solver and is the only remaining source
    // of movement now that it doesn't.
    const { nodes, edges, groups } = twoGroupGraph();
    const opts = { ...OPTS, groups, routingStyle: 'lombardi' };
    const a = applyLayout(nodes, edges, 'pattern', opts);
    const b = applyLayout(nodes, edges, 'pattern', opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
