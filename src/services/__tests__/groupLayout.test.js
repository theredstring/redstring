import { describe, it, expect } from 'vitest';
import {
  computeGroupLayout,
  buildChildGroupIdsIndex,
  computeGroupDepths,
  buildParentGroupIdsIndex,
  collectAffectedGroupIds,
  buildEdgeZSlotIndex,
  edgeZSlotFor,
  buildShellCutoutPath,
  placeholderIdForGroup,
  groupIdFromPlaceholderId,
  GROUP_LAYOUT_CONSTANTS as C,
} from '../groupLayout.js';

const GRID_SIZE = 100;
const memberPadding = Math.max(24, Math.round(GRID_SIZE * 0.2));
const margin = memberPadding + C.innerCanvasBorder;
const labelHeight = Math.max(80, C.fontSize * 1.4 + C.titlePaddingVertical * 2);

const measure = (text) => (text || '').length * 12;
const dim = (w, h) => ({ currentWidth: w, currentHeight: h });

const buildContext = (overrides = {}) => ({
  nodesById: new Map(),
  dimsById: new Map(),
  groupsById: new Map(),
  groupsByMemberId: new Map(),
  gridSize: GRID_SIZE,
  measureLabelWidth: measure,
  ...overrides,
});

const addNode = (ctx, id, x, y, w = 200, h = 150) => {
  ctx.nodesById.set(id, { id, x, y });
  ctx.dimsById.set(id, dim(w, h));
};

const addGroup = (ctx, group) => {
  ctx.groupsById.set(group.id, group);
  for (const memberId of group.memberInstanceIds || []) {
    if (!ctx.groupsByMemberId.has(memberId)) ctx.groupsByMemberId.set(memberId, []);
    ctx.groupsByMemberId.get(memberId).push({ groupId: group.id });
  }
};

