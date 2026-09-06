import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useCanvasTouch } from '../../src/hooks/useCanvasTouch';

vi.mock('../../src/services/haptics.js', () => ({ haptic: () => { } }));

// Where the pinch is anchored is only observable through the pan/zoom it writes,
// so these tests keep a live transform (setPanAndZoom feeds the refs back) and
// project world points through it exactly as useCanvasTransform.applyTransform
// does. A correctly calibrated pinch is a similarity transform matching both
// fingers: whatever content a finger lands on stays under that finger.

const NODE_A = { id: 'inst-a', prototypeId: 'p', name: 'A', x: 0, y: 0 };

const CANVAS_SIZE = { width: 4000, height: 4000, offsetX: 0, offsetY: 0 };

const makeProps = (overrides = {}) => {
  const panOffsetRef = { current: { x: 0, y: 0 } };
  const zoomLevelRef = { current: 1 };
  return {
    containerRef: { current: null },
    panOffset: { x: 0, y: 0 }, panOffsetRef,
    zoomLevel: 1, zoomLevelRef,
    canvasSize: CANVAS_SIZE,
    isPaused: false, activeGraphId: 'g',
    startDragForNode: vi.fn(() => true),
    handleMouseMove: vi.fn(), handleMouseUp: vi.fn(), handleMouseDown: vi.fn(),
    setPanStart: vi.fn(), setIsPanning: vi.fn(), setPanOffset: vi.fn(),
    setZoomLevel: vi.fn(),
    // Mirrors the real transform hook: refs are the live values the next move reads.
    setPanAndZoom: vi.fn((pan, zoom) => { panOffsetRef.current = pan; zoomLevelRef.current = zoom; }),
    stopPanMomentum: vi.fn(), isViewMoving: vi.fn(() => false),
    cancelConnectionDraw: vi.fn(),
    startZoomMomentum: vi.fn(), stopZoomMomentum: vi.fn(),
    storeActions: { setSelectedEdgeId: vi.fn(), clearSelectedEdgeIds: vi.fn(), openRightPanelNodeTab: vi.fn(), setRightPanelExpanded: vi.fn() },
    selectedInstanceIds: new Set(), setSelectedInstanceIds: vi.fn(),
    selectedEdgeId: null, selectedEdgeIds: new Set(),
    plusSign: null, setPlusSign: vi.fn(),
    nodeNamePrompt: { visible: false }, previewingNodeId: null,
    selectedNodeIdForPieMenu: null, setSelectedNodeIdForPieMenu: vi.fn(),
    drawingConnectionFrom: null, setDrawingConnectionFrom: vi.fn(),
    draggingNodeInfo: null, setDraggingNodeInfo: vi.fn(), draggingNodeInfoRef: { current: null },
    isAnimatingZoomRef: { current: false }, isPanningOrZooming: { current: false },
    panSourceRef: { current: null }, panVelocityHistoryRef: { current: [] },
    isMouseDown: { current: false }, mouseMoved: { current: false },
    startedOnNode: { current: false }, mouseInsideNode: { current: false },
    mouseDownPosition: { current: { x: 0, y: 0 } },
    recentlyPanned: false, setLastInteractionType: vi.fn(),
    groupControlPanelShouldShow: false, groupControlPanelVisible: false, setGroupControlPanelVisible: vi.fn(),
    connectionControlPanelShouldShow: false, connectionControlPanelVisible: false, setConnectionControlPanelVisible: vi.fn(),
    selectedGroup: null, setSelectedGroup: vi.fn(),
    isInsideNode: vi.fn(() => true),
    getNodeDimensions: vi.fn(() => ({ currentWidth: 200, currentHeight: 100 })),
    clampCoordinates: (x, y) => ({ x, y }),
    isTouchDeviceRef: { current: false }, suppressNextMouseDownRef: { current: false },
    nodes: [NODE_A],
    pinchRef: { current: { active: false } }, pinchSmoothingRef: { current: { lastFrameTime: 0 } },
    ignoreCanvasClick: { current: false },
    armGestureBlock: vi.fn(), scheduleGestureBlockClear: vi.fn(),
    // 1.0 drives the zoom easing to full, so the applied zoom equals the
    // finger-driven target and the transform can be checked exactly. Anchoring
    // is independent of this: a lower setting only makes the zoom lag.
    touchSettings: { zoomSensitivity: 1.0, panSensitivity: 0.5 },
    nodeLiftDelay: 250,
    tryToggleConnectionOrbAtPoint: vi.fn(() => false), trySelectConnectionAtPoint: vi.fn(() => false),
    abstractionCarouselVisibleRef: { current: false },
    ...overrides,
  };
};

let hookProps = null;
function Harness() {
  const divRef = useRef(null);
  hookProps.containerRef = divRef;
  const touch = useCanvasTouch(hookProps);
  const nodeHandlers = (node) => ({
    onTouchStart: (e) => touch.handleNodeTouchStart(node, e),
    onTouchMove: (e) => touch.handleNodeTouchMove(node, e),
    onTouchEnd: (e) => touch.handleNodeTouchEnd(node, e),
  });
  return (
    <div ref={divRef} data-testid="canvas-area"
      onTouchStart={touch.handleTouchStartCanvas}
      onTouchMove={touch.handleTouchMoveCanvas}
      onTouchEnd={touch.handleTouchEndCanvas}>
      <svg className="canvas">
        <g data-testid="nodeA" {...nodeHandlers(NODE_A)} />
      </svg>
    </div>
  );
}

