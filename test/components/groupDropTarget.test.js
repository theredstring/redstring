import { describe, it, expect, vi } from 'vitest';

// utils.js measures text when it loads; jsdom has no 2D context.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});

import { findGroupDropTarget, groupDropDialogFor } from '../../src/components/canvas/groups/groupDropTarget.js';
import { createPointerHandlers } from '../../src/components/canvas/input/pointerHandlers.js';

const node = (id, x, y) => ({ id, x, y, name: id });

// Where a Thing landing at a point joins: shared by the drag drop and the plus sign.
describe('findGroupDropTarget', () => {
  const nodes = [node('a', 0, 0), node('b', 400, 0), node('inner', 1000, 1000), node('anchor', 3000, 3000)];
  const outer = { id: 'outer', name: 'Outer', memberInstanceIds: ['a', 'b', 'inner'], linkedNodePrototypeId: 'p' };
  const inner = { id: 'inner-g', name: 'Inner', memberInstanceIds: ['inner'] };
  const empty = {
    id: 'empty', name: 'Empty', memberInstanceIds: [], linkedNodePrototypeId: 'q',
    anchorInstanceId: 'anchor', emptyPlaceholderOrigin: { x: 5000, y: 5000 },
  };
  const groupDepths = new Map([['outer', 0], ['inner-g', 1], ['empty', 0]]);
  const find = (point, excludeNodeId) => findGroupDropTarget({
    point, excludeNodeId, groups: [inner, outer, empty], nodes, groupDepths, gridSize: 200,
  });

  it('finds the group whose members surround the point', () => {
    expect(find({ x: 300, y: 20 })?.id).toBe('outer');
  });

  it('prefers the innermost group over an outer one listed later', () => {
    expect(find({ x: 1010, y: 1010 })?.id).toBe('inner-g');
  });

  it('skips groups the node is already in', () => {
    expect(find({ x: 1010, y: 1010 }, 'inner')).toBe(null);
  });

  it('holds an empty node-group open at its placeholder origin', () => {
    expect(find({ x: 5010, y: 5010 })?.id).toBe('empty');
    expect(find({ x: 3010, y: 3010 })).toBe(null);
  });

  it('returns null outside every group', () => {
    expect(find({ x: -2000, y: -2000 })).toBe(null);
  });

  it('names the chain above a nested target in the dialog', () => {
    const dialog = groupDropDialogFor(inner, ['n'], new Map([['inner-g', new Set(['outer'])]]), { x: 1, y: 2 });
    expect(dialog).toEqual({
      nodeIds: ['n'], groupId: 'inner-g', groupName: 'Inner (and others)', isNodeGroup: false, position: { x: 1, y: 2 },
    });
  });
});

// A click on a node-group's interior is a canvas click: it spawns a plus sign
// that remembers which group it was opened in.
describe('handleCanvasClick on a node-group interior', () => {
  it('spawns a plus sign carrying the group id and click point', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('canvas');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    bg.setAttribute('data-group-id', 'g1');
    const interior = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    interior.classList.add('node-group-interior');
    bg.appendChild(interior);
    svg.appendChild(bg);
    document.body.appendChild(svg);

    const setPlusSign = vi.fn();
    const ctxRef = {
      current: {
        justCompletedBoxSelectRef: { current: false }, ignoreCanvasClick: { current: false },
        gestureBlockRef: { current: false }, selectedInstanceIds: new Set(), plusSign: null,
        semanticOrbitActive: false, draggingNodeInfo: null, drawingConnectionFrom: null,
        nodeNamePrompt: { visible: false }, activeGraphId: 'graph', findEdgeAtClientPoint: () => null,
        selectedEdgeIds: new Set(), selectedEdgeId: null, wasDrawingConnection: { current: false },
        isPieMenuActionInProgress: false, selectedGroup: null, abstractionCarouselVisible: false,
        carouselExitInProgressRef: { current: false },
        containerRef: { current: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
        panOffsetRef: { current: { x: 0, y: 0 } }, zoomLevelRef: { current: 1 },
        canvasSize: { offsetX: 0, offsetY: 0, width: 10000, height: 10000 }, setPlusSign,
      },
    };
    createPointerHandlers(ctxRef).handleCanvasClick({ target: interior, clientX: 120, clientY: 80 });

    expect(setPlusSign).toHaveBeenCalledTimes(1);
    expect(setPlusSign.mock.calls[0][0]).toMatchObject({
      mode: 'appear', groupInteriorId: 'g1', clientX: 120, clientY: 80,
    });
    svg.remove();
  });
});