describe('computeGroupLayout', () => {
  it('handles a simple thing-group', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0, 200, 150);
    addNode(ctx, 'b', 300, 0, 200, 150);
    addNode(ctx, 'c', 0, 200, 200, 150);
    const g = { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b', 'c'] };
    addGroup(ctx, g);

    const r = computeGroupLayout(g, ctx);
    expect(r.ok).toBe(true);
    expect(r.isNodeGroup).toBe(false);
    expect(r.bbox).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 350 });
    expect(r.rect).toEqual({ x: -margin, y: -margin, w: 500 + margin * 2, h: 350 + margin * 2 });
    expect(r.nodeGroupRect.y).toBe(r.rect.y);
    expect(r.nodeGroupRect.h).toBe(r.rect.h);
    expect(r.droppedOrphanIds).toEqual([]);
  });

  it('handles a simple node-group: nodeGroupRect extends above rect by labelHeight + titleToCanvasGap + titleTopMargin', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0, 200, 150);
    addNode(ctx, 'b', 300, 0, 200, 150);
    const g = { id: 'g1', name: 'NG', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'proto-1' };
    addGroup(ctx, g);

    const r = computeGroupLayout(g, ctx);
    expect(r.ok).toBe(true);
    expect(r.isNodeGroup).toBe(true);

    const expectedNgY = r.label.y - C.titleTopMargin;
    expect(r.nodeGroupRect.y).toBe(expectedNgY);
    expect(r.nodeGroupRect.h).toBe((r.rect.y + r.rect.h) - expectedNgY);

    const overhang = r.rect.y - r.nodeGroupRect.y;
    expect(overhang).toBe(labelHeight + C.titleToCanvasGap + C.titleTopMargin);
  });

  it('outer thing-group containing an inner node-group folds nested title overhang into outer minY', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0, 200, 150);
    addNode(ctx, 'b', 300, 0, 200, 150);
    addNode(ctx, 'c', 0, 200, 200, 150);

    const inner = { id: 'inner', name: 'Inner', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'proto-1' };
    const outer = { id: 'outer', name: 'Outer', memberInstanceIds: ['a', 'b', 'c'] };
    addGroup(ctx, inner);
    addGroup(ctx, outer);

    const innerLayout = computeGroupLayout(inner, ctx);
    const outerLayout = computeGroupLayout(outer, ctx);

    expect(innerLayout.ok).toBe(true);
    expect(outerLayout.ok).toBe(true);

    expect(outerLayout.bbox.minY).toBe(innerLayout.nodeGroupRect.y);
    expect(outerLayout.bbox.minY).toBeLessThan(0);

    const overhang = -innerLayout.nodeGroupRect.y;
    expect(overhang).toBeGreaterThan(labelHeight);
  });

  it('node-group containing node-group: outer folds inner overhang (strict subset)', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    addNode(ctx, 'c', 600, 200);

    const inner = { id: 'inner', name: 'Inner', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p1' };
    const outer = { id: 'outer', name: 'Outer', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p2' };
    addGroup(ctx, inner);
    addGroup(ctx, outer);

    const innerLayout = computeGroupLayout(inner, ctx);
    const outerLayout = computeGroupLayout(outer, ctx);

    expect(outerLayout.ok).toBe(true);
    expect(outerLayout.isNodeGroup).toBe(true);
    expect(outerLayout.bbox.minY).toBe(innerLayout.nodeGroupRect.y);
    const outerOverhangAboveRect = outerLayout.rect.y - outerLayout.nodeGroupRect.y;
    expect(outerOverhangAboveRect).toBe(labelHeight + C.titleToCanvasGap + C.titleTopMargin);
  });

  it('nested node-group shell keeps margin clearance on all four edges of the parent (no coincident rims)', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    addNode(ctx, 'c', 600, 200);

    const inner = { id: 'inner', name: 'Inner', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p1' };
    const outer = { id: 'outer', name: 'Outer', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p2' };
    addGroup(ctx, inner);
    addGroup(ctx, outer);

    const innerLayout = computeGroupLayout(inner, ctx);
    const outerLayout = computeGroupLayout(outer, ctx);
    const iv = innerLayout.visualBounds;

    // Before the four-edge fold, outer.rect.x === inner.rect.x (both minX - margin
    // from the same shared member 'a') — rims exactly coincided. Now the outer
    // shell must clear the inner shell by the full margin on left and bottom,
    // and at least contain it on the right (where member 'c' extends further).
    expect(outerLayout.rect.x).toBeLessThanOrEqual(iv.x - margin);
    expect(outerLayout.rect.y + outerLayout.rect.h).toBeGreaterThanOrEqual(iv.y + iv.h + margin);
    expect(outerLayout.rect.x + outerLayout.rect.w).toBeGreaterThanOrEqual(iv.x + iv.w);
    // Top keeps the pre-existing overhang fold (visualBounds.y === nodeGroupRect.y).
    expect(outerLayout.bbox.minY).toBe(innerLayout.nodeGroupRect.y);
  });

  it('empty node-group placeholder folds into the parent shell via its anchor instance', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'anchor-e', 300, 0);
    const empty = {
      id: 'empty', name: 'E', memberInstanceIds: [], linkedNodePrototypeId: 'p1',
      anchorInstanceId: 'anchor-e', emptyPlaceholderOrigin: { x: 300, y: 0 }
    };
    const outer = { id: 'outer', name: 'O', memberInstanceIds: ['a', 'anchor-e'], linkedNodePrototypeId: 'p2' };
    addGroup(ctx, empty);
    addGroup(ctx, outer);

    const emptyLayout = computeGroupLayout(empty, ctx);
    const outerLayout = computeGroupLayout(outer, ctx);
    expect(emptyLayout.ok).toBe(true);
    expect(outerLayout.ok).toBe(true);

    // The placeholder's shell (rect + title tab) must sit fully inside the
    // outer shell with margin clearance — before this it was invisible to the
    // parent (no members ⇒ never a strict-subset child).
    const ev = emptyLayout.visualBounds;
    expect(outerLayout.rect.x).toBeLessThanOrEqual(ev.x - margin);
    expect(outerLayout.rect.x + outerLayout.rect.w).toBeGreaterThanOrEqual(ev.x + ev.w + margin);
    expect(outerLayout.rect.y + outerLayout.rect.h).toBeGreaterThanOrEqual(ev.y + ev.h + margin);
    expect(outerLayout.bbox.minY).toBeLessThanOrEqual(ev.y);
    expect(outerLayout.nestedContributors.some(c => c.nestedGroupId === 'empty')).toBe(true);
  });

  it('a node-group folds a nested plain group, title pill included', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    addNode(ctx, 'c', 600, 0);
    const plain = { id: 'plain', name: 'A rather long plain group name', memberInstanceIds: ['a', 'b'] };
    const ng = { id: 'ng', name: 'NG', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p1' };
    addGroup(ctx, plain);
    addGroup(ctx, ng);

    const plainLayout = computeGroupLayout(plain, ctx);
    const ngLayout = computeGroupLayout(ng, ctx);
    expect(plainLayout.ok).toBe(true);
    expect(ngLayout.ok).toBe(true);

    // A plain group's visualBounds top is its FLOATING title pill, which sits
    // above its dashed rect with a gap. Folding only the members would leave the
    // pill hanging over the shell's rim.
    const pv = plainLayout.visualBounds;
    expect(pv.y).toBe(plainLayout.label.y);
    expect(pv.y).toBeLessThan(plainLayout.rect.y);

    expect(ngLayout.nestedContributors.some(c => c.nestedGroupId === 'plain')).toBe(true);
    expect(ngLayout.bbox.minY).toBeLessThanOrEqual(pv.y);
    expect(ngLayout.rect.x).toBeLessThanOrEqual(pv.x - margin);
    expect(ngLayout.rect.x + ngLayout.rect.w).toBeGreaterThanOrEqual(pv.x + pv.w + margin);
    expect(ngLayout.rect.y + ngLayout.rect.h).toBeGreaterThanOrEqual(pv.y + pv.h + margin);
  });

  it('peer node-groups (equal member sets) do NOT fold each other — neither is a strict subset', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    const gA = { id: 'gA', name: 'A', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'pA' };
    const gB = { id: 'gB', name: 'B', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'pB' };
    addGroup(ctx, gA);
    addGroup(ctx, gB);

    const rA = computeGroupLayout(gA, ctx);
    const rB = computeGroupLayout(gB, ctx);

    expect(rA.bbox.minY).toBe(0);
    expect(rB.bbox.minY).toBe(0);
    expect(rA.nestedContributors).toEqual([]);
    expect(rB.nestedContributors).toEqual([]);
  });

  it('three-deep nesting (thing > node > thing) propagates overhang correctly', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    addNode(ctx, 'c', 600, 0);
    addNode(ctx, 'd', 900, 0);

    // innermost ⊊ middle ⊊ outer (strict-subset chain)
    const innermost = { id: 'i', name: 'I', memberInstanceIds: ['a'], linkedNodePrototypeId: 'p0' };
    const middle = { id: 'm', name: 'M', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p1' };
    const outer = { id: 'o', name: 'O', memberInstanceIds: ['a', 'b', 'c', 'd'] };

    addGroup(ctx, innermost);
    addGroup(ctx, middle);
    addGroup(ctx, outer);

    const middleLayout = computeGroupLayout(middle, ctx);
    const outerLayout = computeGroupLayout(outer, ctx);

    expect(middleLayout.ok).toBe(true);
    expect(outerLayout.ok).toBe(true);

    // outer should fold middle's nodeGroupRect.y (which itself already folded innermost's)
    expect(outerLayout.bbox.minY).toBe(middleLayout.nodeGroupRect.y);
    expect(middleLayout.bbox.minY).toBe(innermost ? computeGroupLayout(innermost, ctx).nodeGroupRect.y : 0);
  });

  it('skips orphan member IDs and reports them in droppedOrphanIds', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 100, 100);
    addNode(ctx, 'b', 400, 100);
    const g = { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b', 'orphan-id'] };
    addGroup(ctx, g);

    const r = computeGroupLayout(g, ctx);
    expect(r.ok).toBe(true);
    expect(r.droppedOrphanIds).toEqual(['orphan-id']);
    expect(r.bbox).toEqual({ minX: 100, minY: 100, maxX: 600, maxY: 250 });
  });

  it('returns identical bounds whether the group has only orphans or all members resolve', () => {
    const ctxA = buildContext();
    addNode(ctxA, 'a', 100, 100);
    addNode(ctxA, 'b', 400, 100);
    const gA = { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b'] };
    addGroup(ctxA, gA);

    const ctxB = buildContext();
    addNode(ctxB, 'a', 100, 100);
    addNode(ctxB, 'b', 400, 100);
    const gB = { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b', 'orphan-id'] };
    addGroup(ctxB, gB);

    const rA = computeGroupLayout(gA, ctxA);
    const rB = computeGroupLayout(gB, ctxB);

    expect(rB.bbox).toEqual(rA.bbox);
    expect(rB.rect).toEqual(rA.rect);
  });

  it('returns ok:false when no members resolve', () => {
    const ctx = buildContext();
    const g = { id: 'g1', name: 'Empty', memberInstanceIds: ['x', 'y'] };
    addGroup(ctx, g);
    const r = computeGroupLayout(g, ctx);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-resolvable-members');
    expect(r.droppedOrphanIds).toEqual(['x', 'y']);
  });

  it('cycle-detection guard returns without infinite recursion if visiting set already contains the group', () => {
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'b', 300, 0);
    const g = { id: 'g', name: 'G', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p1' };
    addGroup(ctx, g);

    const visiting = new Set(['g']);
    const r = computeGroupLayout(g, { ...ctx, _visiting: visiting });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cycle');
  });

  it('drag/static parity: identical inputs via static path and drag-overlay path yield identical rect/label', () => {
    const ctxStatic = buildContext();
    addNode(ctxStatic, 'a', 100, 100);
    addNode(ctxStatic, 'b', 400, 100);
    const g = { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b'] };
    addGroup(ctxStatic, g);

    const dragOverlay = new Map([
      ['a', { x: 100, y: 100 }],
      ['b', { x: 400, y: 100 }],
    ]);
    const stored = new Map([
      ['a', { id: 'a', x: 100, y: 100 }],
      ['b', { id: 'b', x: 400, y: 100 }],
    ]);
    const ctxDrag = buildContext({
      nodesById: new Map([
        ['a', dragOverlay.get('a') ? { id: 'a', ...dragOverlay.get('a') } : stored.get('a')],
        ['b', dragOverlay.get('b') ? { id: 'b', ...dragOverlay.get('b') } : stored.get('b')],
      ]),
      dimsById: ctxStatic.dimsById,
    });
    addGroup(ctxDrag, g);

    const rStatic = computeGroupLayout(g, ctxStatic);
    const rDrag = computeGroupLayout(g, ctxDrag);

    const epsilon = 0.5;
    expect(Math.abs(rStatic.rect.x - rDrag.rect.x)).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(rStatic.rect.y - rDrag.rect.y)).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(rStatic.rect.w - rDrag.rect.w)).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(rStatic.rect.h - rDrag.rect.h)).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(rStatic.label.x - rDrag.label.x)).toBeLessThanOrEqual(epsilon);
    expect(Math.abs(rStatic.label.y - rDrag.label.y)).toBeLessThanOrEqual(epsilon);
  });
});

