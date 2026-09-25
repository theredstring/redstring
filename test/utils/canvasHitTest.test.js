import { describe, it, expect, vi } from 'vitest';

// utils.js measures text when it loads, and jsdom has no 2D context: a fixed
// advance per character is enough, nothing here depends on exact widths.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});
import { selectionInRect, groupTitleAtCanvasPoint, groupDragOffsets } from '../../src/utils/canvas/canvasHitTest.js';
import { getNodeDimensions } from '../../src/utils.js';
import { placeholderIdForGroup } from '../../src/services/groupLayout.js';

// P4.01: canvas-space hit tests, moved out of NodeCanvas.
const node = (id, x, y, extra = {}) => ({ id, x, y, name: id, prototypeId: `p-${id}`, ...extra });

describe('selectionInRect', () => {
  const a = node('a', 0, 0);
  const b = node('b', 1000, 0);
  const anchor = node('anchor', 10, 10, { isGroupAnchor: true });
  const { currentWidth } = getNodeDimensions(a, false, null);

  it('selects the nodes a box touches, never a group anchor', () => {
    const got = selectionInRect({ x: -5, y: -5, width: 20, height: 20 }, [a, b, anchor], null, null);
    expect([...got]).toEqual(['a']);
  });

  it('counts touching the right edge as touching', () => {
    const got = selectionInRect({ x: currentWidth, y: 0, width: 1, height: 1 }, [a], null, null);
    expect(got.has('a')).toBe(true);
  });

  it('extends the base selection and never drops a node the box did not add', () => {
    const base = new Set(['b']);
    const got = selectionInRect({ x: 5000, y: 5000, width: 1, height: 1 }, [a, b], base, null);
    expect([...got]).toEqual(['b']);
    expect(base).toEqual(new Set(['b'])); // not mutated
  });
});

describe('groupTitleAtCanvasPoint', () => {
  const rects = new Map([['anc-1', { x: 100, y: 100, width: 80, height: 30, groupId: 'g-1' }]]);
  it('finds the pill containing the point, edges included', () => {
    expect(groupTitleAtCanvasPoint(180, 130, rects)).toEqual({ anchorInstanceId: 'anc-1', groupId: 'g-1' });
  });
  it('is null outside every pill', () => {
    expect(groupTitleAtCanvasPoint(181, 130, rects)).toBeNull();
  });
});

describe('groupDragOffsets', () => {
  it('covers members, the anchor, an empty placeholder and empty nested child groups', () => {
    const m = node('m', 10, 20);
    const anchor = node('anc', 0, 0);
    const group = { id: 'g', anchorInstanceId: 'anc', memberInstanceIds: [] };
    const emptyNodeGroup = { ...group, emptyPlaceholderOrigin: { x: 50, y: 60 } };
    const childEmpty = { id: 'c1', memberInstanceIds: [], emptyPlaceholderOrigin: { x: 70, y: 80 } };
    const childFull = { id: 'c2', memberInstanceIds: ['m'], emptyPlaceholderOrigin: { x: 0, y: 0 } };
    const offsets = groupDragOffsets(emptyNodeGroup, [m], true, 100, 100, {
      nodes: [m, anchor],
      childGroupIdsByGroupId: new Map([['g', ['c1', 'c2', 'missing']]]),
      groupsById: new Map([['c1', childEmpty], ['c2', childFull]]),
    });
    expect(offsets).toEqual([
      { id: 'm', dx: 90, dy: 80 },
      { id: 'anc', dx: 100, dy: 100 },
      { id: placeholderIdForGroup('g'), dx: 50, dy: 40 },
      { id: placeholderIdForGroup('c1'), dx: 30, dy: 20 },
    ]);
  });

  it('gives a thing group (not a node group) no placeholder', () => {
    const group = { id: 'g', memberInstanceIds: [], emptyPlaceholderOrigin: { x: 0, y: 0 } };
    const offsets = groupDragOffsets(group, [], false, 0, 0, {
      nodes: [], childGroupIdsByGroupId: new Map(), groupsById: new Map(),
    });
    expect(offsets).toEqual([]);
  });
});
