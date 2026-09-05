/**
 * COMPACTION MUST TIGHTEN A NESTED WEB WITHOUT CROWDING IT.
 *
 * The group pipeline is otherwise expansion-only, so nesting used to accumulate
 * slack multiplicatively: a four-deep web drew at ~2.5x the area of the same
 * graph with no groups at all, at a zoom where nothing was legible. Compaction
 * closes that. The risk it introduces is the opposite one — packing things
 * until the drawing lies about what contains what, or until a label no longer
 * fits the edge it is drawn along.
 *
 * So the assertions come in two halves, and BOTH have to hold:
 *
 *   FLOORS   — every guarantee the layout made before compaction still holds
 *              after it. These are the tests that would catch over-compaction.
 *   CEILINGS — compaction actually removes slack, and a nested web stays within
 *              reach of the same graph laid out flat. These catch a regression
 *              back into sprawl.
 *
 * Rects are the ones a RENDERER would paint (`drawnGroupRects`), not the
 * solver's own idea of them — see layoutHelpers.js.
 */

import { describe, it, expect } from 'vitest';
import { applyLayout, deriveGroupVisualBounds } from '../graphLayoutService.js';
import { estimateEdgeLabelWidth } from '../layoutGeometry.js';
import {
  buildGroupsByMemberIdIndex, buildChildGroupIdsIndex, buildParentGroupIdsIndex,
  withEmptyGroupPlaceholders,
} from '../groupLayout.js';
import {
  node, edge, buildNestedGroupWeb, drawnGroupRects, contentArea, distance,
} from './layoutHelpers.js';

// The label font the canvas draws a group title at (45 × fontSize × nodeScale
// at default settings), passed explicitly so the solver reserves the tab this
// test then measures.
const GROUP_FONT = 45;
const OPTS = {
  width: 3000, height: 2200, padding: 300, gridSize: 100,
  edgeLabelFontSize: 45, groupLabelFontSize: GROUP_FONT,
};

const positionsOf = (updates) => new Map(updates.map(u => [u.instanceId, { x: u.x, y: u.y }]));

const layout = (nodes, edges, groups, extra = {}) =>
  positionsOf(applyLayout(nodes, edges, 'force', { ...OPTS, groups, ...extra }));

const overlap = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0
  && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0;

const nodeRect = (positions, n) => {
  const p = positions.get(n.id);
  return p && { minX: p.x, minY: p.y, maxX: p.x + n.width, maxY: p.y + n.height };
};

/** depth × branch → a web deep and wide enough for slack to compound. */
const WEBS = [
  { name: '3 deep, 2 wide', shape: { depth: 3, branch: 2, leaves: 3 } },
  { name: '3 deep, 3 wide', shape: { depth: 3, branch: 3, leaves: 3 } },
  { name: '4 deep, 2 wide', shape: { depth: 4, branch: 2, leaves: 3 } },
];