describe('computeGroupDepths', () => {
  const depthsFor = (ctx) => {
    const childIndex = buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);
    return computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
  };

  it('assigns 0 to non-nested groups', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'g1', name: 'A', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'g2', name: 'B', memberInstanceIds: ['c'], linkedNodePrototypeId: 'p2' });

    const depths = depthsFor(ctx);
    expect(depths.get('g1')).toBe(0);
    expect(depths.get('g2')).toBe(0);
  });

  it('deepens by one per level along a nesting chain (outer=0, middle=1, inner=2)', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'inner', name: 'I', memberInstanceIds: ['a'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'middle', name: 'M', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p2' });
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p3' });

    const depths = depthsFor(ctx);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('middle')).toBe(1);
    expect(depths.get('inner')).toBe(2);
  });

  it('keeps children strictly deeper than every parent when nesting overlaps', () => {
    // inner sits inside both b1 and b2 (siblings), all inside outer.
    const ctx = buildContext();
    addGroup(ctx, { id: 'inner', name: 'I', memberInstanceIds: ['a'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'b1', name: 'B1', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p2' });
    addGroup(ctx, { id: 'b2', name: 'B2', memberInstanceIds: ['a', 'c'], linkedNodePrototypeId: 'p3' });
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'b', 'c', 'd'], linkedNodePrototypeId: 'p4' });

    const depths = depthsFor(ctx);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('b1')).toBeGreaterThan(depths.get('outer'));
    expect(depths.get('b2')).toBeGreaterThan(depths.get('outer'));
    expect(depths.get('inner')).toBeGreaterThan(depths.get('b1'));
    expect(depths.get('inner')).toBeGreaterThan(depths.get('b2'));
  });

  it('nests a plain group inside a node-group', () => {
    // The whole point: at depth 0 a plain group renders in the flat bottom
    // layer, underneath the opaque shell containing it — i.e. invisible.
    const ctx = buildContext();
    addGroup(ctx, { id: 'plain', name: 'P', memberInstanceIds: ['a', 'b'] });
    addGroup(ctx, { id: 'ng', name: 'NG', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p1' });

    const childIndex = buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);
    expect(childIndex.get('ng').has('plain')).toBe(true);

    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    expect(depths.get('ng')).toBe(0);
    expect(depths.get('plain')).toBe(1);
  });

  it('nests plain groups inside each other', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'inner', name: 'I', memberInstanceIds: ['a'] });
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'b'] });

    const depths = depthsFor(ctx);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('inner')).toBe(1);
  });

  it('interleaves plain and node-groups down one nesting chain', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'ng-inner', name: 'NGI', memberInstanceIds: ['a'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'plain', name: 'P', memberInstanceIds: ['a', 'b'] });
    addGroup(ctx, { id: 'ng-outer', name: 'NGO', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p2' });

    const depths = depthsFor(ctx);
    expect(depths.get('ng-outer')).toBe(0);
    expect(depths.get('plain')).toBe(1);
    expect(depths.get('ng-inner')).toBe(2);
  });

  it('empty node-groups inherit depth from the group holding their anchor', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'anchor-e'], linkedNodePrototypeId: 'p1' });
    // Empty placeholder group: no members, but its anchor lives inside outer.
    addGroup(ctx, { id: 'empty', name: 'E', memberInstanceIds: [], linkedNodePrototypeId: 'p2', anchorInstanceId: 'anchor-e' });

    const depths = depthsFor(ctx);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('empty')).toBe(1);
  });

  it('is independent of group insertion order', () => {
    // The old ancestor-count pass read parent depths while iterating the group
    // Map, so a chain that included an anchored empty group came out different
    // depending on which order the groups happened to be inserted in.
    const chain = [
      { id: 'outer', name: 'O', memberInstanceIds: ['a', 'm1', 'm2'] },
      { id: 'mid', name: 'M', memberInstanceIds: ['m1', 'm2'], linkedNodePrototypeId: 'p1', anchorInstanceId: 'a' },
      { id: 'leaf', name: 'L', memberInstanceIds: [], linkedNodePrototypeId: 'p2', anchorInstanceId: 'm1' },
    ];
    const expected = { outer: 0, mid: 1, leaf: 2 };

    for (const groups of [chain, [...chain].reverse()]) {
      const ctx = buildContext();
      groups.forEach(g => addGroup(ctx, g));
      const depths = depthsFor(ctx);
      expect({
        outer: depths.get('outer'), mid: depths.get('mid'), leaf: depths.get('leaf'),
      }).toEqual(expected);
    }
  });
});

