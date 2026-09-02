import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useCanvasTouch } from '../../src/hooks/useCanvasTouch';

vi.mock('../../src/services/haptics.js', () => ({ haptic: () => { } }));

const NODE = { id: 'inst-1', prototypeId: 'proto-1', name: 'Node', x: 0, y: 0 };

const makeProps = (overrides = {}) => ({
  containerRef: { current: null },
  panOffset: { x: 0, y: 0 },
  panOffsetRef: { current: { x: 0, y: 0 } },
  zoomLevel: 1,
  zoomLevelRef: { current: 1 },
  canvasSize: { width: 4000, height: 4000, offsetX: 0, offsetY: 0 },
  isPaused: false,
  activeGraphId: 'graph-1',
  startDragForNode: vi.fn(() => true),
  handleMouseMove: vi.fn(),
  handleMouseUp: vi.fn(),
  handleMouseDown: vi.fn(),
  setPanStart: vi.fn(),
  setIsPanning: vi.fn(),
  setPanOffset: vi.fn(),
  setZoomLevel: vi.fn(),
  setPanAndZoom: vi.fn(),
  stopPanMomentum: vi.fn(),
  isViewMoving: vi.fn(() => false),
  startZoomMomentum: vi.fn(),
  stopZoomMomentum: vi.fn(),
  storeActions: { setSelectedEdgeId: vi.fn(), clearSelectedEdgeIds: vi.fn(), openRightPanelNodeTab: vi.fn(), setRightPanelExpanded: vi.fn() },
  selectedInstanceIds: new Set(),
  setSelectedInstanceIds: vi.fn(),
  selectedEdgeId: null,
  selectedEdgeIds: new Set(),
  plusSign: null,
  setPlusSign: vi.fn(),
  nodeNamePrompt: { visible: false },
  previewingNodeId: null,
  selectedNodeIdForPieMenu: null,
  setSelectedNodeIdForPieMenu: vi.fn(),
  drawingConnectionFrom: null,
  setDrawingConnectionFrom: vi.fn(),
  draggingNodeInfo: null,
  setDraggingNodeInfo: vi.fn(),
  draggingNodeInfoRef: { current: null },
  isAnimatingZoomRef: { current: false },
  isPanningOrZooming: { current: false },
  panSourceRef: { current: null },
  panVelocityHistoryRef: { current: [] },
  isMouseDown: { current: false },
  mouseMoved: { current: false },
  startedOnNode: { current: false },
  mouseInsideNode: { current: false },
  mouseDownPosition: { current: { x: 0, y: 0 } },
  recentlyPanned: false,
  setLastInteractionType: vi.fn(),
  groupControlPanelShouldShow: false,
  groupControlPanelVisible: false,
  setGroupControlPanelVisible: vi.fn(),
  connectionControlPanelShouldShow: false,
  connectionControlPanelVisible: false,
  setConnectionControlPanelVisible: vi.fn(),
  selectedGroup: null,
  setSelectedGroup: vi.fn(),
  isInsideNode: vi.fn(() => true),
  getNodeDimensions: vi.fn(() => ({ currentWidth: 200, currentHeight: 100 })),
  clampCoordinates: (x, y) => ({ x, y }),
  isTouchDeviceRef: { current: false },
  suppressNextMouseDownRef: { current: false },
  nodes: [NODE],
  pinchRef: { current: { active: false } },
  pinchSmoothingRef: { current: { lastFrameTime: 0 } },
  ignoreCanvasClick: { current: false },
  armGestureBlock: vi.fn(),
  scheduleGestureBlockClear: vi.fn(),
  touchSettings: { zoomSensitivity: 0.7, panSensitivity: 0.5 },
  nodeLiftDelay: 250,
  tryToggleConnectionOrbAtPoint: vi.fn(() => false),
  trySelectConnectionAtPoint: vi.fn(() => false),
  abstractionCarouselVisibleRef: { current: false },
  ...overrides,
});