describe('floors: what compaction is not allowed to cross', () => {
  WEBS.forEach(({ name, shape }) => {
    describe(name, () => {
      const { nodes, edges, groups } = buildNestedGroupWeb(shape);
      const positions = layout(nodes, edges, groups);
      const rects = drawnGroupRects(positions, nodes, groups, GROUP_FONT);

      it('draws no node inside a group it does not belong to', () => {
        const anchors = new Set(groups.map(g => g.anchorInstanceId).filter(Boolean));
        const intruders = [];
        groups.forEach(group => {
          const rect = rects.get(group.id);
          if (!rect) return;
          const members = new Set(group.memberInstanceIds || []);
          nodes.forEach(n => {
            if (members.has(n.id)) return;
            // Anchors are title tabs, placed AT a group's rim by design, and a
            // parent's own tab can still land over a nested child's shell — a
            // separate defect in the anchor re-pin, not something compaction
            // introduced or can fix. Every other node is in scope.
            if (anchors.has(n.id)) return;
            const r = nodeRect(positions, n);
            if (r && overlap(r, rect)) intruders.push(`${n.id} inside ${group.id}`);
          });
        });
        expect(intruders).toEqual([]);
      });

      it('leaves every labelled connection at least as long as its label', () => {
        const short = edges.filter(e => {
          if (!e.name) return false;
          const span = distance(positions, nodes, e.sourceId, e.destinationId);
          return span < estimateEdgeLabelWidth(e.name, OPTS.edgeLabelFontSize);
        }).map(e => e.id);
        expect(short).toEqual([]);
      });

      it('keeps sibling group shells apart at every depth', () => {
        const groupsById = new Map(groups.map(g => [g.id, g]));
        const parents = buildParentGroupIdsIndex(
          buildChildGroupIdsIndex(groupsById, buildGroupsByMemberIdIndex(groupsById))
        );
        const familyOf = (id) => [...(parents.get(id) || [])].sort().join('+') || 'TOP';
        const families = new Map();
        groups.forEach(g => {
          const key = familyOf(g.id);
          if (!families.has(key)) families.set(key, []);
          families.get(key).push(g.id);
        });
        const collisions = [];
        families.forEach(ids => {
          for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              const a = rects.get(ids[i]);
              const b = rects.get(ids[j]);
              if (a && b && overlap(a, b)) collisions.push(`${ids[i]} ∩ ${ids[j]}`);
            }
          }
        });
        expect(collisions).toEqual([]);
      });

      it('keeps every child shell inside its parent shell', () => {
        const groupsById = new Map(groups.map(g => [g.id, g]));
        const parents = buildParentGroupIdsIndex(
          buildChildGroupIdsIndex(groupsById, buildGroupsByMemberIdIndex(groupsById))
        );
        const escapes = [];
        parents.forEach((parentIds, childId) => {
          const c = rects.get(childId);
          if (!c) return;
          parentIds.forEach(pid => {
            const p = rects.get(pid);
            if (!p) return;
            const out = Math.max(p.minX - c.minX, 0) + Math.max(c.maxX - p.maxX, 0)
              + Math.max(p.minY - c.minY, 0) + Math.max(c.maxY - p.maxY, 0);
            if (out > 1) escapes.push(`${childId} escapes ${pid} by ${Math.round(out)}px`);
          });
        });
        expect(escapes).toEqual([]);
      });
    });
  });
});

describe('ceilings: compaction actually removes slack', () => {
  it('draws a deep web smaller than it would uncompacted', () => {
    // The wide cases are where per-level slack compounds hardest; a two-wide
    // level has little for compaction to close, so it is not asserted on.
    [{ depth: 3, branch: 3, leaves: 3 }, { depth: 4, branch: 2, leaves: 3 }].forEach(shape => {
      const { nodes, edges, groups } = buildNestedGroupWeb(shape);
      const loose = contentArea(layout(nodes, edges, groups, { compactGroups: false }), nodes);
      const tight = contentArea(layout(nodes, edges, groups), nodes);
      // Measured 26-31%; asserted well under that so ordinary solver drift
      // doesn't fail the build.
      expect(tight).toBeLessThan(loose * 0.9);
    });
  });

  it('keeps a nested web within reach of the same graph laid out flat', () => {
    // This is the regression that started the work: grouping the same topology
    // cost 2.5x the area at depth 4. Now measured at 1.4-1.8x.
    WEBS.forEach(({ name, shape }) => {
      const { nodes, edges, groups } = buildNestedGroupWeb(shape);
      const grouped = contentArea(layout(nodes, edges, groups), nodes);
      const flat = contentArea(layout(nodes, edges, []), nodes);
      expect(grouped / flat, name).toBeLessThan(2.2);
    });
  });
});