// Containment is never stored — no parent pointer — so `isGroupInsideGroup` is
// the entire nesting model, shared by render-time depth and by the store's
// membership propagation. These pin the cases where the old strict-subset-only
// rule silently dropped a group out of the hierarchy, which hid it behind the
// opaque shell that actually contained it.
describe('group containment predicate', () => {
  const childrenOf = (ctx) => buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);

  it('nests a plain group inside a node-group with the SAME members', () => {
    // Reachable by dragging a node that the node-group already holds into a
    // plain group nested inside it: the outer set doesn't grow, the inner one
    // does, and strict subset stops holding.
    const ctx = buildContext();
    addGroup(ctx, { id: 'ng', name: 'NG', memberInstanceIds: ['m1', 'd'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'plain', name: 'P', memberInstanceIds: ['m1', 'd'] });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('ng').has('plain')).toBe(true);
    expect(childIndex.get('plain').has('ng')).toBe(false);

    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    expect(depths.get('ng')).toBe(0);
    expect(depths.get('plain')).toBe(1);
  });

  it('leaves two plain groups with the same members incomparable', () => {
    // Neither is opaque, so neither can hide the other — an arbitrary ordering
    // would be worse than none.
    const ctx = buildContext();
    addGroup(ctx, { id: 'a', name: 'A', memberInstanceIds: ['m1', 'm2'] });
    addGroup(ctx, { id: 'b', name: 'B', memberInstanceIds: ['m1', 'm2'] });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('a').has('b')).toBe(false);
    expect(childIndex.get('b').has('a')).toBe(false);
  });

  it('leaves two anchorless node-groups with the same members incomparable', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'a', name: 'A', memberInstanceIds: ['m1', 'm2'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'b', name: 'B', memberInstanceIds: ['m1', 'm2'], linkedNodePrototypeId: 'p2' });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('a').has('b')).toBe(false);
    expect(childIndex.get('b').has('a')).toBe(false);
  });

  it('nests a POPULATED node-group by its anchor alone', () => {
    // The anchor is the node-group's title tab on the parent canvas — its
    // identity there, independent of membership. Restricting this to empty
    // node-groups made nesting a cliff: a group was inside right up until it
    // gained its first member, then silently wasn't.
    const ctx = buildContext();
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a'] });
    addGroup(ctx, { id: 'inner', name: 'I', memberInstanceIds: ['m1', 'm2'], linkedNodePrototypeId: 'p1', anchorInstanceId: 'a' });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('outer').has('inner')).toBe(true);

    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('inner')).toBe(1);
  });

  it('folds an anchor-only child into the parent bbox', () => {
    // Depth without the fold means the parent's rim cuts straight through a
    // group it contains. The member loop can't reach this child — they share
    // no member — so the dedicated pass has to.
    const ctx = buildContext();
    addNode(ctx, 'a', 0, 0);
    addNode(ctx, 'm1', 1000, 1000);
    addNode(ctx, 'm2', 1300, 1000);
    const outer = { id: 'outer', name: 'O', memberInstanceIds: ['a'] };
    const inner = { id: 'inner', name: 'I', memberInstanceIds: ['m1', 'm2'], linkedNodePrototypeId: 'p1', anchorInstanceId: 'a' };
    addGroup(ctx, outer);
    addGroup(ctx, inner);
    ctx.childGroupIdsByGroupId = childrenOf(ctx);

    const innerLayout = computeGroupLayout(inner, buildContext({
      nodesById: ctx.nodesById, dimsById: ctx.dimsById,
      groupsById: ctx.groupsById, groupsByMemberId: ctx.groupsByMemberId,
    }));
    const r = computeGroupLayout(outer, ctx);

    expect(r.ok).toBe(true);
    expect(r.bbox.maxX).toBeGreaterThanOrEqual(innerLayout.visualBounds.x + innerLayout.visualBounds.w);
    expect(r.bbox.maxY).toBeGreaterThanOrEqual(innerLayout.visualBounds.y + innerLayout.visualBounds.h);
    expect(r.nestedContributors.some(c => c.nestedGroupId === 'inner')).toBe(true);
  });

  it('stays antisymmetric when both directions claim containment', () => {
    // Degenerate: a node-group listing its own anchor as a member. Without a
    // tie-break the pair would resolve by Map iteration order and the two
    // shells would swap layers between renders.
    const ctx = buildContext();
    addGroup(ctx, { id: 'ng', name: 'NG', memberInstanceIds: ['m1', 'x'], linkedNodePrototypeId: 'p1', anchorInstanceId: 'x' });
    addGroup(ctx, { id: 'plain', name: 'P', memberInstanceIds: ['m1', 'x'] });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('ng').has('plain')).toBe(true);
    expect(childIndex.get('plain').has('ng')).toBe(false);

    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    expect(depths.get('ng')).toBe(0);
    expect(depths.get('plain')).toBe(1);
  });

  it('does not mint a phantom child from a stale anchor', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['m1'] });
    // Anchor instance was deleted; instance removal sweeps every member list,
    // so no group holds it any more.
    addGroup(ctx, { id: 'orphan', name: 'X', memberInstanceIds: [], linkedNodePrototypeId: 'p1', anchorInstanceId: 'ghost' });

    const childIndex = childrenOf(ctx);
    expect(childIndex.get('outer').has('orphan')).toBe(false);
    expect(computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex).get('orphan')).toBe(0);
  });
});

