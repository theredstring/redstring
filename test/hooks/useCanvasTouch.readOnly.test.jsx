import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useCanvasTouch } from '../../src/hooks/useCanvasTouch';
import { setReadOnlyUniverse } from '../../src/store/readOnlyUniverse.js';
import { seedTouchStores, groupTouchProps } from './seedCanvasTouchStores.js';

vi.mock('../../src/services/haptics.js', () => ({ haptic: () => { } }));

const NODE = { id: 'inst-1', prototypeId: 'proto-1', name: 'Node', x: 0, y: 0 };

const makeProps = () => ({
  containerRef: { current: null },
  panOffsetRef: { current: { x: 0, y: 0 } },
  zoomLevelRef: { current: 1 },
  canvasSize: { width: 4000, height: 4000, offsetX: 0, offsetY: 0 },
  activeGraphId: 'graph-1',
  startDragForNode: vi.fn(() => false),
  handleMouseMove: vi.fn(),
  handleMouseUp: vi.fn(),
  handleMouseDown: vi.fn(),
  setPanStart: vi.fn(),
  setIsPanning: vi.fn(),
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
});

let hookProps = null;
function Harness() {
  const divRef = useRef(null);
  hookProps.containerRef = divRef;
  const touch = useCanvasTouch(groupTouchProps(hookProps));
  return (
    <div
      ref={divRef}
      data-testid="canvas-area"
      onTouchStart={touch.handleTouchStartCanvas}
      onTouchMove={touch.handleTouchMoveCanvas}
      onTouchEnd={touch.handleTouchEndCanvas}
    >
      <svg className="canvas" data-testid="canvas">
        <g
          data-testid="node"
          onTouchStart={(e) => touch.handleNodeTouchStart(NODE, e)}
          onTouchMove={(e) => touch.handleNodeTouchMove(NODE, e)}
          onTouchEnd={(e) => touch.handleNodeTouchEnd(NODE, e)}
        />
      </svg>
    </div>
  );
}

const at = (x, y) => {
  const touches = [{ clientX: x, clientY: y, identifier: 0 }];
  return { touches, targetTouches: touches, changedTouches: touches };
};
const lifted = (x, y) => ({ ...at(x, y), touches: [], targetTouches: [] });

describe('a finger on a Thing', () => {
  let props;
  beforeEach(() => {
    props = makeProps();
    hookProps = props;
    seedTouchStores(props);
  });
  afterEach(() => setReadOnlyUniverse(null));

  const readOnly = () => setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://example.com/a.redstring' });

  it('draws a connection in a universe of your own', () => {
    render(<Harness />);
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, at(100, 100));
    fireEvent.touchMove(node, at(160, 100));

    expect(props.setDrawingConnectionFrom).toHaveBeenCalledTimes(1);
    expect(props.handleMouseDown).not.toHaveBeenCalled();
  });

  it('pans a read-only universe instead, and its release is no tap', () => {
    readOnly();
    render(<Harness />);
    const node = screen.getByTestId('node');
    fireEvent.touchStart(node, at(100, 100));
    fireEvent.touchMove(node, at(160, 100));

    expect(props.setDrawingConnectionFrom).not.toHaveBeenCalled();
    expect(props.startDragForNode).not.toHaveBeenCalled();
    expect(props.handleMouseDown).toHaveBeenCalledTimes(1);
    expect(props.handleMouseDown.mock.calls[0][0].clientX).toBe(160);

    props.handleMouseMove.mockClear();
    fireEvent.touchMove(node, at(220, 140));
    expect(props.handleMouseMove).toHaveBeenCalledTimes(1);
    expect(props.handleMouseMove.mock.calls[0][0].clientX).toBe(220);

    fireEvent.touchEnd(node, lifted(220, 140));
    expect(props.handleMouseUp).toHaveBeenCalled();
    expect(props.setPlusSign).not.toHaveBeenCalled();
    expect(props.setSelectedInstanceIds).not.toHaveBeenCalled();
  });

  it('that lifts where it landed is still a tap on it', () => {
    readOnly();
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const node = screen.getByTestId('node');
      fireEvent.touchStart(node, at(100, 100));
      fireEvent.touchEnd(node, lifted(100, 100));
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(props.handleMouseDown).not.toHaveBeenCalled();
    expect(props.setSelectedInstanceIds).toHaveBeenCalled();
  });
});

describe('a tap on bare canvas', () => {
  let props;
  beforeEach(() => {
    props = makeProps();
    hookProps = props;
    seedTouchStores(props);
    render(<Harness />);
  });
  afterEach(() => setReadOnlyUniverse(null));

  const tap = () => {
    const canvas = screen.getByTestId('canvas');
    fireEvent.touchStart(canvas, at(100, 100));
    props.mouseDownPosition.current = { x: 100, y: 100 };
    fireEvent.touchEnd(canvas, lifted(100, 100));
  };

  it('makes a plus sign in a universe of your own', () => {
    tap();
    expect(props.setPlusSign).toHaveBeenCalledTimes(1);
  });

  it('makes nothing in a read-only universe', () => {
    setReadOnlyUniverse({ slug: 'visit', name: 'Visit', sourceUrl: 'https://example.com/a.redstring' });
    tap();
    expect(props.setPlusSign).not.toHaveBeenCalled();
  });
});