const pts = (...list) => list.map(([x, y], i) => ({ clientX: x, clientY: y, identifier: i }));
const ev = (list) => ({ touches: list, targetTouches: list, changedTouches: list });

// jsdom gives elements a zero-sized rect, which the pinch math divides by.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON() { } };
  };
});

// Same projection useCanvasTransform writes to the content <g>.
const screenOf = (world, props) => {
  const pan = props.panOffsetRef.current;
  const zoom = props.zoomLevelRef.current;
  return {
    x: (world.x - CANVAS_SIZE.offsetX) * zoom + pan.x,
    y: (world.y - CANVAS_SIZE.offsetY) * zoom + pan.y,
  };
};

// With the container at the viewport origin and an identity start transform, the
// world point under a client point is that client point.
const startPinch = (canvas, a, b) => fireEvent.touchStart(canvas, ev(pts(a, b)));

describe('pinch calibration', () => {
  it('holds the grabbed point under the midpoint through a symmetric spread', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const canvas = screen.getByTestId('canvas-area');

    startPinch(canvas, [400, 400], [600, 400]);
    const anchor = { ...props.pinchRef.current.centerWorld };
    expect(anchor).toEqual({ x: 500, y: 400 });

    for (const [a, b] of [[[350, 400], [650, 400]], [[250, 400], [750, 400]], [[200, 400], [800, 400]]]) {
      fireEvent.touchMove(canvas, ev(pts(a, b)));
      const s = screenOf(anchor, props);
      expect(s.x).toBeCloseTo(500, 6);
      expect(s.y).toBeCloseTo(400, 6);
    }
    expect(props.zoomLevelRef.current).toBeCloseTo(3, 6);
  });

  it('moves the content 1:1 with the midpoint when both fingers translate', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const canvas = screen.getByTestId('canvas-area');

    startPinch(canvas, [400, 400], [600, 400]);
    const anchor = { ...props.pinchRef.current.centerWorld };

    // Distance held constant, so this is a pure two-finger translate: the
    // content has to follow the fingers exactly. A low-pass on the anchor used
    // to eat 10% of every step, sliding the view out from under them.
    for (const d of [20, 40, 60, 80, 100]) {
      fireEvent.touchMove(canvas, ev(pts([400 + d, 400 + d], [600 + d, 400 + d])));
      const s = screenOf(anchor, props);
      expect(s.x).toBeCloseTo(500 + d, 6);
      expect(s.y).toBeCloseTo(400 + d, 6);
    }
    expect(props.zoomLevelRef.current).toBeCloseTo(1, 6);
  });

  it('keeps both fingers on their content when one stays put and the other spreads', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const canvas = screen.getByTestId('canvas-area');

    // The asymmetric pinch — a finger parked on a node while the other pulls
    // away — is where an anchor that drifts shows up worst: the midpoint travels
    // the whole time, so the error accumulates for the length of the gesture.
    startPinch(canvas, [400, 400], [600, 400]);
    const underA = { x: 400, y: 400 };
    const underB = { x: 600, y: 400 };

    for (const bx of [650, 700, 750, 800]) {
      fireEvent.touchMove(canvas, ev(pts([400, 400], [bx, 400])));
      expect(screenOf(underA, props).x).toBeCloseTo(400, 6);
      expect(screenOf(underB, props).x).toBeCloseTo(bx, 6);
    }
  });

  it('anchors the same way when the pinch starts on a node', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const canvas = screen.getByTestId('canvas-area');
    const nodeA = screen.getByTestId('nodeA');

    // The second finger hands the gesture to the canvas (see the pinch-on-node
    // tests); it must anchor at the midpoint of both fingers, not at either one.
    fireEvent.touchStart(nodeA, ev(pts([400, 400])));
    fireEvent.touchStart(nodeA, ev(pts([400, 400], [600, 400])));
    expect(props.pinchRef.current.centerWorld).toEqual({ x: 500, y: 400 });

    const underA = { x: 400, y: 400 };
    fireEvent.touchMove(canvas, ev(pts([400, 400], [700, 400])));
    expect(screenOf(underA, props).x).toBeCloseTo(400, 6);
  });

  it('leaves the glide anchored where the pinch ended', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const canvas = screen.getByTestId('canvas-area');

    startPinch(canvas, [400, 400], [600, 400]);
    fireEvent.touchMove(canvas, ev(pts([300, 420], [700, 420])));
    fireEvent.touchEnd(canvas, { touches: [], targetTouches: [], changedTouches: pts([300, 420], [700, 420]) });

    // The glide re-applies pan = anchorClient - anchorWorld * zoom every frame,
    // so the pair it is handed has to reproduce the transform the last pinch
    // frame left behind — otherwise the view jumps at the moment of release.
    const [, anchorClient, anchorWorld] = props.startZoomMomentum.mock.calls[0];
    const pan = props.panOffsetRef.current;
    const zoom = props.zoomLevelRef.current;
    expect(anchorClient.x - (anchorWorld.x - CANVAS_SIZE.offsetX) * zoom).toBeCloseTo(pan.x, 6);
    expect(anchorClient.y - (anchorWorld.y - CANVAS_SIZE.offsetY) * zoom).toBeCloseTo(pan.y, 6);
  });
});
