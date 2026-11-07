import { describe, it, expect, vi, afterEach } from 'vitest';

// utils.js measures text when it loads; jsdom has no 2D context.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = function getContext(kind) {
    if (kind !== '2d') return null;
    return { font: '', measureText: (text) => ({ width: text.length * 8 }) };
  };
});

import { createPointerHandlers } from '../../src/components/canvas/input/pointerHandlers.js';
import { createGroupInputHandlers } from '../../src/components/canvas/groups/groupInput.js';
import { setReadOnlyUniverse } from '../../src/store/readOnlyUniverse.js';

const readOnly = () => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://example.com/a.redstring' });
const NODE = { id: 'inst-1', prototypeId: 'proto-1', name: 'Node', x: 0, y: 0 };

// A mouse held down on a Thing at (100, 100), as handleNodeMouseDown leaves it.
const heldOnThing = () => {
  const isPanningRef = { current: false };
  return {
    mousePositionRef: { current: null }, activeGraphId: 'graph-1', middleMouseZoomRef: { current: null },
    draggingNodeInfo: null, draggingNodeInfoRef: { current: null }, drawingConnectionFrom: null,
    isMouseDown: { current: true }, isPanning: false, isPanningRef, pinchRef: { current: { active: false } },
    clearLabelsOnMouseMove: () => { }, lastMousePosRef: { current: null },
    containerRef: { current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    panOffsetRef: { current: { x: 0, y: 0 } }, zoomLevelRef: { current: 1 },
    canvasSize: { width: 4000, height: 4000, offsetX: 0, offsetY: 0 }, viewportSize: { width: 1000, height: 1000 },
    clampCoordinates: (x, y) => ({ x, y }), selectionStartRef: { current: null },
    mouseDownPosition: { current: { x: 100, y: 100 } }, mouseMoved: { current: false },
    clickTimeoutIdRef: { current: null }, potentialClickNodeRef: { current: null },
    longPressingInstanceIdRef: { current: NODE.id }, setLongPressingInstanceId: vi.fn(),
    longPressTimeout: { current: null }, groupLongPressTimeout: { current: null },
    startedOnNode: { current: true }, mouseInsideNode: { current: true },
    panStartRef: { current: { x: 0, y: 0 } }, setPanStart: vi.fn(), isPanningOrZooming: { current: false },
    setIsPanning: vi.fn((v) => { isPanningRef.current = v; }), lastPanVelocityRef: { current: {} }, lastPanSampleRef: { current: {} },
    panSourceRef: { current: null }, isTouchDeviceRef: { current: false }, panVelocityHistoryRef: { current: [] },
    nodes: [NODE], isInsideNode: () => false, previewingNodeId: null, anchorPositionUpdatesRef: { current: new Map() },
    setDrawingConnectionFrom: vi.fn(), connectionExitedSourceRef: { current: false }, connectionHoverTargetRef: { current: null },
    connectionStretchTrack: { current: { reset: () => { }, update: () => { } } },
    abstractionCarouselVisible: false, touchSettingsRef: { current: {} }, setPanOffset: vi.fn(),
  };
};

const moveTo = (ctx, x, y) => createPointerHandlers({ current: ctx }).handleMouseMove({
  clientX: x, clientY: y, timeStamp: 0, preventDefault: () => { }, stopPropagation: () => { },
});

afterEach(() => setReadOnlyUniverse(null));

describe('a mouse press moving off a Thing', () => {
  it('draws a connection in a universe of your own', () => {
    const ctx = heldOnThing();
    moveTo(ctx, 160, 100);
    expect(ctx.setDrawingConnectionFrom).toHaveBeenCalledTimes(1);
    expect(ctx.setIsPanning).not.toHaveBeenCalled();
  });

  it('pans a read-only universe, from where the pointer is', () => {
    readOnly();
    const ctx = heldOnThing();
    moveTo(ctx, 160, 100);
    expect(ctx.setDrawingConnectionFrom).not.toHaveBeenCalled();
    expect(ctx.setIsPanning).toHaveBeenCalledWith(true);
    expect(ctx.setPanStart).toHaveBeenCalledWith({ x: 160, y: 100 });
    expect(ctx.panSourceRef.current).toBe('mouse');
    // handleMouseUp reads this to treat the release as a pan's, not a press on a Thing's.
    expect(ctx.startedOnNode.current).toBe(false);
  });
});

describe('a press on a group title in a read-only universe', () => {
  const plainGroup = { group: { id: 'g1', name: 'Group' }, members: [], isNodeGroup: false, effectiveGroupName: 'Group' };

  const groupCtx = () => ({
    isMouseDown: { current: false }, mouseDownPosition: { current: null }, mouseMoved: { current: true },
    mouseInsideNode: { current: false }, startedOnNode: { current: false }, setLongPressingInstanceId: vi.fn(),
    groupLongPressTimeout: { current: null }, groupTouchStartRef: { current: null }, groupTouchCleanupRef: { current: null },
    startGroupDragAtPointRef: { current: vi.fn() }, nodeLiftDelay: 10000, isViewMoving: () => false,
    touch: { panCanvasFromTouch: vi.fn() }, nodeDrag: { draggingNodeInfoRef: { current: null } }, TOUCH_MOVEMENT_THRESHOLD: 10,
    wasDraggingRef: { current: false }, gestureBlockRef: { current: false }, isDoublePress: () => false,
    setSelectedGroup: vi.fn(), setSelectedInstanceIds: vi.fn(), storeActions: { setSelectedEdgeId: vi.fn(), clearSelectedEdgeIds: vi.fn() },
    setGroupControlPanelShouldShow: vi.fn(), setNodeControlPanelShouldShow: vi.fn(), setNodeControlPanelVisible: vi.fn(),
    setAbstractionControlPanelVisible: vi.fn(), setAbstractionControlPanelShouldShow: vi.fn(),
    setConnectionControlPanelVisible: vi.fn(), setConnectionControlPanelShouldShow: vi.fn(),
  });
  const handlersOf = (ctx) => createGroupInputHandlers({ current: ctx });
  const event = (extra) => ({ stopPropagation: () => { }, clientX: 100, clientY: 100, detail: 1, ...extra });

  it('is tracked by mouse even for a plain group, so moving it can pan', () => {
    readOnly();
    const ctx = groupCtx();
    handlersOf(ctx).titleMouseDown(event(), plainGroup);
    clearTimeout(ctx.groupLongPressTimeout.current);
    expect(ctx.isMouseDown.current).toBe(true);
    expect(ctx.startedOnNode.current).toBe(true);
  });

  it('does not select on the click that ends the pan', () => {
    readOnly();
    const ctx = groupCtx();
    ctx.mouseMoved.current = false;
    ctx.gestureBlockRef.current = true;
    handlersOf(ctx).titleClick(event(), plainGroup);
    expect(ctx.setSelectedGroup).not.toHaveBeenCalled();
  });

  it('hands a moving finger to the canvas once, and its release is no tap', () => {
    readOnly();
    const ctx = groupCtx();
    handlersOf(ctx).titleTouchStart(event({ touches: [{ clientX: 100, clientY: 100 }] }), plainGroup);
    const move = (x) => {
      const ev = new Event('touchmove');
      ev.touches = [{ clientX: x, clientY: 100 }];
      document.dispatchEvent(ev);
    };
    move(104);
    expect(ctx.touch.panCanvasFromTouch).not.toHaveBeenCalled();
    move(160);
    move(200);
    expect(ctx.touch.panCanvasFromTouch).toHaveBeenCalledTimes(1);
    expect(ctx.groupTouchStartRef.current).toBeNull();
  });
});