describe('collectAffectedGroupIds', () => {
  const indexesFor = (ctx) => {
    const childIndex = buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);
    return {
      groupsByMemberId: ctx.groupsByMemberId,
      parentGroupIdsIndex: buildParentGroupIdsIndex(childIndex),
    };
  };

  it('round-trips placeholder ids', () => {
    expect(groupIdFromPlaceholderId(placeholderIdForGroup('g1'))).toBe('g1');
    expect(groupIdFromPlaceholderId('inst-123')).toBe(null);
    expect(groupIdFromPlaceholderId(undefined)).toBe(null);
  });

  it('resolves a moved member to its group', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'g1', name: 'G', memberInstanceIds: ['a', 'b'] });
    const affected = collectAffectedGroupIds(['a'], indexesFor(ctx));
    expect([...affected]).toEqual(['g1']);
  });

  it('resolves a placeholder id to the empty group it stands for', () => {
    const ctx = buildContext();
    addGroup(ctx, {
      id: 'empty', name: 'E', memberInstanceIds: [], linkedNodePrototypeId: 'p1',
      anchorInstanceId: 'anchor-e',
    });
    const affected = collectAffectedGroupIds([placeholderIdForGroup('empty')], indexesFor(ctx));
    expect(affected.has('empty')).toBe(true);
  });

  it('walks up to containing ancestors transitively', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'inner', name: 'I', memberInstanceIds: ['a'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, { id: 'middle', name: 'M', memberInstanceIds: ['a', 'b'], linkedNodePrototypeId: 'p2' });
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'b', 'c'], linkedNodePrototypeId: 'p3' });

    const affected = collectAffectedGroupIds(['a'], indexesFor(ctx));
    expect(affected.has('inner')).toBe(true);
    expect(affected.has('middle')).toBe(true);
    expect(affected.has('outer')).toBe(true);
  });

  it('reaches the parent of a nested EMPTY group moved by placeholder alone', () => {
    // The drag case that used to leave the parent shell frozen: an empty
    // node-group has no member instance, so only its placeholder id moves.
    const ctx = buildContext();
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'anchor-e'], linkedNodePrototypeId: 'p1' });
    addGroup(ctx, {
      id: 'empty', name: 'E', memberInstanceIds: [], linkedNodePrototypeId: 'p2',
      anchorInstanceId: 'anchor-e',
    });

    const affected = collectAffectedGroupIds([placeholderIdForGroup('empty')], indexesFor(ctx));
    expect(affected.has('empty')).toBe(true);
    expect(affected.has('outer')).toBe(true);
  });

  it('returns an empty set for ids that belong to no group', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'g1', name: 'G', memberInstanceIds: ['a'] });
    expect(collectAffectedGroupIds(['loose'], indexesFor(ctx)).size).toBe(0);
  });
});

