import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useCanvasTouch } from '../../src/hooks/useCanvasTouch';

vi.mock('../../src/services/haptics.js', () => ({ haptic: () => { } }));

const NODE_A = { id: 'inst-a', prototypeId: 'p', name: 'A', x: 0, y: 0 };
const NODE_B = { id: 'inst-b', prototypeId: 'p', name: 'B', x: 400, y: 0 };

const makeProps = (overrides = {}) => ({
  containerRef: { current: null },
  panOffset: { x: 0, y: 0 }, panOffsetRef: { current: { x: 0, y: 0 } },
  zoomLevel: 1, zoomLevelRef: { current: 1 },
  canvasSize: { width: 4000, height: 4000, offsetX: 0, offsetY: 0 },
  isPaused: false, activeGraphId: 'g',
  startDragForNode: vi.fn(() => true),
  handleMouseMove: vi.fn(), handleMouseUp: vi.fn(), handleMouseDown: vi.fn(),
  setPanStart: vi.fn(), setIsPanning: vi.fn(), setPanOffset: vi.fn(),
  setZoomLevel: vi.fn(), setPanAndZoom: vi.fn(),
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
  nodes: [NODE_A, NODE_B],
  pinchRef: { current: { active: false } }, pinchSmoothingRef: { current: { lastFrameTime: 0 } },
  ignoreCanvasClick: { current: false },
  armGestureBlock: vi.fn(), scheduleGestureBlockClear: vi.fn(),
  touchSettings: { zoomSensitivity: 0.7, panSensitivity: 0.5 },
  nodeLiftDelay: 250,
  tryToggleConnectionOrbAtPoint: vi.fn(() => false), trySelectConnectionAtPoint: vi.fn(() => false),
  abstractionCarouselVisibleRef: { current: false },
  ...overrides,
});

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
        <g data-testid="nodeB" {...nodeHandlers(NODE_B)} />
      </svg>
    </div>
  );
}

const pts = (...list) => list.map(([x, y], i) => ({ clientX: x, clientY: y, identifier: i }));
const ev = (list) => ({ touches: list, targetTouches: list, changedTouches: list });

// jsdom gives elements a zero-sized rect, which the pinch math divides by. Give
// the container a real one so setPanAndZoom is reached.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON() { } };
  };
});

describe('a second finger turns a node gesture into a pinch', () => {
  it('abandons an in-flight connection draw when the second finger lands on canvas', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const canvas = screen.getByTestId('canvas-area');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchMove(nodeA, ev(pts([100, 140]))); // past the 12px threshold
    expect(props.setDrawingConnectionFrom).toHaveBeenCalled();  // draw is live

    fireEvent.touchStart(canvas, ev(pts([100, 140], [300, 300])));

    expect(props.pinchRef.current.active).toBe(true);
    expect(props.cancelConnectionDraw).toHaveBeenCalled();
  });

  it('still zooms after the draw is abandoned', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const canvas = screen.getByTestId('canvas-area');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchMove(nodeA, ev(pts([100, 140])));
    fireEvent.touchStart(canvas, ev(pts([100, 140], [300, 300])));
    // Spread. Previously the leftover dragNodeId made handleTouchMoveCanvas bail
    // on every frame, so the pinch was set up and then never applied.
    fireEvent.touchMove(canvas, ev(pts([80, 140], [340, 340])));

    expect(props.setPanAndZoom).toHaveBeenCalled();
  });

  it('starts a pinch when BOTH fingers land on nodes', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const nodeB = screen.getByTestId('nodeB');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    // A node touchstart stops propagation, so before the multi-touch hand-off the
    // canvas never saw this finger at all and no pinch could ever start.
    fireEvent.touchStart(nodeB, ev(pts([100, 100], [500, 100])));

    expect(props.pinchRef.current.active).toBe(true);

    fireEvent.touchMove(nodeB, ev(pts([80, 100], [520, 100])));
    expect(props.setPanAndZoom).toHaveBeenCalled();
  });

  it('never draws a connection once two fingers are down', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const nodeB = screen.getByTestId('nodeB');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchStart(nodeB, ev(pts([100, 100], [500, 100])));
    props.setDrawingConnectionFrom.mockClear();

    // Finger one travels well past the connection threshold during the pinch.
    fireEvent.touchMove(nodeA, ev(pts([100, 300], [500, 100])));
    fireEvent.touchMove(nodeA, ev(pts([100, 400], [500, 100])));

    expect(props.setDrawingConnectionFrom).not.toHaveBeenCalled();
    expect(props.startDragForNode).not.toHaveBeenCalled();
  });

  // Both touchends land on nodes, and handleNodeTouchEnd stops propagation, so
  // nothing would reach the canvas teardown. A pinch left active permanently
  // blocks panning, since the pan branch is gated on it.
  it('tears the pinch down when both fingers lift off nodes', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const nodeB = screen.getByTestId('nodeB');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchStart(nodeB, ev(pts([100, 100], [500, 100])));
    expect(props.pinchRef.current.active).toBe(true);

    fireEvent.touchEnd(nodeA, { touches: pts([500, 100]), targetTouches: [], changedTouches: pts([100, 100]) });
    fireEvent.touchEnd(nodeB, { touches: [], targetTouches: [], changedTouches: pts([500, 100]) });

    expect(props.pinchRef.current.active).toBe(false);
  });

  it('leaves an in-flight node drag alone', () => {
    const props = makeProps({ draggingNodeInfoRef: { current: { instanceId: 'inst-a' } } });
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');
    const nodeB = screen.getByTestId('nodeB');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchStart(nodeB, ev(pts([100, 100], [500, 100])));

    // The drag keeps the gesture; no pinch, and its bookkeeping is untouched.
    expect(props.pinchRef.current.active).toBe(false);
    expect(props.cancelConnectionDraw).not.toHaveBeenCalled();
  });

  it('leaves the one-finger draw alone', () => {
    const props = makeProps();
    hookProps = props;
    render(<Harness />);
    const nodeA = screen.getByTestId('nodeA');

    fireEvent.touchStart(nodeA, ev(pts([100, 100])));
    fireEvent.touchMove(nodeA, ev(pts([100, 140])));

    expect(props.setDrawingConnectionFrom).toHaveBeenCalled();
    expect(props.cancelConnectionDraw).not.toHaveBeenCalled();
    expect(props.pinchRef.current.active).toBe(false);
  });
});