// Mirrors the real tree: canvas-area div > svg.canvas > g (node), with the same
// handlers NodeCanvas wires up, so bubbling behaves like it does in the app.
let hookProps = null;
function Harness() {
  const divRef = useRef(null);
  hookProps.containerRef = divRef;
  const touch = useCanvasTouch(hookProps);
  return (
    <div
      ref={divRef}
      data-testid="canvas-area"
      onTouchStart={touch.handleTouchStartCanvas}
      onTouchMove={touch.handleTouchMoveCanvas}
      onTouchEnd={touch.handleTouchEndCanvas}
    >
      <svg className="canvas">
        <g
          data-testid="node"
          onPointerDown={(e) => touch.handleNodePointerDown(NODE, e)}
          onTouchStart={(e) => touch.handleNodeTouchStart(NODE, e)}
          onTouchMove={(e) => touch.handleNodeTouchMove(NODE, e)}
          onTouchEnd={(e) => touch.handleNodeTouchEnd(NODE, e)}
        />
      </svg>
    </div>
  );
}

const touchAt = (x, y) => [{ clientX: x, clientY: y, identifier: 0 }];

describe('touch on a node while the view is coasting', () => {
  let props;
  beforeEach(() => {
    props = makeProps({ isViewMoving: vi.fn(() => true) });
    hookProps = props;
    render(<Harness />);
  });

  it('hands the gesture to the canvas pan pipeline', () => {
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });

    expect(props.stopPanMomentum).toHaveBeenCalled();
    expect(props.handleMouseDown).toHaveBeenCalled();
    expect(props.startDragForNode).not.toHaveBeenCalled();
  });

  it('keeps panning as the finger moves across the node', () => {
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });
    // The glide is stopped by the touchdown, so any later re-entry sees a still view.
    props.isViewMoving.mockReturnValue(false);

    fireEvent.touchMove(node, { touches: touchAt(160, 140), targetTouches: touchAt(160, 140), changedTouches: touchAt(160, 140) });
    fireEvent.touchMove(node, { touches: touchAt(220, 190), targetTouches: touchAt(220, 190), changedTouches: touchAt(220, 190) });

    expect(props.handleMouseMove).toHaveBeenCalledTimes(2);
    expect(props.setDrawingConnectionFrom).not.toHaveBeenCalled();
  });

  // pointerdown and touchstart both reach handleNodeTouchStart for the same
  // finger. Whichever lands second sees a view the first one already stopped, so
  // the verdict has to stick for the gesture rather than being re-derived.
  it('keeps the canvas panning when the second entry sees a stopped view', () => {
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });
    // handleMouseDown is mocked, so mirror the pan state it would have set.
    props.isMouseDown.current = true;
    props.isViewMoving.mockReturnValue(false);
    props.handleMouseDown.mockClear();

    // The duplicate entry for the same finger (the pointer pass).
    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });

    // It must not arm the node, and must not start a second pan.
    expect(props.startedOnNode.current).toBe(false);
    expect(props.handleMouseDown).not.toHaveBeenCalled();

    fireEvent.touchMove(node, { touches: touchAt(160, 140), targetTouches: touchAt(160, 140), changedTouches: touchAt(160, 140) });
    expect(props.handleMouseMove).toHaveBeenCalledTimes(1);
    expect(props.setDrawingConnectionFrom).not.toHaveBeenCalled();
  });

  it('releases without spawning a plus sign', () => {
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });
    props.isViewMoving.mockReturnValue(false);
    fireEvent.touchEnd(node, { touches: [], targetTouches: [], changedTouches: touchAt(100, 100) });

    expect(props.setPlusSign).not.toHaveBeenCalled();
    expect(props.handleMouseUp).toHaveBeenCalled();
  });
});

describe('touch on a node while the view is still', () => {
  it('is handled by the node as usual', () => {
    const props = makeProps({ isViewMoving: vi.fn(() => false) });
    hookProps = props;
    render(<Harness />);
    const node = screen.getByTestId('node');

    fireEvent.touchStart(node, { touches: touchAt(100, 100), targetTouches: touchAt(100, 100), changedTouches: touchAt(100, 100) });

    // Node claimed it: the canvas pan pipeline never saw the touch.
    expect(props.handleMouseDown).not.toHaveBeenCalled();
    expect(props.isMouseDown.current).toBe(true);
    expect(props.startedOnNode.current).toBe(true);
  });
});