describe('connection z-slots', () => {
  // Composition shape the canvas actually produces:
  //   parent (depth 0) contains sibling node-groups A and B (depth 1);
  //   B holds member 'nephew'. A is wired to 'nephew'.
  const buildFamily = () => {
    const ctx = buildContext();
    addGroup(ctx, {
      id: 'parent', name: 'P', linkedNodePrototypeId: 'pp',
      anchorInstanceId: 'parent-anchor',
      memberInstanceIds: ['a-anchor', 'b-anchor', 'nephew', 'cousin'],
    });
    addGroup(ctx, {
      id: 'gA', name: 'A', linkedNodePrototypeId: 'pa',
      anchorInstanceId: 'a-anchor', memberInstanceIds: ['cousin'],
    });
    addGroup(ctx, {
      id: 'gB', name: 'B', linkedNodePrototypeId: 'pb',
      anchorInstanceId: 'b-anchor', memberInstanceIds: ['nephew'],
    });
    const childIndex = buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);
    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    return { ctx, depths, slots: buildEdgeZSlotIndex(ctx.groupsById, depths) };
  };

  it('puts an anchor at its own depth and a member one level above its group', () => {
    const { depths, slots } = buildFamily();
    expect(depths.get('parent')).toBe(0);
    expect(depths.get('gB')).toBe(1);

    // parent's anchor tucks under parent's own band
    expect(slots.get('parent-anchor')).toBe(0);
    // A's anchor tucks under A's band but clears parent's
    expect(slots.get('a-anchor')).toBe(1);
    // nephew is drawn above B's shell, so its connections must be too
    expect(slots.get('nephew')).toBe(2);
  });

  it('routes a node-group → nephew connection above the sibling shell that holds the nephew', () => {
    const { depths, slots } = buildFamily();
    const topSlot = Math.max(...depths.values()) + 1;

    const edge = { sourceId: 'a-anchor', destinationId: 'nephew' };
    const slot = edgeZSlotFor(edge, slots, topSlot);

    // Must clear gB's shell (depth 1), which is what used to swallow it.
    expect(slot).toBeGreaterThan(depths.get('gB'));
    expect(slot).toBe(2);
  });

  it('still tucks a top-level group\'s connection under its own band', () => {
    const ctx = buildContext();
    addGroup(ctx, {
      id: 'g', name: 'G', linkedNodePrototypeId: 'p',
      anchorInstanceId: 'g-anchor', memberInstanceIds: ['m'],
    });
    const childIndex = buildChildGroupIdsIndex(ctx.groupsById, ctx.groupsByMemberId);
    const depths = computeGroupDepths(ctx.groupsById, ctx.groupsByMemberId, childIndex);
    const slots = buildEdgeZSlotIndex(ctx.groupsById, depths);

    // free node ↔ the group's title: below the shell, so it reads as ending at the pill
    expect(edgeZSlotFor({ sourceId: 'loose', destinationId: 'g-anchor' }, slots, 1)).toBe(0);
  });

  it('sends self-loops to the top slot regardless of membership', () => {
    const { slots } = buildFamily();
    expect(edgeZSlotFor({ sourceId: 'nephew', destinationId: 'nephew' }, slots, 5)).toBe(5);
    expect(edgeZSlotFor({ sourceId: 'loose', destinationId: 'loose' }, slots, 5)).toBe(5);
  });

  it('clamps to the top slot so an edge never outruns the deepest shell', () => {
    const { slots } = buildFamily();
    expect(edgeZSlotFor({ sourceId: 'a-anchor', destinationId: 'nephew' }, slots, 1)).toBe(1);
  });

  it('ignores plain thing-groups, which render no opaque shell', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'plain', name: 'Plain', memberInstanceIds: ['x', 'y'] });
    const slots = buildEdgeZSlotIndex(ctx.groupsById, new Map([['plain', 0]]));
    expect(slots.size).toBe(0);
    expect(edgeZSlotFor({ sourceId: 'x', destinationId: 'y' }, slots, 1)).toBe(0);
  });
});