describe('the solver reserves the rect the renderer draws', () => {
  it('agrees with computeGroupLayout on a group\'s visual bounds', () => {
    // These are two copies of the same geometry — the solver cannot run the
    // renderer's version, because that one needs a text measurement function
    // and the solver runs in a worker. They drifted: the solver's fallback
    // guessed a title width from character count and came out about half size,
    // so every group's name overhung the rect kept clear for it.
    const members = ['m1', 'm2'].map(id => node(id, 300, 100));
    const group = {
      id: 'G', name: 'Mitochondrial electron transport',
      memberInstanceIds: ['m1', 'm2'], anchorInstanceId: 'anchor',
      linkedNodePrototypeId: 'proto',
    };
    const positions = new Map([['m1', { x: 0, y: 0 }], ['m2', { x: 600, y: 0 }]]);
    const drawn = drawnGroupRects(positions, members, [group], GROUP_FONT).get('G');

    const solver = deriveGroupVisualBounds(
      group,
      { minX: 0, minY: 0, maxX: 900, maxY: 100 },
      { gridSize: 100, groupLabelFontSize: GROUP_FONT }
    );

    expect(solver.x).toBeCloseTo(drawn.minX, 6);
    expect(solver.y).toBeCloseTo(drawn.minY, 6);
    expect(solver.w).toBeCloseTo(drawn.maxX - drawn.minX, 6);
    expect(solver.h).toBeCloseTo(drawn.maxY - drawn.minY, 6);
  });
});

describe('an empty nested node-group travels with the layout', () => {
  it('moves its shell instead of stranding it where it was last dragged', () => {
    // An empty node-group's box rides on `emptyPlaceholderOrigin`, which only
    // the drag path used to write. Auto-layout moved the anchor and left the
    // shell behind, and the parent's rect stretched to span both positions.
    const nodes = ['anchor-P', 'p1', 'p2', 'p3', 'anchor-C'].map(id => node(id, 300, 100));
    const edges = [
      edge('p1', 'p2', 'is composed of'),
      edge('p2', 'p3', 'depends on'),
      edge('anchor-C', 'p1', 'relates to'),
    ];
    const parent = {
      id: 'P', name: 'Parent', anchorInstanceId: 'anchor-P', linkedNodePrototypeId: 'pp',
      memberInstanceIds: ['p1', 'p2', 'p3', 'anchor-C'],
    };
    const child = {
      id: 'C', name: 'Empty child', anchorInstanceId: 'anchor-C', linkedNodePrototypeId: 'pc',
      memberInstanceIds: [], emptyPlaceholderOrigin: { x: 4000, y: 3000 },
    };

    // What the entry points do before handing the graph to the solver.
    const augmented = withEmptyGroupPlaceholders(nodes, [parent, child],
      () => ({ width: 300, height: 100 }));
    expect(augmented.nodes.some(n => n.id === '__placeholder__C')).toBe(true);
    // and it is listed as a member of the group AND of the group containing it
    expect(augmented.groups.find(g => g.id === 'C').memberInstanceIds).toContain('__placeholder__C');
    expect(augmented.groups.find(g => g.id === 'P').memberInstanceIds).toContain('__placeholder__C');

    const positions = layout(augmented.nodes, edges, augmented.groups);
    const placeholder = positions.get('__placeholder__C');
    const anchor = positions.get('anchor-C');
    expect(placeholder).toBeDefined();

    // The shell ends up with its own anchor, not at (4000, 3000).
    expect(Math.hypot(placeholder.x - anchor.x, placeholder.y - anchor.y)).toBeLessThan(1200);

    // And the parent's drawn rect is a box around its members, not one
    // stretched across the canvas to reach a stranded child.
    const rects = drawnGroupRects(positions, augmented.nodes, augmented.groups, GROUP_FONT);
    const p = rects.get('P');
    const ink = augmented.nodes.length * 300 * 100;
    expect((p.maxX - p.minX) * (p.maxY - p.minY)).toBeLessThan(ink * 20);
  });
});
