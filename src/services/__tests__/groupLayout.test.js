import { describe, it, expect } from 'vitest';
import { computeGroupLayout, buildChildGroupIdsIndex, computeGroupDepths, GROUP_LAYOUT_CONSTANTS as C } from '../groupLayout.js';

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

  it('counts every ancestor along a nesting chain (outer=0, middle=1, inner=2)', () => {
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

  it('empty node-groups inherit depth from the group holding their anchor', () => {
    const ctx = buildContext();
    addGroup(ctx, { id: 'outer', name: 'O', memberInstanceIds: ['a', 'anchor-e'], linkedNodePrototypeId: 'p1' });
    // Empty placeholder group: no members, but its anchor lives inside outer.
    addGroup(ctx, { id: 'empty', name: 'E', memberInstanceIds: [], linkedNodePrototypeId: 'p2', anchorInstanceId: 'anchor-e' });

    const depths = depthsFor(ctx);
    expect(depths.get('outer')).toBe(0);
    expect(depths.get('empty')).toBe(1);
  });
});