describe('buildShellCutoutPath', () => {
  const region = { x: -1000, y: -1000, w: 5000, h: 5000 };
  const shell = { x: 0, y: 0, w: 400, h: 300, r: 24 };

  it('emits the region plus one subpath per shell to punch out', () => {
    const d = buildShellCutoutPath(region, [shell]);
    expect(d.match(/M /g)).toHaveLength(2);
    // The region is a plain rect; the shell keeps its rounded corners so the cut
    // follows the same curve the rim paints.
    expect(d).toContain('M -1000 -1000');
    expect(d).toContain('A 24 24');
  });

  it('cuts several shells at once (both ends land on a group title)', () => {
    const d = buildShellCutoutPath(region, [shell, { ...shell, x: 900 }]);
    expect(d.match(/M /g)).toHaveLength(3);
  });

  it('yields the bare region when there is nothing to cut', () => {
    expect(buildShellCutoutPath(region, []).match(/M /g)).toHaveLength(1);
    expect(buildShellCutoutPath(region, [null, { x: 0, y: 0, w: 0, h: 10, r: 4 }]).match(/M /g)).toHaveLength(1);
  });

  it('returns nothing for a degenerate region rather than an empty clip', () => {
    // An empty clip would hide the connection entirely; callers skip applying it.
    expect(buildShellCutoutPath({ ...region, w: 0 }, [shell])).toBe('');
  });
});
